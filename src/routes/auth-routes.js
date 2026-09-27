import { Router } from 'express';
import { esc, layout } from '../views.js';
import {
  closeSession,
  hashPassword,
  openSession,
  record,
  verifyPassword
} from '../auth.js';
import { User } from '../models.js';

const router = Router();

// Per account as well as per IP: an attacker on a phone network changes address
// far more easily than they change which account they are guessing at.
const failures = new Map();

const noteFailure = (key) => {
  const now = Date.now();
  const rec = failures.get(key) || { count: 0, until: 0 };
  if (now > rec.until) rec.count = 0;
  rec.count += 1;
  if (rec.count >= 5) {
    rec.count = 0;
    rec.until = now + 5 * 60_000;
  }
  failures.set(key, rec);
};

const lockedOut = (key) => Date.now() < (failures.get(key)?.until || 0);

const shell = ({ title, message, tone = 'bad', body }) =>
  layout({
    title: `Atlas House — ${esc(title)}`,
    body: `
  <p class="eyebrow">Atlas House</p>
  <h1>${esc(title)}</h1>
  ${message ? `<div class="notice ${tone === 'bad' ? 'bad' : ''}" style="margin-top:20px;">${esc(message)}</div>` : ''}
  ${body}`
  });

const loginPage = ({ message = '', next = '' } = {}) =>
  shell({
    title: 'Sign in',
    message,
    body: `
  <form method="post" action="/admin/login" class="card" style="margin-top:24px;max-width:420px;">
    <input type="hidden" name="next" value="${esc(next)}"/>
    <label class="stat-label" for="email">Email</label>
    <input id="email" name="email" type="email" autocomplete="username"
           style="width:100%;margin:10px 0 18px;" required autofocus/>
    <label class="stat-label" for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password"
           style="width:100%;margin:10px 0 18px;" required/>
    <button type="submit">Sign in</button>
  </form>`
  });

router.get('/admin/login', (req, res) => {
  if (req.user) return res.redirect(302, '/ops/today');
  const next = typeof req.query.next === 'string' ? req.query.next : '';
  res.type('html').send(loginPage({ next }));
});

router.post('/admin/login', async (req, res) => {
  const email = String(req.body?.email || '').trim().toLowerCase();
  const ip = req.ip || 'unknown';
  const next = String(req.body?.next || '');

  if (lockedOut(ip) || lockedOut(email)) {
    return res.status(429).type('html').send(loginPage({ message: 'Too many attempts. Wait five minutes.' }));
  }

  const user = await User.findOne({ email });
  const ok = user?.active && (await verifyPassword(req.body?.password, user.passwordHash));

  if (!ok) {
    noteFailure(ip);
    if (email) noteFailure(email);
    // Deliberately the same message whether the address exists or not.
    return res.status(401).type('html').send(loginPage({ message: 'Those details did not work.', next }));
  }

  failures.delete(ip);
  failures.delete(email);
  await openSession(res, user, req);
  req.user = user;
  await record(req, 'auth.signed_in', user.email);

  res.redirect(302, next.startsWith('/ops') || next.startsWith('/admin') ? next : '/ops/today');
});

router.post('/admin/logout', async (req, res) => {
  if (req.user) await record(req, 'auth.signed_out', req.user.email);
  await closeSession(req, res);
  res.redirect(302, '/admin/login');
});

/* ── Accepting an invitation ───────────────────────────────────────────── */

const acceptPage = ({ token, name, message = '' }) =>
  shell({
    title: `Welcome, ${name}`,
    message,
    body: `
  <p class="muted" style="margin-top:12px;max-width:52ch;">
    Choose a password. Nobody else sees it, including whoever invited you.
  </p>
  <form method="post" action="/admin/accept/${esc(token)}" class="card" style="margin-top:20px;max-width:420px;">
    <label class="stat-label" for="password">New password</label>
    <input id="password" name="password" type="password" autocomplete="new-password" minlength="10"
           style="width:100%;margin:10px 0 18px;" required autofocus/>
    <label class="stat-label" for="confirm">Again</label>
    <input id="confirm" name="confirm" type="password" autocomplete="new-password" minlength="10"
           style="width:100%;margin:10px 0 18px;" required/>
    <button type="submit">Set password</button>
    <p class="muted" style="font-size:12px;margin-top:14px;">At least 10 characters.</p>
  </form>`
  });

const findInvitee = (token) =>
  User.findOne({ inviteToken: String(token || ''), inviteExpires: { $gt: new Date() } });

router.get('/admin/accept/:token', async (req, res) => {
  const user = await findInvitee(req.params.token);
  if (!user) {
    return res.status(404).type('html').send(
      shell({
        title: 'That link has expired',
        message: 'Invitations last seven days. Ask the owner to send another.',
        body: '<p class="muted"><a href="/admin/login">Sign in</a></p>'
      })
    );
  }
  res.type('html').send(acceptPage({ token: req.params.token, name: user.name.split(/\s+/)[0] }));
});

router.post('/admin/accept/:token', async (req, res) => {
  const user = await findInvitee(req.params.token);
  if (!user) return res.redirect(302, '/admin/login');

  const password = String(req.body?.password || '');
  const first = user.name.split(/\s+/)[0];

  if (password.length < 10) {
    return res.status(400).type('html').send(
      acceptPage({ token: req.params.token, name: first, message: 'At least 10 characters, please.' })
    );
  }
  if (password !== String(req.body?.confirm || '')) {
    return res.status(400).type('html').send(
      acceptPage({ token: req.params.token, name: first, message: 'Those two did not match.' })
    );
  }

  user.passwordHash = await hashPassword(password);
  user.inviteToken = undefined;
  user.inviteExpires = undefined;
  await user.save();

  await openSession(res, user, req);
  req.user = user;
  await record(req, 'auth.invite_accepted', user.email);
  res.redirect(302, '/ops/today');
});

export default router;
