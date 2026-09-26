import { withTransaction } from './db.js';
import { BLOCKING_STATUSES, Booking, Property, Room } from './models.js';

export const day = (value) => {
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
};

export const nightsBetween = (checkIn, checkOut) =>
  Math.round((day(checkOut) - day(checkIn)) / 86_400_000);

// Same-day turnover is legitimate: one guest leaves in the morning, the next
// arrives that afternoon. Hence strict inequalities — using >= and <= here
// would reject perfectly good back-to-back bookings.
const overlapQuery = (checkIn, checkOut, excludeId) => ({
  status: { $in: BLOCKING_STATUSES },
  checkIn: { $lt: day(checkOut) },
  checkOut: { $gt: day(checkIn) },
  ...(excludeId ? { _id: { $ne: excludeId } } : {})
});

export async function busyRoomIds(checkIn, checkOut, { excludeId, session } = {}) {
  const clashes = await Booking.find(overlapQuery(checkIn, checkOut, excludeId), { rooms: 1 })
    .session(session || null)
    .lean();
  return new Set(clashes.flatMap((b) => b.rooms.map(String)));
}

/**
 * What can actually be sold for a date range.
 *
 * A room is free when nothing overlapping holds it. An entire apartment is
 * sellable only when every one of its rooms is free — which is the whole reason
 * the bedroom, not the apartment, is the unit of inventory.
 */
export async function availability(checkIn, checkOut, { excludeId } = {}) {
  const [properties, rooms, busy] = await Promise.all([
    Property.find({ active: true }).sort('name').lean(),
    Room.find({ active: true }).lean(),
    busyRoomIds(checkIn, checkOut, { excludeId })
  ]);

  const byProperty = new Map(properties.map((p) => [String(p._id), { ...p, rooms: [] }]));
  for (const room of rooms) {
    const entry = byProperty.get(String(room.property));
    if (entry) entry.rooms.push({ ...room, free: !busy.has(String(room._id)) });
  }

  return [...byProperty.values()].map((property) => {
    const freeRooms = property.rooms.filter((r) => r.free);
    return {
      ...property,
      freeRooms,
      wholeAvailable: property.rooms.length > 0 && freeRooms.length === property.rooms.length,
      roomsAvailable: property.splittable ? freeRooms : []
    };
  });
}

/**
 * Backup power is wired per apartment, not per bedroom. If one bedroom sells as
 * Premium and another as Standard for the same nights, there is no way to run
 * the generator for one and not the other — so surface it and let a person
 * decide, rather than silently promising something the building cannot do.
 */
export async function tierConflict({ roomIds, checkIn, checkOut, tier, excludeId }) {
  const rooms = await Room.find({ _id: { $in: roomIds } }, { property: 1 }).lean();
  const propertyIds = [...new Set(rooms.map((r) => String(r.property)))];
  if (!propertyIds.length) return null;

  const siblings = await Room.find(
    { property: { $in: propertyIds }, _id: { $nin: roomIds } },
    { _id: 1 }
  ).lean();
  if (!siblings.length) return null;

  const siblingIds = siblings.map((r) => r._id);
  const clashes = await Booking.find(
    { ...overlapQuery(checkIn, checkOut, excludeId), rooms: { $in: siblingIds } },
    { tier: 1, guestName: 1 }
  ).lean();

  const different = clashes.find((b) => b.tier !== tier);
  if (!different) return null;

  return (
    `${different.guestName} already has the other bedroom on ${different.tier} for these nights. ` +
    `Backup power serves the whole apartment, so selling this one as ${tier} means running ` +
    `the higher tier for both.`
  );
}

export class BookingConflict extends Error {}

/**
 * Reserves rooms inside a transaction where the database supports one, so two
 * people entering bookings at the same moment cannot both pass the check.
 */
export async function reserve({ roomIds, checkIn, checkOut, excludeId, build }) {
  return withTransaction(async (session) => {
    const busy = await busyRoomIds(checkIn, checkOut, { excludeId, session });
    const taken = roomIds.filter((id) => busy.has(String(id)));

    if (taken.length) {
      const rooms = await Room.find({ _id: { $in: taken } }).populate('property').lean();
      const names = rooms.map((r) => `${r.property?.name || '?'} · ${r.name}`).join(', ');
      throw new BookingConflict(`Already booked for those dates: ${names}`);
    }

    return build(session);
  });
}
