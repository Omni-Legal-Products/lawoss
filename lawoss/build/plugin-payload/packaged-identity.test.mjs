import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdtemp, mkdir, readFile, writeFile, rm, realpath, symlink, rename, stat } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { renameSync, symlinkSync } from 'node:fs';
import { createProductSdkIdentityModule } from './product-identity.mjs';
import { readPackagedProductSdkIdentity } from './packaged-identity.mjs';
const r = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const builder = createRequire(createRequire(r.resolve('electron-builder')).resolve('app-builder-lib'));
const asar = builder('@electron/asar');
const asarPackage = createRequire(builder.resolve('@electron/asar/package.json'));
const asarFs = asarPackage('./lib/wrapped-fs').default;
const code = { code: 'PACKAGED_SDK_IDENTITY_INVALID' };
const filename = 'electron/generated/plugin-sdk/identity.mjs';
function identity() {
 return { schema: 1, kind: 'lawoss-product-sdk-packaging', mode: 'without-sdk', sdk: null, target: { platform: 'darwin', arch: 'arm64' },
 applicationBuild: { schemaVersion: 1, product: 'lawoss-desktop', version: '0.0.0', gitSha: 'b'.repeat(40), buildEpoch: '1792663200', platform: 'darwin', arch: 'arm64', channel: 'stable', workflowRunUrl: '' } };
}
async function fixture(t, text, options, archiveGate) {
 const root = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-asar-sdk-')));
 t.after(() => rm(root, { recursive: true, force: true }));
 const source = path.join(root, 'application-code'), resourcesRoot = path.join(root, 'Resources');
 await mkdir(path.join(source, path.dirname(filename)), { recursive: true }); await mkdir(resourcesRoot);
 const input = identity();
 await writeFile(path.join(source, filename), text ?? createProductSdkIdentityModule(input));
 const archive = path.join(resourcesRoot, 'app.asar');
 await createAsarAndWaitForClose(source, archive, options ?? {}, archiveGate);
 return { source, resourcesRoot, target: input.target, applicationBuild: input.applicationBuild, expectedMode: 'without-sdk', input };
}
async function replaceArchiveFromSource(source, resourcesRoot, gate) {
 const nextArchive = path.join(resourcesRoot, 'next.asar');
 await createAsarAndWaitForClose(source, nextArchive, {}, gate);
 await rename(nextArchive, path.join(resourcesRoot, 'app.asar'));
}
function deferred() {
 let resolve;
 const promise = new Promise(r => { resolve = r; });
 return { promise, resolve };
}
async function createAsarAndWaitForClose(source, destination, options, gate) {
 // Top-level node:test cases are serial; the pinned wrapper descriptor is held only for this exact destination.
 const descriptor = Object.getOwnPropertyDescriptor(asarFs, 'createWriteStream');
 const original = descriptor.value;
 let writer, closed = false, writerError, endDescriptor;
 let resolveClosed;
 const closedEvent = new Promise(resolve => { resolveClosed = resolve; });
 let resolveWriterFailure;
 const writerFailure = new Promise(resolve => { resolveWriterFailure = resolve; });
 const captureWriterError = error => {
  if (!writerError) { writerError = error; resolveWriterFailure(error); }
 };
 let restoreError;
 let creatorError;
 let completion;
 const restore = () => {
  try { Object.defineProperty(asarFs, 'createWriteStream', descriptor); }
  catch (error) { restoreError = error; }
 };
 Object.defineProperty(asarFs, 'createWriteStream', { ...descriptor, value: function(file, ...args) {
  const stream = Reflect.apply(original, this, [file, ...args]);
  if (file !== destination) return stream;
  writer = stream;
  if (gate) { gate.writer = stream; gate.writerClosed = false; }
  stream.on('error', captureWriterError);
  stream.once('close', () => {
   closed = true;
   stream.off('error', captureWriterError);
   if (gate) gate.writerClosed = true;
   if (endDescriptor) Object.defineProperty(stream, 'end', endDescriptor);
   else delete stream.end;
   resolveClosed({ error: writerError });
  });
  if (gate?.release) {
   endDescriptor = Object.getOwnPropertyDescriptor(stream, 'end');
   const end = stream.end;
   stream.end = function(...endArgs) {
    gate.endRequested.resolve();
    gate.release.promise.then(() => {
     try {
      if (gate.failOnEnd) stream.destroy(gate.failOnEnd);
      else end.apply(stream, endArgs);
     }
     catch (error) { captureWriterError(error); stream.destroy(error); }
    });
    return stream;
   };
  }
  return stream;
 } });
 try {
  const creatorDone = Promise.resolve().then(() => asar.createPackageWithOptions(source, destination, options))
   .then(value => ({ value }), error => ({ error }));
  const first = await Promise.race([
   creatorDone.then(result => ({ kind: 'creator', ...result })),
   writerFailure.then(error => ({ kind: 'writer', error }))
  ]);
  if (first.error) creatorError = first.error;
  if (first.kind === 'writer' || first.error) {
   if (writer && !closed) writer.destroy();
  }
  if (writer) {
   completion = await closedEvent;
  }
 } finally {
  // The descriptor is restored only after an observed writer has settled.
  restore();
 }
 if (creatorError) throw creatorError;
 if (!writer) throw new Error(`Pinned ASAR did not create the expected archive writer: ${destination}`);
 if (completion.error) throw completion.error;
 if (restoreError) throw restoreError;
}
test('fixture does not return an archive while its actual writer is unfinished', async t => {
 const gate = { endRequested: deferred(), release: deferred() };
 let fixtureReturned = false;
 const fixturePromise = fixture(t, undefined, undefined, gate);
 const fixtureOutcome = fixturePromise.then(value => { fixtureReturned = true; return { value }; }, error => ({ error }));
 try {
  const started = await Promise.race([
   gate.endRequested.promise.then(() => ({ kind: 'writer' })),
   fixtureOutcome.then(outcome => ({ kind: 'fixture', ...outcome }))
  ]);
  assert.equal(started.kind, 'writer', 'fixture failed or returned without creating its archive writer');
  assert.equal(fixtureReturned, false, 'fixture returned before the pinned ASAR writer emitted close');
  assert.equal(gate.writerClosed, false);
 } finally {
  gate.release.resolve();
  await fixturePromise;
 }
 assert.equal(gate.writerClosed, true);
 const f = await fixturePromise;
 assert.deepEqual(await readPackagedProductSdkIdentity(f), f.input);
 const replacement = identity(); replacement.applicationBuild.gitSha = 'c'.repeat(40);
 await writeFile(path.join(f.source, filename), createProductSdkIdentityModule(replacement));
 const replacementGate = { endRequested: deferred(), release: deferred() };
 let replaced = false;
 const replacementPromise = replaceArchiveFromSource(f.source, f.resourcesRoot, replacementGate).then(() => { replaced = true; });
 try {
  const started = await Promise.race([
   replacementGate.endRequested.promise.then(() => ({ kind: 'writer' })),
   replacementPromise.then(() => ({ kind: 'replaced' }), error => ({ kind: 'error', error }))
  ]);
  assert.equal(started.kind, 'writer', 'replacement failed or completed without its archive writer');
  assert.equal(replaced, false, 'replacement archive was renamed before its writer emitted close');
  assert.equal(replacementGate.writerClosed, false);
  assert.deepEqual(await readPackagedProductSdkIdentity(f), f.input);
  assert.ok((await stat(path.join(f.resourcesRoot, 'app.asar'))).isFile());
 } finally {
  replacementGate.release.resolve();
  await replacementPromise;
 }
 assert.equal(replacementGate.writerClosed, true);
 await assert.rejects(readPackagedProductSdkIdentity(f), code);
 assert.equal(fixtureReturned, true);
});
test('writer error settles before restoring the exact pinned ASAR descriptor', async t => {
 const root = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-asar-writer-error-')));
 t.after(() => rm(root, { recursive: true, force: true }));
 const source = path.join(root, 'source');
 await mkdir(path.join(source, path.dirname(filename)), { recursive: true });
 await writeFile(path.join(source, filename), createProductSdkIdentityModule(identity()));
 const destination = path.join(root, 'app.asar');
 const descriptor = Object.getOwnPropertyDescriptor(asarFs, 'createWriteStream');
 const failure = Object.assign(new Error('controlled ASAR writer failure'), { code: 'EWRITER' });
 const gate = { endRequested: deferred(), release: deferred(), failOnEnd: failure };
 const creation = createAsarAndWaitForClose(source, destination, {}, gate);
 await gate.endRequested.promise;
 gate.release.resolve();
 await assert.rejects(creation, error => error === failure);
 assert.equal(gate.writerClosed, true);
 assert.deepEqual(Object.getOwnPropertyDescriptor(asarFs, 'createWriteStream'), descriptor);
});
test('creator failure before opening an archive propagates without waiting and restores its descriptor', async t => {
 const root = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-asar-no-writer-')));
 t.after(() => rm(root, { recursive: true, force: true }));
 const failure = new Error('controlled pre-writer creator failure');
 const options = new Proxy({}, { get(_target, property) { if (property === 'globOptions') throw failure; } });
 const descriptor = Object.getOwnPropertyDescriptor(asarFs, 'createWriteStream');
 await assert.rejects(createAsarAndWaitForClose(root, path.join(root, 'app.asar'), options), error => error === failure);
 assert.deepEqual(Object.getOwnPropertyDescriptor(asarFs, 'createWriteStream'), descriptor);
});
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
 assert.equal(asar.statFile(path.join(f.resourcesRoot, 'app.asar'), path.join(...filename.split('/'))).unpacked, true);
 await assert.rejects(readPackagedProductSdkIdentity(f), code);
});
test('changing the asar at the same path cannot reuse a cached private identity', async t => {
 const f = await fixture(t);
 await readPackagedProductSdkIdentity(f);
 const replacement = identity(); replacement.applicationBuild.gitSha = 'c'.repeat(40);
 await writeFile(path.join(f.source, filename), createProductSdkIdentityModule(replacement));
 await replaceArchiveFromSource(f.source, f.resourcesRoot);
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

test('actual asar development null identity requires explicit development expectation', async t => {
 const input = { ...identity(), mode: 'development', applicationBuild: null };
 const f = await fixture(t, createProductSdkIdentityModule(input));
 const development = { ...f, applicationBuild: null, expectedMode: 'development' };
 assert.deepEqual(await readPackagedProductSdkIdentity(development), input);
 for (const expectedMode of ['without-sdk', 'sdk']) await assert.rejects(readPackagedProductSdkIdentity({ ...development, expectedMode }), code);
 await assert.rejects(readPackagedProductSdkIdentity({ ...f, expectedMode: 'development' }), code);
});
