import { Router } from 'express';
import crypto from 'node:crypto';
import { ADMIN_PASSWORD, CHALLENGE, trackingLink } from '../config.js';
import { esc, layout } from '../views.js';
import {
  addParticipant,
  dailyClicks,
  listParticipants,
  orphanClicks,
  removeParticipant,
  setLedger,
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

function announcement(row) {
  const end = CHALLENGE.endDate
    ? new Date(`${CHALLENGE.endDate}T12:00:00Z`).toLocaleDateString('en-NG', {
        weekday: 'long',
        day: 'numeric',
        month: 'long'
      })
    : '[end date]';
  const firstName = row.name.split(/\s+/)[0];
  const reward = `₦${CHALLENGE.perBookingNaira.toLocaleString('en-NG')}`;

  return `Hey ${firstName} — quick one, and there's money in it.

I'm running a 7-day thing for Atlas House, my shortlet in Iwofe. I made you your own link:

${trackingLink(row.code)}

Share it however you like — WhatsApp status, your IG story, repost the video I'll send. Anyone who clicks it lands straight in my chat, tagged as yours.

Every booking that comes through your link, I send you ${reward}. Whoever brings the most bookings by ${end} gets two free nights at the apartment.

No cap on how many you can earn. Starts today, ends ${end}.`;
}

router.get('/admin', requireAdmin, (req, res) => {
  const rows = standings();
  const sum = totals();
  const orphans = orphanClicks();
  const daily = dailyClicks(7);
  const flash = typeof req.query.msg === 'string' ? req.query.msg.slice(0, 200) : '';
  const error = typeof req.query.err === 'string' ? req.query.err.slice(0, 200) : '';
  const peak = Math.max(1, ...daily.map((d) => d.count));

  const tableRows = rows.length
    ? rows
        .map(
          (row) => `<tr>
      <td>
        <strong>${esc(row.name)}</strong><br/>
        <span class="mono">${esc(row.code)}</span>
      </td>
      <td>
        <span class="mono" style="word-break:break-all;">${esc(trackingLink(row.code))}</span><br/>
        <button type="button" class="ghost copy" data-copy="${esc(trackingLink(row.code))}"
                style="margin-top:6px;">Copy link</button>
        <button type="button" class="ghost copy" data-copy="${esc(announcement(row))}"
                style="margin-top:6px;">Copy message</button>
      </td>
      <td class="num">${row.uniqueClicks}<br/><span class="muted" style="font-size:11px;">${row.clicks} total</span></td>
      <td colspan="4">
        <form method="post" action="/admin/ledger" style="display:flex;gap:8px;align-items:center;flex-wrap:wrap;">
          <input type="hidden" name="code" value="${esc(row.code)}"/>
          <label class="muted" style="font-size:11px;">Enq
            <input class="num" name="enquiries" type="number" min="0" value="${row.enquiries}"/></label>
          <label class="muted" style="font-size:11px;">Book
            <input class="num" name="bookings" type="number" min="0" value="${row.bookings}"/></label>
          <label class="muted" style="font-size:11px;">Nights
            <input class="num" name="nights" type="number" min="0" value="${row.nights}"/></label>
          <button type="submit">Save</button>
        </form>
      </td>
      <td>
        <form method="post" action="/admin/remove"
              onsubmit="return confirm('Remove ${esc(row.name)} from the roster? Their click history is kept.');">
          <input type="hidden" name="code" value="${esc(row.code)}"/>
          <button type="submit" class="ghost">Remove</button>
        </form>
      </td>
    </tr>`
        )
        .join('')
    : `<tr><td colspan="6" class="muted" style="padding:28px 10px;">
         Roster is empty. Add your contacts below — every link is generated from this list.
       </td></tr>`;

  res.type('html').send(
    layout({
      title: 'Atlas House — Referral Admin',
      extraCss: `
        .bars { display:flex; align-items:flex-end; gap:10px; height:70px; }
        .bars div { flex:1; background:rgba(201,168,76,0.35); border-radius:2px 2px 0 0; min-height:2px; }
        .bars span { display:block; text-align:center; font-size:10px; color:#8A8A8A; margin-top:6px; }
      `,
      body: `
  <p class="eyebrow">Atlas House · Ops</p>
  <h1>Referral admin</h1>
  ${flash ? `<div class="notice" style="margin-top:20px;">${esc(flash)}</div>` : ''}
  ${error ? `<div class="notice bad" style="margin-top:20px;">${esc(error)}</div>` : ''}

  <div class="card" style="margin-top:28px;">
    <div class="stat-row">
      <div><div class="stat-number">${sum.bookings}</div><div class="stat-label">Bookings</div></div>
      <div><div class="stat-number">${sum.enquiries}</div><div class="stat-label">Enquiries</div></div>
      <div><div class="stat-number">${sum.uniqueClicks}</div><div class="stat-label">Unique clicks</div></div>
      <div><div class="stat-number">${sum.clicks}</div><div class="stat-label">Total clicks</div></div>
      <div><div class="stat-number">${sum.participants}</div><div class="stat-label">Referrers</div></div>
    </div>
    <div style="margin-top:26px;">
      <div class="stat-label" style="margin-bottom:10px;">Clicks, last 7 days</div>
      <div class="bars">
        ${daily
          .map(
            (d) =>
              `<div style="height:${Math.round((d.count / peak) * 100)}%" title="${d.date}: ${d.count}"></div>`
          )
          .join('')}
      </div>
      <div style="display:flex;gap:10px;">${daily
        .map((d) => `<span style="flex:1;text-align:center;font-size:10px;color:#8A8A8A;">${d.count}</span>`)
        .join('')}</div>
    </div>
  </div>

  <h2>Roster</h2>
  <div class="card scroll">
    <table>
      <thead><tr>
        <th>Referrer</th><th>Link &amp; message</th><th class="num">Clicks</th>
        <th colspan="4">Logged by ops</th><th></th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <h2>Add contacts</h2>
  <div class="card">
    <form method="post" action="/admin/participants">
      <p class="muted" style="font-size:13px;margin-bottom:12px;">
        One name per line. The code is the first name, lowercased — or write
        <span class="mono">Name, code</span> to set it yourself.
      </p>
      <textarea name="bulk" rows="6" placeholder="Ada Obi&#10;Emeka Nwosu&#10;Tobi Adeyemi, tobi"
        style="width:100%;font-family:ui-monospace,Menlo,monospace;font-size:13px;background:#0E0E0E;
               color:#F5F0E8;border:1px solid rgba(201,168,76,0.22);border-radius:3px;padding:11px;"></textarea>
      <button type="submit" style="margin-top:14px;">Add to roster</button>
    </form>
  </div>

  ${
    orphans.length
      ? `<h2>Unmatched clicks</h2>
  <div class="card">
    <p class="muted" style="font-size:13px;margin-bottom:10px;">
      Clicks on codes that are not on the roster — usually a mistyped link.
    </p>
    ${orphans
      .map((o) => `<div><span class="mono">${esc(o.code)}</span> <span class="muted">— ${o.count}</span></div>`)
      .join('')}
  </div>`
      : ''
  }

  <form method="post" action="/admin/logout"><button type="submit" class="ghost">Sign out</button></form>
  <p class="muted" style="font-size:13px;margin-top:20px;">
    Public standings: <a href="/leaderboard">/leaderboard</a> ·
    <a href="/admin/export.csv">Export CSV</a>
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

router.post('/admin/participants', requireAdmin, (req, res) => {
  const lines = String(req.body?.bulk || '')
    .split('\n')
    .map((line) => line.trim())
    .filter(Boolean);

  const added = [];
  const problems = [];

  for (const line of lines) {
    const [name, code] = line.split(',').map((part) => part.trim());
    try {
      added.push(addParticipant(name, code));
    } catch (err) {
      problems.push(`${line}: ${err.message}`);
    }
  }

  const params = new URLSearchParams();
  if (added.length) params.set('msg', `Added ${added.length} contact(s): ${added.join(', ')}`);
  if (problems.length) params.set('err', problems.join(' · '));
  res.redirect(302, `/admin?${params}`);
});

router.post('/admin/ledger', requireAdmin, (req, res) => {
  const { code, enquiries, bookings, nights } = req.body || {};
  setLedger(code, { enquiries, bookings, nights });
  res.redirect(302, `/admin?msg=${encodeURIComponent(`Saved ${code}.`)}`);
});

router.get('/admin/export.csv', requireAdmin, (_req, res) => {
  const header = 'Name,Code,Link,Clicks,Unique clicks,Enquiries,Bookings,Nights booked';
  const cell = (value) => `"${String(value).replace(/"/g, '""')}"`;
  const lines = standings().map((row) =>
    [
      cell(row.name),
      row.code,
      trackingLink(row.code),
      row.clicks,
      row.uniqueClicks,
      row.enquiries,
      row.bookings,
      row.nights
    ].join(',')
  );
  res
    .type('text/csv')
    .set('Content-Disposition', 'attachment; filename="atlas-referrals.csv"')
    .send([header, ...lines].join('\n'));
});

router.post('/admin/remove', requireAdmin, (req, res) => {
  const code = String(req.body?.code || '');
  removeParticipant(code);
  res.redirect(302, `/admin?msg=${encodeURIComponent(`Removed ${code}.`)}`);
});

export default router;
