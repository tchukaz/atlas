import { Router } from 'express';
import { CHALLENGE, naira } from '../config.js';
import { esc, layout } from '../views.js';

const router = Router();

const CAPTION =
  'Two-bedroom, both en-suite, AC, fast wifi, backup power, secure parking. Iwofe, Port Harcourt. Link in my story 👇';

const prose = `
  .prose h2 { margin-top: 30px; }
  .prose p, .prose li { color: #B9B2A6; font-size: 15px; }
  .prose ul { margin: 10px 0 0 20px; }
  .prose li { margin-bottom: 8px; }
`;

router.get('/rules', (_req, res) => {
  const window =
    CHALLENGE.startDate && CHALLENGE.endDate
      ? `${CHALLENGE.startDate} to ${CHALLENGE.endDate}`
      : 'the announced dates';

  res.type('html').send(
    layout({
      title: 'Atlas House — Referral Challenge Rules',
      extraCss: prose,
      body: `
  <p class="eyebrow">Atlas House</p>
  <h1>The rules</h1>
  <div class="card prose" style="margin-top:24px;">
    <h2 style="margin-top:0;">What you earn</h2>
    <p>${naira(CHALLENGE.perBookingNaira)} for every confirmed booking that comes through your link,
    paid within 48 hours of the guest checking in. There is no cap — five bookings is
    ${naira(CHALLENGE.perBookingNaira * 5)}.</p>
    <p>The referrer with the most confirmed bookings when the challenge closes wins
    ${esc(CHALLENGE.grandPrize)}, to be taken within three months.</p>

    <h2>What counts as a booking</h2>
    <p>A stay that is <strong style="color:#F5F0E8;">paid for and checked in</strong>, from an enquiry
    that reached our WhatsApp tagged with your code. A reservation that is never paid, or a guest who
    never arrives, does not count.</p>

    <h2>How the ranking works</h2>
    <p>Position is decided by confirmed bookings, then by nights booked, then by clicks, then by who
    joined first.</p>
    <p><strong style="color:#F5F0E8;">Clicks do not decide the winner.</strong> They are shown so that
    people putting in real effort get visible credit, but they carry no weight in the prize. Sending
    traffic to your own link will not move you up the board.</p>

    <h2>What gets an entry removed</h2>
    <ul>
      <li>Booking your own stay, or a stay by someone using your registered number, through your own link.</li>
      <li>Registering more than once to collect additional links.</li>
      <li>Automated or purchased traffic.</li>
      <li>Misrepresenting Atlas House to get a click.</li>
    </ul>
    <p>Atlas House may withhold a payout or remove an entry where any of the above is found. Where it
    is unclear, we will ask you first.</p>

    <h2>Dates</h2>
    <p>The challenge runs ${esc(window)}. Bookings are counted by check-in date, so a stay booked
    inside the window but checked in after it closes does not count toward the prize — though you are
    still paid for it.</p>

    <h2>Your details</h2>
    <p>We store your name, email and WhatsApp number to run the challenge and pay you. We do not sell
    or share them. The public standings show first names only. Ask us any time and we will delete
    your record.</p>
  </div>

  <p class="muted" style="font-size:13px;">
    <a href="/join">Get your link</a> · <a href="/leaderboard">Standings</a>
  </p>`
    })
  );
});

router.get('/kit', (_req, res) => {
  res.type('html').send(
    layout({
      title: 'Atlas House — Share kit',
      extraCss: `${prose}
        .shots { display:grid; grid-template-columns:repeat(auto-fit,minmax(200px,1fr)); gap:14px; }
        .shots img { width:100%; border-radius:3px; border:1px solid var(--line); display:block; }
        .caption { background:#0E0E0E; border:1px solid var(--line); border-radius:3px;
                   padding:16px; margin:14px 0; font-size:15px; }`,
      body: `
  <p class="eyebrow">Atlas House</p>
  <h1>Share kit</h1>
  <p class="muted" style="margin-top:12px;max-width:56ch;">
    Everything you need to post in about fifteen seconds. Save a photo, paste the caption, drop your
    link in.
  </p>

  <div class="card">
    <h2 style="font-size:20px;">The caption</h2>
    <div class="caption" id="caption">${esc(CAPTION)}</div>
    <button type="button" id="copy">Copy caption</button>
  </div>

  <div class="card">
    <h2 style="font-size:20px;">The photos</h2>
    <p class="muted" style="font-size:14px;margin-bottom:14px;">Long-press to save on your phone.</p>
    <div class="shots">
      <img src="/assets/apt-2bed.jpg" alt="Atlas House two-bedroom apartment"/>
      <img src="/assets/apt-1bed.jpg" alt="Atlas House one-bedroom apartment"/>
    </div>
  </div>

  <div class="card prose">
    <h2 style="font-size:20px;margin-top:0;">What works</h2>
    <ul>
      <li>WhatsApp status reaches more of your contacts than a group post, and annoys nobody.</li>
      <li>Say it in your own words. "A friend of mine runs this place" beats an advert.</li>
      <li>Post more than once. Most bookings come the second or third time someone sees it.</li>
    </ul>
  </div>

  <p class="muted" style="font-size:13px;">
    <a href="/leaderboard">Standings</a> · <a href="/rules">Rules</a>
  </p>

  <script>
    document.getElementById('copy').addEventListener('click', async (event) => {
      await navigator.clipboard.writeText(${JSON.stringify(CAPTION)});
      event.target.textContent = 'Copied';
      setTimeout(() => { event.target.textContent = 'Copy caption'; }, 1400);
    });
  </script>`
    })
  );
});

export default router;
