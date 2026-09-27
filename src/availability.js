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

const addDays = (d, n) => new Date(day(d).getTime() + n * 86_400_000);

/**
 * The stretches of a window a room is actually free, rather than a yes/no.
 *
 * A room booked 1–3 and 5–7 is free 3–5, but an enquiry for 2–6 reads as simply
 * "unavailable" unless the gaps are worked out and shown. Losing that booking
 * for want of a counter-offer is the expensive kind of mistake.
 */
export function freeStretches(windowStart, windowEnd, busyIntervals) {
  const start = day(windowStart);
  const end = day(windowEnd);
  const clipped = busyIntervals
    .map((b) => ({ from: day(b.checkIn), to: day(b.checkOut) }))
    .filter((b) => b.from < end && b.to > start)
    .sort((a, b) => a.from - b.from);

  const gaps = [];
  let cursor = start;
  for (const busy of clipped) {
    if (busy.from > cursor) gaps.push({ from: cursor, to: busy.from });
    if (busy.to > cursor) cursor = busy.to;
  }
  if (cursor < end) gaps.push({ from: cursor, to: end });

  return gaps
    .map((g) => ({ ...g, nights: nightsBetween(g.from, g.to) }))
    .filter((g) => g.nights > 0);
}

/**
 * Per-room detail for a window: whether it covers the whole stay, and if not,
 * what it could still take. Used to counter-offer instead of saying no.
 */
export async function availabilityDetail(checkIn, checkOut, { excludeId } = {}) {
  const [properties, rooms, clashes] = await Promise.all([
    Property.find({ active: true }).sort('name').lean(),
    Room.find({ active: true }).lean(),
    Booking.find(overlapQuery(checkIn, checkOut, excludeId), {
      rooms: 1,
      checkIn: 1,
      checkOut: 1,
      guestName: 1,
      tier: 1
    }).lean()
  ]);

  const wanted = nightsBetween(checkIn, checkOut);
  const busyByRoom = new Map();
  for (const booking of clashes) {
    for (const roomId of booking.rooms) {
      const key = String(roomId);
      if (!busyByRoom.has(key)) busyByRoom.set(key, []);
      busyByRoom.get(key).push(booking);
    }
  }

  const byProperty = new Map(properties.map((p) => [String(p._id), { ...p, rooms: [] }]));
  for (const room of rooms) {
    const entry = byProperty.get(String(room.property));
    if (!entry) continue;
    const busy = busyByRoom.get(String(room._id)) || [];
    const stretches = freeStretches(checkIn, checkOut, busy);
    const longest = stretches.reduce((best, s) => (!best || s.nights > best.nights ? s : best), null);
    entry.rooms.push({
      ...room,
      busy,
      stretches,
      longest,
      free: busy.length === 0,
      partial: busy.length > 0 && stretches.length > 0
    });
  }

  return {
    wanted,
    properties: [...byProperty.values()].map((property) => {
      const free = property.rooms.filter((r) => r.free);
      return {
        ...property,
        wholeAvailable: property.rooms.length > 0 && free.length === property.rooms.length,
        freeRooms: free,
        roomsAvailable: property.splittable ? free : [],
        partialRooms: property.rooms.filter((r) => r.partial)
      };
    })
  };
}

/**
 * A night-by-night strip per room. Gaps are far easier to read as a row of
 * cells than as a list of date ranges — which is how they get missed.
 */
export async function calendarStrip(from, nights = 30) {
  const start = day(from);
  const end = addDays(start, nights);

  const [rooms, bookings] = await Promise.all([
    Room.find({ active: true }).populate('property').lean(),
    Booking.find(overlapQuery(start, end), {
      rooms: 1,
      checkIn: 1,
      checkOut: 1,
      guestName: 1,
      tier: 1,
      status: 1
    }).lean()
  ]);

  const days = Array.from({ length: nights }, (_, i) => addDays(start, i));

  return {
    days,
    rows: rooms
      .filter((r) => r.property?.active)
      .map((room) => {
        const mine = bookings.filter((b) => b.rooms.some((id) => String(id) === String(room._id)));
        return {
          room,
          cells: days.map((d) => {
            const hit = mine.find((b) => day(b.checkIn) <= d && day(b.checkOut) > d);
            return { date: d, booking: hit || null };
          })
        };
      })
  };
}

export class BookingConflict extends Error {}

/**
 * When an extension is blocked, work out whether the booking in the way could
 * simply be housed elsewhere — turning a refusal into a booking.
 *
 * Only offers to move guests who have not arrived: relocating someone mid-stay
 * is a different and much worse thing to do. A guest who asked for a specific
 * amenity keeps it, since that is what they came for. The admin decides.
 */
export async function relocationOptions({ booking, from, to }) {
  const blockers = await Booking.find({
    _id: { $ne: booking._id },
    status: { $in: BLOCKING_STATUSES },
    rooms: { $in: booking.rooms },
    checkIn: { $lt: day(to) },
    checkOut: { $gt: day(from) }
  })
    .populate({ path: 'rooms', populate: { path: 'property' } })
    .lean();

  if (!blockers.length) return { blockers: [], movable: [], blocked: [] };

  const movable = [];
  const blocked = [];

  for (const blocker of blockers) {
    if (blocker.status !== 'confirmed') {
      blocked.push({ blocker, why: `${blocker.guestName} has already checked in.` });
      continue;
    }

    // Everything free for the whole of the blocker's own stay, excluding both
    // the rooms it currently holds and the ones being extended into.
    const busy = await busyRoomIds(blocker.checkIn, blocker.checkOut, { excludeId: blocker._id });
    const held = new Set(booking.rooms.map(String));
    const current = new Set(blocker.rooms.map((r) => String(r._id)));

    const [rooms, properties] = await Promise.all([
      Room.find({ active: true }).lean(),
      Property.find({ active: true }).lean()
    ]);
    const propertyById = new Map(properties.map((p) => [String(p._id), p]));

    const wanted = blocker.requestedAmenities || [];
    const free = rooms.filter((r) => {
      const id = String(r._id);
      if (busy.has(id) || held.has(id) || current.has(id)) return false;
      const property = propertyById.get(String(r.property));
      if (!property) return false;
      // A guest who booked for the snooker table does not get moved away from it.
      return wanted.every((a) => (property.amenities || []).includes(a));
    });

    const needed = blocker.rooms.length;
    const byProperty = new Map();
    for (const room of free) {
      const key = String(room.property);
      if (!byProperty.has(key)) byProperty.set(key, []);
      byProperty.get(key).push(room);
    }

    // A whole-apartment booking has to land in a whole apartment, not a spare
    // bedroom somewhere.
    const candidates = [];
    for (const [propertyId, group] of byProperty) {
      if (group.length < needed) continue;
      const property = propertyById.get(propertyId);
      candidates.push({
        property,
        rooms: group.slice(0, needed),
        label: `${property.name} · ${group.slice(0, needed).map((r) => r.name).join(' + ')}`
      });
    }

    if (candidates.length) movable.push({ blocker, candidates });
    else {
      blocked.push({
        blocker,
        why: wanted.length
          ? `Nothing else free for ${blocker.guestName}'s dates has ${wanted.join(', ')}.`
          : `Nothing else is free for ${blocker.guestName}'s dates.`
      });
    }
  }

  return { blockers, movable, blocked };
}

/**
 * How far a stay can run before it hits the next booking on the same rooms.
 * Returning the limit rather than a bare refusal lets ops offer the guest the
 * nights that do exist.
 */
export async function extensionLimit(booking) {
  const next = await Booking.find(
    {
      _id: { $ne: booking._id },
      status: { $in: BLOCKING_STATUSES },
      rooms: { $in: booking.rooms },
      checkIn: { $gte: day(booking.checkOut) }
    },
    { checkIn: 1, guestName: 1 }
  )
    .sort({ checkIn: 1 })
    .limit(1)
    .lean();

  return next.length ? { until: next[0].checkIn, blockedBy: next[0].guestName } : { until: null };
}

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
