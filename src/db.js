import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';

const DATA_DIR = process.env.DATA_DIR || path.join(process.cwd(), 'data');
fs.mkdirSync(DATA_DIR, { recursive: true });

export const db = new Database(path.join(DATA_DIR, 'atlas.db'));

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS participants (
    id            INTEGER PRIMARY KEY,
    name          TEXT NOT NULL,
    email         TEXT NOT NULL,
    phone         TEXT NOT NULL,
    phone_raw     TEXT NOT NULL,
    code          TEXT NOT NULL UNIQUE,
    token         TEXT NOT NULL UNIQUE,
    enquiries     INTEGER NOT NULL DEFAULT 0,
    status        TEXT NOT NULL DEFAULT 'active',
    consent_at    TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS participants_phone ON participants(phone);
  CREATE UNIQUE INDEX IF NOT EXISTS participants_email ON participants(email);

  CREATE TABLE IF NOT EXISTS clicks (
    id        INTEGER PRIMARY KEY,
    code      TEXT NOT NULL,
    ts        TEXT NOT NULL,
    visitor   TEXT NOT NULL,
    subnet    TEXT,
    referer   TEXT,
    is_bot    INTEGER NOT NULL DEFAULT 0,
    is_self   INTEGER NOT NULL DEFAULT 0
  );

  CREATE INDEX IF NOT EXISTS clicks_code ON clicks(code);
  CREATE INDEX IF NOT EXISTS clicks_ts ON clicks(ts);

  CREATE TABLE IF NOT EXISTS bookings (
    id            INTEGER PRIMARY KEY,
    code          TEXT NOT NULL,
    guest_name    TEXT NOT NULL,
    guest_phone   TEXT,
    nights        INTEGER NOT NULL DEFAULT 1,
    checked_in_on TEXT NOT NULL,
    payout_status TEXT NOT NULL DEFAULT 'pending',
    flagged       TEXT,
    created_at    TEXT NOT NULL
  );

  CREATE INDEX IF NOT EXISTS bookings_code ON bookings(code);

  CREATE TABLE IF NOT EXISTS reminders (
    id             INTEGER PRIMARY KEY,
    participant_id INTEGER NOT NULL REFERENCES participants(id) ON DELETE CASCADE,
    send_date      TEXT NOT NULL,
    kind           TEXT NOT NULL DEFAULT 'daily',
    sent_at        TEXT NOT NULL
  );

  CREATE UNIQUE INDEX IF NOT EXISTS reminders_once
    ON reminders(participant_id, send_date, kind);
`);
