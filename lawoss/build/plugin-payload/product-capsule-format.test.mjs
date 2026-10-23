import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, open, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { gzipSync } from 'node:zlib';

const toolsRequire = createRequire(new URL('./tools/package.json', import.meta.url));
const arboristRequire = createRequire(toolsRequire.resolve('@npmcli/arborist/package.json'));
assert.equal(arboristRequire('tar/package.json').version, '7.5.22');
const tar = arboristRequire('tar');

// Inert format fixtures only. Never import build preparation or evaluate payload JS.
function tarBytes(entries, end = true) {
  const chunks = [];
  for (const item of entries) {
    const body = Buffer.from(item.body ?? '');
    const header = new tar.Header({ mode: 0o644, type: 'File', size: body.length, ...item });
    if (header.encode()) chunks.push(new tar.Pax({ path: item.path, linkpath: item.linkpath }).encode());
    chunks.push(header.block, body);
    const padding = (512 - body.length % 512) % 512;
    if (padding) chunks.push(Buffer.alloc(padding));
  }
  if (end) chunks.push(Buffer.alloc(1024));
  return Buffer.concat(chunks);
}

async function admission(t, raw) {
  const root = await mkdtemp(path.join(tmpdir(), 'lawoss-capsule-format-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = gzipSync(raw), archive = path.join(root, 'input.tgz');
  await writeFile(archive, bytes);
  const handle = await open(archive, 'r');
  t.after(() => handle.close());
  const { validateProductSdkCapsuleArchive } = await import('./product-capsule-format.mjs');
  return {
    run: () => validateProductSdkCapsuleArchive(handle, bytes.length, tar),
    async unchanged() {
      assert.deepEqual(await readFile(archive), bytes);
      assert.deepEqual(await readdir(root), ['input.tgz']);
      assert.equal((await handle.stat()).size, bytes.length);
    },
  };
}

test('standalone format admission accepts inert tar data and leaves the caller handle and directory unchanged', async t => {
  const f = await admission(t, tarBytes([
    { path: './', type: 'Directory' },
    { path: 'node_modules/tool/run.js', body: "throw new Error('Inert data must never execute');\n", mode: 0o755 },
    { path: 'node_modules/.bin/tool', type: 'SymbolicLink', linkpath: '../tool/run.js' },
    { path: 'node_modules/.bin/alias', type: 'SymbolicLink', linkpath: 'tool' },
  ]));
  assert.equal(await f.run(), undefined);
  await f.unchanged();
});

// Each case catches removal of an existing admission boundary without mirroring its predicates.
for (const [label, raw, code] of [
  ['parent traversal', tarBytes([{ path: '../escape' }]), 'PRODUCT_SDK_CAPSULE_INVALID'],
  ['case alias', tarBytes([{ path: 'File' }, { path: 'file' }]), 'PRODUCT_SDK_CAPSULE_INVALID'],
  ['missing bin target', tarBytes([{ path: 'node_modules/.bin/tool', type: 'SymbolicLink', linkpath: '../missing' }]), 'PRODUCT_SDK_CAPSULE_INVALID'],
  ['missing EOF', tarBytes([{ path: 'file' }], false), 'PRODUCT_SDK_CAPSULE_INVALID'],
  ['nonzero trailing bytes', Buffer.concat([tarBytes([{ path: 'file' }]), Buffer.from('hidden')]), 'PRODUCT_SDK_CAPSULE_INVALID'],
  ['nested gzip', gzipSync(tarBytes([{ path: 'file' }])), 'PRODUCT_SDK_CAPSULE_INVALID'],
  ['oversized entry', tarBytes([{ path: 'large', size: 32 * 1024 * 1024 + 1 }]), 'PRODUCT_SDK_CAPSULE_LIMIT'],
  ['oversized metadata', tarBytes([{ path: 'PaxHeader', type: 'ExtendedHeader', body: 'a'.repeat(65537) }]), 'PRODUCT_SDK_CAPSULE_LIMIT'],
]) test(`standalone format admission refuses ${label} without output or closing the caller handle`, async t => {
  const f = await admission(t, raw);
  await assert.rejects(f.run(), { code });
  await f.unchanged();
});
