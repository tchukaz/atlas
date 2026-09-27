import 'dotenv/config';
import { R2 } from '../src/config.js';
import { put, open, remove, exists, usingR2 } from '../src/storage.js';

/**
 * A real round trip against the bucket. Credentials that look right and a
 * bucket that actually accepts a write are different things, and the only way
 * to tell them apart is to write something and read it back.
 */

const missing = Object.entries({
  R2_ACCOUNT_ID: R2.accountId,
  R2_BUCKET: R2.bucket,
  R2_ACCESS_KEY_ID: R2.accessKeyId,
  R2_SECRET_ACCESS_KEY: R2.secretAccessKey
})
  .filter(([, v]) => !v)
  .map(([k]) => k);

if (missing.length) {
  console.error(`Not configured. Missing in .env: ${missing.join(', ')}`);
  console.error('Uploads are going to local disk until all four are set.');
  process.exit(1);
}

console.log(`Bucket   : ${R2.bucket}`);
console.log(`Endpoint : https://${R2.accountId}.r2.cloudflarestorage.com`);
console.log(`Driver   : ${usingR2 ? 'Cloudflare R2' : 'local disk (unexpected)'}\n`);

const key = `healthcheck-${Date.now()}.txt`;
const body = Buffer.from(`Atlas House R2 check at ${new Date().toISOString()}`);
let wrote = false;

try {
  process.stdout.write('write  ... ');
  await put(key, body, 'text/plain');
  wrote = true;
  console.log('ok');

  process.stdout.write('exists ... ');
  if (!(await exists(key))) throw new Error('the object was written but does not report as present');
  console.log('ok');

  process.stdout.write('read   ... ');
  const found = await open(key);
  if (!found) throw new Error('could not read the object back');
  const chunks = [];
  for await (const chunk of found.stream) chunks.push(chunk);
  const round = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  if (!round.equals(body)) throw new Error('what came back is not what went in');
  console.log(`ok (${round.length} bytes, identical)`);

  process.stdout.write('delete ... ');
  await remove(key);
  if (await exists(key)) throw new Error('the object survived deletion');
  wrote = false;
  console.log('ok\n');

  console.log('R2 is working. Uploads will go to the bucket.');
} catch (err) {
  console.error(`failed\n\n${err.message}\n`);
  if (/403|Forbidden|SignatureDoesNotMatch/i.test(err.message)) {
    console.error('That reads like a credentials problem — check the access key and secret,');
    console.error('and that the token has Object Read & Write on this bucket.');
  } else if (/404|NoSuchBucket/i.test(err.message)) {
    console.error(`No bucket called "${R2.bucket}" on this account. Check the name and the account id.`);
  } else if (/ENOTFOUND|EAI_AGAIN|ECONNREFUSED/i.test(err.message)) {
    console.error('The endpoint could not be reached — check the account id and your connection.');
  }
  if (wrote) await remove(key).catch(() => {});
  process.exit(1);
}
