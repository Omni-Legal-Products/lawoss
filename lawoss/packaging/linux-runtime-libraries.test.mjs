import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, mkdir, mkdtemp, readFile, readdir, rename, rm, symlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const packageRuntime = fileURLToPath(new URL('../../scripts/sandbox/package-runtime.mjs', import.meta.url));
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const cleanEnvironment = { PATH: process.env.PATH, LANG: 'C', LC_ALL: 'C' };
function command(executable, args, env = cleanEnvironment) {
  const result = spawnSync(executable, args, { env, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined, `${executable} must be executable: ${result.error?.code}`);
  assert.equal(result.signal, null, `${executable} must complete within its test budget`);
  assert.equal(result.status, 0, `${executable} failed: ${result.stderr}`);
  return result.stdout;
}

const native = {
  skip: process.platform !== 'linux' ? 'Real Linux ELF execution requires a native Linux host' : false,
  timeout: 120_000,
};
async function fixture(t) {
  // Missing build/inspection tools on Linux are a failed preflight, never a skip.
  for (const tool of ['gcc', 'readelf', 'ldd', 'patchelf']) command(tool, ['--version']);
  assert.ok(['x64', 'arm64'].includes(process.arch), 'Fixture requires a supported native runtime architecture');
  const root = await mkdtemp(join(tmpdir(), 'lawoss ELF closure '));
  t.after(() => rm(root, { recursive: true, force: true }));
  const sourceBin = join(root, 'original executable', 'bin');
  const libraries = join(root, 'original dependency libraries');
  const qemuSource = join(root, 'synthetic QEMU source');
  const licenses = join(root, 'synthetic dependency licenses');
  const data = join(root, 'synthetic QEMU data');
  const destination = join(root, 'staged runtime');
  for (const directory of [sourceBin, libraries, qemuSource, licenses, data, destination]) await mkdir(directory, { recursive: true });
  const libraryA = 'liblawoss-fixture-a.so.1', libraryB = 'liblawoss-fixture-b.so.1';
  const originalA = join(libraries, `${libraryA}.0`), originalB = join(libraries, `${libraryB}.0`);
  const sourceA = join(root, 'library a.c'), sourceB = join(root, 'library b.c'), sourceQemu = join(root, 'qemu fixture.c');
  const executable = `qemu-system-${process.arch === 'arm64' ? 'aarch64' : 'x86_64'}`;
  const qemu = join(sourceBin, executable);
  await writeFile(sourceB, 'int lawoss_fixture_b(void) { return 41; }\n');
  await writeFile(sourceA, 'extern int lawoss_fixture_b(void); int lawoss_fixture_a(void) { return lawoss_fixture_b() + 1; }\n');
  await writeFile(sourceQemu, '#include <stdio.h>\n#include <string.h>\nextern int lawoss_fixture_a(void);\nint main(int argc, char **argv) { if (argc == 2 && strcmp(argv[1], "--version") == 0) { printf("QEMU emulator version 11.1.2 fixture=%d\\n", lawoss_fixture_a()); return 0; } return 64; }\n');
  command('gcc', ['-shared', '-fPIC', sourceB, `-Wl,-soname,${libraryB}`, '-o', originalB]);
  await symlink(`${libraryB}.0`, join(libraries, libraryB));
  command('gcc', ['-shared', '-fPIC', sourceA, '-L', libraries, `-Wl,-rpath,${libraries}`, `-Wl,-soname,${libraryA}`, `-l:${libraryB}`, '-o', originalA]);
  await symlink(`${libraryA}.0`, join(libraries, libraryA));
  command('gcc', [sourceQemu, '-L', libraries, `-Wl,-rpath,${libraries}`, `-Wl,-rpath-link,${libraries}`, `-l:${libraryA}`, '-o', qemu]);
  assert.equal(command(qemu, ['--version']), 'QEMU emulator version 11.1.2 fixture=42\n');
  const originalHashes = new Map(await Promise.all([qemu, originalA, originalB].map(async file => [file, sha256(await readFile(file))])));
  const licenseTexts = [
    'Synthetic library A fixture license: MIT permission applies to liblawoss-fixture-a.so.1.\n',
    'Synthetic library B fixture license: MIT permission applies to liblawoss-fixture-b.so.1.\n',
  ];
  for (const [index, name] of [libraryA, libraryB].entries()) {
    await mkdir(join(licenses, name));
    await writeFile(join(licenses, name, 'COPYING'), licenseTexts[index]);
  }
  for (const name of ['COPYING', 'COPYING.LIB', 'LICENSE']) await writeFile(join(qemuSource, name), `Synthetic QEMU fixture ${name}\n`);
  for (const name of ['bios-256k.bin', 'linuxboot_dma.bin', 'kvmvapic.bin']) await writeFile(join(data, name), `Synthetic ${name}\n`);
  await writeFile(join(destination, 'kernel'), 'synthetic kernel\n');
  await writeFile(join(destination, 'initrd.gz'), 'synthetic initrd\n');
  const env = { ...cleanEnvironment, QEMU_SOURCE_DIR: qemuSource, QEMU_DATA_DIR: data, SANDBOX_DEPENDENCY_LICENSES: licenses };
  return { root, libraries, qemu, destination, executable, libraryA, libraryB, originalA, originalB, originalHashes, licenseTexts, licenses, sourceQemu, env };
}

test('Linux runtime CLI ships a relocatable transitive ELF closure without changing original binaries or depending on loader environment', native, async t => {
  const { root, libraries, qemu, destination, executable, libraryA, libraryB, originalA, originalB, originalHashes, licenseTexts, env } = await fixture(t);
  command(process.execPath, [packageRuntime, qemu, destination], env);
  for (const [file, expected] of originalHashes) assert.equal(sha256(await readFile(file)), expected, 'Packaging must patch owned copies only');

  const relocated = join(root, 'relocated final runtime');
  await rename(destination, relocated);
  await rename(libraries, join(root, 'hidden original dependency libraries'));
  // This is the regression oracle: a copied executable alone still points at
  // now-absent original libraries, and inherited LD_* variables cannot hide it.
  assert.equal(command(join(relocated, executable), ['--version'], { PATH: '/usr/bin:/bin', LANG: 'C', LC_ALL: 'C' }), 'QEMU emulator version 11.1.2 fixture=42\n');
  const manifest = JSON.parse(await readFile(join(relocated, 'manifest.json'), 'utf8'));
  assert.equal(manifest.qemuVersion, '11.1.2');
  assert.equal(manifest.architecture, process.arch === 'arm64' ? 'aarch64' : 'x86_64');
  for (const name of [executable, libraryA, libraryB]) {
    assert.equal(typeof manifest.files[name], 'string', `Manifest must cover ${name}`);
    const dynamic = command('readelf', ['-d', join(relocated, name)]);
    assert.match(dynamic, /\$(?:ORIGIN|\{ORIGIN\})/);
    assert.equal(dynamic.includes(libraries), false, 'Final ELF search paths must not retain the original build root');
  }
  const names = await readdir(relocated);
  assert.equal(names.some(name => /^(?:libc\.so|libm\.so|ld-linux|ld-[0-9])/.test(name)), false, 'The reviewed host glibc/loader baseline must not be bundled');
  assert.deepEqual(Object.keys(manifest.files).sort(), names.filter(name => name !== 'manifest.json').sort());
  for (const [name, expected] of Object.entries(manifest.files)) assert.equal(sha256(await readFile(join(relocated, name))), expected, `Final manifest hash differs for ${name}`);
  const notices = await readFile(join(relocated, 'third-party-notices.txt'), 'utf8');
  for (const text of licenseTexts) assert.ok(notices.includes(text), 'Full synthetic dependency license must ship');
  const sbom = JSON.stringify(JSON.parse(await readFile(join(relocated, 'third-party-sbom.json'), 'utf8')));
  for (const [name, original] of [[libraryA, originalA], [libraryB, originalB]]) {
    assert.ok(sbom.includes(name), 'SBOM must identify each shipped non-glibc library');
    assert.ok(sbom.includes(originalHashes.get(original)), 'SBOM must trace original library bytes');
    assert.ok(sbom.includes(manifest.files[name]), 'SBOM must trace final patched library bytes');
  }
});

async function refusesPackage(f, category) {
  const result = spawnSync(process.execPath, [packageRuntime, f.qemu, f.destination], { env: f.env, encoding: 'utf8', timeout: 30_000, maxBuffer: 1024 * 1024 });
  assert.equal(result.error, undefined); assert.equal(result.signal, null);
  assert.notEqual(result.status, 0, 'An unverified closure must not produce a successful runtime');
  if (category) assert.match(result.stderr, category);
  await assert.rejects(access(join(f.destination, 'manifest.json')));
}

test('Linux runtime CLI refuses an unowned dependency without its explicit license provenance', native, async t => {
  const f = await fixture(t);
  await rm(join(f.licenses, f.libraryB), { recursive: true });
  assert.equal(command(f.qemu, ['--version']), 'QEMU emulator version 11.1.2 fixture=42\n');
  await refusesPackage(f, /license provenance/i);
  for (const [file, expected] of f.originalHashes) assert.equal(sha256(await readFile(file)), expected);
});

test('Linux runtime CLI refuses a missing transitive ELF dependency instead of publishing a manifest', native, async t => {
  const f = await fixture(t);
  await rm(f.originalB);
  await refusesPackage(f);
  assert.equal(sha256(await readFile(f.qemu)), f.originalHashes.get(f.qemu));
});

test('Linux runtime CLI refuses two real ELFs resolving the same SONAME to different original files', native, async t => {
  const f = await fixture(t), alternate = join(f.root, 'conflicting original libraries');
  await mkdir(alternate);
  const sourceB = join(f.root, 'alternate b.c'), sourceC = join(f.root, 'library c.c');
  const libraryC = 'liblawoss-fixture-c.so.1';
  await writeFile(sourceB, 'int lawoss_fixture_b(void) { return 100; }\n');
  await writeFile(sourceC, 'extern int lawoss_fixture_b(void); int lawoss_fixture_c(void) { return lawoss_fixture_b(); }\n');
  command('gcc', ['-shared', '-fPIC', sourceB, `-Wl,-soname,${f.libraryB}`, '-o', join(alternate, f.libraryB)]);
  command('gcc', ['-shared', '-fPIC', sourceC, '-L', alternate, `-Wl,-rpath,${alternate}`, `-Wl,-soname,${libraryC}`, `-l:${f.libraryB}`, '-o', join(f.libraries, libraryC)]);
  command('gcc', [f.sourceQemu, '-L', f.libraries, `-Wl,-rpath,${f.libraries}`, `-Wl,-rpath-link,${f.libraries}`, `-l:${f.libraryA}`, '-Wl,--no-as-needed', `-l:${libraryC}`, '-o', f.qemu]);
  await mkdir(join(f.licenses, libraryC)); await writeFile(join(f.licenses, libraryC, 'COPYING'), 'Synthetic library C MIT fixture license\n');
  assert.equal(command(f.qemu, ['--version']), 'QEMU emulator version 11.1.2 fixture=42\n');
  await refusesPackage(f, /ambiguous/i);
});
