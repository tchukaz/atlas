import { Router } from 'express';
import { CHALLENGE, SITE_URL, daysLeft, naira, trackingLink } from '../config.js';
import { esc, layout } from '../views.js';
import { tabs, OPS_CSS, flashOf, back } from '../views-ops.js';
import { requireCan, record } from '../auth.js';
import { formatPhone } from '../phone.js';
import { runDailyNudges } from '../reminders.js';
import {
  burstFlags,
  dailyClicks,
  orphanClicks,
  rankOf,
  setEnquiries,
  setStatus,
  standings,
  totals
} from '../store.js';

const router = Router();
async function nudgeText(row) {
  const { rank, leader } = await rankOf(row.code);
  const remaining = daysLeft();
  const first = row.name.split(/\s+/)[0];
  const position =
    leader && leader.bookings > row.bookings
      ? `${leader.name.split(/\s+/)[0]} is on ${leader.bookings}, you're on ${row.bookings}.`
      : rank === 1 && row.bookings > 0
        ? "You're top of the board."
        : 'Nobody has a booking yet — first one takes the lead.';

  return `${first} — ${position} ${
    remaining === null ? '' : `${remaining} day${remaining === 1 ? '' : 's'} left. `
  }Your link: ${trackingLink(row.code)}`;
}

router.get('/admin', requireCan('referrals.manage'), async (req, res) => {
  const [rows, sum, bursts, orphans, daily] = await Promise.all([
    standings(),
    totals(),
    burstFlags(),
    orphanClicks(),
    dailyClicks(7)
  ]);
  const { flash, error } = flashOf(req);
  const peak = Math.max(1, ...daily.map((d) => d.count));
  const inviteLink = `${SITE_URL}/join`;

  const nudges = await Promise.all(rows.map((row) => nudgeText(row)));

  const rosterRows = rows.length
    ? rows
        .map(
          (row, i) => `<tr${row.disqualified ? ' style="opacity:0.45;"' : ''}>
      <td>
        <strong>${esc(row.name)}</strong>${row.disqualified ? ' <span class="muted">(removed)</span>' : ''}<br/>
        <span class="mono">${esc(row.code)}</span><br/>
        <span class="muted" style="font-size:11px;">${esc(row.email)}<br/>${esc(formatPhone(row.phone))}</span>
      </td>
      <td class="num">${row.uniqueClicks}<br/><span class="muted" style="font-size:11px;">${row.clicks} raw</span></td>
      <td class="num">${row.bookings}<br/><span class="muted" style="font-size:11px;">${row.nights} nights</span></td>
      <td class="num">${naira(row.bookings * CHALLENGE.perBookingNaira)}</td>
      <td>
        <form method="post" action="/admin/enquiries" style="display:flex;gap:6px;align-items:center;">
          <input type="hidden" name="code" value="${esc(row.code)}"/>
          <input class="num" name="enquiries" type="number" min="0" value="${row.enquiries}"/>
          <button type="submit">Save</button>
        </form>
      </td>
      <td>
        <button type="button" class="ghost copy" data-copy="${esc(trackingLink(row.code))}">Link</button>
        <button type="button" class="ghost copy" data-copy="${esc(nudges[i])}">Nudge</button>
        <form method="post" action="/admin/status" style="margin-top:6px;">
          <input type="hidden" name="code" value="${esc(row.code)}"/>
          <input type="hidden" name="status" value="${row.disqualified ? 'active' : 'disqualified'}"/>
          <button type="submit" class="ghost">${row.disqualified ? 'Reinstate' : 'Disqualify'}</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="6" class="muted" style="padding:28px 10px;">
         Nobody has signed up yet. Share the invite link above.
       </td></tr>`;

  res.type('html').send(
    layout({
      title: 'Atlas House — Referrals',
      extraCss: `${OPS_CSS}
        .bars { display:flex; align-items:flex-end; gap:10px; height:70px; }
        .bars div { flex:1; background:rgba(201,168,76,0.35); border-radius:2px 2px 0 0; min-height:2px; }
        .invite { background:#0E0E0E; border:1px solid var(--line); border-radius:3px;
                  padding:14px; margin:12px 0; word-break:break-all; }`,
      body: `
  <p class="eyebrow">Atlas House · Ops</p>
  <h1>Referrals</h1>
  ${tabs('/admin', req.user)}
  ${flash ? `<div class="notice">${esc(flash)}</div>` : ''}
  ${error ? `<div class="notice bad">${esc(error)}</div>` : ''}

  <div class="card">
    <h2 style="font-size:20px;margin-top:0;">Invite link</h2>
    <p class="muted" style="font-size:14px;">Send this to everyone. They sign up and get their own
    link automatically — you do not set anyone up by hand.</p>
    <div class="invite mono">${esc(inviteLink)}</div>
    <button type="button" class="copy" data-copy="${esc(inviteLink)}">Copy invite link</button>
  </div>

  <div class="card">
    <div class="stat-row">
      <div><div class="stat-number">${sum.bookings}</div><div class="stat-label">Bookings</div></div>
      <div><div class="stat-number">${naira(sum.bookings * CHALLENGE.perBookingNaira)}</div><div class="stat-label">Owed</div></div>
      <div><div class="stat-number">${sum.enquiries}</div><div class="stat-label">Enquiries</div></div>
      <div><div class="stat-number">${sum.uniqueClicks}</div><div class="stat-label">Clicks</div></div>
      <div><div class="stat-number">${sum.active}</div><div class="stat-label">Referrers</div></div>
    </div>
    <div style="margin-top:26px;">
      <div class="stat-label" style="margin-bottom:10px;">Clicks, last 7 days</div>
      <div class="bars">
        ${daily.map((d) => `<div style="height:${Math.round((d.count / peak) * 100)}%" title="${d.date}: ${d.count}"></div>`).join('')}
      </div>
      <div style="display:flex;gap:10px;">${daily
        .map((d) => `<span style="flex:1;text-align:center;font-size:10px;color:#8A8A8A;">${d.count}</span>`)
        .join('')}</div>
    </div>
  </div>

  <div class="card">
    <p class="muted" style="font-size:13px;margin:0;">
      Referral credit is counted from real bookings — log those under
      <a href="/ops/bookings">Bookings</a> with the referrer's code, and a booking counts once the
      guest has checked in. Nothing is typed twice.
    </p>
  </div>

  <h2>Referrers</h2>
  <div class="card scroll">
    <table>
      <thead><tr>
        <th>Referrer</th><th class="num">Clicks</th><th class="num">Bookings</th>
        <th class="num">Earned</th><th>Enquiries</th><th></th>
      </tr></thead>
      <tbody>${rosterRows}</tbody>
    </table>
  </div>

  ${
    bursts.length || orphans.length
      ? `<h2>Worth a look</h2>
  <div class="card">
    ${
      bursts.length
        ? `<p class="muted" style="font-size:13px;">Clusters of clicks from one network in a short
           window — often someone refreshing their own link.</p>
           ${bursts
             .map(
               (b) =>
                 `<div><span class="mono">${esc(b.code)}</span>
                  <span class="muted">— ${b.hits} clicks around ${esc(new Date(b.fromTs).toISOString().slice(0, 16).replace('T', ' '))}</span></div>`
             )
             .join('')}`
        : ''
    }
    ${
      orphans.length
        ? `<p class="muted" style="font-size:13px;margin-top:${bursts.length ? '16px' : '0'};">
           Clicks on codes nobody owns — usually a mistyped link.</p>
           ${orphans
             .map((o) => `<div><span class="mono">${esc(o.code)}</span> <span class="muted">— ${o.count}</span></div>`)
             .join('')}`
        : ''
    }
  </div>`
      : ''
  }

  <h2>Reminders</h2>
  <div class="card">
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      The daily email goes out automatically. Use this to preview who would receive one right now.
    </p>
    <form method="post" action="/admin/nudges" style="display:inline;">
      <input type="hidden" name="dryRun" value="1"/>
      <button type="submit" class="ghost">Preview (send nothing)</button>
    </form>
    <form method="post" action="/admin/nudges" style="display:inline;"
          onsubmit="return confirm('Send today\\'s reminder email to every active referrer now?');">
      <button type="submit">Send now</button>
    </form>
  </div>

  <p class="muted" style="font-size:13px;margin-top:20px;">
    <a href="/leaderboard">Public standings</a> · <a href="/admin/export.csv">Export CSV</a>
  </p>

  <script>
    document.addEventListener('click', async (event) => {
      const button = event.target.closest('.copy');
      if (!button) return;
      await navigator.clipboard.writeText(button.dataset.copy);
      const original = button.textContent;
      button.textContent = 'Copied';
      setTimeout(() => { button.textContent = original; }, 1400);
    });
  </script>`
    })
  );
});

router.post('/admin/enquiries', requireCan('referrals.manage'), async (req, res) => {
  await setEnquiries(req.body?.code, req.body?.enquiries);
  back(res, '/admin', { msg: `Enquiries updated for ${req.body?.code}.` });
});

router.post('/admin/status', requireCan('referrals.manage'), async (req, res) => {
  const status = req.body?.status === 'disqualified' ? 'disqualified' : 'active';
  await setStatus(req.body?.code, status);
  back(res, '/admin', { msg: `${req.body?.code} is now ${status}.` });
});

router.post('/admin/nudges', requireCan('referrals.manage'), async (req, res) => {
  const dryRun = req.body?.dryRun === '1';
  try {
    const result = await runDailyNudges({ dryRun });
    const summary = result.reason
      ? `Nothing sent — ${result.reason}.`
      : `${dryRun ? 'Would send' : 'Sent'} ${result.sent}, skipped ${result.skipped}${
          result.failed ? `, failed ${result.failed}` : ''
        }.`;
    back(res, '/admin', { msg: summary });
  } catch (err) {
    back(res, '/admin', { err: err.message });
  }
});

router.get('/admin/export.csv', requireCan('referrals.manage'), async (_req, res) => {
  const header =
    'Name,Code,Email,Phone,Link,Clicks,Unique clicks,Enquiries,Bookings,Nights,Earned,Status';
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const rows = await standings();
  const lines = rows.map((row) =>
    [
      cell(row.name),
      row.code,
      cell(row.email),
      cell(formatPhone(row.phone)),
      trackingLink(row.code),
      row.clicks,
      row.uniqueClicks,
      row.enquiries,
      row.bookings,
      row.nights,
      row.bookings * CHALLENGE.perBookingNaira,
      row.status
    ].join(',')
  );
  res
    .type('text/csv')
    .set('Content-Disposition', 'attachment; filename="atlas-referrals.csv"')
    .send([header, ...lines].join('\n'));
});

export default router;
