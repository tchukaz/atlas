import { Router } from 'express';
import { CHALLENGE, daysLeft, naira, trackingLink } from '../config.js';
import { esc, layout } from '../views.js';
import { findByToken, rankOf, standings } from '../store.js';

const router = Router();

router.get('/me/:token', async (req, res) => {
  const participant = await findByToken(req.params.token);
  if (!participant) {
    return res
      .status(404)
      .type('html')
      .send(
        layout({
          title: 'Atlas House',
          body: `<h1>Link not recognised</h1>
        <p class="muted" style="margin-top:12px;">That dashboard link is not valid. Check the one we
        emailed you, or <a href="/join">sign up</a>.</p>`
        })
      );
  }

  const row = (await standings()).find((r) => r.code === participant.code);
  const { rank, of, leader } = await rankOf(participant.code);
  const earned = row.bookings * CHALLENGE.perBookingNaira;
  const remaining = daysLeft();
  const link = trackingLink(participant.code);

  // Marks this browser as the referrer's own, so refreshing their own link
  // does not inflate the click count they are judged on.
  res.cookie('atlas_ref', participant.token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: req.secure,
    maxAge: 90 * 24 * 60 * 60 * 1000
  });

  const standing = row.disqualified
    ? '<div class="notice bad">Your entry is under review. Get in touch if this is unexpected.</div>'
    : rank === 1 && row.bookings > 0
      ? `<div class="notice">You are <strong>1st</strong> of ${of}. Hold it.</div>`
      : leader && leader.bookings > row.bookings
        ? `<div class="notice">You are ${rank === null ? 'unranked' : `<strong>#${rank}</strong> of ${of}`}.
           ${esc(leader.name.split(/\s+/)[0])} leads with ${leader.bookings}.</div>`
        : `<div class="notice">Nobody has a booking yet. The first one takes the lead outright.</div>`;

  res.type('html').send(
    layout({
      title: `Atlas House — ${participant.name}`,
      extraCss: `.linkbox { background:#0E0E0E; border:1px solid var(--line); border-radius:3px;
                            padding:14px; word-break:break-all; margin-bottom:14px; }`,
      body: `
  <p class="eyebrow">Atlas House · Your results</p>
  <h1>${esc(participant.name.split(/\s+/)[0])}</h1>
  ${remaining !== null ? `<p class="muted" style="margin-top:10px;">${remaining === 0 ? 'The challenge has closed.' : `${remaining} day${remaining === 1 ? '' : 's'} left.`}</p>` : ''}

  <div style="margin-top:22px;">${standing}</div>

  <div class="card">
    <div class="stat-row">
      <div><div class="stat-number">${row.bookings}</div><div class="stat-label">Bookings</div></div>
      <div><div class="stat-number">${row.nights}</div><div class="stat-label">Nights</div></div>
      <div><div class="stat-number">${row.uniqueClicks}</div><div class="stat-label">Clicks</div></div>
      <div><div class="stat-number">${naira(earned)}</div><div class="stat-label">Earned</div></div>
    </div>
  </div>

  <div class="card">
    <h2 style="font-size:20px;">Your link</h2>
    <div class="linkbox mono">${esc(link)}</div>
    <button type="button" id="copy">Copy link</button>
    <p class="muted" style="font-size:13px;margin-top:16px;">
      Photos and a ready-made caption are in the <a href="/kit">share kit</a>.
    </p>
  </div>

  <p class="muted" style="font-size:13px;">
    Clicks are shown for credit but do not decide the winner — bookings do.
    <a href="/rules">The rules</a> · <a href="/leaderboard">Standings</a>
  </p>

  <script>
    document.getElementById('copy').addEventListener('click', async (event) => {
      await navigator.clipboard.writeText(${JSON.stringify(link)});
      event.target.textContent = 'Copied';
      setTimeout(() => { event.target.textContent = 'Copy link'; }, 1400);
    });
  </script>`
    })
  );
});

export default router;
