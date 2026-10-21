import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { sandboxMatrices } from '../../scripts/sandbox/ci-matrix.mjs';

// Use the desktop's declared dependency, not an incidental workspace hoist.
const { parse } = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))('yaml');
const workflow = parse(readFileSync(new URL('../../.github/workflows/ci-desktop-packaging.yml', import.meta.url), 'utf8'));
const smoke = workflow.jobs['package-smoke'];
const entries = smoke.strategy.matrix.include;
const expected = [
  ['linux', 'x64', 'ubuntu-latest', 'x86_64-unknown-linux-gnu', 'linux-unpacked', 'legalwork'],
  ['linux', 'arm64', 'ubuntu-24.04-arm', 'aarch64-unknown-linux-gnu', 'linux-arm64-unpacked', 'legalwork'],
  ['win', 'x64', 'windows-2022', 'x86_64-pc-windows-msvc', 'win-unpacked', 'LAWOSS.exe'],
  ['win', 'arm64', 'windows-11-arm', 'aarch64-pc-windows-msvc', 'win-arm64-unpacked', 'LAWOSS.exe'],
  ['mac', 'x64', 'macos-15-intel', 'x86_64-apple-darwin', 'mac/LAWOSS.app', 'Contents/MacOS/LAWOSS'],
  ['mac', 'arm64', 'macos-14', 'aarch64-apple-darwin', 'mac-arm64/LAWOSS.app', 'Contents/MacOS/LAWOSS'],
];
const step = (name) => {
  const found = smoke.steps.find((candidate) => candidate.name === name);
  assert.ok(found, `Missing required package gate: ${name}`);
  assert.notEqual(found['continue-on-error'], true, `${name} must remain a required gate`);
  return found;
};

test('desktop smoke covers all six native targets with architecture-correct artifacts', () => {
  assert.equal(entries.length, expected.length);
  assert.equal(new Set(entries.map(({ platform, arch }) => `${platform}-${arch}`)).size, expected.length);
  assert.equal(smoke['runs-on'], '${{ matrix.os }}');
  assert.equal(smoke.name, 'Package and launch (${{ matrix.os }})');
  assert.equal(smoke.env.TARGET, '${{ matrix.target }}');
  for (const [platform, arch, os, target, directory, binary] of expected) {
    const entry = entries.find((candidate) => candidate.platform === platform && candidate.arch === arch);
    assert.ok(entry, `Missing desktop target ${platform}-${arch}`);
    assert.deepEqual(entry, {
      os, target, platform, arch,
      executable: `${directory}/${binary}`,
      asar: `${directory}/${platform === 'mac' ? 'Contents/Resources' : 'resources'}/app.asar`,
      securityTarget: platform === 'mac' ? directory : `${directory}/${binary}`,
    });
  }
});

test('every desktop target has a same-architecture protected runtime artifact', () => {
  const runtime = workflow.jobs['sandbox-runtime'];
  const selected = sandboxMatrices(runtime.with.targets).runtime.include;
  const desktopTargets = entries.map(({ platform, arch }) => `${platform === 'mac' ? 'darwin' : platform === 'win' ? 'win32' : platform}-${arch}`);
  assert.deepEqual(selected.map(({ platform, arch }) => `${platform}-${arch}`).sort(), desktopTargets.sort());
  assert.equal(selected.length, 6);
  const download = smoke.steps.find(({ uses }) => uses?.startsWith('actions/download-artifact@'));
  assert.equal(download.with.name, "sandbox-runtime-${{ matrix.platform == 'win' && 'win32' || matrix.platform == 'mac' && 'darwin' || matrix.platform }}-${{ matrix.arch }}");
});

test('native packaging refuses a mismatched host and keeps architecture-specific security gates', () => {
  const architecture = step('Verify native runner architecture');
  assert.match(architecture.run, /process\.arch/);
  assert.match(architecture.run, /\$\{\{ matrix\.arch \}\}/);
  assert.match(architecture.run, /throw new Error/);
  assert.ok(smoke.steps.indexOf(architecture) < smoke.steps.indexOf(step('Install dependencies')));
  assert.match(step('Package desktop app').run, /--\$\{\{ matrix\.platform \}\} --\$\{\{ matrix\.arch \}\}/);
  assert.match(step('Verify Linux AppImage packaging').run, /--linux AppImage --\$\{\{ matrix\.arch \}\}/);
  assert.match(step('Verify packaged server modules load from app.asar').run, /matrix\.asar/);
  assert.match(step('Verify shipped fuses, Node and document tools').run, /matrix\.securityTarget/);
  assert.match(step('Run isolation probe with the packaged Node and VM').run, /matrix\.securityTarget/);
  for (const name of ['Verify Windows and macOS packaged startup', 'Verify Linux packaged startup']) {
    assert.match(step(name).run, /matrix\.executable/);
  }
  for (const name of ['Native ISIR renderer, tools and application relaunch (Linux)',
    'Native ISIR renderer, tools and application relaunch (Windows and macOS)',
    'Verify Windows and macOS native modules', 'Verify Linux native modules',
    'Verify Windows and macOS preview isolation', 'Verify Linux preview isolation']) step(name);
  // Synthetic diagnostics may be uploaded; unsigned installers must stay private.
  for (const upload of smoke.steps.filter(({ uses }) => uses?.startsWith('actions/upload-artifact@'))) {
    assert.match(upload.with.path, /^\$\{\{ runner\.temp \}\}\/(?:isir-[\w-]+|nsis-proof-\$\{\{ matrix\.arch \}\})\.json$/);
  }
  const nsis = step('Verify actual Windows NSIS installation and final bytes');
  assert.equal(nsis.if, "runner.os == 'Windows'");
  assert.equal(nsis.shell, 'pwsh');
  assert.match(nsis.run, /probe-nsis-ci\.ps1 -Arch '\$\{\{ matrix\.arch \}\}'/);
  assert.ok(smoke.steps.indexOf(nsis) > smoke.steps.indexOf(step('Verify Windows installer packaging')));
});
