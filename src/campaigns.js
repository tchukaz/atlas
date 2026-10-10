import { Booking, Campaign, Click } from './models.js';
import { subnetHash, visitorHash, looksAutomated } from './fraud.js';

export const PLATFORMS = ['instagram', 'facebook', 'tiktok', 'whatsapp', 'flyer', 'other'];

export const normalizeCampaignCode = (raw) => String(raw || '').replace(/[^0-9]/g, '').slice(0, 8);

/** Four digits, not already taken. Short enough to sit in ad copy. */
export async function freeCode() {
  for (let attempt = 0; attempt < 40; attempt++) {
    const candidate = String(1000 + Math.floor(Math.random() * 9000));
    if (!(await Campaign.exists({ code: candidate }))) return candidate;
  }
  return String(Date.now()).slice(-6);
}

/**
 * Every hit is written, bots included — the proportion that gets filtered is
 * itself worth seeing on paid traffic, where a campaign full of bots says
 * something about where the ad landed.
 */
export async function recordCampaignClick({ code, ip, userAgent, referer }) {
  await Click.create({
    code: normalizeCampaignCode(code),
    kind: 'campaign',
    visitor: visitorHash(ip, userAgent),
    subnet: subnetHash(ip),
    referer: String(referer || '').slice(0, 200),
    isBot: looksAutomated(userAgent)
  });
}

/**
 * Totals per campaign. Reported alongside each other rather than as one
 * number: counted clicks are what you judge the ad on, and the gap between
 * that and raw hits is what you judge the placement on.
 */
export async function campaignStats() {
  const campaigns = await Campaign.find().sort('-createdAt').lean();
  if (!campaigns.length) return [];

  const codes = campaigns.map((c) => c.code);

  const [clickRows, bookingRows] = await Promise.all([
    Click.aggregate([
      { $match: { kind: 'campaign', code: { $in: codes } } },
      {
        $group: {
          _id: '$code',
          hits: { $sum: 1 },
          bots: { $sum: { $cond: ['$isBot', 1, 0] } },
          // One device counts once per day, same rule the referral side uses.
          visitorDays: {
            $addToSet: {
              $cond: [
                '$isBot',
                '$$REMOVE',
                { v: '$visitor', d: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } } }
              ]
            }
          },
          humanHits: { $sum: { $cond: ['$isBot', 0, 1] } },
          lastAt: { $max: '$ts' }
        }
      }
    ]),
    Booking.aggregate([
      { $match: { campaignCode: { $in: codes }, status: { $in: ['checked_in', 'checked_out'] } } },
      {
        $group: {
          _id: '$campaignCode',
          bookings: { $sum: 1 },
          nights: {
            $sum: { $round: [{ $divide: [{ $subtract: ['$checkOut', '$checkIn'] }, 86400000] }, 0] }
          },
          revenue: { $sum: { $sum: '$payments.amount' } }
        }
      }
    ])
  ]);

  const clicksBy = new Map(clickRows.map((r) => [r._id, r]));
  const bookingsBy = new Map(bookingRows.map((r) => [r._id, r]));

  return campaigns.map((c) => {
    const k = clicksBy.get(c.code);
    const b = bookingsBy.get(c.code);
    const counted = k?.visitorDays?.length || 0;
    const hits = k?.hits || 0;
    const bots = k?.bots || 0;
    const bookings = b?.bookings || 0;

    return {
      ...c,
      hits,
      bots,
      counted,
      // Humans who came back the same day, or more than once in a day.
      repeats: Math.max(0, (k?.humanHits || 0) - counted),
      lastAt: k?.lastAt || null,
      enquiries: c.enquiries || 0,
      bookings,
      nights: b?.nights || 0,
      revenue: b?.revenue || 0,
      // Without recorded spend these are all zero, which reads as "this ad was
      // free" rather than "nobody has entered what it cost".
      costPerClick: c.spend && counted ? Math.round(c.spend / counted) : null,
      costPerEnquiry: c.spend && c.enquiries ? Math.round(c.spend / c.enquiries) : null,
      costPerBooking: c.spend && bookings ? Math.round(c.spend / bookings) : null
    };
  });
}

/**
 * Clicks from the last few minutes, for attaching an enquiry that arrived
 * without its code. A guest who deleted the tag from the message still left a
 * click behind, and the timing is usually unambiguous.
 */
export async function recentClicks(minutes = 30) {
  const since = new Date(Date.now() - minutes * 60_000);
  const rows = await Click.find({ ts: { $gte: since }, isBot: false, isSelf: false })
    .sort('-ts')
    .limit(25)
    .lean();
  if (!rows.length) return [];

  const campaigns = await Campaign.find({ code: { $in: rows.map((r) => r.code) } }, { code: 1, name: 1 }).lean();
  const names = new Map(campaigns.map((c) => [c.code, c.name]));

  // One entry per code, most recent first: three clicks on the same advert are
  // three identical buttons, and picking any of them sets the same code.
  const seen = new Set();
  return rows
    .filter((r) => (seen.has(r.code) ? false : seen.add(r.code)))
    .map((r) => ({
      at: r.ts,
      code: r.code,
      kind: r.kind,
      label: r.kind === 'campaign' ? names.get(r.code) || `Campaign ${r.code}` : r.code,
      minutesAgo: Math.max(0, Math.round((Date.now() - new Date(r.ts)) / 60_000))
    }));
}
