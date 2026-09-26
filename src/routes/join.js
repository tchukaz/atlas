import { Router } from 'express';
import { CHALLENGE, SITE_URL, dashboardLink, naira, trackingLink } from '../config.js';
import { esc, layout } from '../views.js';
import { normalizePhone } from '../phone.js';
import { codeProblem, createParticipant, findByContact, normalizeCode } from '../store.js';
import { sendWelcome } from '../email.js';

const router = Router();

const attempts = new Map();

function rateLimited(ip) {
  const now = Date.now();
  const record = attempts.get(ip) || { count: 0, resetAt: now + 3_600_000 };
  if (now > record.resetAt) {
    record.count = 0;
    record.resetAt = now + 3_600_000;
  }
  record.count += 1;
  attempts.set(ip, record);
  return record.count > 8;
}

const FORM_CSS = `
  .field { margin-bottom: 18px; }
  .field label { display:block; font-size:10px; letter-spacing:0.18em; text-transform:uppercase;
                 color: var(--gold); margin-bottom: 7px; }
  .field input { width:100%; }
  .field .hint { font-size:12px; color: var(--muted); margin-top:6px; }
  .handle-row { display:flex; align-items:center; gap:0; }
  .handle-row .prefix { font-size:13px; color: var(--muted); white-space:nowrap;
                        border:1px solid var(--line); border-right:none;
                        border-radius:3px 0 0 3px; padding:9px 4px 9px 11px; background:#0E0E0E; }
  .handle-row input { border-radius:0 3px 3px 0; }
  .field label.consent { display:flex; gap:10px; align-items:flex-start; font-size:13px;
                         color:var(--muted); text-transform:none; letter-spacing:normal;
                         line-height:1.5; margin-bottom:0; }
  .consent input { width:auto; margin-top:3px; flex-shrink:0; }
  .hp { position:absolute; left:-9999px; }
  .linkbox { background:#0E0E0E; border:1px solid var(--line); border-radius:3px;
             padding:14px; word-break:break-all; margin:14px 0; }
`;

function signupForm({ values = {}, error = '' } = {}) {
  return layout({
    title: 'Atlas House — Join the referral challenge',
    extraCss: FORM_CSS,
    body: `
  <p class="eyebrow">Atlas House · Referral Challenge</p>
  <h1>Get your link</h1>
  <p class="muted" style="margin-top:12px;max-width:54ch;">
    Share it, and every enquiry it brings is tagged as yours. You earn
    ${naira(CHALLENGE.perBookingNaira)} for each booking that checks in — no cap. The top referrer
    wins ${esc(CHALLENGE.grandPrize)}.
  </p>

  ${error ? `<div class="notice bad" style="margin-top:22px;">${esc(error)}</div>` : ''}

  <form method="post" action="/join" class="card" style="margin-top:24px;max-width:480px;">
    <div class="field">
      <label for="name">Your name</label>
      <input id="name" name="name" required maxlength="60" autocomplete="name"
             value="${esc(values.name || '')}"/>
    </div>
    <div class="field">
      <label for="email">Email</label>
      <input id="email" name="email" type="email" required maxlength="120" autocomplete="email"
             value="${esc(values.email || '')}"/>
      <div class="hint">Your link and the daily standings go here.</div>
    </div>
    <div class="field">
      <label for="phone">WhatsApp number</label>
      <input id="phone" name="phone" required maxlength="20" inputmode="tel" autocomplete="tel"
             placeholder="08026883536" value="${esc(values.phone || '')}"/>
    </div>
    <div class="field">
      <label for="code">Choose your link</label>
      <div class="handle-row">
        <span class="prefix">${esc(SITE_URL.replace(/^https?:\/\//, ''))}/go/</span>
        <input id="code" name="code" required maxlength="20" pattern="[A-Za-z0-9]{3,20}"
               placeholder="yourname" value="${esc(values.code || '')}"/>
      </div>
      <div class="hint" id="availability">Letters and numbers only. People will read this aloud.</div>
    </div>
    <div class="field">
      <label class="consent">
        <input type="checkbox" name="consent" required/>
        <span>I agree that Atlas House may store my name, email and WhatsApp number to run this
        challenge and pay out what I earn.</span>
      </label>
    </div>
    <input class="hp" name="website" tabindex="-1" autocomplete="off"/>
    <button type="submit">Get my link</button>
  </form>

  <p class="muted" style="font-size:13px;">Full terms: <a href="/rules">the rules</a>.</p>

  <script>
    const code = document.getElementById('code');
    const hint = document.getElementById('availability');
    let timer;
    code.addEventListener('input', () => {
      clearTimeout(timer);
      timer = setTimeout(async () => {
        const value = code.value.trim();
        if (value.length < 3) { hint.textContent = 'Letters and numbers only. People will read this aloud.'; return; }
        const res = await fetch('/join/available?code=' + encodeURIComponent(value));
        const data = await res.json();
        hint.textContent = data.ok ? '\\u2713 ' + value + ' is free' : data.reason;
        hint.style.color = data.ok ? '#C9A84C' : '#C4553D';
      }, 300);
    });
  </script>`
  });
}

function successPage(participant, { returning = false } = {}) {
  const link = trackingLink(participant.code);
  return layout({
    title: 'Atlas House — Your referral link',
    extraCss: FORM_CSS,
    body: `
  <p class="eyebrow">Atlas House · Referral Challenge</p>
  <h1>${returning ? "You're already in" : "You're in"}, ${esc(participant.name.split(/\s+/)[0])}</h1>
  <p class="muted" style="margin-top:12px;">This is your link. Anyone who opens it lands in our
  WhatsApp already tagged as yours.</p>

  <div class="card" style="margin-top:22px;max-width:560px;">
    <div class="linkbox mono" id="link">${esc(link)}</div>
    <button type="button" id="copy">Copy link</button>
    <p class="muted" style="font-size:13px;margin-top:16px;">
      Track your clicks and bookings any time at
      <a href="${esc(dashboardLink(participant.token))}">your dashboard</a> —
      we have emailed you both links.
    </p>
  </div>

  <div class="card" style="max-width:560px;">
    <h2 style="font-size:20px;">What to post</h2>
    <p class="muted" style="font-size:14px;">Grab the photos and a ready-made caption from the
      <a href="/kit">share kit</a>. Posting it to your status or story takes about fifteen seconds.</p>
  </div>

  <p class="muted" style="font-size:13px;">
    <a href="/leaderboard">Standings</a> · <a href="/rules">Rules</a>
  </p>

  <script>
    document.getElementById('copy').addEventListener('click', async (event) => {
      await navigator.clipboard.writeText(${JSON.stringify(link)});
      event.target.textContent = 'Copied';
      setTimeout(() => { event.target.textContent = 'Copy link'; }, 1400);
    });
  </script>`
  });
}

router.get('/join', (_req, res) => res.type('html').send(signupForm()));

router.get('/join/available', async (req, res) => {
  const code = normalizeCode(req.query.code);
  const problem = await codeProblem(code);
  res.json({ ok: !problem, reason: problem || '' });
});

router.post('/join', async (req, res) => {
  const { name = '', email = '', phone = '', code = '', consent, website } = req.body || {};
  const values = { name, email, phone, code };
  const fail = (error) => res.status(400).type('html').send(signupForm({ values, error }));

  if (website) return res.status(400).type('html').send(signupForm({ error: 'Something went wrong.' }));
  if (rateLimited(req.ip)) {
    return res.status(429).type('html').send(signupForm({ values, error: 'Too many attempts. Try again later.' }));
  }
  if (!consent) return fail('Please tick the consent box so we can store your details.');

  const cleanName = String(name).trim().slice(0, 60);
  if (cleanName.length < 2) return fail('Please enter your name.');

  const cleanEmail = String(email).trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s.]+\.[^@\s]+$/.test(cleanEmail)) return fail('That email does not look right.');

  const normalizedPhone = normalizePhone(phone);
  if (!normalizedPhone) return fail('That does not look like a Nigerian mobile number.');

  // Someone coming back a second time gets their original link rather than an
  // error — and cannot collect a second code to spread activity across.
  const existing = await findByContact(normalizedPhone, cleanEmail);
  if (existing) return res.type('html').send(successPage(existing, { returning: true }));

  const cleanCode = normalizeCode(code);
  const problem = await codeProblem(cleanCode);
  if (problem) return fail(problem);

  const participant = await createParticipant({
    name: cleanName,
    email: cleanEmail,
    phoneRaw: phone,
    code: cleanCode
  });

  sendWelcome(participant).catch((err) => console.error('welcome email failed:', err.message));

  res.type('html').send(successPage(participant));
});

export default router;
