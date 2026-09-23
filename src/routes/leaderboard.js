import { Router } from 'express';
import { CHALLENGE } from '../config.js';
import { esc, layout } from '../views.js';
import { standings, totals } from '../store.js';

const router = Router();

const naira = (n) => `₦${n.toLocaleString('en-NG')}`;

function dateRange() {
  if (!CHALLENGE.startDate || !CHALLENGE.endDate) return '';
  const fmt = (iso) =>
    new Date(`${iso}T12:00:00Z`).toLocaleDateString('en-NG', {
      day: 'numeric',
      month: 'short'
    });
  return `${fmt(CHALLENGE.startDate)} — ${fmt(CHALLENGE.endDate)}`;
}

router.get('/leaderboard', (_req, res) => {
  const rows = standings();
  const sum = totals();
  const range = dateRange();

  const tableRows = rows.length
    ? rows
        .map((row, i) => {
          const leading = i === 0 && row.bookings > 0;
          return `<tr class="${leading ? 'lead' : ''}">
        <td class="rank">${i + 1}</td>
        <td>${esc(row.name)}</td>
        <td class="num"><strong>${row.bookings}</strong></td>
        <td class="num">${row.nights}</td>
        <td class="num">${row.enquiries}</td>
        <td class="num">${row.uniqueClicks}</td>
      </tr>`;
        })
        .join('')
    : `<tr><td colspan="6" class="muted" style="padding:28px 10px;">No participants yet.</td></tr>`;

  res.type('html').send(
    layout({
      title: 'Atlas House — Referral Standings',
      body: `
  <p class="eyebrow">Atlas House Referral Challenge${range ? ` · ${range}` : ''}</p>
  <h1>Standings</h1>
  <p class="muted" style="margin-top:10px;max-width:56ch;">
    Ranked by confirmed bookings. ${naira(CHALLENGE.perBookingNaira)} per booking, paid within 48 hours
    of check-in. Clicks are shown for credit but do not decide the winner.
  </p>

  <div class="card" style="margin-top:32px;">
    <div class="stat-row">
      <div><div class="stat-number">${sum.bookings}</div><div class="stat-label">Bookings</div></div>
      <div><div class="stat-number">${sum.nights}</div><div class="stat-label">Nights</div></div>
      <div><div class="stat-number">${sum.enquiries}</div><div class="stat-label">Enquiries</div></div>
      <div><div class="stat-number">${sum.uniqueClicks}</div><div class="stat-label">Unique clicks</div></div>
      <div><div class="stat-number">${sum.participants}</div><div class="stat-label">Referrers</div></div>
    </div>
  </div>

  <div class="card scroll">
    <table>
      <thead><tr>
        <th></th><th>Referrer</th>
        <th class="num">Bookings</th><th class="num">Nights</th>
        <th class="num">Enquiries</th><th class="num">Clicks</th>
      </tr></thead>
      <tbody>${tableRows}</tbody>
    </table>
  </div>

  <p class="muted" style="font-size:13px;">
    A booking counts once it is paid for and checked in, from an enquiry tagged with your code.
    Ties are broken by clicks.
  </p>`
    })
  );
});

export default router;
