import { esc, layout } from './views.js';

export const OPS_CSS = `
  .tabs { display:flex; gap:6px; flex-wrap:wrap; margin:22px 0 6px; align-items:flex-start; }
  .tabs a, .tabs summary {
    font-size:11px; letter-spacing:0.14em; text-transform:uppercase; text-decoration:none;
    padding:9px 14px; border:1px solid var(--line); border-radius:3px; color:var(--muted);
    display:inline-block; cursor:pointer; list-style:none;
  }
  .tabs summary::-webkit-details-marker { display:none; }
  .tabs a.on, .tabs summary.on { background:var(--gold); color:var(--black);
                                 border-color:var(--gold); font-weight:600; }
  .more { position:relative; }
  .moremenu { position:absolute; z-index:20; top:calc(100% + 5px); left:0; min-width:190px;
              background:var(--dark); border:1px solid var(--line); border-radius:3px;
              padding:6px; display:flex; flex-direction:column; gap:4px;
              box-shadow:0 12px 28px rgba(0,0,0,0.5); }
  .moremenu a { border:none; text-align:left; }
  .moremenu a:hover { background:rgba(201,168,76,0.12); }
  .crumbs { font-size:12px; color:var(--muted); margin:14px 0 4px; }
  .crumbs a { color:var(--gold-light); text-decoration:none; }
  .crumbs .sep { margin:0 7px; opacity:0.5; }
  .grid { display:grid; gap:10px; grid-template-columns:repeat(auto-fit,minmax(150px,1fr)); align-items:end; }
  .grid label { font-size:10px; letter-spacing:0.16em; text-transform:uppercase; color:var(--gold);
                display:block; margin-bottom:6px; }
  .grid input, .grid select, .grid textarea { width:100%; }
  .pill { font-size:10px; letter-spacing:0.1em; text-transform:uppercase; padding:3px 8px;
          border-radius:2px; border:1px solid var(--line); color:var(--muted); white-space:nowrap;
          display:inline-block; }
  .pill.on { border-color:var(--gold); color:var(--gold); }
  .pill.warn { border-color:#C4553D; color:#C4553D; }
  .pill.good { border-color:#7FA86B; color:#7FA86B; }
  .free { color:#7FA86B; }
  .busy { color:#C4553D; }
  .thumbs { display:grid; grid-template-columns:repeat(auto-fill,minmax(150px,1fr)); gap:12px; }
  .thumbs figure { margin:0; border:1px solid var(--line); border-radius:3px; overflow:hidden;
                   background:#0E0E0E; }
  .thumbs img { width:100%; height:130px; object-fit:cover; display:block; }
  .thumbs figcaption { padding:8px 10px; font-size:12px; color:var(--muted); }
  .roomopt { display:flex; align-items:center; gap:9px; padding:7px 2px; font-size:14px;
             color:var(--cream); cursor:pointer; }
  .roomopt input { width:auto; flex-shrink:0; transform:scale(1.25); }
  .roomopt input:disabled + span { color:var(--muted); }
  label.plain { text-transform:none; letter-spacing:normal; color:var(--muted);
                font-size:13px; display:flex; align-items:center; gap:8px; }
  label.plain input { width:auto; }

  @media (max-width: 720px) {
    /* Wide tables become one card per row: ops reads this on a phone far more
       often than at a desk, and a six-column table there is unusable. */
    table.stack thead { display:none; }
    table.stack, table.stack tbody, table.stack tr, table.stack td { display:block; width:100%; }
    table.stack tr { border:1px solid var(--line); border-radius:3px; padding:6px 10px;
                     margin-bottom:12px; }
    table.stack td { border:none; padding:6px 0; text-align:left; }
    table.stack td.num { text-align:left; }
    table.stack td[data-h]::before {
      content: attr(data-h); display:block; font-size:10px; letter-spacing:0.16em;
      text-transform:uppercase; color:var(--gold); margin-bottom:3px;
    }
    .grid { grid-template-columns:1fr; }
    .tabs a { flex:1 1 auto; text-align:center; }
    button, .grid input, .grid select { min-height:44px; }
  }
`;

// The daily three stay visible everywhere; the rest are things you go looking
// for rather than live in, and on a phone seven tabs wrapped to three rows.
const PRIMARY = [
  ['/ops/today', 'Today', 'Who arrives, leaves and is in house'],
  ['/ops/calendar', 'Calendar', 'Every bedroom, night by night'],
  ['/ops/bookings', 'Bookings', 'Find, create and manage stays']
];

const SECONDARY = [
  ['/ops/enquiries', 'Enquiries', 'Dates you were asked for and could not sell'],
  ['/ops/reports', 'Reports', 'Occupancy, revenue and demand'],
  ['/ops/records', 'Records', 'Every photo and document'],
  ['/ops/setup', 'Setup', 'Apartments, bedrooms and what you sell'],
  ['/admin', 'Referrals', 'The referral challenge']
];

export const tabs = (active) => {
  const link = ([href, label, hint]) =>
    `<a href="${href}" class="${href === active ? 'on' : ''}" title="${esc(hint)}">${label}</a>`;
  const inMore = SECONDARY.some(([href]) => href === active);
  return `<nav class="tabs">${PRIMARY.map(link).join('')}
    <details class="more"${inMore ? ' open' : ''}>
      <summary class="${inMore ? 'on' : ''}">More</summary>
      <div class="moremenu">${SECONDARY.map(link).join('')}</div>
    </details>
  </nav>`;
};

const crumbs = (trail, title) => {
  if (!trail?.length) return '';
  const parts = trail.map(([label, href]) =>
    href ? `<a href="${href}">${esc(label)}</a>` : `<span>${esc(label)}</span>`
  );
  return `<div class="crumbs">${parts.join('<span class="sep">›</span>')}</div>`;
};

export const opsPage = ({ title, active, body, flash, error, extraCss = '', breadcrumb }) =>
  layout({
    title: `Atlas House — ${title}`,
    extraCss: OPS_CSS + extraCss,
    body: `<p class="eyebrow">Atlas House · Ops</p>
      ${tabs(active)}
      ${crumbs(breadcrumb, title)}
      <h1>${esc(title)}</h1>
      ${flash ? `<div class="notice">${esc(flash)}</div>` : ''}
      ${error ? `<div class="notice bad">${esc(error)}</div>` : ''}
      ${body}`
  });

export const flashOf = (req) => ({
  flash: typeof req.query.msg === 'string' ? req.query.msg.slice(0, 400) : '',
  error: typeof req.query.err === 'string' ? req.query.err.slice(0, 400) : ''
});

export const back = (res, to, { msg, err } = {}) => {
  // `to` may already carry a query string, so merge rather than append a second
  // "?" — which silently swallowed the message it was meant to deliver.
  const [pathname, existing] = String(to).split('?');
  const params = new URLSearchParams(existing || '');
  if (msg) params.set('msg', msg);
  if (err) params.set('err', err);
  res.redirect(302, `${pathname}${params.toString() ? `?${params}` : ''}`);
};

export const todayIso = () => new Date().toISOString().slice(0, 10);
export const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
export const pretty = (d) =>
  d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : '';
