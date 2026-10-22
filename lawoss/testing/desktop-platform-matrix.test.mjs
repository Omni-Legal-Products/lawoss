import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import test from 'node:test';
import { sandboxMatrices } from '../../scripts/sandbox/ci-matrix.mjs';

// Use the desktop's declared dependency, not an incidental workspace hoist.
const { parse } = createRequire(new URL('../../apps/desktop/package.json', import.meta.url))('yaml');
const workflow = parse(readFileSync(new URL('../../.github/workflows/ci-desktop-packaging.yml', import.meta.url), 'utf8'));
const smoke = workflow.jobs['package-smoke'];
const nsisSource = readFileSync(new URL('./alpha/probe-nsis-ci.ps1', import.meta.url), 'utf8');
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

const startupPaths = [
  '${{ runner.temp }}/alpha-startup-${{ matrix.arch }}/startup.json',
  "${{ runner.temp }}/alpha-startup-${{ matrix.arch }}/startup.${{ runner.os == 'Linux' && 'xwd' || 'png' }}",
];
const finalPayloads = [
  ['Build final macOS ZIP for native startup', 'dist-electron/${{ matrix.securityTarget }}'],
  ['Verify Linux AppImage packaging', "dist-electron/${{ matrix.arch == 'arm64' && 'linux-arm64-unpacked' || 'linux-unpacked' }}"],
  ['Verify Windows installer packaging', "dist-electron/${{ matrix.arch == 'arm64' && 'win-arm64-unpacked' || 'win-unpacked' }}"],
];
function assertPublicUploads(job) {
  const metadata = new Set([
    '${{ runner.temp }}/isir-native-diagnostics.json',
    '${{ runner.temp }}/isir-engine-runtime-smoke.json',
    '${{ runner.temp }}/nsis-proof-${{ matrix.arch }}.json',
  ]);
  for (const upload of job.steps.filter(({ uses }) => uses?.startsWith('actions/upload-artifact@'))) {
    const paths = upload.with.path.trim().split(/\r?\n/);
    if (paths.length === 1 && paths[0] === '${{ runner.temp }}/windows-documents-probe-${{ matrix.arch }}.json') {
      assert.equal(upload.name, 'Upload finite Windows Documents diagnostic');
      assert.equal(upload.if, "runner.os == 'Windows' && !cancelled()");
      assert.equal(upload.with.name, 'windows-documents-probe-${{ matrix.arch }}');
      assert.equal(upload.with['if-no-files-found'], 'ignore');
      assert.equal(upload.with['retention-days'], 7);
      continue;
    }
    if (paths.length === 1 && metadata.has(paths[0])) continue;
    assert.deepEqual(paths, startupPaths, 'Only the two explicit fresh synthetic startup files may be published');
    assert.equal(upload.if, 'success()');
    assert.equal(upload.with['if-no-files-found'], 'error');
  }
}

function assertFinalStartup(job, source = nsisSource) {
  const required = (name, condition) => {
    const found = job.steps.find(candidate => candidate.name === name);
    assert.ok(found, `Missing final-artifact gate: ${name}`);
    assert.equal(found.if, condition);
    assert.ok(found['continue-on-error'] === undefined || found['continue-on-error'] === false);
    assert.ok(Number.isInteger(found['timeout-minutes']) && found['timeout-minutes'] > 0);
    assert.doesNotMatch(found.run, /\|\|\s*(?:true|:)|continue-on-error|exit\s+0|--no-sandbox/);
    assert.ok(job.steps.indexOf(found) > job.steps.findIndex(candidate => candidate.name === 'Run isolation probe with the packaged Node and VM'));
    return found;
  };
  for (const [name, payload] of finalPayloads) {
    const builder = job.steps.find(candidate => candidate.name === name);
    assert.ok(builder?.run.includes(`--prepackaged "${payload}"`), `${name} must archive the inspected native payload`);
  }
  const zip = required('Build final macOS ZIP for native startup', "runner.os == 'macOS'");
  assert.equal(zip.run, 'pnpm --dir apps/desktop exec electron-builder --config electron-builder.yml --mac zip --${{ matrix.arch }} -c.mac.identity=- --prepackaged "dist-electron/${{ matrix.securityTarget }}" --publish never');
  const mac = required('Verify final macOS ZIP native startup', "runner.os == 'macOS'");
  assert.equal(mac['timeout-minutes'], 10, 'Outer batch must fit guarded extraction, hashing, launch, capture and cleanup');
  assert.equal(mac.run, 'node lawoss/testing/alpha/probe-startup-ci.mjs --output-dir "$RUNNER_TEMP/alpha-startup-${{ matrix.arch }}"');
  assert.ok(job.steps.indexOf(mac) > job.steps.indexOf(zip));
  const linux = required('Verify final Linux AppImage native startup', "runner.os == 'Linux'");
  assert.equal(linux['timeout-minutes'], 10, 'Outer batch must fit the existing archive operation budgets');
  assert.equal(linux.run, 'xvfb-run -a node lawoss/testing/alpha/probe-linux-protected-startup-ci.mjs --output-dir "$RUNNER_TEMP/alpha-startup-${{ matrix.arch }}"');
  const prerequisites = required('Install native Linux startup capture tools', "runner.os == 'Linux'");
  assert.match(prerequisites.run, /command -v xwd/);
  assert.match(prerequisites.run, /command -v xprop/);
  assert.match(prerequisites.run, /apt-get install -y --no-install-recommends x11-apps x11-utils/);
  assert.ok(job.steps.indexOf(linux) > job.steps.indexOf(prerequisites));
  assert.ok(job.steps.indexOf(linux) > job.steps.findIndex(candidate => candidate.name === 'Verify Linux AppImage packaging'));
  const windows = required('Verify actual Windows NSIS installation and final bytes', "runner.os == 'Windows'");
  assert.equal(windows.shell, 'pwsh');
  assert.match(windows.run, /probe-nsis-ci\.ps1 -Arch '\$\{\{ matrix\.arch \}\}' -NativeStartup -Output/);
  assert.match(source, /\[switch\]\$NativeStartup/);
  assert.match(source, /if \(\$NativeStartup\) \{\s*\$startupOutput = Join-Path \$env:RUNNER_TEMP \("alpha-startup-\$Arch"\)\s*node lawoss\/testing\/alpha\/probe-startup-ci\.mjs --output-dir \$startupOutput --installed-app \(Join-Path \$installed 'LAWOSS\.exe'\)\s*if \(\$LASTEXITCODE -ne 0\) \{ exit \$LASTEXITCODE \}/);
  assert.ok(source.indexOf('if ($NativeStartup)') > source.indexOf("'@ | node --input-type=module"), 'Native launch follows actual installer integrity verification');
  assertPublicUploads(job);
  assert.ok(job.steps.some(candidate => candidate.uses?.startsWith('actions/upload-artifact@') && candidate.with.path.trim().split(/\r?\n/)[0] === startupPaths[0]), 'Missing finite native startup publication');
}

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
  assertPublicUploads(smoke);
  const nsis = step('Verify actual Windows NSIS installation and final bytes');
  assert.equal(nsis.if, "runner.os == 'Windows'");
  assert.equal(nsis.shell, 'pwsh');
  assert.match(nsis.run, /probe-nsis-ci\.ps1 -Arch '\$\{\{ matrix\.arch \}\}'/);
  assert.ok(smoke.steps.indexOf(nsis) > smoke.steps.indexOf(step('Verify Windows installer packaging')));
});

test('all six final artifacts require native startup after security gates and publish only finite synthetic evidence', () => {
  assertFinalStartup(smoke);
});

test('final-artifact mutation regressions reject missing, disabled and suppressed OS gates', () => {
  assertFinalStartup(smoke);
  for (const name of ['Verify final macOS ZIP native startup', 'Verify final Linux AppImage native startup', 'Verify actual Windows NSIS installation and final bytes']) {
    for (const mutation of ['missing', 'disabled', 'optional', 'suppressed']) {
      const changed = structuredClone(smoke);
      const target = changed.steps.find(candidate => candidate.name === name);
      if (mutation === 'missing') changed.steps.splice(changed.steps.indexOf(target), 1);
      if (mutation === 'disabled') target.if = false;
      if (mutation === 'optional') target['continue-on-error'] = true;
      if (mutation === 'suppressed') target.run += ' || true';
      assert.throws(() => assertFinalStartup(changed), undefined, `${name}: ${mutation}`);
    }
  }
  const missingOptIn = structuredClone(smoke);
  missingOptIn.steps.find(candidate => candidate.name === 'Verify actual Windows NSIS installation and final bytes').run = missingOptIn.steps.find(candidate => candidate.name === 'Verify actual Windows NSIS installation and final bytes').run.replace(' -NativeStartup', '');
  assert.throws(() => assertFinalStartup(missingOptIn));
  const writableLinuxExtraction = structuredClone(smoke);
  const linux = writableLinuxExtraction.steps.find(candidate => candidate.name === 'Verify final Linux AppImage native startup');
  linux.run = linux.run.replace('probe-linux-protected-startup-ci.mjs', 'probe-startup-ci.mjs');
  assert.throws(() => assertFinalStartup(writableLinuxExtraction), undefined, 'Hosted Linux must use the protected installation route');
});

test('publication mutation regressions reject archives, private profiles and broad startup globs', () => {
  assertFinalStartup(smoke);
  for (const forbidden of ['apps/desktop/dist-electron/*.zip', '${{ runner.temp }}/alpha-startup-${{ matrix.arch }}/**', '${{ runner.temp }}/alpha-private/profile', '${{ runner.temp }}/alpha-startup-${{ matrix.arch }}/startup.*', '${{ runner.temp }}/alpha-startup-${{ matrix.arch }}/private.json']) {
    const changed = structuredClone(smoke);
    const upload = changed.steps.find(candidate => candidate.uses?.startsWith('actions/upload-artifact@') && candidate.with.path.includes('/startup.json'));
    upload.with.path += `\n${forbidden}`;
    assert.throws(() => assertPublicUploads(changed));
  }
});

test('final archive mutation regressions reject rebuilding the inspected payload', () => {
  assertFinalStartup(smoke);
  for (const [name] of finalPayloads) {
    const changed = structuredClone(smoke);
    const builder = changed.steps.find(candidate => candidate.name === name);
    builder.run = builder.run.replace(/ --prepackaged "[^"]+"/, '');
    assert.throws(() => assertFinalStartup(changed), undefined, name);
  }
});


test('Windows Documents diagnostic publishes only its exact finite JSON after the unchanged NSIS gate', () => {
  const uploadName = 'Upload finite Windows Documents diagnostic';
  const upload = smoke.steps.find(candidate => candidate.name === uploadName);
  assert.ok(upload);
  assert.ok(smoke.steps.indexOf(upload) > smoke.steps.indexOf(step('Verify actual Windows NSIS installation and final bytes')));
  assertPublicUploads(smoke);
  for (const mutate of [
    upload => upload.with.path = '${{ runner.temp }}/windows-documents-probe-${{ matrix.arch }}.*',
    upload => upload.with.path += '\n${{ runner.temp }}/windows-documents-private/**',
    upload => upload.with.path = '${{ runner.temp }}/windows-documents-private/profile.json',
    upload => upload.if = 'success()',
    upload => upload.with['if-no-files-found'] = 'error',
    upload => upload.with['retention-days'] = 90,
  ]) {
    const changed = structuredClone(smoke);
    mutate(changed.steps.find(candidate => candidate.name === uploadName));
    assert.throws(() => assertPublicUploads(changed));
  }
});
