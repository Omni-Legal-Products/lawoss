import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import test from 'node:test';
import { createNativeLaunchDiagnostics, nativeLaunchDiagnostic } from './native-launch-diagnostics.mjs';

// Real pipe traffic, with each subsequent write admitted only after the parent
// consumed the preceding bytes. This is not native application evidence.
function fixture(t, parts, stdout = '') {
  const collector = createNativeLaunchDiagnostics();
  const script = `process.on('message',value=>{if(value==='exit')process.exit(73);else (value.stream==='stdout'?process.stdout:process.stderr).write(Buffer.from(value.bytes,'base64'));});`;
  const child = spawn(process.execPath, ['-e', script], { stdio: ['ignore', 'pipe', 'pipe', 'ipc'] });
  let received = 0, closed = false;
  const readers = [];
  child.stdout.resume();
  child.stderr.on('data', chunk => {
    collector.stderr(chunk); received += chunk.length;
    for (const reader of readers) if (received >= reader.bytes) reader.resolve();
  });
  const close = once(child, 'close').then(() => { closed = true; });
  t.after(async () => { if (!closed) child.kill('SIGKILL'); await close; });
  child.send({ stream: 'stdout', bytes: Buffer.from(stdout).toString('base64') });
  let requested = 0;
  return { child, collector, close, async write(index) {
    requested += Buffer.byteLength(parts[index]); child.send({ stream: 'stderr', bytes: Buffer.from(parts[index]).toString('base64') });
    if (received < requested) await new Promise(resolve => readers.push({ bytes: requested, resolve }));
  }, async exit() { child.send('exit'); await close; } };
}

test('real stderr pipe split marker and invalid UTF8 retain only bounded categories and exact byte counts', { timeout: 10_000 }, async t => {
  const parts = [Buffer.from([0xff, 0xfe]), Buffer.from('PRIVATE č /private/profile No usable sand'), Buffer.from('box! PRIVATE-SUFFIX')];
  const f = fixture(t, parts);
  for (let i = 0; i < parts.length; i++) await f.write(i);
  await f.exit();
  const expected = { exitObserved: true, exitCode: 73, signal: null,
    stderr: { categories: ['no-usable-sandbox'], scannedBytes: parts.reduce((size, bytes) => size + bytes.length, 0), truncated: false } };
  assert.deepEqual(f.collector.freeze(f.child), expected);
  const primary = new Error('PRIVATE-ERROR'); f.collector.associate(primary);
  assert.deepEqual(nativeLaunchDiagnostic(primary), expected);
  assert.equal(primary.message, 'PRIVATE-ERROR');
  assert.throws(() => nativeLaunchDiagnostic(primary).stderr.categories.push('PRIVATE'));
  assert.doesNotMatch(JSON.stringify(nativeLaunchDiagnostic(primary)), /PRIVATE|private\/profile|No usable sandbox/);
});

test('real pipe scanning stops at 64KiB, recognizes a split boundary marker and ignores later marker categories', { timeout: 10_000 }, async t => {
  const marker = Buffer.from('No usable sandbox!');
  const parts = [Buffer.alloc(64 * 1024 - marker.length, 120), marker.subarray(0, 9), marker.subarray(9), Buffer.from('Failed to move to new namespace: PRIVATE')];
  const f = fixture(t, parts);
  for (let i = 0; i < parts.length; i++) await f.write(i);
  await f.exit();
  assert.deepEqual(f.collector.freeze(f.child), { exitObserved: true, exitCode: 73, signal: null,
    stderr: { categories: ['no-usable-sandbox'], scannedBytes: 64 * 1024, truncated: true } });
});

test('real stdout marker is not a stderr observation and unregistered or nested fields cannot forge diagnostic ownership', { timeout: 10_000 }, async t => {
  const f = fixture(t, [Buffer.from('PRIVATE-STDERR')], 'No usable sandbox! PRIVATE-STDOUT');
  await f.write(0); await f.exit();
  f.collector.freeze(f.child);
  const primary = Object.assign(new Error('PRIVATE'), { nativeLaunch: { exitCode: 999, path: '/private/profile' } });
  assert.equal(nativeLaunchDiagnostic(primary), null);
  f.collector.associate(primary);
  assert.deepEqual(nativeLaunchDiagnostic(primary).stderr, { categories: ['unknown'], scannedBytes: 14, truncated: false });
  assert.equal(nativeLaunchDiagnostic(new Error('PRIVATE', { cause: primary })), null);
  assert.equal(nativeLaunchDiagnostic(new Proxy({}, { get() { throw new Error('PRIVATE'); } })), null);
  assert.equal(nativeLaunchDiagnostic(null), null);
});

test('snapshot before owned cleanup remains non-exited after late stderr and SIGKILL', { skip: process.platform === 'win32', timeout: 10_000 }, async t => {
  const f = fixture(t, [Buffer.from('PRIVATE-INITIAL'), Buffer.from('No usable sandbox! PRIVATE-CLEANUP')]);
  await f.write(0);
  const frozen = f.collector.freeze(f.child);
  await f.write(1); f.child.kill('SIGKILL'); await f.close;
  assert.equal(f.child.signalCode, 'SIGKILL');
  assert.strictEqual(f.collector.freeze(f.child), frozen);
  assert.deepEqual(frozen, { exitObserved: false, exitCode: null, signal: null,
    stderr: { categories: ['unknown'], scannedBytes: 15, truncated: false } });
});

test('real pipe maps only precise SUID and namespace markers to fixed categories', { timeout: 10_000 }, async t => {
  const text = 'PRIVATE The SUID sandbox helper binary was found, but is not configured correctly.\nFailed to move to new namespace: PRIVATE /profile';
  const f = fixture(t, [Buffer.from(text)]); await f.write(0); await f.exit();
  assert.deepEqual(f.collector.freeze(f.child).stderr, { categories: ['suid-helper-not-configured', 'namespace-failure'], scannedBytes: Buffer.byteLength(text), truncated: false });
});
