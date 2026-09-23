import cron from 'node-cron';
import { CHALLENGE, EMAIL, daysLeft } from './config.js';
import { sendDailyNudge } from './email.js';
import { alreadyReminded, markReminded, rankOf, standings } from './store.js';

const lagosToday = () =>
  new Date(Date.now() + 3_600_000).toISOString().slice(0, 10);

function withinChallenge(today) {
  if (!CHALLENGE.startDate || !CHALLENGE.endDate) return false;
  return today >= CHALLENGE.startDate && today <= CHALLENGE.endDate;
}

export async function runDailyNudges({ dryRun = false } = {}) {
  const today = lagosToday();
  const result = { today, sent: 0, skipped: 0, failed: 0, dryRun };

  if (!withinChallenge(today)) {
    result.reason = 'outside the challenge window';
    return result;
  }

  const rows = standings();
  const remaining = daysLeft() ?? 0;

  for (const row of rows) {
    if (row.disqualified) {
      result.skipped += 1;
      continue;
    }
    if (alreadyReminded(row.id, today)) {
      result.skipped += 1;
      continue;
    }

    const { rank, of, leader } = rankOf(row.code);

    if (dryRun) {
      console.log(`[dry-run] ${row.email} — rank ${rank}/${of}, ${row.bookings} bookings`);
      result.sent += 1;
      continue;
    }

    try {
      await sendDailyNudge({
        participant: row,
        rank,
        of,
        leader,
        daysRemaining: remaining,
        stats: { uniqueClicks: row.uniqueClicks, bookings: row.bookings }
      });
      // Marked only after a successful send, so a failure retries tomorrow
      // rather than silently swallowing the nudge.
      markReminded(row.id, today);
      result.sent += 1;
    } catch (err) {
      console.error(`nudge failed for ${row.email}:`, err.message);
      result.failed += 1;
    }
  }

  return result;
}

export function startReminderSchedule() {
  if (!EMAIL.apiKey) {
    console.log('Reminders disabled — RESEND_API_KEY is not set.');
    return null;
  }
  const expression = `0 ${EMAIL.sendHourLagos} * * *`;
  const task = cron.schedule(
    expression,
    () => {
      runDailyNudges()
        .then((r) => console.log('daily nudges:', JSON.stringify(r)))
        .catch((err) => console.error('daily nudges failed:', err.message));
    },
    { timezone: 'Africa/Lagos' }
  );
  console.log(`Reminders scheduled at ${EMAIL.sendHourLagos}:00 Africa/Lagos.`);
  return task;
}

// node src/reminders.js --dry-run
if (process.argv[1] && process.argv[1].endsWith('reminders.js')) {
  runDailyNudges({ dryRun: process.argv.includes('--dry-run') })
    .then((r) => {
      console.log(JSON.stringify(r, null, 2));
      process.exit(0);
    })
    .catch((err) => {
      console.error(err);
      process.exit(1);
    });
}
