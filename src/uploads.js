import crypto from 'node:crypto';
import multer from 'multer';
import sharp from 'sharp';
import { IMAGE } from './config.js';
import { exists, put, remove as removeObject } from './storage.js';

const IMAGE_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'image/avif',
  // iPhones shoot HEIC by default and this sharp build decodes it, so these are
  // re-encoded to JPEG like anything else rather than rejected at the door.
  'image/heic',
  'image/heif'
]);
// A CV arrives as a PDF, a Word file or a photograph of one. Word is stored as
// sent and never opened server-side; blocking it would turn a format quirk into
// a rejection of candidates who are otherwise fine.
const DOC_TYPES = new Set([
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
]);
const FILE_TYPES = new Set(['application/pdf', ...DOC_TYPES]);

// Held in memory so nothing untrusted is written anywhere before it has been
// re-encoded — which also strips EXIF, including the GPS coordinates phones
// attach to photos.
export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: IMAGE.maxUploadBytes, files: 10 },
  fileFilter: (_req, file, cb) => {
    // Some browsers hand over HEIC as octet-stream with no useful type, so the
    // extension is checked too rather than rejecting a valid iPhone photo.
    const byExtension = /\.(jpe?g|png|webp|gif|avif|heic|heif|pdf|docx?)$/i.test(file.originalname || '');
    if (IMAGE_TYPES.has(file.mimetype) || FILE_TYPES.has(file.mimetype) || byExtension) {
      return cb(null, true);
    }
    cb(new Error(`${file.mimetype || 'That file'} is not an accepted type.`));
  }
});

export class UploadRejected extends Error {}

export async function store(file) {
  const id = crypto.randomBytes(12).toString('hex');
  const asDocument =
    FILE_TYPES.has(file.mimetype) ||
    (/\.(pdf|docx?)$/i.test(file.originalname || '') && !IMAGE_TYPES.has(file.mimetype));

  if (asDocument) {
    if (file.buffer.length > IMAGE.maxPdfBytes) {
      throw new UploadRejected(
        `Documents are stored as they arrive — nothing shrinks them — so they are capped at ` +
          `${Math.round(IMAGE.maxPdfBytes / 1048576)}MB. "${file.originalname}" is ` +
          `${(file.buffer.length / 1048576).toFixed(1)}MB. Photograph the document instead and it ` +
          `will compress to a fraction of that.`
      );
    }
    const word = DOC_TYPES.has(file.mimetype) || /\.docx?$/i.test(file.originalname || '');
    const ext = word ? (/\.doc$/i.test(file.originalname || '') ? 'doc' : 'docx') : 'pdf';
    const type = word ? file.mimetype || 'application/octet-stream' : 'application/pdf';
    const filename = `${id}.${ext}`;
    await put(filename, file.buffer, type);
    return { kind: 'file', filename, mimetype: type, bytes: file.buffer.length };
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

  await Promise.all([put(filename, resized, 'image/jpeg'), put(thumbname, thumb, 'image/jpeg')]);

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
    await removeObject(name);
  }
}

/**
 * Records whose file is no longer there. Deleting the upload directory once
 * left rows pointing at nothing and rendering as broken images forever; this
 * makes that visible and fixable instead.
 */
export async function findOrphans(attachments) {
  const orphans = [];
  for (const a of attachments) {
    if (!(await exists(a.filename))) orphans.push(a);
  }
  return orphans;
}
