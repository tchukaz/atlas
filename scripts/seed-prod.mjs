import 'dotenv/config';
import mongoose from 'mongoose';
import { hashPassword } from '../src/auth.js';

/**
 * Copies apartments, bedrooms and products from one database into another, and
 * creates the manager account.
 *
 * Original _id values are kept, which does two things: a bedroom's reference to
 * its apartment survives the copy without remapping, and running this twice
 * changes nothing rather than producing a second set of everything.
 *
 *   node scripts/seed-prod.mjs --from test [--apply]
 *
 * Without --apply it reports what it would do and writes nothing.
 */

const args = process.argv.slice(2);
const apply = args.includes('--apply');
const fromDb = (args[args.indexOf('--from') + 1] || 'test').replace(/[^A-Za-z0-9_-]/g, '');

const base = process.env.MONGODB_URI;
if (!base) {
  console.error('MONGODB_URI is not set.');
  process.exit(1);
}

const swap = (db) => base.replace(/\/[^/?]+(\?|$)/, `/${db}$1`);
const targetDb = base.slice(base.lastIndexOf('/') + 1).split('?')[0];

if (fromDb === targetDb) {
  console.error(`Source and target are both "${fromDb}". Nothing to do.`);
  process.exit(1);
}

console.log(`from : ${fromDb}`);
console.log(`to   : ${targetDb}`);
console.log(apply ? 'mode : APPLY\n' : 'mode : dry run (pass --apply to write)\n');

const source = await mongoose.createConnection(swap(fromDb), { serverSelectionTimeoutMS: 20000 }).asPromise();
const target = await mongoose.createConnection(swap(targetDb), { serverSelectionTimeoutMS: 20000 }).asPromise();

let copied = 0;
let skipped = 0;

// Apartments before bedrooms, so a bedroom never lands pointing at nothing.
for (const name of ['properties', 'rooms', 'products']) {
  const docs = await source.db.collection(name).find().toArray();
  const existing = new Set(
    (await target.db.collection(name).find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id))
  );
  const fresh = docs.filter((d) => !existing.has(String(d._id)));

  console.log(`${name.padEnd(12)} ${docs.length} in source, ${docs.length - fresh.length} already there, ${fresh.length} to copy`);

  if (apply && fresh.length) await target.db.collection(name).insertMany(fresh);
  copied += fresh.length;
  skipped += docs.length - fresh.length;
}

// Every bedroom must still find its apartment on the other side.
const rooms = await target.db.collection('rooms').find().toArray();
const propertyIds = new Set(
  (await target.db.collection('properties').find({}, { projection: { _id: 1 } }).toArray()).map((d) => String(d._id))
);
const orphans = rooms.filter((r) => !propertyIds.has(String(r.property)));
console.log(`\nbedrooms with no apartment: ${orphans.length}${orphans.length ? ' <-- PROBLEM' : ''}`);

/* ── Manager account ───────────────────────────────────────────────────── */

const email = (process.env.MANAGER_USERNAME || '').trim().toLowerCase();
const password = process.env.MANAGER_PASSWORD || '';

if (!email || !password) {
  console.log('\nmanager: MANAGER_USERNAME or MANAGER_PASSWORD missing from .env — skipped');
} else {
  const already = await target.db.collection('users').findOne({ email });
  if (already) {
    // Never silently rewrite a password that someone may already be using.
    console.log(`\nmanager: ${email} already exists as ${already.role} — left alone`);
  } else if (!apply) {
    console.log(`\nmanager: would create ${email} as manager`);
  } else {
    await target.db.collection('users').insertOne({
      name: 'Operations Manager',
      email,
      passwordHash: await hashPassword(password),
      role: 'manager',
      active: true,
      enquiries: 0,
      createdAt: new Date()
    });
    console.log(`\nmanager: created ${email} as manager`);
  }
}

console.log(`\n${apply ? 'copied' : 'would copy'} ${copied} document(s), left ${skipped} already present.`);

await source.close();
await target.close();
