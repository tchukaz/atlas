import fs from 'node:fs/promises';
import { createReadStream, existsSync } from 'node:fs';
import path from 'node:path';
import { AwsClient } from 'aws4fetch';
import { R2, UPLOAD_DIR } from './config.js';

/**
 * Files went missing once because they lived on a local disk while their
 * records lived in a remote database — two lifecycles, nothing reconciling
 * them. R2 makes the files as durable as the records; local disk stays as the
 * no-credentials path so development works before a bucket exists.
 */

const ROOT = path.isAbsolute(UPLOAD_DIR) ? UPLOAD_DIR : path.join(process.cwd(), UPLOAD_DIR);
await fs.mkdir(ROOT, { recursive: true });

export const usingR2 = Boolean(R2.accountId && R2.bucket && R2.accessKeyId && R2.secretAccessKey);

const client = usingR2
  ? new AwsClient({
      accessKeyId: R2.accessKeyId,
      secretAccessKey: R2.secretAccessKey,
      service: 's3',
      region: 'auto'
    })
  : null;

const objectUrl = (key) =>
  `https://${R2.accountId}.r2.cloudflarestorage.com/${R2.bucket}/${encodeURIComponent(key)}`;

const localPath = (key) => path.join(ROOT, path.basename(key));

export async function put(key, body, contentType) {
  if (!usingR2) return fs.writeFile(localPath(key), body);

  const res = await client.fetch(objectUrl(key), {
    method: 'PUT',
    body,
    headers: { 'Content-Type': contentType || 'application/octet-stream' }
  });
  if (!res.ok) throw new Error(`R2 upload failed (${res.status}): ${await res.text()}`);
}

export async function exists(key) {
  if (!usingR2) return existsSync(localPath(key));
  const res = await client.fetch(objectUrl(key), { method: 'HEAD' });
  return res.ok;
}

/** Returns what an Express response can send: a local path or a fetched body. */
export async function open(key) {
  if (!usingR2) {
    const target = localPath(key);
    return existsSync(target) ? { kind: 'path', path: target } : null;
  }
  const res = await client.fetch(objectUrl(key));
  if (!res.ok) return null;
  return {
    kind: 'stream',
    stream: res.body,
    contentType: res.headers.get('content-type'),
    length: res.headers.get('content-length')
  };
}

export async function remove(key) {
  if (!usingR2) {
    await fs.unlink(localPath(key)).catch(() => {});
    return;
  }
  await client.fetch(objectUrl(key), { method: 'DELETE' }).catch(() => {});
}

export async function usage() {
  if (usingR2) return { where: 'Cloudflare R2', bucket: R2.bucket, files: null, bytes: null };
  const names = await fs.readdir(ROOT).catch(() => []);
  let bytes = 0;
  for (const name of names) {
    const stat = await fs.stat(path.join(ROOT, name)).catch(() => null);
    if (stat?.isFile()) bytes += stat.size;
  }
  return { where: 'this server', files: names.length, bytes };
}

export { ROOT as LOCAL_ROOT, localPath, createReadStream };
