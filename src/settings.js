import { Attachment, Setting } from './models.js';
import { remove } from './uploads.js';

export const RETENTION_CHOICES = [
  { value: 90, label: '90 days' },
  { value: 180, label: '180 days' },
  { value: 365, label: '365 days' },
  { value: 0, label: 'Keep forever' }
];

const DEFAULTS = {
  // Deliberately "forever" until someone chooses: silently deleting a guest's
  // ID on a default nobody picked is worse than keeping it a while longer.
  sensitiveRetentionDays: 0
};

export async function getSetting(key) {
  const row = await Setting.findOne({ key }).lean();
  return row ? row.value : DEFAULTS[key];
}

export async function setSetting(key, value) {
  await Setting.updateOne(
    { key },
    { $set: { value, updatedAt: new Date() } },
    { upsert: true }
  );
  return value;
}

export const getSettings = async () => ({
  sensitiveRetentionDays: await getSetting('sensitiveRetentionDays')
});

/**
 * Identity documents kept indefinitely are liability with no upside once the
 * guest has gone. Only records flagged sensitive are touched — apartment
 * photos are not personal data and are left alone.
 */
export async function purgeExpiredSensitive({ dryRun = false } = {}) {
  const days = Number(await getSetting('sensitiveRetentionDays')) || 0;
  if (!days) return { skipped: true, reason: 'retention is set to keep forever' };

  const cutoff = new Date(Date.now() - days * 86_400_000);
  const stale = await Attachment.find({ sensitive: true, uploadedAt: { $lt: cutoff } }).lean();

  if (!dryRun) {
    for (const attachment of stale) await remove(attachment);
    if (stale.length) {
      await Attachment.deleteMany({ _id: { $in: stale.map((a) => a._id) } });
    }
  }

  return { days, cutoff, deleted: stale.length, dryRun };
}
