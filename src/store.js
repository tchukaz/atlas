import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { IP_SALT } from './config.js';

const DATA_DIR = path.join(process.cwd(), 'data');
const PARTICIPANTS_FILE = path.join(DATA_DIR, 'participants.json');
const LEDGER_FILE = path.join(DATA_DIR, 'ledger.json');
const CLICKS_FILE = path.join(DATA_DIR, 'clicks.jsonl');

fs.mkdirSync(DATA_DIR, { recursive: true });

function readJson(file, fallback) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return fallback;
  }
}

function writeJson(file, value) {
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

let participants = readJson(PARTICIPANTS_FILE, []);
let ledger = readJson(LEDGER_FILE, {});

const clicks = fs.existsSync(CLICKS_FILE)
  ? fs
      .readFileSync(CLICKS_FILE, 'utf8')
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        try {
          return JSON.parse(line);
        } catch {
          return null;
        }
      })
      .filter(Boolean)
  : [];

const clickLog = fs.createWriteStream(CLICKS_FILE, { flags: 'a' });

export const normalizeCode = (raw) =>
  String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9]/g, '')
    .slice(0, 24);

export const listParticipants = () => participants.slice();

export const findParticipant = (code) =>
  participants.find((p) => p.code === normalizeCode(code)) || null;

export function addParticipant(name, code) {
  const cleanName = String(name || '').trim().slice(0, 60);
  const cleanCode = normalizeCode(code || cleanName.split(/\s+/)[0]);
  if (!cleanName) throw new Error('Name is required.');
  if (!cleanCode) throw new Error('Code must contain at least one letter or number.');
  if (findParticipant(cleanCode)) throw new Error(`Code "${cleanCode}" is already taken.`);

  participants.push({ name: cleanName, code: cleanCode, addedAt: new Date().toISOString() });
  participants.sort((a, b) => a.name.localeCompare(b.name));
  writeJson(PARTICIPANTS_FILE, participants);
  return cleanCode;
}

export function removeParticipant(code) {
  const clean = normalizeCode(code);
  participants = participants.filter((p) => p.code !== clean);
  writeJson(PARTICIPANTS_FILE, participants);
}

// Collapses repeat clicks from one device so the reach number means something.
export const visitorId = (ip, userAgent) =>
  crypto
    .createHash('sha256')
    .update(`${IP_SALT}|${ip || ''}|${userAgent || ''}`)
    .digest('hex')
    .slice(0, 16);

export function recordClick({ code, ip, userAgent, referer }) {
  const entry = {
    ts: new Date().toISOString(),
    code: normalizeCode(code),
    vid: visitorId(ip, userAgent),
    ref: String(referer || '').slice(0, 200)
  };
  clicks.push(entry);
  clickLog.write(`${JSON.stringify(entry)}\n`);
  return entry;
}

export function setLedger(code, fields) {
  const clean = normalizeCode(code);
  const current = ledger[clean] || { enquiries: 0, bookings: 0, nights: 0 };
  ledger[clean] = {
    enquiries: Math.max(0, Math.trunc(Number(fields.enquiries ?? current.enquiries)) || 0),
    bookings: Math.max(0, Math.trunc(Number(fields.bookings ?? current.bookings)) || 0),
    nights: Math.max(0, Math.trunc(Number(fields.nights ?? current.nights)) || 0)
  };
  writeJson(LEDGER_FILE, ledger);
  return ledger[clean];
}

export function standings() {
  const byCode = new Map();
  for (const p of participants) {
    byCode.set(p.code, {
      ...p,
      clicks: 0,
      uniqueClicks: 0,
      lastClickAt: null,
      enquiries: ledger[p.code]?.enquiries ?? 0,
      bookings: ledger[p.code]?.bookings ?? 0,
      nights: ledger[p.code]?.nights ?? 0,
      _seen: new Set()
    });
  }

  for (const click of clicks) {
    const row = byCode.get(click.code);
    if (!row) continue;
    row.clicks += 1;
    if (!row._seen.has(click.vid)) {
      row._seen.add(click.vid);
      row.uniqueClicks += 1;
    }
    if (!row.lastClickAt || click.ts > row.lastClickAt) row.lastClickAt = click.ts;
  }

  return [...byCode.values()]
    .map(({ _seen, ...row }) => row)
    .sort(
      (a, b) =>
        b.bookings - a.bookings ||
        b.uniqueClicks - a.uniqueClicks ||
        b.clicks - a.clicks ||
        a.name.localeCompare(b.name)
    );
}

export function totals() {
  const rows = standings();
  return {
    participants: rows.length,
    clicks: rows.reduce((n, r) => n + r.clicks, 0),
    uniqueClicks: rows.reduce((n, r) => n + r.uniqueClicks, 0),
    enquiries: rows.reduce((n, r) => n + r.enquiries, 0),
    bookings: rows.reduce((n, r) => n + r.bookings, 0),
    nights: rows.reduce((n, r) => n + r.nights, 0)
  };
}

// Clicks on codes that are not (or no longer) on the roster — usually a typo'd
// or retired link, worth seeing rather than silently dropping.
export function orphanClicks() {
  const known = new Set(participants.map((p) => p.code));
  const counts = new Map();
  for (const click of clicks) {
    if (known.has(click.code)) continue;
    counts.set(click.code, (counts.get(click.code) || 0) + 1);
  }
  return [...counts.entries()].map(([code, count]) => ({ code, count }));
}

export function dailyClicks(days = 7) {
  const out = [];
  const today = new Date();
  for (let i = days - 1; i >= 0; i--) {
    const d = new Date(today);
    d.setDate(d.getDate() - i);
    const key = d.toISOString().slice(0, 10);
    out.push({ date: key, count: clicks.filter((c) => c.ts.startsWith(key)).length });
  }
  return out;
}
