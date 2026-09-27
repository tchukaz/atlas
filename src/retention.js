import cron from 'node-cron';
import { purgeExpiredSensitive } from './settings.js';

/**
 * Sweeps nightly rather than on demand: retention that only runs when someone
 * remembers to click is not a retention policy.
 */
export function startRetentionSchedule() {
  return cron.schedule(
    '30 3 * * *',
    () => {
      purgeExpiredSensitive()
        .then((r) => {
          if (!r.skipped && r.deleted) console.log(`retention: removed ${r.deleted} record(s)`);
        })
        .catch((err) => console.error('retention sweep failed:', err.message));
    },
    { timezone: 'Africa/Lagos' }
  );
}
