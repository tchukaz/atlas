import { esc, layout } from './views.js';

export const OPS_CSS = `
  .tabs { display:flex; gap:6px; flex-wrap:wrap; margin:26px 0 8px; }
  .tabs a { font-size:11px; letter-spacing:0.14em; text-transform:uppercase; text-decoration:none;
            padding:9px 14px; border:1px solid var(--line); border-radius:3px; color:var(--muted); }
  .tabs a.on { background:var(--gold); color:var(--black); border-color:var(--gold); font-weight:600; }
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

const TABS = [
  ['/ops/bookings', 'Bookings'],
  ['/ops/calendar', 'Today'],
  ['/ops/inventory', 'Inventory'],
  ['/ops/enquiries', 'Enquiries'],
  ['/ops/records', 'Records'],
  ['/ops/reports', 'Reports'],
  ['/admin', 'Referrals']
];

export const tabs = (active) =>
  `<div class="tabs">${TABS.map(
    ([href, label]) => `<a href="${href}" class="${href === active ? 'on' : ''}">${label}</a>`
  ).join('')}</div>`;

export const opsPage = ({ title, active, body, flash, error, extraCss = '' }) =>
  layout({
    title: `Atlas House — ${title}`,
    extraCss: OPS_CSS + extraCss,
    body: `<p class="eyebrow">Atlas House · Ops</p>
      <h1>${esc(title)}</h1>
      ${tabs(active)}
      ${flash ? `<div class="notice">${esc(flash)}</div>` : ''}
      ${error ? `<div class="notice bad">${esc(error)}</div>` : ''}
      ${body}`
  });

export const flashOf = (req) => ({
  flash: typeof req.query.msg === 'string' ? req.query.msg.slice(0, 400) : '',
  error: typeof req.query.err === 'string' ? req.query.err.slice(0, 400) : ''
});

export const back = (res, to, { msg, err } = {}) => {
  const params = new URLSearchParams();
  if (msg) params.set('msg', msg);
  if (err) params.set('err', err);
  res.redirect(302, `${to}${params.toString() ? `?${params}` : ''}`);
};

export const todayIso = () => new Date().toISOString().slice(0, 10);
export const iso = (d) => (d ? new Date(d).toISOString().slice(0, 10) : '');
export const pretty = (d) =>
  d ? new Date(d).toLocaleDateString('en-NG', { day: 'numeric', month: 'short' }) : '';
