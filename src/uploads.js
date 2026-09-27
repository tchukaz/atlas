import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import multer from 'multer';
import sharp from 'sharp';
import { IMAGE, UPLOAD_DIR } from './config.js';

const ROOT = path.isAbsolute(UPLOAD_DIR) ? UPLOAD_DIR : path.join(process.cwd(), UPLOAD_DIR);

await fs.mkdir(ROOT, { recursive: true });

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  // iPhones shoot HEIC by default. sharp's build here decodes it, so these are
  // re-encoded to JPEG like anything else rather than rejected at the door.
  'image/heic',
  'image/heif'
]);
const FILE_TYPES = new Set(['application/pdf']);

// Held in memory so nothing untrusted is written to disk before it has been
// re-encoded — which also strips EXIF, including the GPS coordinates phones
// attach to photos.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE.maxUploadBytes, files: 10 },
  fileFilter: (_req, file, cb) => {
    // Some browsers hand over HEIC as octet-stream with no useful type, so the
    // extension is checked too rather than rejecting a valid iPhone photo.
    const byExtension = /\.(jpe?g|png|webp|gif|avif|heic|heif|pdf)$/i.test(file.originalname || '');
    if (IMAGE_TYPES.has(file.mimetype) || FILE_TYPES.has(file.mimetype) || byExtension) {
      return cb(null, true);
    }
    cb(new Error(`${file.mimetype || 'That file'} is not an accepted type.`));
  }
});

export const filePath = (name) => path.join(ROOT, path.basename(name));

/**
 * Phone photos arrive at 3–8MB each. Left alone they fill the disk and make
 * every gallery page crawl, so everything is re-encoded to a sane width and a
 * thumbnail is kept for listings.
 */
export class UploadRejected extends Error {}

export async function store(file) {
  const id = crypto.randomBytes(12).toString('hex');

  if (FILE_TYPES.has(file.mimetype)) {
    if (file.buffer.length > IMAGE.maxPdfBytes) {
      throw new UploadRejected(
        `PDFs are kept as they arrive — nothing shrinks them — so they are capped at ` +
          `${Math.round(IMAGE.maxPdfBytes / 1048576)}MB. "${file.originalname}" is ` +
          `${(file.buffer.length / 1048576).toFixed(1)}MB. Photograph the document instead and it ` +
          `will compress to a fraction of that.`
      );
    }
    const filename = `${id}.pdf`;
    await fs.writeFile(filePath(filename), file.buffer);
    return { kind: 'file', filename, mimetype: file.mimetype, bytes: file.buffer.length };
  }

  const isPdfByName = /\.pdf$/i.test(file.originalname || '');
  if (isPdfByName && !IMAGE_TYPES.has(file.mimetype)) {
    return store({ ...file, mimetype: 'application/pdf' });
  }

  const filename = `${id}.jpg`;
  const thumbname = `${id}_t.jpg`;

  const resized = await sharp(file.buffer)
    .rotate()
    .resize(IMAGE.maxWidth, null, { withoutEnlargement: true })
    .jpeg({ quality: IMAGE.quality, mozjpeg: true })
    .toBuffer();

  const thumb = await sharp(file.buffer)
    .rotate()
    .resize(IMAGE.thumbWidth, IMAGE.thumbWidth, { fit: 'cover' })
    .jpeg({ quality: 70 })
    .toBuffer();

  await Promise.all([
    fs.writeFile(filePath(filename), resized),
    fs.writeFile(filePath(thumbname), thumb)
  ]);

  return {
    kind: 'image',
    filename,
    thumbname,
    mimetype: 'image/jpeg',
    bytes: resized.length,
    originalBytes: file.buffer.length
  };
}

export async function remove(attachment) {
  for (const name of [attachment.filename, attachment.thumbname].filter(Boolean)) {
    await fs.unlink(filePath(name)).catch(() => {});
  }
}

export async function diskUsage() {
  const names = await fs.readdir(ROOT).catch(() => []);
  let bytes = 0;
  for (const name of names) {
    const stat = await fs.stat(path.join(ROOT, name)).catch(() => null);
    if (stat?.isFile()) bytes += stat.size;
  }
  return { files: names.length, bytes };
}
