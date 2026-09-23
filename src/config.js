import 'dotenv/config';
import crypto from 'node:crypto';

export const PORT = Number(process.env.PORT) || 3000;

export const SITE_URL = (process.env.SITE_URL || 'https://atlashouseng.com').replace(/\/$/, '');

export const WHATSAPP_NUMBER = process.env.WHATSAPP_NUMBER || '2348026883536';

export const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD || '';

// Rotating this invalidates every logged visitor fingerprint, which is the point:
// we never store raw IPs, only a salted hash used to collapse repeat clicks.
export const IP_SALT = process.env.IP_SALT || crypto.randomBytes(16).toString('hex');

export const CHALLENGE = {
  startDate: process.env.CHALLENGE_START || '',
  endDate: process.env.CHALLENGE_END || '',
  perBookingNaira: Number(process.env.REWARD_PER_BOOKING) || 10000
};

export const REF_MESSAGE = (code) =>
  `Hi Atlas House! (ref: ${code.toUpperCase()})`;

export const waLink = (code) =>
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(REF_MESSAGE(code))}`;

export const trackingLink = (code) => `${SITE_URL}/go/${code}`;
