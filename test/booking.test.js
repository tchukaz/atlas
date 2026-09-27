import test, { before, after, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import mongoose from 'mongoose';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

import { Booking, Participant, Property, Room, Attachment } from '../src/models.js';
import {
  BookingConflict,
  availabilityDetail,
  extensionLimit,
  relocationOptions,
  reserve,
  tierConflict
} from '../src/availability.js';
import { standings } from '../src/store.js';
import { purgeExpiredSensitive } from '../src/settings.js';
import { Setting } from '../src/models.js';

let replset;
let rooms = {};

// A replica set rather than a bare mongod: overlap checks run in a transaction,
// and a standalone server silently cannot, which would hide the very race these
// tests exist to catch.
before(async () => {
  replset = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  await mongoose.connect(replset.getUri('atlastest'));
}, { timeout: 120_000 });

after(async () => {
  await mongoose.disconnect();
  await replset?.stop();
});

beforeEach(async () => {
  await Promise.all(
    [Booking, Participant, Property, Room, Attachment, Setting].map((m) => m.deleteMany({}))
  );

  const a = await Property.create({ name: 'Apartment A', bedrooms: 2, splittable: true, amenities: ['snooker'] });
  const b = await Property.create({ name: 'Apartment B', bedrooms: 2, splittable: false });
  const c = await Property.create({ name: 'Apartment C', bedrooms: 1, splittable: false });

  const made = await Room.insertMany([
    { property: a._id, name: 'Bedroom 1' },
    { property: a._id, name: 'Bedroom 2' },
    { property: b._id, name: 'Bedroom 1' },
    { property: b._id, name: 'Bedroom 2' },
    { property: c._id, name: 'Bedroom' }
  ]);
  rooms = { a1: made[0], a2: made[1], b1: made[2], b2: made[3], c1: made[4] };
});

const book = (fields) =>
  reserve({
    roomIds: fields.rooms,
    checkIn: fields.checkIn,
    checkOut: fields.checkOut,
    build: (session) =>
      Booking.create(
        [
          {
            reference: `AH-${Math.random().toString(16).slice(2, 8).toUpperCase()}`,
            guestName: fields.guestName,
            guestPhone: fields.guestPhone,
            rooms: fields.rooms,
            tier: fields.tier || 'standard',
            checkIn: fields.checkIn,
            checkOut: fields.checkOut,
            status: fields.status || 'confirmed',
            referralCode: fields.referralCode,
            requestedAmenities: fields.requestedAmenities || []
          }
        ],
        session ? { session } : {}
      ).then(([doc]) => doc)
  });

/* ── Double booking ────────────────────────────────────────────────────── */

test('the same bedroom cannot be sold twice over the same nights', async () => {
  await book({ guestName: 'First', rooms: [rooms.a1._id], checkIn: '2026-10-01', checkOut: '2026-10-05' });
  await assert.rejects(
    () => book({ guestName: 'Second', rooms: [rooms.a1._id], checkIn: '2026-10-03', checkOut: '2026-10-07' }),
    BookingConflict
  );
  assert.equal(await Booking.countDocuments(), 1);
});

test('same-day turnover is allowed', async () => {
  // One guest leaves in the morning, the next arrives that afternoon. Using
  // >= here instead of > would reject a perfectly good back-to-back booking.
  await book({ guestName: 'Out', rooms: [rooms.a1._id], checkIn: '2026-10-01', checkOut: '2026-10-03' });
  await book({ guestName: 'In', rooms: [rooms.a1._id], checkIn: '2026-10-03', checkOut: '2026-10-05' });
  assert.equal(await Booking.countDocuments(), 2);
});

test('a cancelled booking releases its nights', async () => {
  const first = await book({ guestName: 'Gone', rooms: [rooms.a1._id], checkIn: '2026-10-01', checkOut: '2026-10-05' });
  first.status = 'cancelled';
  await first.save();
  await book({ guestName: 'Replacement', rooms: [rooms.a1._id], checkIn: '2026-10-01', checkOut: '2026-10-05' });
  assert.equal(await Booking.countDocuments({ status: 'confirmed' }), 1);
});

test('an enquiry holds nothing', async () => {
  await book({ guestName: 'Maybe', rooms: [rooms.a1._id], checkIn: '2026-10-01', checkOut: '2026-10-05', status: 'enquiry' });
  await book({ guestName: 'Actual', rooms: [rooms.a1._id], checkIn: '2026-10-01', checkOut: '2026-10-05' });
  assert.equal(await Booking.countDocuments(), 2);
});

/* ── Nested inventory ──────────────────────────────────────────────────── */

test('selling one bedroom leaves the other free and the apartment unsellable', async () => {
  await book({ guestName: 'Room only', rooms: [rooms.a1._id], checkIn: '2026-10-12', checkOut: '2026-10-15' });

  const { properties } = await availabilityDetail('2026-10-12', '2026-10-15');
  const a = properties.find((p) => p.name === 'Apartment A');

  assert.equal(a.wholeAvailable, false, 'the whole apartment must be off the board');
  assert.equal(a.freeRooms.length, 1, 'the other bedroom is still sellable');
  assert.equal(a.freeRooms[0].name, 'Bedroom 2');
});

test('a whole-apartment booking cannot be taken when one bedroom is gone', async () => {
  await book({ guestName: 'Room only', rooms: [rooms.a1._id], checkIn: '2026-10-12', checkOut: '2026-10-15' });
  await assert.rejects(
    () => book({ guestName: 'Whole', rooms: [rooms.a1._id, rooms.a2._id], checkIn: '2026-10-13', checkOut: '2026-10-14' }),
    BookingConflict
  );
});

test('a non-splittable apartment never offers individual bedrooms', async () => {
  const { properties } = await availabilityDetail('2026-10-12', '2026-10-15');
  const b = properties.find((p) => p.name === 'Apartment B');
  assert.equal(b.wholeAvailable, true);
  assert.deepEqual(b.roomsAvailable, [], 'whole-only means no room-level offers');
});

test('partial availability is surfaced with the dates that are free', async () => {
  await book({ guestName: 'Early', rooms: [rooms.c1._id], checkIn: '2026-10-01', checkOut: '2026-10-03' });
  await book({ guestName: 'Later', rooms: [rooms.c1._id], checkIn: '2026-10-05', checkOut: '2026-10-07' });

  const { properties, wanted } = await availabilityDetail('2026-10-02', '2026-10-06');
  const c = properties.find((p) => p.name === 'Apartment C');

  assert.equal(wanted, 4);
  assert.equal(c.partialRooms.length, 1);
  assert.equal(c.partialRooms[0].longest.nights, 2);
});

/* ── Tier ──────────────────────────────────────────────────────────────── */

test('mixing tiers in one apartment is flagged, because power is per apartment', async () => {
  await book({ guestName: 'Premium guest', rooms: [rooms.a1._id], tier: 'premium', checkIn: '2026-10-12', checkOut: '2026-10-15' });

  const warning = await tierConflict({
    roomIds: [rooms.a2._id],
    checkIn: '2026-10-13',
    checkOut: '2026-10-15',
    tier: 'standard'
  });

  assert.ok(warning, 'a mismatch must be reported');
  assert.match(warning, /Premium guest/);
  assert.match(warning, /whole apartment/i);
});

test('matching tiers raise nothing', async () => {
  await book({ guestName: 'A', rooms: [rooms.a1._id], tier: 'premium', checkIn: '2026-10-12', checkOut: '2026-10-15' });
  const warning = await tierConflict({
    roomIds: [rooms.a2._id],
    checkIn: '2026-10-13',
    checkOut: '2026-10-15',
    tier: 'premium'
  });
  assert.equal(warning, null);
});

/* ── Extending and relocating ──────────────────────────────────────────── */

test('an extension knows how far it can run before the next arrival', async () => {
  const stay = await book({ guestName: 'Staying on', rooms: [rooms.a1._id], checkIn: '2026-11-05', checkOut: '2026-11-06' });
  await book({ guestName: 'Next', rooms: [rooms.a1._id], checkIn: '2026-11-08', checkOut: '2026-11-10' });

  const limit = await extensionLimit(stay);
  assert.equal(limit.until.toISOString().slice(0, 10), '2026-11-08');
  assert.equal(limit.blockedBy, 'Next');
});

test('a blocker who has not arrived can be offered another room', async () => {
  const stay = await book({ guestName: 'Mr B', rooms: [rooms.a1._id], checkIn: '2026-11-05', checkOut: '2026-11-06' });
  await book({ guestName: 'Mr Q', rooms: [rooms.a1._id], checkIn: '2026-11-08', checkOut: '2026-11-10' });

  const { movable, blocked } = await relocationOptions({ booking: stay, from: '2026-11-06', to: '2026-11-09' });
  assert.equal(blocked.length, 0);
  assert.equal(movable.length, 1);
  assert.equal(movable[0].blocker.guestName, 'Mr Q');
  assert.ok(movable[0].candidates.length > 0);
});

test('a guest who has checked in is never offered for moving', async () => {
  const stay = await book({ guestName: 'Mr B', rooms: [rooms.a1._id], checkIn: '2026-11-05', checkOut: '2026-11-06' });
  await book({ guestName: 'Arrived', rooms: [rooms.a1._id], checkIn: '2026-11-08', checkOut: '2026-11-10', status: 'checked_in' });

  const { movable, blocked } = await relocationOptions({ booking: stay, from: '2026-11-06', to: '2026-11-09' });
  assert.equal(movable.length, 0);
  assert.match(blocked[0].why, /already checked in/);
});

test('a guest who booked for an amenity keeps it', async () => {
  const stay = await book({ guestName: 'Mr B', rooms: [rooms.a1._id], checkIn: '2026-11-05', checkOut: '2026-11-06' });
  await book({
    guestName: 'Snooker fan',
    rooms: [rooms.a1._id],
    checkIn: '2026-11-08',
    checkOut: '2026-11-10',
    requestedAmenities: ['snooker']
  });

  const { movable } = await relocationOptions({ booking: stay, from: '2026-11-06', to: '2026-11-09' });
  const offered = movable[0].candidates.flatMap((c) => c.rooms.map((r) => String(r.property)));
  const snookerProperty = String(rooms.a1.property);
  assert.ok(offered.length > 0, 'there should still be somewhere to put them');
  assert.ok(
    offered.every((id) => id === snookerProperty),
    'only the apartment with the snooker table may be offered'
  );
});

/* ── Referral credit ───────────────────────────────────────────────────── */

test('referral credit waits until the guest has actually checked in', async () => {
  await Participant.create({
    name: 'Ada Obi',
    email: 'ada@example.com',
    phone: '2348031234567',
    code: 'adaobi',
    token: 'tok-ada'
  });

  const stay = await book({
    guestName: 'Referred',
    rooms: [rooms.c1._id],
    checkIn: '2026-10-20',
    checkOut: '2026-10-23',
    referralCode: 'adaobi'
  });

  let [ada] = await standings();
  assert.equal(ada.bookings, 0, 'a confirmed booking is not yet earned');

  stay.status = 'checked_in';
  await stay.save();

  [ada] = await standings();
  assert.equal(ada.bookings, 1);
  assert.equal(ada.nights, 3);
});

/* ── Retention ─────────────────────────────────────────────────────────── */

test('retention leaves everything alone until a period is chosen', async () => {
  await Attachment.create({
    kind: 'image',
    filename: 'a'.repeat(24) + '.jpg',
    sensitive: true,
    uploadedAt: new Date('2020-01-01')
  });
  const result = await purgeExpiredSensitive();
  assert.ok(result.skipped);
  assert.equal(await Attachment.countDocuments(), 1);
});

test('retention removes expired identity documents and nothing else', async () => {
  const old = new Date(Date.now() - 200 * 86_400_000);
  await Attachment.create([
    { kind: 'image', filename: 'a'.repeat(24) + '.jpg', sensitive: true, uploadedAt: old },
    { kind: 'image', filename: 'b'.repeat(24) + '.jpg', sensitive: false, uploadedAt: old },
    { kind: 'image', filename: 'c'.repeat(24) + '.jpg', sensitive: true, uploadedAt: new Date() }
  ]);
  await Setting.create({ key: 'sensitiveRetentionDays', value: 90 });

  const result = await purgeExpiredSensitive();
  assert.equal(result.deleted, 1, 'only the old sensitive one goes');

  const left = await Attachment.find().lean();
  assert.equal(left.length, 2);
  assert.ok(left.some((a) => !a.sensitive), 'an ordinary photo must survive');
});
