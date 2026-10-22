import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { chmod, link, lstat, mkdir, mkdtemp, readFile, readlink, rm, symlink, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { assertHostedLinuxContext, linuxUsernsProfile, validateProtectedLinuxTree } from './linux-protected-install.mjs';

const environment = { GITHUB_ACTIONS: 'true', RUNNER_ENVIRONMENT: 'github-hosted' };
const context = { platform: 'linux', arch: 'x64', uid: 1000, euid: 1000, environment };
const stage = `/opt/lawoss-ci-${'a'.repeat(32)}`;
const refused = { code: 'linux-protected-install-refused' };
const unverified = { code: 'linux-protected-install-unverified' };

test('protected Linux installation requires an ordinary user on an explicit hosted supported Linux runner', () => {
  for (const arch of ['x64', 'arm64']) assert.doesNotThrow(() => assertHostedLinuxContext({ ...context, arch }));
  for (const patch of [
    { platform: 'darwin' }, { platform: 'win32' }, { arch: 'ia32' }, { arch: 'ARM64' },
    ...[0, -1, 1000.5, NaN, Infinity, '1000', null, true].map(uid => ({ uid })),
    ...[0, -1, 1000.5, NaN, Infinity, '1000', null, true].map(euid => ({ euid })),
    { environment: {} }, { environment: null },
    { environment: { ...environment, GITHUB_ACTIONS: true } },
    { environment: { ...environment, GITHUB_ACTIONS: 'false' } },
    { environment: { ...environment, RUNNER_ENVIRONMENT: 'self-hosted' } },
    { environment: { ...environment, RUNNER_ENVIRONMENT: 'github-hosted\n' } },
  ]) assert.throws(() => assertHostedLinuxContext({ ...context, ...patch }), refused);
});

test('user namespace profile grants only the exact protected staging executable', () => {
  for (const suffix of ['a'.repeat(32), '0123456789abcdef'.repeat(2)]) {
    const root = `/opt/lawoss-ci-${suffix}`, name = `lawoss-ci-${suffix}`, executable = `${root}/app/legalwork`;
    assert.deepEqual(linuxUsernsProfile(root), {
      name, executable,
      text: `abi <abi/4.0>,\ninclude <tunables/global>\nprofile ${name} ${executable} flags=(unconfined) {\n  userns,\n}\n`,
    });
  }
});

test('user namespace profile refuses alternate, writable temporary and injected paths', () => {
  for (const root of [
    undefined, null, 42, '', '/opt', '/tmp', `/tmp/lawoss-ci-${'a'.repeat(32)}`,
    `/home/runner/lawoss-ci-${'a'.repeat(32)}`, `/opt/lawoss-ci-${'a'.repeat(31)}`,
    `/opt/lawoss-ci-${'a'.repeat(33)}`, `/opt/lawoss-ci-${'A'.repeat(32)}`,
    `${stage}/`, `${stage}/app`, `${stage}/../other`, `/opt/../opt/lawoss-ci-${'a'.repeat(32)}`,
    `/opt//lawoss-ci-${'a'.repeat(32)}`, `${stage}\n`, `${stage}\0`, `${stage} *`,
    `/opt/lawoss-ci-${'*'.repeat(32)}`, `/opt/lawoss-ci-${'?'.repeat(32)}`,
    `${stage} { userns, }`, `${stage}\nprofile injected /** flags=(unconfined) { userns, }`,
  ]) assert.throws(() => linuxUsernsProfile(root), refused);
});

async function temporaryTree(t) {
  const root = await mkdtemp(path.join(tmpdir(), 'lawoss-protected-tree-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const payload = path.join(root, 'payload');
  await mkdir(path.join(payload, 'app'), { recursive: true });
  await writeFile(path.join(payload, 'app', 'legalwork'), 'Inert filesystem fixture; never execute.\n', { mode: 0o755 });
  return { root, payload };
}

test('actual temporary payload cannot satisfy root ownership and protected physical ancestry', { skip: typeof process.getuid !== 'function' }, async t => {
  const { payload } = await temporaryTree(t);
  assert.equal((await lstat(payload)).uid, process.getuid());
  // A root-run container still has to reject writable /tmp ancestry; no fabricated root-positive proof.
  await assert.rejects(validateProtectedLinuxTree(payload), unverified);
});

test('actual writable payload refuses protected-tree verification', { skip: typeof process.getuid !== 'function' }, async t => {
  const { payload } = await temporaryTree(t);
  await chmod(path.join(payload, 'app', 'legalwork'), 0o777);
  assert.notEqual((await lstat(path.join(payload, 'app', 'legalwork'))).mode & 0o022, 0);
  await assert.rejects(validateProtectedLinuxTree(payload), unverified);
});

test('an actual symbolic-link root refuses protected-tree verification', { skip: typeof process.getuid !== 'function' }, async t => {
  const { root, payload } = await temporaryTree(t), alias = path.join(root, 'alias');
  await symlink(payload, alias);
  assert.equal((await lstat(alias)).isSymbolicLink(), true);
  await assert.rejects(validateProtectedLinuxTree(alias), unverified);
});

const ownedMetadataContainer = process.platform === 'linux' && process.getuid?.() === 0 && process.env.LAWOSS_OWNED_METADATA_CONTAINER === '1';
test('explicit owned Linux metadata container verifies protected files and refuses unsafe mutations', { skip: !ownedMetadataContainer }, async t => {
  const root = `/opt/lawoss-ci-${randomBytes(16).toString('hex')}`;
  await mkdir(root, { mode: 0o755 });
  t.after(() => rm(root, { recursive: true, force: true }));
  const app = path.join(root, 'app'), executable = path.join(app, 'legalwork');
  await mkdir(app, { mode: 0o755 });
  await writeFile(executable, 'Inert root-owned metadata fixture; never execute.\n', { mode: 0o755 });
  assert.equal(await validateProtectedLinuxTree(root), undefined);

  await t.test('group-writable regular payload refuses verification', async () => {
    await chmod(executable, 0o775);
    try { await assert.rejects(validateProtectedLinuxTree(root), unverified); }
    finally { await chmod(executable, 0o755); }
  });
  await t.test('hard-linked regular payload refuses verification', async () => {
    const alias = path.join(app, 'hardlink');
    await link(executable, alias);
    try { assert.equal((await lstat(executable)).nlink, 2); await assert.rejects(validateProtectedLinuxTree(root), unverified); }
    finally { await unlink(alias); }
  });
  await t.test('absolute and escaping symbolic links refuse verification', async () => {
    const alias = path.join(app, 'unsafe-link');
    for (const target of ['/etc/passwd', '../../outside']) {
      await symlink(target, alias);
      try { await assert.rejects(validateProtectedLinuxTree(root), unverified); }
      finally { await unlink(alias); }
    }
  });
  await t.test('relative internal link to protected payload verifies', async () => {
    const alias = path.join(app, 'internal-link');
    await symlink('legalwork', alias);
    try { assert.equal(await validateProtectedLinuxTree(root), undefined); }
    finally { await unlink(alias); }
  });
  await t.test('set-user-ID regular payload refuses verification', async () => {
    await chmod(executable, 0o4755);
    try { assert.equal((await lstat(executable)).mode & 0o4000, 0o4000); await assert.rejects(validateProtectedLinuxTree(root), unverified); }
    finally { await chmod(executable, 0o755); }
  });
  await t.test('actual GNU copy preserves bytes modes and internal links in a protected copied tree', async () => {
    const source = path.join(root, 'copy-source'), destination = path.join(root, 'copy-destination');
    await mkdir(path.join(source, 'nested'), { recursive: true, mode: 0o755 });
    const filename = path.join('nested', 'žluťoučký kůň.txt');
    await writeFile(path.join(source, filename), Buffer.from('Příliš žluťoučký kůň 🐎\n', 'utf8'), { mode: 0o744 });
    await symlink(filename, path.join(source, 'internal-link'));
    const child = spawnSync('/usr/bin/cp', ['--recursive', '--no-dereference', '--preserve=mode', '--no-preserve=ownership,xattr', '--', `${source}/.`, destination], {
      encoding: 'utf8', timeout: 10000, maxBuffer: 4096,
    });
    assert.equal(child.error, undefined);
    assert.equal(child.signal, null);
    assert.equal(child.status, 0);
    assert.equal(child.stdout, '');
    assert.equal(child.stderr, '');
    assert.deepEqual(await readFile(path.join(destination, filename)), await readFile(path.join(source, filename)));
    for (const relative of ['', 'nested', filename, 'internal-link']) {
      const original = await lstat(path.join(source, relative)), copy = await lstat(path.join(destination, relative));
      assert.equal(copy.mode & 0o7777, original.mode & 0o7777);
      assert.equal(copy.uid, 0);
    }
    assert.equal((await lstat(path.join(source, filename))).mode & 0o7777, 0o744);
    assert.equal((await lstat(source)).mode & 0o7777, 0o755);
    assert.equal((await lstat(path.join(source, 'nested'))).mode & 0o7777, 0o755);
    assert.equal((await lstat(path.join(destination, 'internal-link'))).isSymbolicLink(), true);
    assert.equal(await readlink(path.join(destination, 'internal-link')), await readlink(path.join(source, 'internal-link')));
    assert.equal(await validateProtectedLinuxTree(destination), undefined);
  });
  assert.equal(await validateProtectedLinuxTree(root), undefined);
});

const actualHostedLinuxUser = process.platform === 'linux' && ['x64', 'arm64'].includes(process.arch) && Number.isSafeInteger(process.getuid?.()) && process.getuid() > 0 && process.env.GITHUB_ACTIONS === 'true' && process.env.RUNNER_ENVIRONMENT === 'github-hosted';
test('actual ordinary non-hosted CLI refuses with finite output before creating its output directory', { skip: actualHostedLinuxUser }, async t => {
  const root = await mkdtemp(path.join(tmpdir(), 'lawoss-protected-cli-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const output = path.join(root, 'must-not-be-created');
  const child = spawnSync(process.execPath, [fileURLToPath(new URL('./probe-linux-protected-startup-ci.mjs', import.meta.url)), '--output-dir', output], {
    encoding: 'utf8', timeout: 10000, maxBuffer: 4096,
  });
  assert.equal(child.error, undefined);
  assert.equal(child.signal, null);
  assert.equal(child.status, 2);
  assert.equal(child.stderr, '');
  const lines = child.stdout.trim().split('\n');
  assert.equal(lines.length, 1);
  assert.deepEqual(JSON.parse(lines[0]), { kind: 'lawoss-ci-linux-protected-installation', status: 'refused', reason: 'native-hosted-nonroot-linux-required' });
  await assert.rejects(lstat(output), { code: 'ENOENT' });
});
