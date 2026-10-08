import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/* ── Referral side ─────────────────────────────────────────────────────── */

const participantSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  phone: { type: String, required: true, unique: true },
  phoneRaw: String,
  code: { type: String, required: true, unique: true },
  token: { type: String, required: true, unique: true },
  enquiries: { type: Number, default: 0 },
  status: { type: String, enum: ['active', 'disqualified'], default: 'active' },
  consentAt: Date,
  createdAt: { type: Date, default: Date.now }
});

const clickSchema = new Schema({
  code: { type: String, required: true, index: true },
  ts: { type: Date, default: Date.now, index: true },
  visitor: { type: String, required: true },
  subnet: String,
  referer: String,
  isBot: { type: Boolean, default: false },
  isSelf: { type: Boolean, default: false }
});

const reminderSchema = new Schema({
  participant: { type: Schema.Types.ObjectId, ref: 'Participant', required: true },
  sendDate: { type: String, required: true },
  kind: { type: String, default: 'daily' },
  sentAt: { type: Date, default: Date.now }
});
reminderSchema.index({ participant: 1, sendDate: 1, kind: 1 }, { unique: true });

/* ── Inventory ─────────────────────────────────────────────────────────── */

const propertySchema = new Schema({
  name: { type: String, required: true },
  bedrooms: { type: Number, required: true, min: 1 },
  // Whether the bedrooms may be sold to separate parties. Off means the whole
  // apartment goes to one booking or not at all.
  splittable: { type: Boolean, default: false },
  // Structured rather than a free-text note, so occupancy can be compared
  // across units that have a thing and units that do not.
  amenities: [String],
  notes: String,
  active: { type: Boolean, default: true },
  createdAt: { type: Date, default: Date.now }
});

const roomSchema = new Schema({
  property: { type: Schema.Types.ObjectId, ref: 'Property', required: true, index: true },
  name: { type: String, required: true },
  active: { type: Boolean, default: true }
});

/* ── What gets sold ────────────────────────────────────────────────────── */

export const SHAPES = {
  entire: 'Entire apartment',
  room: 'Private room in a shared apartment'
};

export const TIERS = {
  standard: 'Standard — inverter backup, no AC during an outage',
  premium: 'Premium — generator backup, AC runs through an outage'
};

const productSchema = new Schema({
  name: { type: String, required: true },
  shape: { type: String, enum: Object.keys(SHAPES), required: true },
  tier: { type: String, enum: Object.keys(TIERS), required: true },
  bedrooms: { type: Number, default: 1 },
  // What you would normally charge. Constrains nothing — the booking records
  // what was actually paid — but without it a discount is invisible later.
  referenceRate: { type: Number, default: 0 },
  active: { type: Boolean, default: true }
});

/* ── Bookings ──────────────────────────────────────────────────────────── */

export const BOOKING_STATUSES = ['enquiry', 'confirmed', 'checked_in', 'checked_out', 'cancelled', 'no_show'];

// Statuses that actually hold a room. An enquiry does not block anyone, and a
// cancellation must free the dates immediately.
export const BLOCKING_STATUSES = ['confirmed', 'checked_in', 'checked_out'];

const paymentSchema = new Schema(
  { amount: { type: Number, required: true }, method: String, paidOn: Date, note: String },
  { _id: true }
);

const bookingSchema = new Schema({
  reference: { type: String, required: true, unique: true },
  guestName: { type: String, required: true },
  guestPhone: String,
  guestEmail: String,

  product: { type: Schema.Types.ObjectId, ref: 'Product' },
  rooms: [{ type: Schema.Types.ObjectId, ref: 'Room', required: true }],
  tier: { type: String, enum: Object.keys(TIERS), required: true },

  checkIn: { type: Date, required: true, index: true },
  checkOut: { type: Date, required: true, index: true },
  status: { type: String, enum: BOOKING_STATUSES, default: 'confirmed', index: true },

  quotedAmount: { type: Number, default: 0 },
  payments: [paymentSchema],

  // Held against damage, returned afterwards. Tracked apart from the stay money
  // so it never shows up as revenue.
  deposit: {
    amount: { type: Number, default: 0 },
    takenOn: Date,
    note: String,
    refund: {
      amount: Number,
      processedOn: Date,
      note: String
    }
  },

  referralCode: { type: String, index: true },
  // What the guest specifically came for. If this is set, the room cannot be
  // swapped for one that lacks it when making space for someone else.
  requestedAmenities: [String],
  flagged: String,
  notes: String,
  // Dates moving after the fact silently changes past reports, so changes leave
  // a trace.
  history: [{ at: { type: Date, default: Date.now }, what: String }],
  createdAt: { type: Date, default: Date.now }
});

bookingSchema.virtual('totalPaid').get(function () {
  return (this.payments || []).reduce((sum, p) => sum + (p.amount || 0), 0);
});

bookingSchema.virtual('balance').get(function () {
  return Math.max(0, (this.quotedAmount || 0) - this.totalPaid);
});

bookingSchema.virtual('depositOutstanding').get(function () {
  const held = this.deposit?.amount || 0;
  if (!held) return 0;
  return this.deposit?.refund?.processedOn ? 0 : held;
});

bookingSchema.set('toObject', { virtuals: true });
bookingSchema.set('toJSON', { virtuals: true });

/* ── Records portal ────────────────────────────────────────────────────── */

const attachmentSchema = new Schema({
  kind: { type: String, enum: ['image', 'file'], default: 'image' },
  title: String,
  note: String,
  filename: { type: String, required: true },
  thumbname: String,
  mimetype: String,
  bytes: Number,
  // Free-form tagging beats a rigid category list for a store that holds guest
  // photos, apartment shots, receipts and reviews alike.
  tags: [String],
  booking: { type: Schema.Types.ObjectId, ref: 'Booking', index: true },
  property: { type: Schema.Types.ObjectId, ref: 'Property', index: true },
  sensitive: { type: Boolean, default: false },
  uploadedAt: { type: Date, default: Date.now }
});

/* ── Enquiries we could not take ───────────────────────────────────────── */

// Bookings record what was sold; without this, what was turned away leaves no
// trace at all. It is the number that says whether being full is costing money.
const enquirySchema = new Schema({
  guestName: String,
  guestPhone: String,
  checkIn: { type: Date, required: true },
  checkOut: { type: Date, required: true },
  wanted: String,
  // Which unit was actually asked for. Turn-aways attributed to a specific
  // apartment are the clearest demand signal available at this size.
  property: { type: Schema.Types.ObjectId, ref: 'Property' },
  tier: { type: String, enum: Object.keys(TIERS) },
  reason: { type: String, default: 'no_availability' },
  offered: String,
  outcome: { type: String, enum: ['open', 'converted', 'lost'], default: 'open' },
  booking: { type: Schema.Types.ObjectId, ref: 'Booking' },
  note: String,
  createdAt: { type: Date, default: Date.now }
});

/* ── Staff accounts ────────────────────────────────────────────────────── */

const userSchema = new Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: String,
  role: { type: String, required: true, default: 'frontdesk' },
  // Deactivated rather than deleted: the audit trail has to keep pointing at
  // a real person.
  active: { type: Boolean, default: true },
  inviteToken: String,
  inviteExpires: Date,
  lastLoginAt: Date,
  createdAt: { type: Date, default: Date.now }
});

// Held in the database, not in memory: sessions must survive a restart, and a
// departing staff member's access has to be revocable.
const sessionSchema = new Schema({
  token: { type: String, required: true, unique: true },
  user: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  userAgent: String,
  createdAt: { type: Date, default: Date.now },
  expiresAt: { type: Date, required: true }
});
sessionSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

/**
 * Who did what. More useful than the roles themselves: you mostly trust your
 * staff, and the question that actually comes up is who issued that refund.
 * Views of documents flagged sensitive are recorded too.
 */
const auditSchema = new Schema({
  at: { type: Date, default: Date.now, index: true },
  actorName: String,
  actorEmail: String,
  action: { type: String, required: true },
  target: String,
  detail: String
});

const settingSchema = new Schema({
  key: { type: String, required: true, unique: true },
  value: Schema.Types.Mixed,
  updatedAt: { type: Date, default: Date.now }
});

export const User = model('User', userSchema);
export const Session = model('Session', sessionSchema);
export const Audit = model('Audit', auditSchema);
export const Setting = model('Setting', settingSchema);

/* ── Hiring ────────────────────────────────────────────────────────────── */

const jobSchema = new Schema({
  title: { type: String, required: true },
  slug: { type: String, required: true, unique: true },
  summary: String,
  responsibilities: [String],
  requirements: [String],
  // Free-form label/value pairs so a posting can carry whatever it needs —
  // shift pattern, uniform, who it reports to — without a schema change.
  details: [{ label: String, value: String }],
  employmentType: { type: String, default: 'FULL_TIME' },
  location: { type: String, default: 'Iwofe, Port Harcourt, Rivers State' },
  status: { type: String, enum: ['draft', 'open', 'closed'], default: 'draft', index: true },
  postedOn: { type: Date, default: Date.now },
  // Google drops a posting past this date, and a filled vacancy left up
  // generates calls for months. Both reasons to keep it.
  closesOn: Date,
  createdAt: { type: Date, default: Date.now }
});

const applicationSchema = new Schema({
  job: { type: Schema.Types.ObjectId, ref: 'Job', required: true, index: true },
  name: { type: String, required: true },
  phone: String,
  email: String,
  about: String,
  hasGuarantors: Boolean,
  hasPoliceCert: Boolean,
  source: { type: String, enum: ['form', 'whatsapp'], default: 'form' },
  status: { type: String, enum: ['new', 'shortlisted', 'rejected', 'hired'], default: 'new' },
  note: String,
  createdAt: { type: Date, default: Date.now }
});

export const Job = model('Job', jobSchema);
export const Application = model('Application', applicationSchema);

export const Enquiry = model('Enquiry', enquirySchema);

export const Participant = model('Participant', participantSchema);
export const Click = model('Click', clickSchema);
export const Reminder = model('Reminder', reminderSchema);
export const Property = model('Property', propertySchema);
export const Room = model('Room', roomSchema);
export const Product = model('Product', productSchema);
export const Booking = model('Booking', bookingSchema);
export const Attachment = model('Attachment', attachmentSchema);
