import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

const desktopRequire = createRequire(new URL('../../../apps/desktop/package.json', import.meta.url));
const builderRequire = createRequire(desktopRequire.resolve('electron-builder/package.json'));
const appBuilderRequire = createRequire(builderRequire.resolve('app-builder-lib/package.json'));
assert.equal(appBuilderRequire('./package.json').version, '26.16.1');
const { generateAppRunScript } = appBuilderRequire('./out/targets/appimage/appImageUtil.js');
const AppImageTarget = appBuilderRequire('./out/targets/appimage/AppImageTarget.js').default;

// Execute the real generated Bash launcher against owned argument-recording
// shims only. This is launcher policy coverage, not native app acceptance.
async function launcherFixture(t, namespaceStatus) {
  const root = await mkdtemp(join(tmpdir(), 'lawoss AppRun žluťoučký '));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'home'));
  const output = join(root, 'argv.json'), recorder = join(root, 'record-argv.mjs');
  await writeFile(recorder, "import {writeFileSync} from 'node:fs';writeFileSync(process.env.LAWOSS_FIXTURE_ARGV,JSON.stringify(process.argv.slice(2)));\n");
  await writeFile(join(root, 'legalwork'), '#!/bin/sh\nexec "$LAWOSS_FIXTURE_NODE" "$LAWOSS_FIXTURE_RECORDER" "$@"\n', { mode: 0o700 });
  await writeFile(join(root, 'unshare'), `#!/bin/sh\nexit ${namespaceStatus}\n`, { mode: 0o700 });
  const launcher = join(root, 'AppRun');
  await writeFile(launcher, generateAppRunScript({
    DesktopFileName: 'lawoss.desktop', ExecutableName: 'legalwork', ProductName: 'LAWOSS',
    ProductFilename: 'LAWOSS', ResourceName: 'appimagekit-lawoss',
  }), { mode: 0o700 });
  return { launcher, output, environment: {
    PATH: '/usr/bin:/bin', HOME: join(root, 'home'), APPDIR: root, LANG: 'C', LC_ALL: 'C',
    LAWOSS_FIXTURE_NODE: process.execPath, LAWOSS_FIXTURE_RECORDER: recorder, LAWOSS_FIXTURE_ARGV: output,
  } };
}

const argumentCases = [
  ['empty argv', []],
  ['Unicode, spaces and literal shell characters', ['žluťoučký priečinok', 'space here', '$HOME', '`printf injected`', "single'quote", 'double"quote', 'trailing\\', '']],
  ['explicit user sandbox argument', ['--no-sandbox', 'žluťoučký priečinok', '$HOME', '']],
];
for (const namespaceStatus of [0, 1]) for (const [label, args] of argumentCases) {
  test(`generated AppRun preserves ${label} when the namespace probe returns ${namespaceStatus}`, {
    skip: process.platform === 'win32' ? 'Generated Bash launcher requires a POSIX host' : false,
    timeout: 10_000,
  }, async t => {
    const f = await launcherFixture(t, namespaceStatus);
    const result = spawnSync('/bin/bash', [f.launcher, ...args], {
      env: f.environment, encoding: 'utf8', timeout: 5000, maxBuffer: 1024 * 1024,
    });
    assert.equal(result.error, undefined);assert.equal(result.signal, null);
    assert.equal(result.status, 0, result.stderr);
    assert.deepEqual(JSON.parse(await readFile(f.output, 'utf8')), args);
  });
}

// Keep the real target's option merge/default/Exec construction. The helper is
// only the desktop-file write boundary and returns the actual Exec it receives.
async function desktopEntry(toolset, executableArgs) {
  const packager = {
    platformSpecificBuildOptions: {},
    config: {
      appImage: executableArgs === undefined ? {} : { executableArgs },
      ...(toolset === undefined ? {} : { toolsets: { appimage: toolset } }),
    },
    appInfo: { buildVersion: '1.2.3' },
  };
  const target = new AppImageTarget('appImage', packager, {
    computeDesktopEntry(_options, exec) { return `[Desktop Entry]\nExec=${exec}\n`; },
  }, 'unused-output');
  return target.desktopEntry.value;
}

for (const toolset of [undefined, '0.0.0', 'latest']) {
  const label = toolset ?? 'unset';
  test(`actual AppImage target defaults to sandbox-preserving desktop Exec for toolset ${label}`, async () => {
    assert.equal(await desktopEntry(toolset), '[Desktop Entry]\nExec=AppRun %U\n');
  });
  test(`actual AppImage target preserves explicitly configured executableArgs for toolset ${label}`, async () => {
    const args = ['--profile="žluťoučký priečinok"', '--literal=$HOME', '--no-sandbox'];
    assert.equal(await desktopEntry(toolset, args), '[Desktop Entry]\nExec=AppRun --profile="žluťoučký priečinok" --literal=$HOME --no-sandbox %U\n');
  });
}
