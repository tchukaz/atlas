import { Router } from 'express';
import { WHATSAPP_NUMBER, waLink } from '../config.js';
import { esc } from '../views.js';
import { findByCode, normalizeCode, recordClick } from '../store.js';

const router = Router();

const FALLBACK_WA = `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent('Hi Atlas House!')}`;

function interstitial(destination) {
  const url = esc(destination);
  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"/>
<meta name="viewport" content="width=device-width, initial-scale=1.0"/>
<meta name="robots" content="noindex"/>
<meta http-equiv="refresh" content="1;url=${url}"/>
<title>Atlas House — opening WhatsApp</title>
<link rel="icon" href="/assets/favicon.png"/>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Cormorant+Garamond:wght@300;400&family=Montserrat:wght@400;600&display=swap" rel="stylesheet">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    background: #0A0A0A; color: #F5F0E8;
    font-family: 'Montserrat', system-ui, sans-serif;
    min-height: 100vh; display: flex; align-items: center; justify-content: center;
    text-align: center; padding: 24px;
  }
  img { width: 92px; margin-bottom: 26px; opacity: 0.95; }
  h1 { font-family: 'Cormorant Garamond', Georgia, serif; font-weight: 400; font-size: 30px; margin-bottom: 10px; }
  p { color: #8A8A8A; font-size: 13px; letter-spacing: 0.06em; margin-bottom: 26px; }
  a.btn {
    display: inline-block; background: #C9A84C; color: #0A0A0A;
    text-decoration: none; padding: 14px 34px; border-radius: 3px;
    font-size: 11px; font-weight: 600; letter-spacing: 0.16em; text-transform: uppercase;
  }
</style>
</head>
<body>
<main>
  <img src="/assets/logo.png" alt="Atlas House"/>
  <h1>Taking you to WhatsApp</h1>
  <p>One moment&hellip;</p>
  <a class="btn" href="${url}">Open WhatsApp</a>
</main>
<script>window.location.replace(${JSON.stringify(destination)});</script>
</body>
</html>`;
}

const readOwnToken = (req) => {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === 'atlas_ref') return decodeURIComponent(rest.join('='));
  }
  return null;
};

router.get('/go/:code', (req, res) => {
  const code = normalizeCode(req.params.code);
  const participant = findByCode(code);

  if (code) {
    recordClick({
      code,
      ip: req.ip,
      userAgent: req.get('user-agent'),
      referer: req.get('referer'),
      selfToken: readOwnToken(req)
    });
  }

  // A disqualified referrer still forwards their traffic. The guest did nothing
  // wrong, and a booking is worth more than the point being made.
  res
    .set('Cache-Control', 'no-store')
    .type('html')
    .send(interstitial(participant ? waLink(participant.code) : FALLBACK_WA));
});

router.get('/go', (_req, res) => res.redirect(302, '/join'));

export default router;
