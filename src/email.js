import { Resend } from 'resend';
import { CHALLENGE, EMAIL, SITE_URL, dashboardLink, naira, trackingLink } from './config.js';
import { esc } from './views.js';

const client = EMAIL.apiKey ? new Resend(EMAIL.apiKey) : null;

async function send({ to, subject, html }) {
  if (!client) {
    console.log(`[email skipped — no RESEND_API_KEY] ${subject} -> ${to}`);
    return { skipped: true };
  }
  const { error } = await client.emails.send({
    from: EMAIL.from,
    to,
    subject,
    html,
    ...(EMAIL.replyTo ? { replyTo: EMAIL.replyTo } : {})
  });
  if (error) throw new Error(error.message || 'Resend rejected the message');
  return { sent: true };
}

const wrap = (body) => `
<div style="background:#0A0A0A;padding:32px 16px;font-family:Helvetica,Arial,sans-serif;">
  <div style="max-width:520px;margin:0 auto;background:#111;border:1px solid rgba(201,168,76,0.22);
              border-radius:4px;padding:32px;color:#F5F0E8;">
    <div style="font-size:11px;letter-spacing:0.24em;text-transform:uppercase;color:#C9A84C;
                margin-bottom:18px;">Atlas House</div>
    ${body}
    <hr style="border:none;border-top:1px solid rgba(245,240,232,0.1);margin:28px 0 16px;"/>
    <div style="font-size:12px;color:#8A8A8A;">
      Atlas House · Iwofe, Port Harcourt ·
      <a href="${SITE_URL}/rules" style="color:#C9A84C;">Rules</a>
    </div>
  </div>
</div>`;

const button = (href, label) => `
  <a href="${href}" style="display:inline-block;background:#C9A84C;color:#0A0A0A;
     text-decoration:none;padding:13px 28px;border-radius:3px;font-size:12px;font-weight:bold;
     letter-spacing:0.12em;text-transform:uppercase;">${label}</a>`;

export function sendWelcome(participant) {
  const link = trackingLink(participant.code);
  return send({
    to: participant.email,
    subject: 'Your Atlas House referral link',
    html: wrap(`
      <h1 style="font-size:24px;font-weight:normal;margin:0 0 14px;">
        You're in, ${esc(participant.name.split(/\s+/)[0])}
      </h1>
      <p style="color:#B9B2A6;font-size:15px;line-height:1.6;margin:0 0 20px;">
        This is your link. Anyone who opens it lands in our WhatsApp already tagged as yours.
      </p>
      <div style="background:#0E0E0E;border:1px solid rgba(201,168,76,0.22);border-radius:3px;
                  padding:14px;font-family:monospace;font-size:14px;color:#E8C97A;
                  word-break:break-all;margin-bottom:22px;">${esc(link)}</div>
      <p style="color:#B9B2A6;font-size:15px;line-height:1.6;margin:0 0 20px;">
        You earn <strong style="color:#F5F0E8;">${naira(CHALLENGE.perBookingNaira)}</strong> for every
        booking that comes through it and checks in. No cap. The top referrer wins
        ${esc(CHALLENGE.grandPrize)}.
      </p>
      ${button(dashboardLink(participant.token), 'Track your results')}
      <p style="color:#8A8A8A;font-size:13px;line-height:1.6;margin:22px 0 0;">
        Grab photos and a ready-made caption from the
        <a href="${SITE_URL}/kit" style="color:#C9A84C;">share kit</a>.
      </p>`)
  });
}

export function sendDailyNudge({ participant, rank, of, leader, daysRemaining, stats }) {
  const chasing =
    rank === 1
      ? `You're top of the board. ${of - 1} people are chasing you.`
      : leader && leader.bookings > stats.bookings
        ? `${esc(leader.name.split(/\s+/)[0])} is on ${leader.bookings} booking${leader.bookings === 1 ? '' : 's'}. You're on ${stats.bookings}.`
        : 'Nobody has a booking yet. First one takes the lead outright.';

  return send({
    to: participant.email,
    subject:
      daysRemaining <= 1
        ? 'Last day — Atlas House referral challenge'
        : `${daysRemaining} days left · you're ${rank ? `#${rank}` : 'in'}`,
    html: wrap(`
      <h1 style="font-size:24px;font-weight:normal;margin:0 0 14px;">
        ${daysRemaining <= 1 ? 'Last day' : `${daysRemaining} days left`}
      </h1>
      <p style="color:#B9B2A6;font-size:15px;line-height:1.6;margin:0 0 6px;">${chasing}</p>
      <p style="color:#B9B2A6;font-size:15px;line-height:1.6;margin:0 0 22px;">
        Your link has ${stats.uniqueClicks} click${stats.uniqueClicks === 1 ? '' : 's'} and
        ${stats.bookings} booking${stats.bookings === 1 ? '' : 's'} so far${
          stats.bookings ? `, worth ${naira(stats.bookings * CHALLENGE.perBookingNaira)}` : ''
        }.
      </p>
      <div style="background:#0E0E0E;border:1px solid rgba(201,168,76,0.22);border-radius:3px;
                  padding:14px;font-family:monospace;font-size:14px;color:#E8C97A;
                  word-break:break-all;margin-bottom:22px;">${esc(trackingLink(participant.code))}</div>
      <p style="color:#B9B2A6;font-size:15px;line-height:1.6;margin:0 0 20px;">
        Post it again today — status, story, or straight to a group. Most bookings come from the
        second or third time someone sees it.
      </p>
      ${button(dashboardLink(participant.token), 'See where you stand')}`)
  });
}
