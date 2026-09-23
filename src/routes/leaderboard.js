import { Router } from 'express';
import { CHALLENGE, daysLeft, naira } from '../config.js';
import { esc, layout } from '../views.js';
import { standings, totals } from '../store.js';

const router = Router();

// Public page: first names only. Nothing here should let a viewer work out who
// someone is or how to reach them.
const publicName = (full) => {
  const [first, ...rest] = String(full).trim().split(/\s+/);
  return rest.length ? `${first} ${rest[rest.length - 1][0].toUpperCase()}.` : first;
};

function dateRange() {
  if (!CHALLENGE.startDate || !CHALLENGE.endDate) return '';
  const fmt = (iso) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' });
  return `${fmt(CHALLENGE.startDate)} — ${fmt(CHALLENGE.endDate)}`;
}

router.get('/leaderboard', (_req, res) => {
  const rows = standings().filter((r) => !r.disqualified);
  const sum = totals();
  const range = dateRange();
  const remaining = daysLeft();

  const tableRows = rows.length
    ? rows
        .map(
          (row, i) => `<tr class="${i === 0 && row.bookings > 0 ? 'lead' : ''}">
        <td class="rank">${i + 1}</td>
        <td>${esc(publicName(row.name))}</td>
        <td class="num"><strong>${row.bookings}</strong></td>
        <td class="num">${row.nights}</td>
        <td class="num">${row.uniqueClicks}</td>
      </tr>`
        )
        .join('')
    : `<tr><td colspan="5" class="muted" style="padding:28px 10px;">
         No one has joined yet. <a href="/join">Be first</a>.
       </td></tr>`;

  res.type('html').send(
    layout({
      title: 'Atlas House — Referral Standings',
      body: `
  <p class="eyebrow">Atlas House Referral Challenge${range ? ` · ${range}` : ''}</p>
  <h1>Standings</h1>
  <p class="muted" style="margin-top:10px;max-width:58ch;">
    Ranked by confirmed bookings. ${naira(CHALLENGE.perBookingNaira)} per booking, paid within 48
    hours of check-in. Top referrer wins ${esc(CHALLENGE.grandPrize)}.
    <strong style="color:#F5F0E8;">Clicks are shown for credit but do not decide the winner.</strong>
  </p>
  ${
    remaining !== null
      ? `<p class="eyebrow" style="margin-top:18px;">${
          remaining === 0 ? 'Closed' : `${remaining} day${remaining === 1 ? '' : 's'} left`
        }</p>`
      : ''
  }

  <div class="card" style="margin-top:26px;">
    <div class="stat-row">
      <div><div class="stat-number">${sum.bookings}</div><div class="stat-label">Bookings</div></div>
      <div><div class="stat-number">${sum.nights}</div><div class="stat-label">Nights</div></div>
      <div><div class="stat-number">${sum.uniqueClicks}</div><div class="stat-label">Clicks</div></div>
      <div><div class="stat-number">${sum.active}</div><div class="stat-label">Referrers</div></div>
    </div>
  </div>

  <div class="card scroll">
    <table>
      <thead><tr>
        <th></th><th>Referrer</th>
        <th class="num">Bookings</th><th class="num">Nights</th><th class="num">Clicks</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <div class="card" style="text-align:center;">
    <p class="muted" style="margin-bottom:16px;">Not in yet?</p>
    <a href="/join"><button type="button">Get your link</button></a>
  </div>

  <p class="muted" style="font-size:13px;">
    A booking counts once it is paid for and checked in, from an enquiry tagged with your code.
    <a href="/rules">Full rules</a>.
  </p>`
    })
  );
});

export default router;
