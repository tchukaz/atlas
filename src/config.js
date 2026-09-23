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
  // Signup opens before the race starts, otherwise the first days are spent
  // recruiting rather than referring.
  signupOpens: process.env.SIGNUP_OPENS || '',
  startDate: process.env.CHALLENGE_START || '',
  endDate: process.env.CHALLENGE_END || '',
  perBookingNaira: Number(process.env.REWARD_PER_BOOKING) || 5000,
  grandPrize: process.env.GRAND_PRIZE || 'one free night at Atlas House'
};

export const EMAIL = {
  apiKey: process.env.RESEND_API_KEY || '',
  from: process.env.EMAIL_FROM || 'Atlas House <noreply@atlashouseng.com>',
  replyTo: process.env.EMAIL_REPLY_TO || '',
  // Africa/Lagos is UTC+1 year-round, so a plain hour offset is safe here.
  sendHourLagos: Number(process.env.REMINDER_HOUR) || 9
};

export const REF_MESSAGE = (code) => `Hi Atlas House! (ref: ${code.toUpperCase()})`;

export const waLink = (code) =>
  `https://wa.me/${WHATSAPP_NUMBER}?text=${encodeURIComponent(REF_MESSAGE(code))}`;

export const trackingLink = (code) => `${SITE_URL}/go/${code}`;

export const dashboardLink = (token) => `${SITE_URL}/me/${token}`;

export const naira = (amount) => `₦${Number(amount || 0).toLocaleString('en-NG')}`;

export function daysLeft() {
  if (!CHALLENGE.endDate) return null;
  const end = new Date(`${CHALLENGE.endDate}T23:59:59+01:00`);
  return Math.max(0, Math.ceil((end - Date.now()) / 86_400_000));
}

export const challengeOver = () => daysLeft() === 0;
