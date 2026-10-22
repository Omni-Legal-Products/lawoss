import './network-guard.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs, { chmod, link, lstat, mkdtemp, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { canonical, inventory } from './validate.mjs';

const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const scenario = process.argv[2];

// Each modeled observation runs in its own child, over actual inert files. This
// models exact IDs; it does not measure any historical Windows filesystem IDs.
async function exercise(name) {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), 'lawoss-inventory-identity-')));
  const files = [path.join(root, 'a.js'), path.join(root, 'b.js')];
  const content = ['throw Error("inert a");\n', 'throw Error("inert b");\n'];
  for (let i = 0; i < files.length; i++) await writeFile(files[i], content[i], { mode: 0o644 });
  const lstatDescriptor = Object.getOwnPropertyDescriptor(fs, 'lstat');
  const readDescriptor = Object.getOwnPropertyDescriptor(fs, 'readFile');
  const originalLstat = fs.lstat, originalRead = fs.readFile;
  try {
    if (name === 'collision' || name === 'duplicate') {
      const first = 2n ** 53n, second = name === 'collision' ? first + 1n : first;
      assert.equal(Number(first), Number(second));
      if (name === 'collision') assert.notEqual(first, second);
      const native = await Promise.all(files.map(file => lstat(file, { bigint: true })));
      assert.notEqual(`${native[0].dev}:${native[0].ino}`, `${native[1].dev}:${native[1].ino}`);
      assert.ok(native.every(stat => stat.isFile() && stat.nlink === 1n));
      const observed = [];
      Object.defineProperty(fs, 'lstat', { ...lstatDescriptor, value: async (file, options) => {
        const stat = await originalLstat(file, options), index = files.indexOf(file);
        if (index === -1) return stat;
        observed.push({ index, bigint: options?.bigint === true });
        const integer = value => options?.bigint === true ? value : Number(value);
        return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat,
          { dev: integer(native[0].dev), ino: integer(index === 0 ? first : second) });
      } });
      syncBuiltinESMExports();
      const failures = [];
      if (name === 'collision') {
        let records, primary;
        try { records = await inventory(root, event => failures.push(event)); }
        catch (error) { primary = error; }
        assert.equal(primary, undefined, `distinct exact IDs refused: ${JSON.stringify(failures)}`);
        assert.deepEqual(records, files.map((file, index) => ({ path: path.basename(file), bytes: Buffer.byteLength(content[index]),
          executable: !!(native[index].mode & 0o111n), sha256: hash(content[index]) })));
        assert.deepEqual(failures, []);
        assert.equal(canonical(records), canonical(JSON.parse(JSON.stringify(records))));
      } else {
        await assert.rejects(inventory(root, event => failures.push(event)), { code: 'TREE_UNSAFE' });
        assert.deepEqual(failures, [{ guard: 'inventory-identity', code: 'TREE_UNSAFE' }]);
        await assert.rejects(inventory(root), { code: 'TREE_UNSAFE' });
      }
      assert.deepEqual(observed.slice(0, 2), [{ index: 0, bigint: true }, { index: 1, bigint: true }]);
      assert.ok(observed.every(item => item.bigint));
    } else if (name === 'hardlink') {
      await rm(files[1]); await link(files[0], files[1]);
      assert.equal((await lstat(files[0], { bigint: true })).nlink, 2n);
      await assert.rejects(inventory(root), { code: 'TREE_UNSAFE' });
      for (const throwing of [false, true]) {
        const failures = [], observerError = new Error('observer must not replace refusal');
        let caught;
        try { await inventory(root, event => { failures.push(event); if (throwing) throw observerError; }); }
        catch (error) { caught = error; }
        assert.equal(caught?.code, 'TREE_UNSAFE'); assert.notEqual(caught, observerError);
        assert.deepEqual(failures, [{ guard: 'inventory-nlink', code: 'TREE_UNSAFE' }]);
      }
    } else if (name === 'outputs') {
      if (process.platform !== 'win32') await chmod(files[0], 0o755);
      const native = await Promise.all(files.map(file => lstat(file, { bigint: true })));
      const expected = files.map((file, index) => ({ path: path.basename(file), bytes: Buffer.byteLength(content[index]),
        executable: !!(native[index].mode & 0o111n), sha256: hash(content[index]) }));
      const failures = [], records = await inventory(root, event => failures.push(event));
      assert.deepEqual(records, expected); assert.deepEqual(failures, []);
      assert.ok(records.every(record => typeof record.bytes === 'number' && typeof record.executable === 'boolean'));
      assert.deepEqual(JSON.parse(JSON.stringify(records)), expected);
      assert.equal(canonical(records), canonical(expected));
    } else if (name === 'limits') {
      // Bounded real content, projected stat sizes. Track the actual content-read
      // boundary separately; identity/type/mode and filesystem backing stay real.
      const reads = [];
      let sizes = new Map();
      Object.defineProperty(fs, 'lstat', { ...lstatDescriptor, value: async (file, options) => {
        const stat = await originalLstat(file, options);
        if (!sizes.has(file)) return stat;
        const size = sizes.get(file);
        return Object.assign(Object.create(Object.getPrototypeOf(stat)), stat,
          { size: options?.bigint === true ? size : Number(size) });
      } });
      Object.defineProperty(fs, 'readFile', { ...readDescriptor, value: async (file, ...args) => {
        reads.push(file); return originalRead(file, ...args);
      } });
      syncBuiltinESMExports();
      const cap = 32n * 1024n * 1024n;
      sizes = new Map([[files[0], cap + 1n]]);
      let failures = [];
      await assert.rejects(inventory(root, event => failures.push(event)), { code: 'TREE_LIMIT' });
      assert.deepEqual(failures, [{ guard: 'inventory-limit', code: 'TREE_LIMIT' }]);
      assert.deepEqual(reads, []);
      // Exactly eight individually permitted files fill the original 256MiB cap.
      for (let i = 2; i < 9; i++) {
        files.push(path.join(root, `${i}.js`)); await writeFile(files.at(-1), 'inert');
      }
      const ordered = (await readdir(root)).sort().map(file => path.join(root, file));
      sizes = new Map(ordered.map((file, index) => [file, index === 8 ? 0n : cap]));
      const records = await inventory(root);
      assert.equal(records.reduce((sum, record) => sum + record.bytes, 0), 256 * 1024 * 1024);
      assert.ok(records.every(record => typeof record.bytes === 'number'));
      reads.length = 0; failures = [];
      sizes.set(ordered[8], 1n);
      await assert.rejects(inventory(root, event => failures.push(event)), { code: 'TREE_LIMIT' });
      assert.deepEqual(failures, [{ guard: 'inventory-limit', code: 'TREE_LIMIT' }]);
      assert.deepEqual(reads, ordered.slice(0, 8));
    } else throw Error(`unknown scenario: ${name}`);
  } finally {
    Object.defineProperty(fs, 'lstat', lstatDescriptor);
    Object.defineProperty(fs, 'readFile', readDescriptor);
    syncBuiltinESMExports();
    await rm(root, { recursive: true, force: true });
  }
}

if (scenario) {
  await exercise(scenario);
  console.log(`inventory-${scenario}-ok`);
} else {
  for (const [name, description] of [
    ['collision', 'modeled distinct exact IDs above 2^53 survive Number projection collision'],
    ['duplicate', 'modeled exact duplicate IDs still refuse at inventory-identity'],
    ['hardlink', 'native actual hardlinks refuse with default and throwing observers'],
    ['outputs', 'native small-file records retain Number/boolean fields and canonical JSON'],
    ['limits', 'modeled file and accumulated byte caps refuse before rejected content reads'],
  ]) test(description, () => {
    const child = spawnSync(process.execPath, [fileURLToPath(import.meta.url), name], {
      encoding: 'utf8', timeout: 20000,
      env: { PATH: path.dirname(process.execPath), ...(process.env.SystemRoot ? { SystemRoot: process.env.SystemRoot } : {}) },
    });
    assert.equal(child.error, undefined);
    assert.equal(child.status, 0, child.stderr);
    assert.equal(child.stdout.trim(), `inventory-${name}-ok`);
  });
}
