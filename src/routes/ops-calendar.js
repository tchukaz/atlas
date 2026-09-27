import { Router } from 'express';
import { esc } from '../views.js';
import { opsPage as page, flashOf, iso, pretty, todayIso } from '../views-ops.js';
import { requireAuth, requireCan } from '../auth.js';
import { calendarStrip, day } from '../availability.js';

const router = Router();
router.use('/ops', requireAuth);

// A fixed palette rather than random hues: these have to stay legible on a
// near-black background, and adjacent stays must be told apart at a glance.
const BOOKING_COLOURS = [
  '#C9A84C', '#7FA86B', '#6E8FB8', '#B87F6E', '#9B7FB8', '#B8A76E', '#6EB8A7', '#C48C8C'
];

const colourFor = (id) => {
  const s = String(id);
  let n = 0;
  for (let i = 0; i < s.length; i++) n = (n * 31 + s.charCodeAt(i)) >>> 0;
  return BOOKING_COLOURS[n % BOOKING_COLOURS.length];
};

const TITLES = new Set([
  'mr', 'mrs', 'ms', 'miss', 'dr', 'prof', 'engr', 'chief', 'alhaji', 'alhaja', 'pastor', 'rev'
]);

// "Mr G" should show as G, not Mr — a first-word heuristic labels half the
// calendar with the same three letters.
const shortName = (full) => {
  const parts = String(full).trim().split(/\s+/);
  const first = parts[0] || '';
  if (parts.length > 1 && TITLES.has(first.toLowerCase().replace(/\.$/, ''))) {
    return parts.slice(1).join(' ');
  }
  return first;
};

const shiftMonth = (from, months) => {
  const d = day(from);
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + months, 1));
};

router.get('/ops/calendar', requireCan('bookings.view'), async (req, res) => {
  const from = day(req.query.from || todayIso());
  const nights = Math.min(90, Math.max(14, Number(req.query.nights) || 35));
  const strip = await calendarStrip(from, nights);

  const monthLabel = (d) =>
    new Date(d).toLocaleDateString('en-NG', { month: 'long', year: 'numeric', timeZone: 'UTC' });

  const header = strip.days
    .map((d) => {
      const date = new Date(d);
      const first = date.getUTCDate() === 1;
      return `<th class="${first ? 'monthstart' : ''}">
        <div class="dnum">${date.getUTCDate()}</div>
        <div class="dow">${['S', 'M', 'T', 'W', 'T', 'F', 'S'][date.getUTCDay()]}</div>
      </th>`;
    })
    .join('');

  const rows = strip.rows.length
    ? strip.rows
        .map((row) => {
          const cells = row.cells
            .map((cell, i) => {
              const prev = row.cells[i - 1]?.booking;
              const b = cell.booking;
              if (!b) return `<td class="free-cell"${i > 0 && prev ? ' data-edge="1"' : ''}></td>`;

              // A new booking starting the day another ends renders as one
              // unbroken bar unless the boundary is drawn and the colour changes.
              const isStart = !prev || String(prev._id) !== String(b._id);
              const name = shortName(b.guestName);
              return `<td class="busy-cell${isStart ? ' edge' : ''}"
                  style="--c:${colourFor(b._id)}"
                  title="${esc(b.guestName)} · ${esc(b.tier)} · ${pretty(b.checkIn)}–${pretty(b.checkOut)}">
                <a href="/ops/bookings/${b._id}">${isStart ? `<span class="who">${esc(name)}</span>` : ''}</a>
              </td>`;
            })
            .join('');
          return `<tr>
        <th class="rname"><a href="/ops/bookings?room=${row.room._id}">${esc(row.room.property?.name || '')}</a><br/>
          <span class="muted" style="font-weight:400;">${esc(row.room.name)}</span></th>
        ${cells}
      </tr>`;
        })
        .join('')
    : `<tr><td class="muted" style="padding:20px;">No bedrooms yet — add them under <a href="/ops/setup">Setup</a>.</td></tr>`;

  res.type('html').send(
    page({
      title: 'Calendar',
      active: '/ops/calendar',
      user: req.user,
      ...flashOf(req),
      breadcrumb: [['Calendar', null]],
      extraCss: `
        .stripwrap { overflow-x:auto; padding-bottom:6px; }
        .strip { border-collapse:separate; border-spacing:0; font-size:11px; }
        .strip th, .strip td { border-bottom:1px solid rgba(245,240,232,0.07); padding:0; }
        .strip th.rname { text-align:left; padding:8px 12px 8px 4px; white-space:nowrap;
                          position:sticky; left:0; background:var(--dark); z-index:2;
                          font-size:11px; letter-spacing:0; text-transform:none; color:var(--cream);
                          border-right:1px solid var(--line); }
        .strip th.rname a { color:var(--cream); text-decoration:none; }
        .strip thead th { color:var(--muted); font-weight:400; padding:3px 0; }
        .strip thead th.monthstart { border-left:2px solid var(--gold); }
        .dnum { font-size:10px; } .dow { font-size:9px; opacity:0.55; }
        .strip td { width:26px; min-width:26px; height:30px; }
        .free-cell { background:rgba(127,168,107,0.13); }
        .busy-cell { background:var(--c); position:relative; }
        .busy-cell.edge { box-shadow: inset 2px 0 0 rgba(10,10,10,0.85); }
        .busy-cell a { display:block; height:30px; position:relative; }
        .who { position:absolute; left:4px; top:8px; font-size:10px; color:#0A0A0A;
               font-weight:600; white-space:nowrap; pointer-events:none; z-index:1; }
        @media (max-width: 720px) { .strip td { width:20px; min-width:20px; } .who { display:none; } }
      `,
      body: `
  <div class="card">
    <form method="get" action="/ops/calendar" class="grid">
      <div><label>Starting</label><input name="from" type="date" value="${iso(from)}"/></div>
      <div><label>Nights</label>
        <select name="nights">
          ${[14, 35, 60, 90]
            .map((n) => `<option value="${n}"${n === nights ? ' selected' : ''}>${n}</option>`)
            .join('')}
        </select></div>
      <div><button type="submit" class="ghost">Show</button></div>
    </form>
    <div style="display:flex;gap:10px;flex-wrap:wrap;margin-top:14px;align-items:center;">
      <a href="/ops/calendar?from=${iso(shiftMonth(from, -1))}&nights=${nights}"><button type="button" class="ghost">← ${esc(monthLabel(shiftMonth(from, -1)))}</button></a>
      <a href="/ops/calendar?from=${todayIso()}&nights=${nights}"><button type="button" class="ghost">Today</button></a>
      <a href="/ops/calendar?from=${iso(shiftMonth(from, 1))}&nights=${nights}"><button type="button" class="ghost">${esc(monthLabel(shiftMonth(from, 1)))} →</button></a>
    </div>
  </div>

  <div class="card">
    <p class="muted" style="font-size:13px;margin-bottom:14px;">
      Each stay has its own colour and starts with a dark edge, so back-to-back guests read as
      separate bookings. Green is free. Click any block to open it.
    </p>
    <div class="stripwrap">
      <table class="strip">
        <thead><tr><th class="rname"></th>${header}</tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
  </div>`
    })
  );
});

export default router;
