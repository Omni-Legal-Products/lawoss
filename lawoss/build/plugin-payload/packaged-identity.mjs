// Static build gate: read the private SDK module from actual packed app code.
// No resource JavaScript or application module is evaluated by this reader.
import { lstat, open, realpath } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { canonical } from './validate.mjs';
import { createProductSdkIdentityModule, readProductSdkIdentityModule } from './product-identity.mjs';

const invalid = () => { throw Object.assign(new Error('PACKAGED_SDK_IDENTITY_INVALID'), { code: 'PACKAGED_SDK_IDENTITY_INVALID' }); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino && a.size === b.size && a.mtimeMs === b.mtimeMs;
const filename = 'electron/generated/plugin-sdk/identity.mjs';

export async function readPackagedProductSdkIdentity({ resourcesRoot, target, expectedMode, applicationBuild }) {
  try {
    // Snapshot expected caller data with the same bounded format admission.
    const expected = readProductSdkIdentityModule(createProductSdkIdentityModule({ schema: 1,
      kind: 'lawoss-product-sdk-packaging', mode: 'without-sdk', applicationBuild, target, sdk: null }));
    if (!['sdk', 'without-sdk'].includes(expectedMode) || typeof resourcesRoot !== 'string' || resourcesRoot.length > 4096 ||
      !path.isAbsolute(resourcesRoot) || path.resolve(resourcesRoot) !== resourcesRoot) invalid();
    const root = await lstat(resourcesRoot);
    if (!root.isDirectory() || root.isSymbolicLink() || await realpath(resourcesRoot) !== resourcesRoot) invalid();
    const archive = path.join(resourcesRoot, 'app.asar'), before = await lstat(archive);
    if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 16 || before.size > 1024 * 1024 * 1024) invalid();
    const handle = await open(archive, 'r');
    let headerSize;
    try {
      if (!same(before, await handle.stat())) invalid();
      const header = Buffer.alloc(8);
      if ((await handle.read(header, 0, 8, 0)).bytesRead !== 8 || header.readUInt32LE(0) !== 4) invalid();
      headerSize = header.readUInt32LE(4);
      // Bound allocation in the pinned asar parser before it reads its header.
      if (headerSize < 8 || headerSize > 16 * 1024 * 1024 || headerSize > before.size - 8) invalid();
    } finally { await handle.close(); }
    const require = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
    const builder = createRequire(createRequire(require.resolve('electron-builder')).resolve('app-builder-lib'));
    if (builder('@electron/asar/package.json').version !== '3.4.1') invalid();
    const asar = builder('@electron/asar');
    let bytes;
    asar.uncache(archive);
    try {
      const raw = asar.getRawHeader(archive);
      if (raw.headerSize !== headerSize) invalid();
      let node = raw.header;
      for (const part of filename.split('/')) {
        if (!node || typeof node !== 'object' || node.link || node.unpacked || !node.files ||
          Array.isArray(node.files) || !Object.hasOwn(node.files, part)) invalid();
        node = node.files[part];
      }
      if (!node || typeof node !== 'object' || Object.hasOwn(node, 'link') || Object.hasOwn(node, 'files') || node.unpacked ||
        !Number.isSafeInteger(node.size) || node.size < 1 || node.size > 65536 || typeof node.offset !== 'string' ||
        !/^(?:0|[1-9]\d{0,15})$/.test(node.offset)) invalid();
      const offset = Number(node.offset);
      if (!Number.isSafeInteger(offset) || offset + node.size > before.size - 8 - headerSize) invalid();
      bytes = asar.extractFile(archive, filename, false);
      if (bytes.length !== node.size) invalid();
    } finally { asar.uncache(archive); }
    const text = bytes.toString('utf8');
    if (!Buffer.from(text, 'utf8').equals(bytes)) invalid();
    const identity = readProductSdkIdentityModule(text);
    if (identity.mode !== expectedMode || canonical(identity.target) !== canonical(expected.target) ||
      canonical(identity.applicationBuild) !== canonical(expected.applicationBuild)) invalid();
    if (!same(before, await lstat(archive))) invalid();
    const afterRoot = await lstat(resourcesRoot);
    if (afterRoot.dev !== root.dev || afterRoot.ino !== root.ino || !afterRoot.isDirectory() || afterRoot.isSymbolicLink() ||
      await realpath(resourcesRoot) !== resourcesRoot) invalid();
    return identity;
  } catch { invalid(); }
}
