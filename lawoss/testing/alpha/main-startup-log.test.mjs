import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtemp, mkdir, writeFile, readFile, rename, rm, symlink, link } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { prepareAcceptanceProfile } from '../../../apps/desktop/scripts/release-acceptance.mjs';
import { createMainStartupLogDiagnostic } from './main-startup-log.mjs';

const timestamp = '[2026-10-22T00:00:00.000Z] ';
const entry = suffix => `${timestamp}${suffix}\n`;
const slot = (availability, categories = [], scannedBytes = 0, truncated = false) => ({ availability, scannedBytes, truncated, categories });
async function fixture(t) {
  const temporary = await mkdtemp(join(tmpdir(), 'lawoss-main-log-'));
  t.after(() => rm(temporary, { recursive: true, force: true }));
  const profile = await prepareAcceptanceProfile({ root: join(temporary, 'profile'), kind: 'fresh' });
  const logs = join(profile.root, 'userdata/logs');
  await mkdir(logs, { recursive: true });
  return { temporary, profile, logs, current: join(logs, 'main.log'), previous: join(logs, 'main.old.log') };
}

test('owned physical logs expose only exact finite categories and frozen observations', async t => {
  const f = await fixture(t), observer = await createMainStartupLogDiagnostic(f.profile);
  const text = entry('ERROR [main] Uncaught exception: PRIVATE /path token=SECRET')
    + entry('ERROR [main] Unhandled rejection: PRIVATE stack PID1234')
    + entry('WARN [ui-control] failed to start PRIVATE');
  await writeFile(f.current, text);
  const result = await observer.read();
  assert.deepEqual(result, { current: slot('read', ['main-uncaught-exception', 'main-unhandled-rejection', 'ui-control-start-failed'], Buffer.byteLength(text)), previous: slot('missing') });
  assert.doesNotMatch(JSON.stringify(result), /PRIVATE|SECRET|path|token|stack|PID|main\.log/);
  assert.ok(Object.isFrozen(result) && Object.isFrozen(result.current) && Object.isFrozen(result.current.categories));
  assert.throws(() => result.current.categories.push('PRIVATE'));
  await writeFile(f.current, 'changed');
  assert.strictEqual(await observer.read(), result, 'one observation is retained rather than rereading changed logs');
});

test('missing directories/files and empty log remain distinguishable', async t => {
  const f = await fixture(t);
  await rm(join(f.profile.root, 'userdata'), { recursive: true });
  assert.deepEqual(await (await createMainStartupLogDiagnostic(f.profile)).read(), { current: slot('missing'), previous: slot('missing') });
  await mkdir(f.logs, { recursive: true });
  await writeFile(f.current, '');
  assert.deepEqual(await (await createMainStartupLogDiagnostic(f.profile)).read(), { current: slot('empty'), previous: slot('missing') });
});

test('real rotation after binding reads both fixed slots without adopting another filename', async t => {
  const f = await fixture(t), observer = await createMainStartupLogDiagnostic(f.profile);
  const previous = entry('ERROR [main] Unhandled rejection: PRIVATE');
  await writeFile(f.current, previous); await rename(f.current, f.previous);
  const current = entry('WARN [ui-control] failed to start PRIVATE'); await writeFile(f.current, current);
  await writeFile(join(f.logs, 'other.log'), entry('ERROR [main] Uncaught exception: PRIVATE'));
  const result = await observer.read();
  assert.deepEqual(result.current, slot('read', ['ui-control-start-failed'], Buffer.byteLength(current)));
  assert.deepEqual(result.previous, slot('read', ['main-unhandled-rejection'], Buffer.byteLength(previous)));
});

test('large physical log scans one bounded tail and drops a partial leading line', async t => {
  const f = await fixture(t), valid = entry('WARN [ui-control] failed to start PRIVATE');
  const partial = `${timestamp}ERROR [main] Uncaught exception: PRIVATE`;
  const tail = partial + '\n' + 'x'.repeat(65536 - Buffer.byteLength(partial + '\n' + valid)) + valid;
  // Tail starts with a complete-looking spoof cut from a larger physical line.
  await writeFile(f.current, 'PREFIX'.repeat(50000) + tail);
  const result = await (await createMainStartupLogDiagnostic(f.profile)).read();
  assert.deepEqual(result.current, slot('read', ['unknown'], 65536, true), 'both the partial prefix and embedded non-line-start warning are ignored');
  const final = '\n' + valid;
  await writeFile(f.current, 'x'.repeat(2_000_000) + final);
  assert.deepEqual((await (await createMainStartupLogDiagnostic(f.profile)).read()).current, slot('read', ['ui-control-start-failed'], 65536, true));
});

test('wrong levels, timestamps, substring stacks and similar prefixes remain unknown', async t => {
  const f = await fixture(t);
  const text = 'ERROR [main] Uncaught exception: PRIVATE\n'
    + entry('WARN [main] Uncaught exception: PRIVATE')
    + entry('ERROR [main] Uncaught exceptions: PRIVATE')
    + entry('ERROR [other] [main] Unhandled rejection: PRIVATE')
    + entry('WARN [ui-control] failed to starter PRIVATE')
    + ' [2026-10-22T00:00:00.000Z] ERROR [main] Uncaught exception: PRIVATE\n'
    + '[2026-99-99T00:00:00.000Z] ERROR [main] Uncaught exception: PRIVATE\n'
    + entry('ERROR PRIVATE contains [main] Unhandled rejection: PRIVATE');
  await writeFile(f.current, text);
  assert.deepEqual((await (await createMainStartupLogDiagnostic(f.profile)).read()).current, slot('read', ['unknown'], Buffer.byteLength(text)));
});

test('hardlinked logs and marker are refused without leaking their contents', async t => {
  const f = await fixture(t), outside = join(f.temporary, 'private');
  await writeFile(outside, entry('ERROR [main] Uncaught exception: PRIVATE'));
  await link(outside, f.current);
  assert.equal((await (await createMainStartupLogDiagnostic(f.profile)).read()).current.availability, 'unavailable');
  const marker = join(f.profile.root, '.lawoss-release-acceptance-profile.json');
  await link(marker, join(f.temporary, 'marker-link'));
  assert.deepEqual(await (await createMainStartupLogDiagnostic(f.profile)).read(), { current: slot('unavailable'), previous: slot('unavailable') });
});

test('symlinked logs, log directories and markers never follow outside', { skip: process.platform === 'win32' ? 'creating test symlinks requires an explicitly privileged Windows fixture' : false }, async t => {
  for (const target of ['file', 'logs', 'userdata', 'marker']) await t.test(target, async t => {
    const f = await fixture(t), outside = join(f.temporary, 'outside'); await mkdir(outside);
    await writeFile(join(outside, 'main.log'), entry('ERROR [main] Uncaught exception: PRIVATE'));
    const observer = await createMainStartupLogDiagnostic(f.profile);
    if (target === 'file') await symlink(join(outside, 'main.log'), f.current);
    else if (target === 'marker') {
      const marker = join(f.profile.root, '.lawoss-release-acceptance-profile.json');
      await writeFile(join(outside, 'marker'), await readFile(marker)); await rm(marker); await symlink(join(outside, 'marker'), marker);
    } else {
      const directory = target === 'logs' ? f.logs : join(f.profile.root, 'userdata');
      await rm(directory, { recursive: true }); await symlink(outside, directory);
    }
    const result = await observer.read(); assert.equal(result.current.availability, 'unavailable');
    assert.doesNotMatch(JSON.stringify(result), /PRIVATE|outside/);
  });
});

test('changed owner, replaced original root and oversized marker invalidate both slots', async t => {
  for (const change of ['owner', 'root', 'large-marker']) await t.test(change, async t => {
    const f = await fixture(t), observer = await createMainStartupLogDiagnostic(f.profile);
    const marker = join(f.profile.root, '.lawoss-release-acceptance-profile.json');
    if (change === 'root') { await rename(f.profile.root, `${f.profile.root}-old`); await mkdir(f.profile.root); await writeFile(marker, JSON.stringify(f.profile)); }
    else await writeFile(marker, change === 'owner' ? JSON.stringify({ ...f.profile, owner: 'different-owner' }) : 'x'.repeat(65536));
    assert.deepEqual(await observer.read(), { current: slot('unavailable'), previous: slot('unavailable') });
  });
});

test('replacement of a physical ancestor is refused even when the original profile inode is moved back', async t => {
  const f = await fixture(t), observer = await createMainStartupLogDiagnostic(f.profile);
  const oldParent = `${f.temporary}-original`;
  t.after(() => rm(oldParent, { recursive: true, force: true }));
  await rename(f.temporary, oldParent); await mkdir(f.temporary);
  await rename(join(oldParent, 'profile'), f.profile.root);
  await writeFile(f.current, entry('ERROR [main] Uncaught exception: PRIVATE'));
  assert.deepEqual(await observer.read(), { current: slot('unavailable'), previous: slot('unavailable') });
});

test('a directory occupying a fixed log slot is unavailable and invalid UTF8 stays finite', async t => {
  const f = await fixture(t);
  await mkdir(f.current); await writeFile(f.previous, Buffer.from([255, 254, 0, 1]));
  assert.deepEqual(await (await createMainStartupLogDiagnostic(f.profile)).read(), { current: slot('unavailable'), previous: slot('read', ['unknown'], 4) });
});

test('binding an invalid profile returns a nonthrowing unavailable reader', async () => {
  for (const profile of [null, {}, { root: '/not-a-profile', owner: 'PRIVATE', kind: 'fresh' }, new Proxy({}, { get() { throw new Error('PRIVATE'); } })]) {
    const observer = await createMainStartupLogDiagnostic(profile);
    assert.deepEqual(await observer.read(), { current: slot('unavailable'), previous: slot('unavailable') });
  }
});
