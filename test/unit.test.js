import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizePhone, formatPhone } from '../src/phone.js';
import { freeStretches, nightsBetween, day } from '../src/availability.js';
import { ROLES, can, money } from '../src/permissions.js';
import { hashPassword, verifyPassword } from '../src/auth.js';
import { looksAutomated, visitorHash, subnetHash } from '../src/fraud.js';

/* ── Phone normalisation ───────────────────────────────────────────────── */

test('every Nigerian format collapses to one canonical number', () => {
  const same = [
    '08026883536',
    '+2348026883536',
    '2348026883536',
    '0802 688 3536',
    '+234 (802) 688-3536',
    '002348026883536'
  ].map(normalizePhone);

  assert.equal(new Set(same).size, 1, 'all forms must produce one value');
  assert.equal(same[0], '2348026883536');
});

test('signup dedupe survives a guest using a different format', () => {
  // The whole point: the same person registering twice must collide.
  assert.equal(normalizePhone('08031234567'), normalizePhone('+2348031234567'));
});

test('rubbish and non-mobile numbers are rejected', () => {
  for (const bad of ['', null, '12345', '0701234567', '01234567890', 'abcdefghijk']) {
    assert.equal(normalizePhone(bad), null, `${bad} should not validate`);
  }
});

test('formatPhone is readable and survives a round trip', () => {
  assert.equal(formatPhone('2348026883536'), '+234 802 688 3536');
});

/* ── Availability arithmetic ───────────────────────────────────────────── */

const busy = [
  { checkIn: '2026-10-01', checkOut: '2026-10-03' },
  { checkIn: '2026-10-05', checkOut: '2026-10-07' }
];

test('a gap between two stays is reported, not swallowed', () => {
  // The reported bug: 2->6 Oct answered "unavailable" when 3->5 was free.
  const gaps = freeStretches('2026-10-02', '2026-10-06', busy);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].from.toISOString().slice(0, 10), '2026-10-03');
  assert.equal(gaps[0].to.toISOString().slice(0, 10), '2026-10-05');
  assert.equal(gaps[0].nights, 2);
});

test('a fully booked window reports nothing free', () => {
  assert.deepEqual(freeStretches('2026-10-01', '2026-10-03', busy), []);
});

test('a window spanning both stays finds all three gaps', () => {
  const gaps = freeStretches('2026-09-29', '2026-10-09', busy);
  assert.equal(gaps.length, 3);
  assert.deepEqual(gaps.map((g) => g.nights), [2, 2, 2]);
});

test('an empty room is free for the whole window', () => {
  const gaps = freeStretches('2026-11-01', '2026-11-05', []);
  assert.equal(gaps.length, 1);
  assert.equal(gaps[0].nights, 4);
});

test('nights are counted by night, not by calendar date touched', () => {
  assert.equal(nightsBetween('2026-10-01', '2026-10-02'), 1);
  assert.equal(nightsBetween('2026-10-01', '2026-10-08'), 7);
});

test('day() normalises to UTC midnight so times never shift a booking', () => {
  const a = day('2026-10-01');
  const b = day('2026-10-01T23:30:00Z');
  assert.equal(a.getTime(), b.getTime());
});

/* ── Roles ─────────────────────────────────────────────────────────────── */

test('owner can do everything, viewer can change nothing', () => {
  const owner = { role: 'owner' };
  const viewer = { role: 'viewer' };
  for (const action of ROLES.owner.can) assert.ok(can(owner, action), action);
  for (const action of ['bookings.create', 'payments.record', 'payments.refund', 'users.manage']) {
    assert.equal(can(viewer, action), false, `viewer must not ${action}`);
  }
});

test('front desk takes bookings but never sees money', () => {
  const desk = { role: 'frontdesk' };
  assert.ok(can(desk, 'bookings.create'));
  assert.ok(can(desk, 'records.upload'));
  assert.equal(can(desk, 'money.view'), false);
  assert.equal(can(desk, 'payments.refund'), false);
  assert.equal(can(desk, 'records.sensitive'), false);
  assert.equal(can(desk, 'reports.view'), false);
});

test('manager runs the place but cannot refund, delete or add staff', () => {
  const manager = { role: 'manager' };
  assert.ok(can(manager, 'payments.record'));
  assert.ok(can(manager, 'money.view'));
  assert.ok(can(manager, 'records.sensitive'));
  assert.equal(can(manager, 'payments.refund'), false);
  assert.equal(can(manager, 'bookings.delete'), false);
  assert.equal(can(manager, 'users.manage'), false);
  assert.equal(can(manager, 'settings.manage'), false);
});

test('amounts are masked rather than blanked', () => {
  assert.equal(money({ role: 'manager' }, '₦90,000'), '₦90,000');
  assert.equal(money({ role: 'frontdesk' }, '₦90,000'), '—');
  assert.equal(money(null, '₦90,000'), '—');
});

test('an unknown or absent role gets nothing', () => {
  assert.equal(can({ role: 'nonsense' }, 'bookings.view'), false);
  assert.equal(can(undefined, 'bookings.view'), false);
});

/* ── Passwords ─────────────────────────────────────────────────────────── */

test('a password verifies against its own hash and nothing else', async () => {
  const hash = await hashPassword('correct horse battery');
  assert.ok(hash.startsWith('scrypt:'));
  assert.ok(await verifyPassword('correct horse battery', hash));
  assert.equal(await verifyPassword('wrong horse battery', hash), false);
});

test('the same password hashes differently every time', async () => {
  const [a, b] = await Promise.all([hashPassword('same'), hashPassword('same')]);
  assert.notEqual(a, b, 'salt must differ');
});

test('malformed or empty stored hashes never verify', async () => {
  for (const stored of ['', null, 'plaintext', 'bcrypt:xyz']) {
    assert.equal(await verifyPassword('anything', stored), false);
  }
});

/* ── Click hygiene ─────────────────────────────────────────────────────── */

test('bots and link previewers are recognised, real browsers are not', () => {
  assert.equal(looksAutomated('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0) AppleWebKit/605.1.15'), false);
  for (const ua of ['curl/8.4.0', 'Googlebot/2.1', 'WhatsApp/2.23', 'python-requests/2.31', '']) {
    assert.ok(looksAutomated(ua), `${ua || '(empty)'} should be treated as automated`);
  }
});

test('visitor fingerprints are stable per device and differ across devices', () => {
  const a = visitorHash('1.2.3.4', 'Safari');
  assert.equal(a, visitorHash('1.2.3.4', 'Safari'));
  assert.notEqual(a, visitorHash('1.2.3.5', 'Safari'));
  assert.notEqual(a, visitorHash('1.2.3.4', 'Chrome'));
  assert.ok(!a.includes('1.2.3.4'), 'the raw address must never be stored');
});

test('one subnet groups together so a burst is visible', () => {
  assert.equal(subnetHash('41.58.100.7'), subnetHash('41.58.100.200'));
  assert.notEqual(subnetHash('41.58.100.7'), subnetHash('41.58.101.7'));
});
