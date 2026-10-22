// Observations from an owned synthetic profile only; never serialize private log text.
import { constants } from 'node:fs';
import { lstat, open, realpath } from 'node:fs/promises';
import { dirname, isAbsolute, join, resolve } from 'node:path';

const markerName = '.lawoss-release-acceptance-profile.json';
const tailLimit = 65536, markerLimit = 16384;
const definitions = [
  ['ERROR [main] Uncaught exception:', 'main-uncaught-exception'],
  ['ERROR [main] Unhandled rejection:', 'main-unhandled-rejection'],
  ['WARN [ui-control] failed to start', 'ui-control-start-failed'],
];
const slot = (availability, scannedBytes = 0, truncated = false, categories = []) => Object.freeze({ availability, scannedBytes, truncated, categories: Object.freeze(categories) });
const unavailable = () => Object.freeze({ current: slot('unavailable'), previous: slot('unavailable') });
const identity = info => `${info.dev}:${info.ino}`;
const stableFile = (a, b) => identity(a) === identity(b) && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs && a.mode === b.mode;
function physicalFile(info) {
  if (!info.isFile() || info.isSymbolicLink() || info.nlink !== 1n) throw new Error('unavailable');
}
async function physicalDirectory(path) {
  const info = await lstat(path, { bigint: true });
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(path) !== path) throw new Error('unavailable');
  return { path, id: identity(info) };
}
async function chain(root) {
  const entries = [];
  for (let path = root;; path = dirname(path)) {
    entries.push(await physicalDirectory(path));
    if (dirname(path) === path) return entries;
  }
}
async function recheck(entries) {
  for (const entry of entries) if ((await physicalDirectory(entry.path)).id !== entry.id) throw new Error('unavailable');
}
async function boundedRead(path, maximum, tail = false) {
  const before = await lstat(path, { bigint: true }); physicalFile(before);
  if (!tail && before.size > BigInt(maximum)) throw new Error('unavailable');
  const handle = await open(path, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    const opened = await handle.stat({ bigint: true }); physicalFile(opened);
    if (!stableFile(before, opened) || await realpath(path) !== path || before.size > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('unavailable');
    const size = Number(opened.size), length = Math.min(maximum, size), offset = size - length;
    const bytes = Buffer.alloc(length);
    const result = await handle.read(bytes, 0, length, offset); // One bounded positional read, including for large logs.
    const after = await handle.stat({ bigint: true }), named = await lstat(path, { bigint: true });
    physicalFile(after); physicalFile(named);
    if (result.bytesRead !== length || !stableFile(opened, after) || !stableFile(after, named) || await realpath(path) !== path) throw new Error('unavailable');
    return { bytes, truncated: offset > 0 };
  } finally { await handle.close(); }
}
async function marker(root, owner) {
  const { bytes } = await boundedRead(join(root, markerName), markerLimit);
  const value = JSON.parse(bytes.toString('utf8'));
  if (value.schemaVersion !== 1 || value.synthetic !== true || value.root !== root || value.kind !== 'fresh'
    || typeof value.owner !== 'string' || !value.owner || value.owner !== owner) throw new Error('unavailable');
}
function categories(bytes, truncated) {
  const firstNewline = truncated ? bytes.indexOf(10) : -1;
  const text = (truncated ? firstNewline < 0 ? Buffer.alloc(0) : bytes.subarray(firstNewline + 1) : bytes).toString('utf8');
  const found = new Set();
  for (const line of text.split('\n')) {
    const match = /^\[(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z)\] (.*)$/.exec(line);
    if (!match || !Number.isFinite(Date.parse(match[1])) || new Date(match[1]).toISOString() !== match[1]) continue;
    for (const [prefix, category] of definitions)
      if (match[2] === prefix || match[2].startsWith(`${prefix} `)) found.add(category);
  }
  return found.size ? definitions.map(([, category]) => category).filter(category => found.has(category)) : ['unknown'];
}

/** Bind before launch, then observe only once after the original failure's cleanup. */
export async function createMainStartupLogDiagnostic(profile) {
  let root, owner, original;
  try {
    root = profile.root; owner = profile.owner;
    if (typeof root !== 'string' || !isAbsolute(root) || resolve(root) !== root || profile.kind !== 'fresh' || typeof owner !== 'string' || !owner) throw new Error('unavailable');
    original = await chain(root); await marker(root, owner); await recheck(original);
  } catch { return Object.freeze({ read: async () => unavailable() }); }
  const ownership = async () => { await recheck(original); await marker(root, owner); await recheck(original); };
  const readSlot = async name => {
    try {
      await ownership();
      const directories = [await physicalDirectory(join(root, 'userdata')), await physicalDirectory(join(root, 'userdata/logs'))];
      await recheck(directories);
      const { bytes, truncated } = await boundedRead(join(root, 'userdata/logs', name), tailLimit, true);
      await recheck(directories); await ownership();
      return bytes.length ? slot('read', bytes.length, truncated, categories(bytes, truncated)) : slot('empty');
    } catch (error) {
      // A missing file/directory is distinct only while the original profile is still ours.
      try { await ownership(); } catch { return slot('unavailable'); }
      return slot(error?.code === 'ENOENT' ? 'missing' : 'unavailable');
    }
  };
  let observation;
  return Object.freeze({ async read() {
    return observation ??= (async () => {
      try {
        await ownership();
        const current = await readSlot('main.log'), previous = await readSlot('main.old.log');
        await ownership();
        return Object.freeze({ current, previous });
      } catch { return unavailable(); }
    })();
  } });
}
