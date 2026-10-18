import { test } from 'node:test';
import assert from 'node:assert/strict';
import { sandboxMatrices } from '../sandbox/ci-matrix.mjs';

test('CI and release defaults build every runtime and one guest per architecture', () => {
  const { guest, runtime } = sandboxMatrices();
  assert.deepEqual(runtime.include.map(({ platform, arch }) => `${platform}-${arch}`).sort(),
    ['darwin-arm64', 'darwin-x64', 'linux-arm64', 'linux-x64', 'win32-arm64', 'win32-x64']);
  assert.deepEqual(guest.include.map(({ arch }) => arch).sort(), ['arm64', 'x64']);
});

test('Windows alpha prepares both Windows targets without unrelated host builds', () => {
  const { guest, runtime } = sandboxMatrices('win32-x64,win32-arm64');
  assert.deepEqual(runtime.include.map(({ os, msystem, prefix }) => ({ os, msystem, prefix })), [
    { os: 'windows-2022', msystem: 'UCRT64', prefix: 'ucrt64' },
    { os: 'windows-11-arm', msystem: 'CLANGARM64', prefix: 'clangarm64' },
  ]);
  assert.deepEqual(guest.include, [{ os: 'ubuntu-24.04', arch: 'x64' }, { os: 'ubuntu-24.04-arm', arch: 'arm64' }]);
});

test('macOS alpha prepares only the ARM64 host and guest', () => {
  assert.deepEqual(sandboxMatrices('darwin-arm64'), {
    guest: { include: [{ os: 'ubuntu-24.04-arm', arch: 'arm64' }] },
    runtime: { include: [{ os: 'macos-15', platform: 'darwin', arch: 'arm64', qemu: 'aarch64' }] },
  });
});

test('invalid and duplicate targets fail before creating jobs or colliding artifacts', () => {
  for (const targets of ['', 'windows-x64', 'all,win32-x64', 'win32-x64,', 'win32-x64,win32-x64']) {
    assert.throws(() => sandboxMatrices(targets), /Unknown sandbox target|Duplicate sandbox targets/);
  }
});
