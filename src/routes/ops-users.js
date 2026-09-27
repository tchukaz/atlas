import crypto from 'node:crypto';
import { Router } from 'express';
import { SITE_URL } from '../config.js';
import { esc } from '../views.js';
import { opsPage as page, flashOf, back, pretty } from '../views-ops.js';
import { hashPassword, record, requireCan, revokeAllFor } from '../auth.js';

import { ROLES, ROLE_KEYS } from '../permissions.js';
import { Audit, Session, User } from '../models.js';
import { RETENTION_CHOICES, getSettings, purgeExpiredSensitive, setSetting } from '../settings.js';
import { sendInvite } from '../email.js';

const router = Router();

/* ── Staff ─────────────────────────────────────────────────────────────── */

router.get('/ops/team', requireCan('users.manage'), async (req, res) => {
  const [users, sessions] = await Promise.all([
    User.find().sort('name').lean(),
    Session.aggregate([{ $group: { _id: '$user', n: { $sum: 1 } } }])
  ]);
  const active = new Map(sessions.map((s) => [String(s._id), s.n]));

  const rows = users
    .map(
      (u) => `<tr${u.active ? '' : ' style="opacity:0.45;"'}>
      <td data-h="Person"><strong>${esc(u.name)}</strong>${u.active ? '' : ' <span class="muted">(disabled)</span>'}<br/>
        <span class="muted" style="font-size:11px;">${esc(u.email)}</span>
        ${u.inviteToken ? '<br/><span class="pill">invite not accepted</span>' : ''}</td>
      <td data-h="Role">
        <form method="post" action="/ops/team/role" style="display:flex;gap:6px;align-items:center;">
          <input type="hidden" name="id" value="${u._id}"/>
          <select name="role">
            ${ROLE_KEYS.map(
              (r) => `<option value="${r}"${r === u.role ? ' selected' : ''}>${esc(ROLES[r].label)}</option>`
            ).join('')}
          </select>
          <button type="submit">Save</button>
        </form>
      </td>
      <td data-h="Signed in">${active.get(String(u._id)) || 0}
        ${
          active.get(String(u._id))
            ? `<form method="post" action="/ops/team/revoke" style="margin-top:4px;">
                 <input type="hidden" name="id" value="${u._id}"/>
                 <button type="submit" class="ghost">Sign out</button></form>`
            : ''
        }</td>
      <td data-h="Last seen">${u.lastLoginAt ? pretty(u.lastLoginAt) : '<span class="muted">never</span>'}</td>
      <td>
        <form method="post" action="/ops/team/active">
          <input type="hidden" name="id" value="${u._id}"/>
          <button type="submit" class="ghost">${u.active ? 'Disable' : 'Enable'}</button>
        </form>
      </td>
    </tr>`
    )
    .join('');

  res.type('html').send(
    page({
      title: 'Team',
      active: '/ops/team',
      user: req.user,
      ...flashOf(req),
      breadcrumb: [['More', '#more'], ['Team', null]],
      body: `
  <div class="card scroll">
    <table class="stack"><thead><tr>
      <th>Person</th><th>Role</th><th>Signed in</th><th>Last seen</th><th></th>
    </tr></thead><tbody>${rows}</tbody></table>
  </div>

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">Invite someone</h2>
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      They get an email with a link to set their own password — you never handle it.
    </p>
    <form method="post" action="/ops/team" class="grid">
      <div><label>Name</label><input name="name" required maxlength="60"/></div>
      <div><label>Email</label><input name="email" type="email" required maxlength="120"/></div>
      <div><label>Role</label><select name="role">
        ${ROLE_KEYS.map((r) => `<option value="${r}">${esc(ROLES[r].label)}</option>`).join('')}
      </select></div>
      <div><button type="submit">Send invite</button></div>
    </form>
  </div>

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">What each role can do</h2>
    ${ROLE_KEYS.map(
      (r) => `<p class="muted" style="font-size:13px;margin-bottom:8px;">
        <strong style="color:#F5F0E8;">${esc(ROLES[r].label)}</strong> — ${esc(ROLES[r].hint)}</p>`
    ).join('')}
    <p class="muted" style="font-size:12px;margin-top:14px;">
      Keep people on the role that matches the job. Someone who cannot do what
      they need will borrow a colleague's login, and then the record of who did
      what is worth nothing.
    </p>
  </div>`
    })
  );
});

router.post('/ops/team', requireCan('users.manage'), async (req, res) => {
  const { name, email, role } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  if (!cleanEmail || !String(name || '').trim()) {
    return back(res, '/ops/team', { err: 'Name and email are both needed.' });
  }
  if (await User.exists({ email: cleanEmail })) {
    return back(res, '/ops/team', { err: 'Someone already has that email.' });
  }

  const inviteToken = crypto.randomBytes(24).toString('hex');
  const user = await User.create({
    name: String(name).trim().slice(0, 60),
    email: cleanEmail,
    role: ROLE_KEYS.includes(role) ? role : 'frontdesk',
    inviteToken,
    inviteExpires: new Date(Date.now() + 7 * 86_400_000)
  });

  await record(req, 'user.invited', user.email, `as ${user.role}`);
  sendInvite(user, `${SITE_URL}/admin/accept/${inviteToken}`).catch((err) =>
    console.error('invite email failed:', err.message)
  );

  back(res, '/ops/team', {
    msg: `Invited ${user.name}. The link expires in 7 days.`
  });
});

router.post('/ops/team/role', requireCan('users.manage'), async (req, res) => {
  const user = await User.findById(req.body?.id);
  if (!user) return back(res, '/ops/team', { err: 'No such person.' });

  const role = ROLE_KEYS.includes(req.body?.role) ? req.body.role : user.role;
  if (user.role === 'owner' && role !== 'owner') {
    const owners = await User.countDocuments({ role: 'owner', active: true });
    if (owners <= 1) {
      return back(res, '/ops/team', { err: 'That is the only owner — promote someone else first.' });
    }
  }

  user.role = role;
  await user.save();
  await record(req, 'user.role_changed', user.email, `now ${role}`);
  back(res, '/ops/team', { msg: `${user.name} is now ${ROLES[role].label}.` });
});

router.post('/ops/team/active', requireCan('users.manage'), async (req, res) => {
  const user = await User.findById(req.body?.id);
  if (!user) return back(res, '/ops/team', { err: 'No such person.' });

  if (user.active && user.role === 'owner') {
    const owners = await User.countDocuments({ role: 'owner', active: true });
    if (owners <= 1) return back(res, '/ops/team', { err: 'You cannot disable the only owner.' });
  }
  if (String(user._id) === String(req.user._id) && user.active) {
    return back(res, '/ops/team', { err: 'Disabling yourself would lock you out.' });
  }

  user.active = !user.active;
  await user.save();
  // Disabling has to end their sessions or they stay signed in until expiry.
  if (!user.active) await revokeAllFor(user._id);
  await record(req, user.active ? 'user.enabled' : 'user.disabled', user.email);
  back(res, '/ops/team', { msg: `${user.name} ${user.active ? 'enabled' : 'disabled'}.` });
});

router.post('/ops/team/revoke', requireCan('users.manage'), async (req, res) => {
  const user = await User.findById(req.body?.id);
  if (!user) return back(res, '/ops/team', { err: 'No such person.' });
  await revokeAllFor(user._id);
  await record(req, 'user.sessions_revoked', user.email);
  back(res, '/ops/team', { msg: `Signed ${user.name} out everywhere.` });
});

/* ── Settings ──────────────────────────────────────────────────────────── */

router.get('/ops/settings', requireCan('settings.manage'), async (req, res) => {
  const settings = await getSettings();
  const preview = await purgeExpiredSensitive({ dryRun: true });

  res.type('html').send(
    page({
      title: 'Settings',
      active: '/ops/settings',
      user: req.user,
      ...flashOf(req),
      breadcrumb: [['More', '#more'], ['Settings', null]],
      body: `
  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">How long to keep identity documents</h2>
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      Applies only to records ticked <strong style="color:#F5F0E8;">identity details</strong>.
      Apartment photos and receipts are never touched. Scans kept indefinitely are a liability with
      no upside once the guest has gone — but nothing is deleted until you choose a period here.
    </p>
    <form method="post" action="/ops/settings" class="grid">
      <div><label>Keep for</label>
        <select name="sensitiveRetentionDays">
          ${RETENTION_CHOICES.map(
            (c) =>
              `<option value="${c.value}"${
                Number(settings.sensitiveRetentionDays) === c.value ? ' selected' : ''
              }>${esc(c.label)}</option>`
          ).join('')}
        </select></div>
      <div><button type="submit">Save</button></div>
    </form>
    <p class="muted" style="font-size:13px;margin-top:16px;">
      ${
        preview.skipped
          ? 'Nothing is being deleted — retention is set to keep forever.'
          : `${preview.deleted} record(s) are currently older than ${preview.days} days and would be
             removed at the next nightly sweep.`
      }
    </p>
    <form method="post" action="/ops/settings/purge" style="margin-top:10px;"
          onsubmit="return confirm('Delete expired identity documents now? This cannot be undone.');">
      <button type="submit" class="ghost">Run the sweep now</button>
    </form>
  </div>`
    })
  );
});

router.post('/ops/settings', requireCan('settings.manage'), async (req, res) => {
  const allowed = RETENTION_CHOICES.map((c) => c.value);
  const chosen = Number(req.body?.sensitiveRetentionDays);
  if (!allowed.includes(chosen)) return back(res, '/ops/settings', { err: 'Pick one of the options.' });

  await setSetting('sensitiveRetentionDays', chosen);
  await record(req, 'settings.retention', 'sensitiveRetentionDays', String(chosen));
  back(res, '/ops/settings', {
    msg: chosen ? `Identity documents will be kept for ${chosen} days.` : 'Identity documents will be kept indefinitely.'
  });
});

router.post('/ops/settings/purge', requireCan('settings.manage'), async (req, res) => {
  const result = await purgeExpiredSensitive();
  if (result.skipped) return back(res, '/ops/settings', { err: `Nothing to do — ${result.reason}.` });
  await record(req, 'settings.purge_run', 'sensitive records', `${result.deleted} deleted`);
  back(res, '/ops/settings', { msg: `Deleted ${result.deleted} expired record(s).` });
});

/* ── Audit ─────────────────────────────────────────────────────────────── */

router.get('/ops/activity', requireCan('users.manage'), async (req, res) => {
  const entries = await Audit.find().sort('-at').limit(300).lean();

  const rows = entries.length
    ? entries
        .map(
          (a) => `<tr>
      <td data-h="When">${pretty(a.at)}<br/>
        <span class="muted" style="font-size:11px;">${new Date(a.at).toISOString().slice(11, 16)}</span></td>
      <td data-h="Who"><strong>${esc(a.actorName)}</strong><br/>
        <span class="muted" style="font-size:11px;">${esc(a.actorEmail)}</span></td>
      <td data-h="Did"><span class="mono">${esc(a.action)}</span></td>
      <td data-h="What">${esc(a.target || '')}
        ${a.detail ? `<br/><span class="muted" style="font-size:11px;">${esc(a.detail)}</span>` : ''}</td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="4" class="muted" style="padding:24px 10px;">Nothing recorded yet.</td></tr>`;

  res.type('html').send(
    page({
      title: 'Activity',
      active: '/ops/activity',
      user: req.user,
      ...flashOf(req),
      breadcrumb: [['More', '#more'], ['Activity', null]],
      body: `
  <div class="card">
    <p class="muted" style="font-size:13px;margin:0;">
      Money moved, documents opened, accounts changed. This is the part that settles an argument
      about who did what.
    </p>
  </div>
  <div class="card scroll">
    <table class="stack"><thead><tr>
      <th>When</th><th>Who</th><th>Did</th><th>What</th>
    </tr></thead><tbody>${rows}</tbody></table>
  </div>`
    })
  );
});

export default router;
