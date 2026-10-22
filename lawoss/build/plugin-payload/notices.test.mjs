import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import * as notices from './notices.mjs';
import { inventory, SDK_LOCK_SHA256 } from './validate.mjs';

async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'lawoss-sdk-notices-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

test('published supplemental notices bind nine accepted artifacts and retain their original source bytes', async t => {
  const root = await fixture(t);
  await notices.writeSupplementalNotices(root);
  const records = await inventory(root);
  assert.equal(records.length, 5);
  notices.assertSupplementalNotices(records);
  const index = JSON.parse(await readFile(path.join(root, 'third-party-notices/index.json')));
  const lock = JSON.parse(await readFile(new URL('./sdk/package-lock.json', import.meta.url)));
  assert.equal(index.lockSha256, SDK_LOCK_SHA256);
  assert.equal(index.packages.length, 9);
  assert.equal(new Set(index.packages.map(pkg => pkg.name)).size, 9);
  for (const pkg of index.packages) {
    const accepted = lock.packages[`node_modules/${pkg.name}`];
    for (const key of ['version', 'integrity', 'resolved']) assert.equal(pkg[key], accepted[key]);
    const source = await readFile(new URL(`./sdk/notices/${pkg.noticeFile}`, import.meta.url));
    assert.deepEqual(await readFile(path.join(root, 'third-party-notices', pkg.noticeFile)), source);
  }
  const windows = index.packages.find(pkg => pkg.name.endsWith('extract-win32-x64'));
  assert.equal(windows.sourceRevision, 'd735f3057015d3f67747e0dfbb22adf01abfe5fb');
  for (const pkg of index.packages.filter(pkg => pkg.name.startsWith('@msgpackr-extract/') && pkg !== windows)) {
    assert.equal(pkg.sourceRevision, '71def7bd969e5c88d2c918e0d81ee2ba3155d19c');
  }
});

test('actual missing or altered license and index bytes refuse notice admission', async t => {
  const root = await fixture(t);
  await notices.writeSupplementalNotices(root);
  for (const name of ['licenses/opencode-MIT.txt', 'index.json']) {
    const file = path.join(root, 'third-party-notices', name), original = await readFile(file);
    await writeFile(file, 'altered notice bytes');
    assert.throws(() => notices.assertSupplementalNotices([]), { code: 'NOTICES_INVALID' });
    const changed = await inventory(root);
    assert.throws(() => notices.assertSupplementalNotices(changed), { code: 'NOTICES_INVALID' });
    await rm(file);
    const absent = await inventory(root);
    assert.throws(() => notices.assertSupplementalNotices(absent), { code: 'NOTICES_INVALID' });
    await writeFile(file, original);
  }
});

test('additional notice files, executable substitutions and link records refuse the fixed notice set', async t => {
  const root = await fixture(t);
  await notices.writeSupplementalNotices(root);
  const original = await inventory(root);
  for (const mutate of [
    records => { records[0].executable = true; },
    records => { records[0] = { path: records[0].path, link: '../package.json' }; },
  ]) {
    const changed = structuredClone(original); mutate(changed);
    assert.throws(() => notices.assertSupplementalNotices(changed), { code: 'NOTICES_INVALID' });
  }
  await writeFile(path.join(root, 'third-party-notices/unreviewed.txt'), 'unexpected');
  const extra = await inventory(root);
  assert.throws(() => notices.assertSupplementalNotices(extra), { code: 'NOTICES_INVALID' });
});

test('notice publication refuses an existing destination and preserves its contents', async t => {
  const root = await fixture(t), directory = path.join(root, 'third-party-notices');
  await mkdir(directory);
  await writeFile(path.join(directory, 'sentinel.txt'), 'existing data');
  await assert.rejects(notices.writeSupplementalNotices(root), { code: 'NOTICES_INVALID' });
  assert.deepEqual((await inventory(root)).map(record => record.path), ['third-party-notices/sentinel.txt']);
  assert.equal(await readFile(path.join(directory, 'sentinel.txt'), 'utf8'), 'existing data');
});
