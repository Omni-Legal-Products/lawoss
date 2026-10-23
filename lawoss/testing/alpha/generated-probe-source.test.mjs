import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { desktopApplicationBuildInfo } from '../../build/plugin-payload/desktop-packaging.mjs';
import { assertReleaseSource } from '../../../scripts/release/build-info.mjs';

const repository = new URL('../../../', import.meta.url);
const target = { platform: 'darwin', arch: 'arm64' };
const originalProbe = 'export const inertProbe: string = "fixture only; never execute";\n';
const originalPackage = { name: 'fixture-desktop', version: '0.0.0', opencodeRouterVersion: '0.0.0' };

async function fixture(t) {
  const base = await mkdtemp(path.join(tmpdir(), 'lawoss-generated-probe-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const root = path.join(base, 'checkout'), controls = path.join(base, 'git-controls');
  await mkdir(root);
  await mkdir(path.join(controls, 'hooks'), { recursive: true });
  await mkdir(path.join(controls, 'template'));
  await writeFile(path.join(controls, 'excludes'), '');
  const git = (...args) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trimEnd();
  git('init', '-q', `--template=${path.join(controls, 'template')}`);
  // Override ambient global excludes, hooks, signing and identity only in this disposable repository.
  for (const [key, value] of Object.entries({
    'core.excludesFile': path.join(controls, 'excludes'),
    'core.hooksPath': path.join(controls, 'hooks'),
    'commit.gpgSign': 'false', 'user.name': 'LAWOSS fixture', 'user.email': 'fixture@example.invalid',
  })) git('config', '--local', key, value);

  // Derive the real producer arguments from the shipping workflow, rather than a separate command mirror.
  const workflow = await readFile(new URL('.github/workflows/ci-desktop-packaging.yml', repository), 'utf8');
  const commands = [...workflow.matchAll(/^\s*bun (build scripts\/sandbox\/probe\.ts --target=node --outfile=(\S+))\s*$/gm)];
  assert.equal(commands.length, 1, 'shipping workflow must supply one probe build command');
  const buildArgs = commands[0][1].split(' '), output = commands[0][2];
  assert.equal(output, 'scripts/sandbox/probe.mjs');
  await mkdir(path.join(root, 'scripts/sandbox'), { recursive: true });
  const desktopRoot = path.join(root, 'apps/desktop');
  await mkdir(desktopRoot, { recursive: true });
  await writeFile(path.join(root, '.gitignore'), await readFile(new URL('.gitignore', repository)));
  await writeFile(path.join(root, 'scripts/sandbox/probe.ts'), originalProbe);
  await writeFile(path.join(desktopRoot, 'package.json'), JSON.stringify(originalPackage));
  git('add', '.');
  git('commit', '-qm', 'fixture');
  assert.equal(git('status', '--porcelain', '--untracked-files=all'), '');
  const head = git('rev-parse', 'HEAD');
  const info = () => desktopApplicationBuildInfo({ desktopRoot, target, env: {} });
  const expected = { schemaVersion: 1, product: 'lawoss-desktop', version: '0.0.0', gitSha: head,
    buildEpoch: git('show', '-s', '--format=%ct', 'HEAD'), platform: 'darwin', arch: 'arm64',
    channel: 'stable', workflowRunUrl: '' };
  const build = async () => {
    execFileSync('bun', buildArgs, { cwd: root, encoding: 'utf8', stdio: 'pipe' });
    assert.ok((await stat(path.join(root, output))).size > 0, 'Bun must produce an actual nonempty module');
  };
  return { root, git, head, info, expected, build, output };
}

test('successful shipping probe compilation preserves the exact nonnull desktop build identity', async t => {
  const f = await fixture(t);
  const before = f.info();
  assert.deepEqual(before, f.expected);
  await f.build();
  const after = f.info();
  const ignored = spawnSync('git', ['check-ignore', '--no-index', f.output], { cwd: f.root, encoding: 'utf8' });
  t.diagnostic(JSON.stringify({ producer: 'bun build', output: f.output, headUnchanged: f.git('rev-parse', 'HEAD') === f.head,
    before, after, checkIgnoreExit: ignored.status, sourceStatus: f.git('status', '--porcelain', '--untracked-files=all') }));
  assert.equal(f.git('rev-parse', 'HEAD'), f.head);
  assert.deepEqual(after, before, 'generated output must not turn a clean 0.0.0 BuildInfo into null');
  assert.equal(ignored.status, 0, ignored.stderr);
  assert.equal(ignored.stdout.trim(), f.output);
  assert.equal(f.git('status', '--porcelain', '--untracked-files=all'), '');
  assert.equal(assertReleaseSource(f.root, '1.2.3'), f.head);
});

test('the generated probe exception does not admit unrelated or changed source', async t => {
  const f = await fixture(t);
  await f.build();
  const cases = [
    { name: 'unrelated untracked file', file: 'unrelated.txt', content: 'untracked source\n' },
    { name: 'nearby untracked module', file: 'scripts/sandbox/other.mjs', content: 'export const other = true;\n' },
    { name: 'tracked probe source edit', file: 'scripts/sandbox/probe.ts', content: `${originalProbe}export const changed = true;\n`, restore: originalProbe },
    { name: 'arbitrary desktop package edit', file: 'apps/desktop/package.json',
      content: JSON.stringify({ ...originalPackage, name: 'changed-desktop' }), restore: JSON.stringify(originalPackage) },
  ];
  for (const c of cases) await t.test(c.name, async () => {
    const file = path.join(f.root, c.file);
    await writeFile(file, c.content);
    try {
      assert.equal(f.info(), null, 'dirty 0.0.0 development sources must retain null provenance');
      assert.throws(() => assertReleaseSource(f.root, '1.2.3'), /Release source is dirty|Unexpected release source changes/);
      assert.equal(f.git('rev-parse', 'HEAD'), f.head);
    } finally {
      if (c.restore === undefined) await rm(file);
      else await writeFile(file, c.restore);
    }
    assert.deepEqual(f.info(), f.expected, 'restoring only the source change must recover the same identity');
  });
});
