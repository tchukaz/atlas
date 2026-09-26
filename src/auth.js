import crypto from 'node:crypto';
import { ADMIN_PASSWORD } from './config.js';

const SESSIONS = new Set();
export const COOKIE = 'atlas_admin';

export function readCookie(req, name) {
  const header = req.headers.cookie || '';
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return null;
}

export function passwordMatches(supplied) {
  if (!ADMIN_PASSWORD) return false;
  const a = Buffer.from(String(supplied || ''));
  const b = Buffer.from(ADMIN_PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

export function openSession(res, secure) {
  const token = crypto.randomBytes(24).toString('hex');
  SESSIONS.add(token);
  res.cookie(COOKIE, token, {
    httpOnly: true,
    sameSite: 'strict',
    secure,
    maxAge: 12 * 60 * 60 * 1000
  });
}

export function closeSession(req, res) {
  const token = readCookie(req, COOKIE);
  if (token) SESSIONS.delete(token);
  res.clearCookie(COOKIE);
}

export function requireAdmin(req, res, next) {
  const token = readCookie(req, COOKIE);
  if (token && SESSIONS.has(token)) return next();
  return res.redirect(302, '/admin/login');
}
