// Fixed source notice data, independent of adjacent payload receipts. No I/O on import.
import { createHash } from 'node:crypto';
import { constants } from 'node:fs';
import { lstat, mkdir, open, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const SOURCE = fileURLToPath(new URL('./sdk/notices/', import.meta.url));
const PREFIX = 'third-party-notices/';
const files = [
  ['THIRD_PARTY_NOTICES.md', 3292, 'e36e91109824c1f80cf5f7816bc08a45e9e46c02446a2c2ed8b9ffbefc1493d2'],
  ['index.json', 16157, '1821bb360c65a48984f491a994dd189d505a3a623dd8c329acfef93a05167293'],
  ['licenses/kubernetes-Apache-2.0.txt', 11358, 'cfc7749b96f63bd31c3c42b5c471bf756814053e847c10f3eb003417bc523d30'],
  ['licenses/msgpackr-extract-MIT.txt', 1065, 'd00470775464c789c7ac04cfba3bf1b79ef149790eb72556d1c51d8f50c8e7f3'],
  ['licenses/opencode-MIT.txt', 1065, '625f0f619133f89bbbb2abe37369613dfa1885eba1e50d02170deb62bb42cb6b'],
];
const refuse = () => { throw Object.assign(new Error('NOTICES_INVALID'), { code: 'NOTICES_INVALID' }); };
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');

export function assertSupplementalNotices(records) {
  try {
    if (!Array.isArray(records)) refuse();
    const selected = records.filter(record => typeof record.path === 'string' && record.path.startsWith(PREFIX));
    if (selected.length !== files.length) refuse();
    for (const [name, bytes, digest] of files) {
      const matches = selected.filter(record => record.path === `${PREFIX}${name}`);
      if (matches.length !== 1) refuse();
      const record = matches[0];
      if (Object.keys(record).sort().join(',') !== 'bytes,executable,path,sha256' ||
        record.bytes !== bytes || record.sha256 !== digest || record.executable !== false) refuse();
    }
  } catch { refuse(); }
}

async function sourceBytes(name, size, digest) {
  const file = path.join(SOURCE, name), before = await lstat(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size !== size) refuse();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  try {
    const opened = await handle.stat();
    if (opened.dev !== before.dev || opened.ino !== before.ino || !opened.isFile() || opened.nlink !== 1 || opened.size !== size) refuse();
    const buffer = Buffer.alloc(size + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length !== size || sha256(buffer.subarray(0, length)) !== digest) refuse();
    return buffer.subarray(0, length);
  } finally { await handle.close(); }
}

// The caller owns the staging transaction. This function never adopts, repairs
// or deletes an existing destination, and reads every fixed input before writing.
export async function writeSupplementalNotices(stage) {
  try {
    for (const [directory, entries] of [[SOURCE, ['THIRD_PARTY_NOTICES.md', 'index.json', 'licenses']],
      [path.join(SOURCE, 'licenses'), files.slice(2).map(([name]) => path.posix.basename(name))]]) {
      const stat = await lstat(directory);
      if (!stat.isDirectory() || stat.isSymbolicLink() || JSON.stringify((await readdir(directory)).sort()) !== JSON.stringify(entries.sort())) refuse();
    }
    const contents = [];
    for (const [name, size, digest] of files) contents.push([name, await sourceBytes(name, size, digest)]);
    const destination = path.join(stage, 'third-party-notices');
    await mkdir(destination, { mode: 0o755 });
    await mkdir(path.join(destination, 'licenses'), { mode: 0o755 });
    for (const [name, bytes] of contents) await writeFile(path.join(destination, name), bytes, { flag: 'wx', mode: 0o644 });
  } catch { refuse(); }
}
