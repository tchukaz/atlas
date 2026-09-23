import crypto from 'node:crypto';
import { db } from './db.js';
import { normalizePhone } from './phone.js';
import { BURST, subnetHash, visitorHash, looksAutomated } from './fraud.js';

const RESERVED = new Set([
  'admin', 'go', 'api', 'join', 'me', 'rules', 'kit', 'assets', 'leaderboard',
  'data', 'src', 'www', 'about', 'book', 'booking', 'contact', 'atlas', 'atlashouse'
]);

export const normalizeCode = (raw) =>
  String(raw || '').toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 20);

export function codeProblem(code) {
  if (code.length < 3) return 'Pick at least 3 letters or numbers.';
  if (RESERVED.has(code)) return `"${code}" is reserved. Try another.`;
  if (findByCode(code)) return `"${code}" is already taken.`;
  return null;
}

export const findByCode = (code) =>
  db.prepare('SELECT * FROM participants WHERE code = ?').get(normalizeCode(code)) || null;

export const findByToken = (token) =>
  db.prepare('SELECT * FROM participants WHERE token = ?').get(String(token || '')) || null;

export const findByContact = (phone, email) =>
  db
    .prepare('SELECT * FROM participants WHERE phone = ? OR email = ?')
    .get(phone, String(email || '').toLowerCase()) || null;

export const listParticipants = () =>
  db.prepare('SELECT * FROM participants ORDER BY created_at').all();

export function createParticipant({ name, email, phoneRaw, code }) {
  const phone = normalizePhone(phoneRaw);
  const token = crypto.randomBytes(24).toString('hex');
  const now = new Date().toISOString();

  const info = db
    .prepare(
      `INSERT INTO participants (name, email, phone, phone_raw, code, token, consent_at, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .run(name, String(email).toLowerCase(), phone, String(phoneRaw), code, token, now, now);

  return db.prepare('SELECT * FROM participants WHERE id = ?').get(info.lastInsertRowid);
}

export function setStatus(code, status) {
  db.prepare('UPDATE participants SET status = ? WHERE code = ?').run(status, normalizeCode(code));
}

export function setEnquiries(code, count) {
  db.prepare('UPDATE participants SET enquiries = ? WHERE code = ?').run(
    Math.max(0, Math.trunc(Number(count) || 0)),
    normalizeCode(code)
  );
}

export function recordClick({ code, ip, userAgent, referer, selfToken }) {
  const clean = normalizeCode(code);
  const visitor = visitorHash(ip, userAgent);
  const owner = findByCode(clean);
  const isSelf = Boolean(selfToken && owner && selfToken === owner.token);

  db.prepare(
    `INSERT INTO clicks (code, ts, visitor, subnet, referer, is_bot, is_self)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    clean,
    new Date().toISOString(),
    visitor,
    subnetHash(ip),
    String(referer || '').slice(0, 200),
    looksAutomated(userAgent) ? 1 : 0,
    isSelf ? 1 : 0
  );
}

// A click counts once per visitor per day per code. Clicks from bots, or from the
// referrer's own device, are stored but never counted.
const COUNTED = `is_bot = 0 AND is_self = 0`;

const clickStats = db.prepare(`
  SELECT
    COUNT(*) AS total,
    COUNT(DISTINCT visitor || substr(ts, 1, 10)) AS unique_clicks,
    MAX(ts) AS last_click
  FROM clicks WHERE code = ? AND ${COUNTED}
`);

export function standings() {
  const rows = listParticipants().map((p) => {
    const clicks = clickStats.get(p.code);
    const booking = db
      .prepare(
        `SELECT COUNT(*) AS bookings, COALESCE(SUM(nights), 0) AS nights
         FROM bookings WHERE code = ?`
      )
      .get(p.code);

    return {
      ...p,
      clicks: clicks.total || 0,
      uniqueClicks: clicks.unique_clicks || 0,
      lastClickAt: clicks.last_click,
      bookings: booking.bookings || 0,
      nights: booking.nights || 0,
      disqualified: p.status === 'disqualified'
    };
  });

  // Bookings decide the order. Clicks only ever break a tie, so inflating them
  // cannot move anyone past a referrer who actually delivered a guest.
  return rows.sort(
    (a, b) =>
      Number(a.disqualified) - Number(b.disqualified) ||
      b.bookings - a.bookings ||
      b.nights - a.nights ||
      b.uniqueClicks - a.uniqueClicks ||
      a.created_at.localeCompare(b.created_at)
  );
}

export function rankOf(code) {
  const ranked = standings().filter((r) => !r.disqualified);
  const index = ranked.findIndex((r) => r.code === normalizeCode(code));
  return { rank: index === -1 ? null : index + 1, of: ranked.length, leader: ranked[0] || null };
}

export function totals() {
  const rows = standings();
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

export const listBookings = () =>
  db.prepare('SELECT * FROM bookings ORDER BY checked_in_on DESC, id DESC').all();

export function addBooking({ code, guestName, guestPhone, nights, checkedInOn }) {
  const clean = normalizeCode(code);
  const phone = normalizePhone(guestPhone);

  // A referrer booking their own stay — or a second participant's — turns the
  // payout into a discount on their own bill. Flag it; a human decides.
  const conflict = phone
    ? db.prepare('SELECT name, code FROM participants WHERE phone = ?').get(phone)
    : null;
  const flagged = conflict
    ? conflict.code === clean
      ? 'Guest phone matches the referrer'
      : `Guest phone matches participant ${conflict.name}`
    : null;

  db.prepare(
    `INSERT INTO bookings (code, guest_name, guest_phone, nights, checked_in_on, flagged, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    clean,
    String(guestName || '').trim().slice(0, 80),
    phone || String(guestPhone || '').slice(0, 20),
    Math.max(1, Math.trunc(Number(nights) || 1)),
    String(checkedInOn || new Date().toISOString().slice(0, 10)),
    flagged,
    new Date().toISOString()
  );
}

export const setPayoutStatus = (id, status) =>
  db.prepare('UPDATE bookings SET payout_status = ? WHERE id = ?').run(status, Number(id));

export const deleteBooking = (id) =>
  db.prepare('DELETE FROM bookings WHERE id = ?').run(Number(id));

// Many clicks on one code from a single network in minutes: the signature of
// someone refreshing their own link rather than of genuine reach.
export const burstFlags = () =>
  db
    .prepare(
      `SELECT code, subnet, COUNT(*) AS hits, MIN(ts) AS from_ts, MAX(ts) AS to_ts
       FROM clicks
       WHERE subnet IS NOT NULL AND is_bot = 0
       GROUP BY code, subnet, substr(ts, 1, 15)
       HAVING hits >= ?
       ORDER BY hits DESC
       LIMIT 20`
    )
    .all(BURST.maxPerSubnet);

export function dailyClicks(days = 7) {
  const out = [];
  for (let i = days - 1; i >= 0; i--) {
    const day = new Date();
    day.setDate(day.getDate() - i);
    const key = day.toISOString().slice(0, 10);
    const row = db
      .prepare(`SELECT COUNT(*) AS n FROM clicks WHERE substr(ts, 1, 10) = ? AND ${COUNTED}`)
      .get(key);
    out.push({ date: key, count: row.n });
  }
  return out;
}

export const orphanClicks = () =>
  db
    .prepare(
      `SELECT code, COUNT(*) AS count FROM clicks
       WHERE code NOT IN (SELECT code FROM participants)
       GROUP BY code ORDER BY count DESC LIMIT 20`
    )
    .all();

export const alreadyReminded = (participantId, sendDate, kind = 'daily') =>
  Boolean(
    db
      .prepare('SELECT 1 FROM reminders WHERE participant_id = ? AND send_date = ? AND kind = ?')
      .get(participantId, sendDate, kind)
  );

export const markReminded = (participantId, sendDate, kind = 'daily') =>
  db
    .prepare(
      `INSERT OR IGNORE INTO reminders (participant_id, send_date, kind, sent_at)
       VALUES (?, ?, ?, ?)`
    )
    .run(participantId, sendDate, kind, new Date().toISOString());
