// Static build gate: read the private SDK module from actual packed app code.
// No resource JavaScript or application module is evaluated by this reader.
import { constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { lstat, open, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { canonical } from './validate.mjs';
import { createProductSdkIdentityModule, readProductSdkIdentityModule } from './product-identity.mjs';

const invalid = () => { throw Object.assign(new Error('PACKAGED_SDK_IDENTITY_INVALID'), { code: 'PACKAGED_SDK_IDENTITY_INVALID' }); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeNs === b.mtimeNs && a.ctimeNs === b.ctimeNs;
const filename = 'electron/generated/plugin-sdk/identity.mjs';

async function readFixedMember(resourcesRoot, filename, maximum, allowAbsent = false) {
  try {
    if (typeof resourcesRoot !== 'string' || resourcesRoot.length > 4096 ||
      !path.isAbsolute(resourcesRoot) || path.resolve(resourcesRoot) !== resourcesRoot) invalid();
    const root = await lstat(resourcesRoot, { bigint: true });
    if (!root.isDirectory() || root.isSymbolicLink() || await realpath(resourcesRoot) !== resourcesRoot) invalid();
    const archive = path.join(resourcesRoot, 'app.asar'), before = await lstat(archive, { bigint: true });
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1n || before.size < 16n || before.size > 1024n * 1024n * 1024n) invalid();
    const handle = await open(archive, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
    let headerSize;
    try {
      if (!same(before, await handle.stat({ bigint: true }))) invalid();
      const header = Buffer.alloc(8);
      if ((await handle.read(header, 0, 8, 0)).bytesRead !== 8 || header.readUInt32LE(0) !== 4) invalid();
      headerSize = header.readUInt32LE(4);
      // Bound allocation in the pinned asar parser before it reads its header.
      if (headerSize < 8 || headerSize > 16 * 1024 * 1024 || BigInt(headerSize) > before.size - 8n) invalid();
    } finally { await handle.close(); }
    const require = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
    const builder = createRequire(createRequire(require.resolve('electron-builder')).resolve('app-builder-lib'));
    if (builder('@electron/asar/package.json').version !== '3.4.1') invalid();
    const asar = builder('@electron/asar');
    let bytes = null;
    asar.uncache(archive);
    try {
      const raw = asar.getRawHeader(archive);
      if (raw.headerSize !== headerSize) invalid();
      let node = raw.header, missing = false;
      for (const part of filename.split('/')) {
        if (!node || typeof node !== 'object' || Object.hasOwn(node, 'link') || node.unpacked || !node.files || Array.isArray(node.files)) invalid();
        if (!Object.hasOwn(node.files, part)) { missing = true; break; }
        node = node.files[part];
      }
      if (missing) { if (!allowAbsent) invalid(); }
      else {
        if (!node || typeof node !== 'object' || Object.hasOwn(node, 'link') || Object.hasOwn(node, 'files') || node.unpacked ||
          !Number.isSafeInteger(node.size) || node.size < 1 || node.size > maximum || typeof node.offset !== 'string' ||
          !/^(?:0|[1-9]\d{0,15})$/.test(node.offset)) invalid();
        const offset = Number(node.offset);
        if (!Number.isSafeInteger(offset) || BigInt(offset) + BigInt(node.size) > before.size - 8n - BigInt(headerSize)) invalid();
        bytes = asar.extractFile(archive, path.join(...filename.split('/')), false);
        if (bytes.length !== node.size) invalid();
      }
    } finally { asar.uncache(archive); }
    if (!same(before, await lstat(archive, { bigint: true }))) invalid();
    const afterRoot = await lstat(resourcesRoot, { bigint: true });
    if (afterRoot.dev !== root.dev || afterRoot.ino !== root.ino || !afterRoot.isDirectory() || afterRoot.isSymbolicLink() ||
      await realpath(resourcesRoot) !== resourcesRoot) invalid();
    if (await realpath(archive) !== archive) invalid();
    return bytes;
  } catch { invalid(); }
}
export async function readPackagedProductSdkIdentity({ resourcesRoot, target, expectedMode, applicationBuild }) {
  try {
    const expected = readProductSdkIdentityModule(createProductSdkIdentityModule({ schema: 1,
      kind: 'lawoss-product-sdk-packaging', mode: expectedMode === 'development' ? 'development' : 'without-sdk', applicationBuild, target, sdk: null }));
    if (!['sdk', 'without-sdk', 'development'].includes(expectedMode)) invalid();
    const bytes = await readFixedMember(resourcesRoot, filename, 65536);
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) invalid();
    const identity = readProductSdkIdentityModule(text);
    if (identity.mode !== expectedMode || canonical(identity.target) !== canonical(expected.target) ||
      canonical(identity.applicationBuild) !== canonical(expected.applicationBuild)) invalid();
    return identity;
  } catch { invalid(); }
}

/** expectedWorker is source-generation build data; null requires structural absence. */
export async function verifyPackagedProductSdkStageWorker({ resourcesRoot, expectedWorker }) {
  try {
    let expected = null;
    if (expectedWorker !== null) {
      const fields = Object.getOwnPropertyDescriptors(expectedWorker);
      const keys = ['format', 'file', 'bytes', 'sha256', 'compositionSha256'];
      if (Reflect.ownKeys(fields).length !== keys.length || keys.some(key => !fields[key]?.enumerable || !Object.hasOwn(fields[key], 'value'))) invalid();
      expected = Object.fromEntries(keys.map(key => [key, fields[key].value]));
      if (expected.format !== 'cjs' || expected.file !== 'worker.cjs' || !Number.isSafeInteger(expected.bytes) || expected.bytes < 1 || expected.bytes > 16 * 1024 * 1024 ||
        ![expected.sha256, expected.compositionSha256].every(value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value))) invalid();
    }
    const bytes = await readFixedMember(resourcesRoot, 'electron/generated/plugin-sdk/worker.cjs', 16 * 1024 * 1024, expected === null);
    if (expected === null) { if (bytes !== null) invalid(); return Object.freeze({ status: 'absent' }); }
    if (bytes.length !== expected.bytes || createHash('sha256').update(bytes).digest('hex') !== expected.sha256) invalid();
    return Object.freeze({ status: 'verified', ...expected });
  } catch { invalid(); }
}
