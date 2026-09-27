import crypto from 'node:crypto';
import { promisify } from 'node:util';
import { ADMIN_PASSWORD } from './config.js';
import { Audit, Session, User } from './models.js';
import { can } from './permissions.js';

const scrypt = promisify(crypto.scrypt);

export const COOKIE = 'atlas_admin';
const SESSION_DAYS = 14;

/* ── Passwords ─────────────────────────────────────────────────────────── */

// scrypt is in Node itself, so this needs no native module on a machine that
// is already short of memory. Parameters are the Node defaults plus a cost
// that keeps verification around 100ms.
export async function hashPassword(plain) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derived = await scrypt(String(plain), salt, 64, { N: 16384, r: 8, p: 1 });
  return `scrypt:${salt}:${derived.toString('hex')}`;
}

export async function verifyPassword(plain, stored) {
  if (!stored?.startsWith('scrypt:')) return false;
  const [, salt, expected] = stored.split(':');
  const derived = await scrypt(String(plain), salt, 64, { N: 16384, r: 8, p: 1 });
  const a = Buffer.from(derived.toString('hex'));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* ── Cookies and sessions ──────────────────────────────────────────────── */

export function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export async function openSession(res, user, req) {
  const token = crypto.randomBytes(32).toString('hex');
  await Session.create({
    token,
    user: user._id,
    userAgent: String(req.get('user-agent') || '').slice(0, 200),
    expiresAt: new Date(Date.now() + SESSION_DAYS * 86_400_000)
  });
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } });
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: req.secure,
    maxAge: SESSION_DAYS * 86_400_000
  });
}

export async function closeSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) await Session.deleteOne({ token });
  res.clearCookie(COOKIE);
}

export const revokeAllFor = (userId) => Session.deleteMany({ user: userId });

/* ── Bootstrap ─────────────────────────────────────────────────────────── */

/**
 * Without this there is a chicken-and-egg problem: no account exists, and
 * creating one requires being signed in. The env password that already guards
 * the dashboard becomes the first Owner, so nothing locks anyone out mid-change.
 */
export async function ensureOwner() {
  if (await User.exists({ role: 'owner' })) return null;
  if (!ADMIN_PASSWORD) return null;

  const owner = await User.create({
    name: 'Owner',
    email: (process.env.OWNER_EMAIL || 'owner@atlashouseng.com').toLowerCase(),
    passwordHash: await hashPassword(ADMIN_PASSWORD),
    role: 'owner'
  });
  console.log(`Created the first owner account: ${owner.email} (password from ADMIN_PASSWORD).`);
  return owner;
}

/* ── Middleware ────────────────────────────────────────────────────────── */

export async function loadUser(req, _res, next) {
  const token = readCookie(req, COOKIE);
  if (!token) return next();
  const session = await Session.findOne({ token }).populate('user');
  if (session?.user?.active) {
    req.user = session.user;
    req.sessionToken = token;
  }
  next();
}

export function requireAuth(req, res, next) {
  if (req.user) return next();
  return res.redirect(302, `/admin/login?next=${encodeURIComponent(req.originalUrl)}`);
}

/** Route-level gate. Field-level masking uses `can` from permissions.js. */
export const requireCan = (action) => (req, res, next) => {
  if (!req.user) return res.redirect(302, '/admin/login');
  if (can(req.user, action)) return next();
  return res.status(403).type('html').send(
    `<div style="font-family:system-ui;background:#0A0A0A;color:#F5F0E8;padding:40px;min-height:100vh;">
       <h1 style="font-weight:400;">Not your job</h1>
       <p style="color:#8A8A8A;">Your account does not have access to this.
       Ask the owner if you think it should.</p>
       <p><a href="/ops/today" style="color:#C9A84C;">Back to Today</a></p>
     </div>`
  );
};

/* ── Audit ─────────────────────────────────────────────────────────────── */

export function record(req, action, target, detail) {
  return Audit.create({
    actorName: req.user?.name || 'unknown',
    actorEmail: req.user?.email || '',
    action,
    target: target ? String(target).slice(0, 120) : undefined,
    detail: detail ? String(detail).slice(0, 300) : undefined
  }).catch((err) => console.error('audit write failed:', err.message));
}
