export const esc = (value) =>
  String(value ?? '').replace(
    /[&<>"']/g,
    (ch) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[ch]
  );

const BASE_CSS = `
  :root {
    --gold: #C9A84C;
    --gold-light: #E8C97A;
    --black: #0A0A0A;
    --dark: #111111;
    --line: rgba(201,168,76,0.22);
    --cream: #F5F0E8;
    --muted: #8A8A8A;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: var(--black);
    color: var(--cream);
    font-family: 'Montserrat', system-ui, sans-serif;
    font-size: 15px;
    line-height: 1.6;
    -webkit-font-smoothing: antialiased;
  }
  .wrap { max-width: 1040px; margin: 0 auto; padding: 48px 16px 72px; }
  h1, h2, .serif { font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; }
  h1 { font-size: 40px; line-height: 1.15; }
  h2 { font-size: 26px; margin-bottom: 14px; color: var(--gold-light); }
  .eyebrow {
    font-size: 11px; letter-spacing: 0.24em; text-transform: uppercase;
    color: var(--gold); margin-bottom: 10px;
  }
  .muted { color: var(--muted); }
  a { color: var(--gold-light); }
  .card {
    background: var(--dark);
    border: 1px solid var(--line);
    border-radius: 4px;
    padding: 24px;
    margin-bottom: 24px;
  }
  table { width: 100%; border-collapse: collapse; font-size: 14px; }
  th, td { padding: 12px 10px; text-align: left; border-bottom: 1px solid rgba(245,240,232,0.08); }
  th {
    font-size: 10px; letter-spacing: 0.16em; text-transform: uppercase;
    color: var(--gold); font-weight: 600; white-space: nowrap;
  }
  td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
  tbody tr:last-child td { border-bottom: none; }
  .rank { color: var(--gold); font-family: 'Cormorant Garamond', serif; font-size: 20px; width: 40px; }
  .lead td { background: rgba(201,168,76,0.06); }
  input, button, select {
    font-family: inherit; font-size: 14px;
    background: #0E0E0E; color: var(--cream);
    border: 1px solid var(--line); border-radius: 3px; padding: 9px 11px;
  }
  input.num { width: 72px; text-align: right; }
  button {
    background: var(--gold); color: var(--black); border-color: var(--gold);
    font-weight: 600; letter-spacing: 0.06em; text-transform: uppercase;
    font-size: 11px; padding: 10px 18px; cursor: pointer;
  }
  button.ghost { background: transparent; color: var(--gold-light); }
  .stat-row { display: flex; flex-wrap: wrap; gap: 28px; }
  .stat-number { font-family: 'Cormorant Garamond', serif; font-size: 40px; color: var(--gold); line-height: 1; }
  .stat-label { font-size: 10px; letter-spacing: 0.18em; text-transform: uppercase; color: var(--muted); margin-top: 6px; }
  .notice { border-left: 2px solid var(--gold); padding: 10px 14px; background: rgba(201,168,76,0.07); margin-bottom: 20px; font-size: 14px; }
  .notice.bad { border-color: #C4553D; background: rgba(196,85,61,0.1); }
  code, .mono { font-family: ui-monospace, 'SF Mono', Menlo, monospace; font-size: 13px; color: var(--gold-light); }
  .scroll { overflow-x: auto; }
  @media (max-width: 640px) {
    h1 { font-size: 30px; }
    .wrap { padding: 32px 14px 56px; }
    .card { padding: 18px 14px; }
  }
`;

export function layout({ title, body, extraCss = '' }) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="robots" content="noindex"/>
<title>${esc(title)}</title>
<link rel="icon" href="/assets/favicon.png"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400;600&family=Montserrat:wght@300;400;500;600;700&display=swap" rel="stylesheet">
<style>${BASE_CSS}${extraCss}</style>
</head>
<body><div class="wrap">${body}</div></body>
</html>`;
}
