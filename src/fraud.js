import crypto from 'node:crypto';
import { IP_SALT } from './config.js';

const BOT_UA = /bot|crawler|spider|crawling|headless|phantom|puppeteer|playwright|curl|wget|python-requests|axios|postman|facebookexternalhit|whatsapp|slackbot|telegrambot|preview/i;

export const looksAutomated = (userAgent) => !userAgent || BOT_UA.test(userAgent);

export const visitorHash = (ip, userAgent) =>
  crypto
    .createHash('sha256')
    .update(`${IP_SALT}|${ip || ''}|${userAgent || ''}`)
    .digest('hex')
    .slice(0, 16);

// Hashed /24 (or /64) so a burst from one network is visible without keeping addresses.
export function subnetHash(ip) {
  if (!ip) return null;
  const address = String(ip).replace(/^::ffff:/, '');
  const group = address.includes(':')
    ? address.split(':').slice(0, 4).join(':')
    : address.split('.').slice(0, 3).join('.');
  return crypto.createHash('sha256').update(`${IP_SALT}|net|${group}`).digest('hex').slice(0, 16);
}

export const BURST = { windowMinutes: 10, maxPerSubnet: 25 };
