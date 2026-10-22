import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { renameSync, symlinkSync } from 'node:fs';
import { createProductSdkIdentityModule } from './product-identity.mjs';
import { readPackagedProductSdkIdentity } from './packaged-identity.mjs';
const r = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const builder = createRequire(createRequire(r.resolve('electron-builder')).resolve('app-builder-lib'));
const asar = builder('@electron/asar');
const code = { code: 'PACKAGED_SDK_IDENTITY_INVALID' };
const filename = 'electron/generated/plugin-sdk/identity.mjs';
function identity() {
 return { schema: 1, kind: 'lawoss-product-sdk-packaging', mode: 'without-sdk', sdk: null, target: { platform: 'darwin', arch: 'arm64' },
 applicationBuild: { schemaVersion: 1, product: 'lawoss-desktop', version: '0.0.0', gitSha: 'b'.repeat(40), buildEpoch: '1792663200', platform: 'darwin', arch: 'arm64', channel: 'stable', workflowRunUrl: '' } };
}
async function fixture(t, text, options) {
 const root = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-asar-sdk-')));
 t.after(() => rm(root, { recursive: true, force: true }));
 const source = path.join(root, 'application-code'), resourcesRoot = path.join(root, 'Resources');
 await mkdir(path.join(source, path.dirname(filename)), { recursive: true }); await mkdir(resourcesRoot);
 const input = identity();
 await writeFile(path.join(source, filename), text ?? createProductSdkIdentityModule(input));
 await asar.createPackageWithOptions(source, path.join(resourcesRoot, 'app.asar'), options ?? {});
 return { source, resourcesRoot, target: input.target, applicationBuild: input.applicationBuild, expectedMode: 'without-sdk', input };
}
test('actual asar private identity is read as frozen data and matched to the expected build', async t => {
 const f = await fixture(t);
 assert.deepEqual(await readPackagedProductSdkIdentity(f), f.input);
 assert.equal(Object.isFrozen(await readPackagedProductSdkIdentity(f)), true);
 await assert.rejects(readPackagedProductSdkIdentity({ ...f, applicationBuild: { ...f.applicationBuild, gitSha: 'c'.repeat(40) } }), code);
 await assert.rejects(readPackagedProductSdkIdentity({ ...f, target: { platform: 'darwin', arch: 'x64' } }), code);
 await assert.rejects(readPackagedProductSdkIdentity({ ...f, expectedMode: 'sdk' }), code);
});
test('executable identity text inside actual asar is refused without evaluation', async t => {
 const f = await fixture(t, createProductSdkIdentityModule(identity()) + '\nglobalThis.SDK_ASAR_EXECUTED=true;');
 await assert.rejects(readPackagedProductSdkIdentity(f), code);
 assert.equal(globalThis.SDK_ASAR_EXECUTED, undefined);
});
test('unpacked identity is refused even when the external bytes match the generated module', async t => {
 const f = await fixture(t, undefined, { unpack: 'identity.mjs' });
 assert.equal(asar.statFile(path.join(f.resourcesRoot, 'app.asar'), filename).unpacked, true);
 await assert.rejects(readPackagedProductSdkIdentity(f), code);
});
test('changing the asar at the same path cannot reuse a cached private identity', async t => {
 const f = await fixture(t);
 await readPackagedProductSdkIdentity(f);
 const replacement = identity(); replacement.applicationBuild.gitSha = 'c'.repeat(40);
 await writeFile(path.join(f.source, filename), createProductSdkIdentityModule(replacement));
 await asar.createPackage(f.source, path.join(f.resourcesRoot, 'next.asar'));
 const { rename } = await import('node:fs/promises');
 await rename(path.join(f.resourcesRoot, 'next.asar'), path.join(f.resourcesRoot, 'app.asar'));
 await assert.rejects(readPackagedProductSdkIdentity(f), code);
});
test('oversized and truncated asar header declarations refuse before extraction', async t => {
 const f = await fixture(t);
 for (const headerSize of [0, 0xffffffff, 16 * 1024 * 1024 + 1]) {
  const header = Buffer.alloc(16); header.writeUInt32LE(4); header.writeUInt32LE(headerSize, 4);
  await writeFile(path.join(f.resourcesRoot, 'app.asar'), header);
  await assert.rejects(readPackagedProductSdkIdentity(f), code);
 }
});
test('symbolic archive and aliased resource roots are refused', { skip: process.platform === 'win32' ? 'POSIX symlink privilege fixture' : false }, async t => {
 const f = await fixture(t);
 const archive = path.join(f.resourcesRoot, 'app.asar'), original = await readFile(archive);
 await rm(archive); await writeFile(path.join(f.resourcesRoot, 'actual.asar'), original);
 await symlink('actual.asar', archive);
 await assert.rejects(readPackagedProductSdkIdentity(f), code);
 const alias = path.join(f.resourcesRoot, '..', 'alias'); await symlink(f.resourcesRoot, alias);
 await assert.rejects(readPackagedProductSdkIdentity({ ...f, resourcesRoot: alias }), code);
});

test('an ancestor replaced by a same-inode symlink during asar reading refuses physical postflight', { skip: process.platform === 'win32' ? 'POSIX symlink privilege fixture' : false }, async t => {
 const f = await fixture(t), root = path.dirname(f.resourcesRoot), moved = root + '-moved';
 t.after(() => rm(moved, { recursive: true, force: true }));
 const original = asar.extractFile;
 let replacements = 0;
 asar.extractFile = (...args) => {
  const bytes = original(...args);
  if (args[0] === path.join(f.resourcesRoot, 'app.asar')) {
   renameSync(root, moved); symlinkSync(moved, root); replacements++;
  }
  return bytes;
 };
 try { await assert.rejects(readPackagedProductSdkIdentity(f), code); }
 finally { asar.extractFile = original; }
 assert.equal(replacements, 1);
});
