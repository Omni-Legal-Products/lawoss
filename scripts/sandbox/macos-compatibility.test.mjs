import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assertMacOSMinimum } from './macos-compatibility.mjs';
const command = version => `Load command 8\n cmd LC_BUILD_VERSION\n platform 1\n minos ${version}\n sdk 27.0\n tool LD\n version 27037.2\n`;
test('rejects newer QEMU and dylib minimum OS versions, including fat binary slices', () => {
  assert.doesNotThrow(() => assertMacOSMinimum(command('12.0'), 'qemu'));
  for (const version of ['12.1', '14.0', '15.0']) assert.throws(() => assertMacOSMinimum(command(version), 'glib'), /must support macOS 12/);
  assert.throws(() => assertMacOSMinimum(command('12.0') + command('15.0'), 'universal'), /must support macOS 12/);
  assert.throws(() => assertMacOSMinimum('unknown format', 'unknown'), /unknown/);
  assert.doesNotThrow(() => assertMacOSMinimum('Load command 4\n cmd LC_VERSION_MIN_MACOSX\n version 11.0\n sdk 15.0\n', 'legacy'));
});
