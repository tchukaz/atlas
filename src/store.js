import crypto from 'node:crypto';
import { Booking, Click, Participant, Reminder } from './models.js';
import { normalizePhone } from './phone.js';
import { BURST, subnetHash, visitorHash, looksAutomated } from './fraud.js';

const RESERVED = new Set([
  'admin', 'ops', 'go', 'api', 'join', 'me', 'rules', 'kit', 'assets', 'leaderboard',
  'data', 'src', 'www', 'about', 'book', 'booking', 'contact', 'atlas', 'atlashouse'
]);

export const normalizeCode = (raw) =>
  String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);

export async function codeProblem(code) {
  if (code.length < 3) return 'Pick at least 3 letters or numbers.';
  if (RESERVED.has(code)) return `"${code}" is reserved. Try another.`;
  if (await findByCode(code)) return `"${code}" is already taken.`;
  return null;
}

export const findByCode = (code) => Participant.findOne({ code: normalizeCode(code) }).lean();
export const findByToken = (token) => Participant.findOne({ token: String(token || '') }).lean();
export const findByContact = (phone, email) =>
  Participant.findOne({ $or: [{ phone }, { email: String(email || '').toLowerCase() }] }).lean();
export const listParticipants = () => Participant.find().sort('createdAt').lean();

export async function createParticipant({ name, email, phoneRaw, code }) {
  const doc = await Participant.create({
    name,
    email: String(email).toLowerCase(),
    phone: normalizePhone(phoneRaw),
    phoneRaw: String(phoneRaw),
    code,
    token: crypto.randomBytes(24).toString('hex'),
    consentAt: new Date()
  });
  return doc.toObject();
}

export const setStatus = (code, status) =>
  Participant.updateOne({ code: normalizeCode(code) }, { $set: { status } });

export const setEnquiries = (code, count) =>
  Participant.updateOne(
    { code: normalizeCode(code) },
    { $set: { enquiries: Math.max(0, Math.trunc(Number(count) || 0)) } }
  );

export async function recordClick({ code, ip, userAgent, referer, selfToken }) {
  const clean = normalizeCode(code);
  const owner = await findByCode(clean);
  await Click.create({
    code: clean,
    visitor: visitorHash(ip, userAgent),
    subnet: subnetHash(ip),
    referer: String(referer || '').slice(0, 200),
    isBot: looksAutomated(userAgent),
    isSelf: Boolean(selfToken && owner && selfToken === owner.token)
  });
}

const COUNTED = { isBot: false, isSelf: false };

/**
 * Bookings decide the order; clicks only ever break a tie. Faking traffic
 * therefore cannot move anyone past a referrer who delivered a real guest.
 */
export async function standings() {
  const [participants, clickRows, bookingRows] = await Promise.all([
    listParticipants(),
    Click.aggregate([
      { $match: COUNTED },
      {
        $group: {
          _id: '$code',
          clicks: { $sum: 1 },
          // One visitor counts once per day, so refreshing a link all afternoon
          // registers as a single person.
          visitorDays: { $addToSet: { v: '$visitor', d: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } } } },
          lastClickAt: { $max: '$ts' }
        }
      }
    ]),
    Booking.aggregate([
      { $match: { referralCode: { $nin: [null, ''] }, status: { $in: ['checked_in', 'checked_out'] } } },
      {
        $group: {
          _id: '$referralCode',
          bookings: { $sum: 1 },
          nights: {
            $sum: {
              $round: [{ $divide: [{ $subtract: ['$checkOut', '$checkIn'] }, 86400000] }, 0]
            }
          }
        }
      }
    ])
  ]);

  const clicksBy = new Map(clickRows.map((r) => [r._id, r]));
  const bookingsBy = new Map(bookingRows.map((r) => [r._id, r]));

  return participants
    .map((p) => {
      const c = clicksBy.get(p.code);
      const b = bookingsBy.get(p.code);
      return {
        ...p,
        id: String(p._id),
        clicks: c?.clicks || 0,
        uniqueClicks: c?.visitorDays?.length || 0,
        lastClickAt: c?.lastClickAt || null,
        bookings: b?.bookings || 0,
        nights: b?.nights || 0,
        disqualified: p.status === 'disqualified'
      };
    })
    .sort(
      (a, b) =>
        Number(a.disqualified) - Number(b.disqualified) ||
        b.bookings - a.bookings ||
        b.nights - a.nights ||
        b.uniqueClicks - a.uniqueClicks ||
        new Date(a.createdAt) - new Date(b.createdAt)
    );
}

export async function rankOf(code) {
  const ranked = (await standings()).filter((r) => !r.disqualified);
  const index = ranked.findIndex((r) => r.code === normalizeCode(code));
  return { rank: index === -1 ? null : index + 1, of: ranked.length, leader: ranked[0] || null };
}

export async function totals() {
  const rows = await standings();
  const sum = (key) => rows.reduce((n, r) => n + r[key], 0);
  return {
    participants: rows.length,
    active: rows.filter((r) => !r.disqualified).length,
    clicks: sum('clicks'),
    uniqueClicks: sum('uniqueClicks'),
    enquiries: sum('enquiries'),
    bookings: sum('bookings'),
    nights: sum('nights')
  };
}

// Many clicks on one code from a single network within minutes: the signature of
// someone refreshing their own link rather than of genuine reach.
export const burstFlags = () =>
  Click.aggregate([
    { $match: { isBot: false, subnet: { $ne: null } } },
    {
      $group: {
        _id: {
          code: '$code',
          subnet: '$subnet',
          window: {
            $dateToString: { format: '%Y-%m-%dT%H:%M', date: '$ts' }
          }
        },
        hits: { $sum: 1 },
        fromTs: { $min: '$ts' }
      }
    },
    { $match: { hits: { $gte: BURST.maxPerSubnet } } },
    { $sort: { hits: -1 } },
    { $limit: 20 },
    { $project: { _id: 0, code: '$_id.code', hits: 1, fromTs: 1 } }
  ]);

export async function dailyClicks(days = 7) {
  const since = new Date(Date.now() - (days - 1) * 86_400_000);
  since.setHours(0, 0, 0, 0);
  const rows = await Click.aggregate([
    { $match: { ...COUNTED, ts: { $gte: since } } },
    { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$ts' } }, count: { $sum: 1 } } }
  ]);
  const byDate = new Map(rows.map((r) => [r._id, r.count]));

  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date();
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: byDate.get(key) || 0 });
  }
  return out;
}

export async function orphanClicks() {
  const codes = (await Participant.find({}, { code: 1 }).lean()).map((p) => p.code);
  return Click.aggregate([
    { $match: { code: { $nin: codes } } },
    { $group: { _id: '$code', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 20 },
    { $project: { _id: 0, code: '$_id', count: 1 } }
  ]);
}

export const alreadyReminded = async (participantId, sendDate, kind = 'daily') =>
  Boolean(await Reminder.exists({ participant: participantId, sendDate, kind }));

export const markReminded = (participantId, sendDate, kind = 'daily') =>
  Reminder.updateOne(
    { participant: participantId, sendDate, kind },
    { $setOnInsert: { sentAt: new Date() } },
    { upsert: true }
  );
