import mongoose from 'mongoose';
import { MONGODB_URI } from './config.js';

mongoose.set('strictQuery', true);

export async function connect() {
  if (!MONGODB_URI) {
    throw new Error(
      'MONGODB_URI is not set. Point it at a MongoDB instance (Atlas gives a free one) and restart.'
    );
  }
  await mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 10_000 });
  return mongoose.connection;
}

export const disconnect = () => mongoose.disconnect();

// Overlap checks have to be atomic or two staff can double-book the same room.
// Transactions need a replica set: Atlas provides one, a bare local mongod does
// not, so fall back to running the work unguarded rather than refusing to book.
export async function withTransaction(work) {
  const session = await mongoose.startSession();
  try {
    let result;
    await session.withTransaction(async () => {
      result = await work(session);
    });
    return result;
  } catch (err) {
    const unsupported =
      err?.code === 20 ||
      /Transaction numbers are only allowed|replica set|not supported/i.test(err?.message || '');
    if (!unsupported) throw err;
    console.warn('Transactions unavailable on this MongoDB — proceeding without one.');
    return work(null);
  } finally {
    await session.endSession();
  }
}

export { mongoose };
