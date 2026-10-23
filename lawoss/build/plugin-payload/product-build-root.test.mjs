import test from 'node:test';
import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { chmodSync, unlinkSync, writeFileSync } from 'node:fs';
import { chmod, lstat, mkdir, mkdtemp, readFile, readdir, realpath, rm, writeFile, symlink, link, rename } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import { initialize, verifyWorkspace } from './prepare.mjs';
import { freshProductSdkBuildRoot, completeProductSdkBuildRoot } from './product-build-root.mjs';
import * as buildRoot from './product-build-root.mjs';

async function fixture(t) {
  const parent = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-sdk-generation-')));
  t.after(() => rm(parent, { recursive: true, force: true }));
  await chmod(parent, 0o755);
  return { parent, root: path.join(parent, '.plugin-sdk-build') };
}
const invalid = { code: 'PRODUCT_SDK_BUILD_ROOT_INVALID' };
const hash = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

test('fresh build generations hold a lease until completion and archive the exact previous owned root', async t => {
  const f = await fixture(t), parentMode = (await lstat(f.parent)).mode;
  const first = await freshProductSdkBuildRoot(f.root);
  assert.equal(first.root, f.root);
  assert.equal(first.archivedPrevious, null);
  assert.equal(Object.isFrozen(first), true);
  assert.equal(Object.isFrozen(first.identity), true);
  await verifyWorkspace(f.root);
  const before = await lstat(f.root);
  assert.equal(first.identity.dev, before.dev);
  assert.equal(first.identity.ino, before.ino);
  const owner = await readFile(path.join(f.root, '.owner.json'));
  await writeFile(path.join(f.root, 'prior-resource'), 'preserve every previous byte');
  const sentinel = hash(await readFile(path.join(f.root, 'prior-resource')));
  await assert.rejects(freshProductSdkBuildRoot(f.root), { code: 'EEXIST' });
  await completeProductSdkBuildRoot(first);
  const second = await freshProductSdkBuildRoot(f.root);
  try {
    assert.equal(path.dirname(second.archivedPrevious), f.parent);
    assert.equal(path.basename(second.archivedPrevious).startsWith('..plugin-sdk-build.previous-'), true);
    assert.equal((await lstat(second.archivedPrevious)).ino, before.ino);
    assert.equal((await lstat(second.archivedPrevious)).dev, before.dev);
    assert.deepEqual(await readFile(path.join(second.archivedPrevious, '.owner.json')), owner);
    assert.equal(hash(await readFile(path.join(second.archivedPrevious, 'prior-resource'))), sentinel);
    await verifyWorkspace(second.archivedPrevious);
    await verifyWorkspace(f.root);
    assert.notEqual(second.identity.ino, first.identity.ino);
    assert.equal((await lstat(f.parent)).mode, parentMode, 'shared resources-parent permissions stay unchanged');
    await assert.rejects(readFile(path.join(f.root, 'prior-resource')), { code: 'ENOENT' });
  } finally { await completeProductSdkBuildRoot(second); }
});

test('unowned, mismatched and hardlinked owner roots are refused without adopting prior data', async t => {
  for (const kind of ['unowned', 'mismatch', 'hardlinked-marker']) await t.test(kind, async t => {
    const f = await fixture(t);
    if (kind === 'unowned') await mkdir(f.root); else await initialize(f.root);
    await writeFile(path.join(f.root, 'sentinel'), 'prior arbitrary bytes');
    if (kind === 'mismatch') {
      const file = path.join(f.root, '.owner.json'), value = JSON.parse(await readFile(file)); value.ino++;
      await writeFile(file, JSON.stringify(value));
    }
    if (kind === 'hardlinked-marker') await link(path.join(f.root, '.owner.json'), path.join(f.root, 'extra-owner-link'));
    const before = await readdir(f.root), physical = await lstat(f.root);
    await assert.rejects(freshProductSdkBuildRoot(f.root), { code: 'WORKSPACE_INVALID' });
    assert.deepEqual(await readdir(f.root), before);
    assert.equal((await lstat(f.root)).ino, physical.ino);
    assert.equal(await readFile(path.join(f.root, 'sentinel'), 'utf8'), 'prior arbitrary bytes');
    assert.deepEqual(await readdir(f.parent), ['.plugin-sdk-build']);
  });
});

test('known SDK producer/publication admissions and uncertain stages prevent rotation', async t => {
  for (const relative of ['.admit-custom', '.admissions', '.stage-interrupted',
    'supplier/runtime-consumer-validation/.admit-primer', 'runtime-consumer-validation/.admit-payload',
    'publication/.lawoss-plugin-sdk-publication.lock', 'publication/.plugin-sdk-stage-interrupted']) await t.test(relative, async t => {
    const f = await fixture(t); await initialize(f.root);
    const admission = path.join(f.root, relative); await mkdir(path.dirname(admission), { recursive: true });
    await writeFile(admission, 'preserve active or uncertain owner');
    const before = await lstat(f.root);
    await assert.rejects(freshProductSdkBuildRoot(f.root), invalid);
    assert.equal((await lstat(f.root)).ino, before.ino);
    assert.equal(await readFile(admission, 'utf8'), 'preserve active or uncertain owner');
    assert.deepEqual(await readdir(f.parent), ['.plugin-sdk-build']);
  });
});

test('completion is an exact capability and cannot unlock an active producer or be replayed', async t => {
  const f = await fixture(t), generation = await freshProductSdkBuildRoot(f.root);
  await assert.rejects(completeProductSdkBuildRoot({ ...generation }), invalid);
  await writeFile(path.join(f.root, '.admit-active'), 'active producer');
  await assert.rejects(completeProductSdkBuildRoot(generation), invalid);
  await assert.rejects(freshProductSdkBuildRoot(f.root), { code: 'EEXIST' });
  assert.equal(await readFile(path.join(f.root, '.admit-active'), 'utf8'), 'active producer');
  await assert.rejects(completeProductSdkBuildRoot(generation), invalid);
  const other = await fixture(t), completed = await freshProductSdkBuildRoot(other.root);
  await completeProductSdkBuildRoot(completed);
  await assert.rejects(completeProductSdkBuildRoot(completed), invalid);
});

test('a pre-existing unknown outer lease is untouched and no root is created', async t => {
  const f = await fixture(t), lease = path.join(f.parent, '..plugin-sdk-build.generation.lock');
  await writeFile(lease, 'unknown generation owner', { flag: 'wx' });
  await assert.rejects(freshProductSdkBuildRoot(f.root), { code: 'EEXIST' });
  assert.equal(await readFile(lease, 'utf8'), 'unknown generation owner');
  assert.deepEqual(await readdir(f.parent), ['..plugin-sdk-build.generation.lock']);
});

test('archive-name collision preserves the previous root and collision bytes', async t => {
  const f = await fixture(t); await initialize(f.root);
  const uuid = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
  const archive = path.join(f.parent, `..plugin-sdk-build.previous-${uuid}`);
  await mkdir(archive); await writeFile(path.join(archive, 'sentinel'), 'do not overwrite archive');
  const before = await lstat(f.root), owner = await readFile(path.join(f.root, '.owner.json'));
  t.mock.method(crypto, 'randomUUID', () => uuid);
  await assert.rejects(freshProductSdkBuildRoot(f.root), invalid);
  assert.equal((await lstat(f.root)).ino, before.ino);
  assert.deepEqual(await readFile(path.join(f.root, '.owner.json')), owner);
  assert.equal(await readFile(path.join(archive, 'sentinel'), 'utf8'), 'do not overwrite archive');
  assert.deepEqual((await readdir(f.parent)).sort(), [path.basename(archive), '.plugin-sdk-build'].sort());
});

test('a collision plus replaced lease preserves the exact primary and cleanup error separately', async t => {
  const f = await fixture(t); await initialize(f.root);
  const uuid = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', lease = path.join(f.parent, '..plugin-sdk-build.generation.lock');
  const archive = path.join(f.parent, `..plugin-sdk-build.previous-${uuid}`);
  await mkdir(archive); await writeFile(path.join(archive, 'sentinel'), 'prior archive');
  t.mock.method(crypto, 'randomUUID', () => { unlinkSync(lease); writeFileSync(lease, 'replaced lease', { flag: 'wx' }); return uuid; });
  await assert.rejects(freshProductSdkBuildRoot(f.root), error => {
    assert.equal(error instanceof AggregateError, true);
    assert.equal(error.errors.length, 2);
    assert.equal(error.cause, error.errors[0]);
    assert.equal(error.errors[0].code, 'PRODUCT_SDK_BUILD_ROOT_INVALID');
    assert.equal(error.errors[1].code, 'PRODUCT_SDK_BUILD_ROOT_INVALID');
    assert.notEqual(error.errors[0], error.errors[1]);
    return true;
  });
  assert.equal(await readFile(lease, 'utf8'), 'replaced lease');
  assert.equal(await readFile(path.join(archive, 'sentinel'), 'utf8'), 'prior archive');
  await verifyWorkspace(f.root);
});

test('noncanonical paths and POSIX symbolic aliases are refused without outside mutation', async t => {
  const f = await fixture(t);
  await assert.rejects(freshProductSdkBuildRoot('relative'), invalid);
  await assert.rejects(freshProductSdkBuildRoot(`${f.parent}${path.sep}child${path.sep}..${path.sep}.plugin-sdk-build`), invalid);
  await assert.rejects(freshProductSdkBuildRoot(path.parse(f.parent).root), invalid);
  await t.test('physical root and parent paths cannot be symbolic aliases', {
    skip: process.platform === 'win32' ? 'Creating file symlinks requires Windows privilege; canonical regular-directory cases still run' : false,
  }, async () => {
    const outside = await fixture(t); await initialize(outside.root);
    await symlink(outside.root, f.root, 'dir');
    const owner = await readFile(path.join(outside.root, '.owner.json'));
    await assert.rejects(freshProductSdkBuildRoot(f.root), { code: 'WORKSPACE_INVALID' });
    assert.deepEqual(await readFile(path.join(outside.root, '.owner.json')), owner);
    const alias = `${f.parent}-alias`; await symlink(f.parent, alias, 'dir'); t.after(() => rm(alias, { force: true }));
    await assert.rejects(freshProductSdkBuildRoot(path.join(alias, 'other')), invalid);
    assert.deepEqual(await readdir(f.parent), ['.plugin-sdk-build']);
  });
});

test('a real permission-denied rename retains prior data and the uncertain generation marker', {
  skip: process.platform === 'win32' || process.getuid?.() === 0 ? 'Real POSIX EACCES requires an ordinary non-root user' : false,
}, async t => {
  const f = await fixture(t); await initialize(f.root);
  const owner = await readFile(path.join(f.root, '.owner.json'));
  t.mock.method(crypto, 'randomUUID', () => { chmodSync(f.parent, 0o500); return 'cccccccc-cccc-4ccc-8ccc-cccccccccccc'; });
  try { await assert.rejects(freshProductSdkBuildRoot(f.root), { code: 'EACCES' }); }
  finally { await chmod(f.parent, 0o755); }
  assert.deepEqual(await readFile(path.join(f.root, '.owner.json')), owner);
  assert.deepEqual((await readdir(f.parent)).sort(), ['..plugin-sdk-build.generation.lock', '.plugin-sdk-build'].sort());
  await assert.rejects(freshProductSdkBuildRoot(f.root), { code: 'EEXIST' });
});

test('case variants of known admissions remain conservative on case-insensitive filesystems', async t => {
  const f = await fixture(t); await initialize(f.root);
  const file = path.join(f.root, '.ADMIT-primer'); await writeFile(file, 'preserve case-variant admission');
  let escaped;
  try {
    await assert.rejects(async () => { escaped = await freshProductSdkBuildRoot(f.root); }, invalid);
    assert.equal(await readFile(file, 'utf8'), 'preserve case-variant admission');
    assert.deepEqual(await readdir(f.parent), ['.plugin-sdk-build']);
  } finally { if (escaped) await completeProductSdkBuildRoot(escaped); }
});

test('a previously owned POSIX SDK root with exposed permissions is refused without repair', {
  skip: process.platform === 'win32' ? 'POSIX mode bits are not Windows ACL ownership proof' : false,
}, async t => {
  const f = await fixture(t); await initialize(f.root); await chmod(f.root, 0o777);
  let escaped;
  try {
    await assert.rejects(async () => { escaped = await freshProductSdkBuildRoot(f.root); }, invalid);
    assert.equal((await lstat(f.root)).mode & 0o777, 0o777);
    assert.deepEqual(await readdir(f.parent), ['.plugin-sdk-build']);
  } finally { if (escaped) await completeProductSdkBuildRoot(escaped); }
});

test('completion of a substituted generation root leaves both roots and its unresolved lease intact', async t => {
  const f = await fixture(t), generation = await freshProductSdkBuildRoot(f.root);
  const previous = `${f.root}-moved`; await rename(f.root, previous); await initialize(f.root);
  const originalOwner = await readFile(path.join(previous, '.owner.json'));
  const replacementOwner = await readFile(path.join(f.root, '.owner.json'));
  await assert.rejects(completeProductSdkBuildRoot(generation), invalid);
  assert.deepEqual(await readFile(path.join(previous, '.owner.json')), originalOwner);
  assert.deepEqual(await readFile(path.join(f.root, '.owner.json')), replacementOwner);
  await assert.rejects(freshProductSdkBuildRoot(f.root), { code: 'EEXIST' });
});

test('retaining a failed generation closes its capability while preserving the exact unresolved lease and root', async t => {
  const f = await fixture(t), generation = await freshProductSdkBuildRoot(f.root);
  const lease = path.join(f.parent, '..plugin-sdk-build.generation.lock');
  const before = await lstat(lease), owner = await readFile(path.join(f.root, '.owner.json'));
  await writeFile(path.join(f.root, 'failed-evidence'), 'preserve failed producer evidence');
  await assert.rejects(buildRoot.retainFailedProductSdkBuildRoot({ ...generation }), invalid);
  await buildRoot.retainFailedProductSdkBuildRoot(generation);
  assert.equal((await lstat(lease)).ino, before.ino);
  assert.deepEqual(await readFile(path.join(f.root, '.owner.json')), owner);
  assert.equal(await readFile(path.join(f.root, 'failed-evidence'), 'utf8'), 'preserve failed producer evidence');
  await assert.rejects(buildRoot.retainFailedProductSdkBuildRoot(generation), invalid);
  await assert.rejects(completeProductSdkBuildRoot(generation), invalid);
  await assert.rejects(freshProductSdkBuildRoot(f.root), { code: 'EEXIST' });
});

test('a retained capsule-verification admission prevents rotation of the build generation', async t => {
  const f = await fixture(t); await initialize(f.root);
  const verification = path.join(f.root, 'verification'); await initialize(verification);
  const admission = path.join(verification, '.admit-payload'); await mkdir(admission);
  const before = await lstat(f.root), marker = await lstat(admission);
  let escaped;
  try {
    await assert.rejects(async () => { escaped = await freshProductSdkBuildRoot(f.root); }, invalid);
    assert.equal((await lstat(f.root)).ino, before.ino);
    assert.equal((await lstat(admission)).ino, marker.ino);
  } finally { if (escaped) await completeProductSdkBuildRoot(escaped); }
});
