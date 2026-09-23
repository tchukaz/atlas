import { Router } from 'express';
import crypto from 'node:crypto';
import {
  ADMIN_PASSWORD,
  CHALLENGE,
  SITE_URL,
  daysLeft,
  naira,
  trackingLink
} from '../config.js';
import { esc, layout } from '../views.js';
import { formatPhone } from '../phone.js';
import { runDailyNudges } from '../reminders.js';
import {
  addBooking,
  burstFlags,
  dailyClicks,
  deleteBooking,
  listBookings,
  orphanClicks,
  rankOf,
  setEnquiries,
  setPayoutStatus,
  setStatus,
  standings,
  totals
} from '../store.js';

const router = Router();

const SESSIONS = new Set();
const COOKIE = 'atlas_admin';
const failures = new Map();

function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

function passwordMatches(supplied) {
  if (!ADMIN_PASSWORD) return false;
  const a = Buffer.from(String(supplied || ''));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

function requireAdmin(req, res, next) {
  const token = readCookie(req, COOKIE);
  if (token && SESSIONS.has(token)) return next();
  return res.redirect(302, '/admin/login');
}

function loginPage(message = '') {
  return layout({
    title: 'Atlas House — Admin',
    body: `
  <p class="eyebrow">Atlas House</p>
  <h1>Referral admin</h1>
  ${message ? `<div class="notice bad" style="margin-top:20px;">${esc(message)}</div>` : ''}
  <form method="post" action="/admin/login" class="card" style="margin-top:24px;max-width:420px;">
    <label class="stat-label" for="password">Password</label>
    <input id="password" name="password" type="password" autocomplete="current-password"
           style="width:100%;margin:10px 0 18px;" required autofocus/>
    <button type="submit">Sign in</button>
  </form>`
  });
}

router.get('/admin/login', (_req, res) => res.type('html').send(loginPage()));

router.post('/admin/login', (req, res) => {
  const ip = req.ip || 'unknown';
  const record = failures.get(ip) || { count: 0, until: 0 };

  if (Date.now() < record.until) {
    return res.status(429).type('html').send(loginPage('Too many attempts. Wait a minute.'));
  }
  if (!ADMIN_PASSWORD) {
    return res.status(503).type('html').send(loginPage('ADMIN_PASSWORD is not set on the server.'));
  }
  if (!passwordMatches(req.body?.password)) {
    record.count += 1;
    if (record.count >= 5) {
      record.count = 0;
      record.until = Date.now() + 60_000;
    }
    failures.set(ip, record);
    return res.status(401).type('html').send(loginPage('Wrong password.'));
  }

  failures.delete(ip);
  const token = crypto.randomBytes(24).toString('hex');
  SESSIONS.add(token);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    maxAge: 12 * 60 * 60 * 1000
  });
  res.redirect(302, '/admin');
});

router.post('/admin/logout', (req, res) => {
  const token = readCookie(req, COOKIE);
  if (token) SESSIONS.delete(token);
  res.clearCookie(COOKIE);
  res.redirect(302, '/admin/login');
});

function nudgeText(row) {
  const { rank, leader } = rankOf(row.code);
  const remaining = daysLeft();
  const first = row.name.split(/\s+/)[0];
  const position =
    leader && leader.bookings > row.bookings
      ? `${leader.name.split(/\s+/)[0]} is on ${leader.bookings}, you're on ${row.bookings}.`
      : rank === 1 && row.bookings > 0
        ? `You're top of the board.`
        : `Nobody has a booking yet — first one takes the lead.`;

  return `${first} — ${position} ${
    remaining === null ? '' : `${remaining} day${remaining === 1 ? '' : 's'} left. `
  }Your link: ${trackingLink(row.code)}`;
}

router.get('/admin', requireAdmin, (req, res) => {
  const rows = standings();
  const sum = totals();
  const bookings = listBookings();
  const bursts = burstFlags();
  const orphans = orphanClicks();
  const daily = dailyClicks(7);
  const peak = Math.max(1, ...daily.map((d) => d.count));
  const flash = typeof req.query.msg === 'string' ? req.query.msg.slice(0, 300) : '';
  const error = typeof req.query.err === 'string' ? req.query.err.slice(0, 300) : '';

  const owed = bookings.filter((b) => b.payout_status === 'pending').length * CHALLENGE.perBookingNaira;
  const inviteLink = `${SITE_URL}/join`;

  const rosterRows = rows.length
    ? rows
        .map(
          (row) => `<tr${row.disqualified ? ' style="opacity:0.45;"' : ''}>
      <td>
        <strong>${esc(row.name)}</strong>${row.disqualified ? ' <span class="muted">(removed)</span>' : ''}<br/>
        <span class="mono">${esc(row.code)}</span><br/>
        <span class="muted" style="font-size:11px;">${esc(row.email)}<br/>${esc(formatPhone(row.phone))}</span>
      </td>
      <td class="num">${row.uniqueClicks}<br/><span class="muted" style="font-size:11px;">${row.clicks} raw</span></td>
      <td class="num">${row.bookings}<br/><span class="muted" style="font-size:11px;">${row.nights} nights</span></td>
      <td>
        <form method="post" action="/admin/enquiries" style="display:flex;gap:6px;align-items:center;">
          <input type="hidden" name="code" value="${esc(row.code)}"/>
          <input class="num" name="enquiries" type="number" min="0" value="${row.enquiries}"/>
          <button type="submit">Save</button>
        </form>
      </td>
      <td>
        <button type="button" class="ghost copy" data-copy="${esc(trackingLink(row.code))}">Link</button>
        <button type="button" class="ghost copy" data-copy="${esc(nudgeText(row))}">Nudge</button>
        <form method="post" action="/admin/status" style="margin-top:6px;">
          <input type="hidden" name="code" value="${esc(row.code)}"/>
          <input type="hidden" name="status" value="${row.disqualified ? 'active' : 'disqualified'}"/>
          <button type="submit" class="ghost">${row.disqualified ? 'Reinstate' : 'Disqualify'}</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="muted" style="padding:28px 10px;">
         Nobody has signed up yet. Share the invite link above.
       </td></tr>`;

  const bookingRows = bookings.length
    ? bookings
        .map(
          (b) => `<tr>
      <td><span class="mono">${esc(b.code)}</span></td>
      <td>${esc(b.guest_name)}<br/><span class="muted" style="font-size:11px;">${esc(formatPhone(b.guest_phone))}</span></td>
      <td class="num">${b.nights}</td>
      <td>${esc(b.checked_in_on)}</td>
      <td>${b.flagged ? `<span style="color:#C4553D;">${esc(b.flagged)}</span>` : '<span class="muted">—</span>'}</td>
      <td>
        <form method="post" action="/admin/payout" style="display:flex;gap:6px;">
          <input type="hidden" name="id" value="${b.id}"/>
          <input type="hidden" name="status" value="${b.payout_status === 'paid' ? 'pending' : 'paid'}"/>
          <button type="submit" class="ghost">${b.payout_status === 'paid' ? 'Paid ✓' : 'Mark paid'}</button>
        </form>
      </td>
      <td>
        <form method="post" action="/admin/booking/delete"
              onsubmit="return confirm('Delete this booking?');">
          <input type="hidden" name="id" value="${b.id}"/>
          <button type="submit" class="ghost">Delete</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="7" class="muted" style="padding:24px 10px;">No bookings logged yet.</td></tr>`;

  const options = rows
    .filter((r) => !r.disqualified)
    .map((r) => `<option value="${esc(r.code)}">${esc(r.name)} (${esc(r.code)})</option>`)
    .join('');

  res.type('html').send(
    layout({
      title: 'Atlas House — Referral Admin',
      extraCss: `
        .bars { display:flex; align-items:flex-end; gap:10px; height:70px; }
        .bars div { flex:1; background:rgba(201,168,76,0.35); border-radius:2px 2px 0 0; min-height:2px; }
        .invite { background:#0E0E0E; border:1px solid var(--line); border-radius:3px;
                  padding:14px; margin:12px 0; word-break:break-all; }
      `,
      body: `
  <p class="eyebrow">Atlas House · Ops</p>
  <h1>Referral admin</h1>
  ${flash ? `<div class="notice" style="margin-top:20px;">${esc(flash)}</div>` : ''}
  ${error ? `<div class="notice bad" style="margin-top:20px;">${esc(error)}</div>` : ''}

  <div class="card" style="margin-top:26px;">
    <h2 style="font-size:20px;margin-top:0;">Invite link</h2>
    <p class="muted" style="font-size:14px;">Send this to everyone. They sign up and get their own
    link automatically — you do not have to set anyone up by hand.</p>
    <div class="invite mono">${esc(inviteLink)}</div>
    <button type="button" class="copy" data-copy="${esc(inviteLink)}">Copy invite link</button>
  </div>

  <div class="card">
    <div class="stat-row">
      <div><div class="stat-number">${sum.bookings}</div><div class="stat-label">Bookings</div></div>
      <div><div class="stat-number">${naira(owed)}</div><div class="stat-label">Owed</div></div>
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

  <h2>Log a booking</h2>
  <div class="card">
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      Only once the stay is paid for and the guest has checked in.
    </p>
    <form method="post" action="/admin/booking" style="display:flex;gap:10px;flex-wrap:wrap;align-items:flex-end;">
      <label class="muted" style="font-size:11px;">Referrer<br/>
        <select name="code" required style="margin-top:5px;">${options}</select></label>
      <label class="muted" style="font-size:11px;">Guest name<br/>
        <input name="guestName" required maxlength="80" style="margin-top:5px;"/></label>
      <label class="muted" style="font-size:11px;">Guest phone<br/>
        <input name="guestPhone" maxlength="20" placeholder="0802…" style="margin-top:5px;"/></label>
      <label class="muted" style="font-size:11px;">Nights<br/>
        <input class="num" name="nights" type="number" min="1" value="1" style="margin-top:5px;"/></label>
      <label class="muted" style="font-size:11px;">Checked in<br/>
        <input name="checkedInOn" type="date" value="${new Date().toISOString().slice(0, 10)}" style="margin-top:5px;"/></label>
      <button type="submit">Add booking</button>
    </form>
  </div>

  <div class="card scroll">
    <table>
      <thead><tr>
        <th>Code</th><th>Guest</th><th class="num">Nights</th><th>Checked in</th>
        <th>Flag</th><th>Payout</th><th></th>
      </tr></thead>
      <tbody>${bookingRows}</tbody>
    </table>
  </div>

  <h2>Referrers</h2>
  <div class="card scroll">
    <table>
      <thead><tr>
        <th>Referrer</th><th class="num">Clicks</th><th class="num">Bookings</th>
        <th>Enquiries</th><th></th>
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
                  <span class="muted">— ${b.hits} clicks around ${esc(b.from_ts.slice(0, 16).replace('T', ' '))}</span></div>`
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

  <form method="post" action="/admin/logout"><button type="submit" class="ghost">Sign out</button></form>
  <p class="muted" style="font-size:13px;margin-top:20px;">
    <a href="/leaderboard">Standings</a> · <a href="/admin/export.csv">Export CSV</a>
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

const back = (res, { msg, err }) => {
  const params = new URLSearchParams();
  if (msg) params.set('msg', msg);
  if (err) params.set('err', err);
  res.redirect(302, `/admin?${params}`);
};

router.post('/admin/booking', requireAdmin, (req, res) => {
  const { code, guestName, guestPhone, nights, checkedInOn } = req.body || {};
  if (!code || !String(guestName || '').trim()) {
    return back(res, { err: 'A referrer and a guest name are required.' });
  }
  addBooking({ code, guestName, guestPhone, nights, checkedInOn });
  back(res, { msg: `Booking logged for ${code}.` });
});

router.post('/admin/payout', requireAdmin, (req, res) => {
  setPayoutStatus(req.body?.id, req.body?.status === 'paid' ? 'paid' : 'pending');
  back(res, { msg: 'Payout status updated.' });
});

router.post('/admin/booking/delete', requireAdmin, (req, res) => {
  deleteBooking(req.body?.id);
  back(res, { msg: 'Booking deleted.' });
});

router.post('/admin/enquiries', requireAdmin, (req, res) => {
  setEnquiries(req.body?.code, req.body?.enquiries);
  back(res, { msg: `Enquiries updated for ${req.body?.code}.` });
});

router.post('/admin/status', requireAdmin, (req, res) => {
  const status = req.body?.status === 'disqualified' ? 'disqualified' : 'active';
  setStatus(req.body?.code, status);
  back(res, { msg: `${req.body?.code} is now ${status}.` });
});

router.post('/admin/nudges', requireAdmin, async (req, res) => {
  const dryRun = req.body?.dryRun === '1';
  try {
    const result = await runDailyNudges({ dryRun });
    const summary = result.reason
      ? `Nothing sent — ${result.reason}.`
      : `${dryRun ? 'Would send' : 'Sent'} ${result.sent}, skipped ${result.skipped}${
          result.failed ? `, failed ${result.failed}` : ''
        }.`;
    back(res, { msg: summary });
  } catch (err) {
    back(res, { err: err.message });
  }
});

router.get('/admin/export.csv', requireAdmin, (_req, res) => {
  const header =
    'Name,Code,Email,Phone,Link,Clicks,Unique clicks,Enquiries,Bookings,Nights,Earned,Status';
  const cell = (value) => `"${String(value ?? '').replace(/"/g, '""')}"`;
  const lines = standings().map((row) =>
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
