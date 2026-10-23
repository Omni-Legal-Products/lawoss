// Build-only fixed composition. This binding is packaging data, never launch authority.
import { constants } from 'node:fs';
import { lstat, open, realpath, writeFile, readdir } from 'node:fs/promises';
import { createRequire, builtinModules } from 'node:module';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { canonical, SDK_LOCK_SHA256 } from './validate.mjs';

const limit = 16 * 1024 * 1024;
const invalid = () => { throw Object.assign(new Error('PRODUCT_SDK_WORKER_INVALID'), { code: 'PRODUCT_SDK_WORKER_INVALID' }); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const same = (a, b) => ['dev', 'ino', 'size', 'mtimeNs', 'ctimeNs', 'mode', 'nlink'].every(key => a[key] === b[key]);
const local = name => fileURLToPath(new URL(name, import.meta.url));
const builtin = new Set(builtinModules.flatMap(name => [name, `node:${name}`]).filter(name => !['child_process', 'node:child_process', 'module', 'node:module'].includes(name)));

async function physical(file, maximum = limit, single = true) {
  if (typeof file !== 'string' || file.length > 4096 || !path.isAbsolute(file) || path.resolve(file) !== file) invalid();
  const before = await lstat(file, { bigint: true });
  if (!before.isFile() || before.isSymbolicLink() || (single && before.nlink !== 1n) || before.size < 1n || before.size > BigInt(maximum) || await realpath(file) !== file) invalid();
  const handle = await open(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  let primary;
  try {
    if (!same(before, await handle.stat({ bigint: true }))) invalid();
    const bytes = Buffer.alloc(Number(before.size) + 1);
    let total = 0;
    while (total < bytes.length) {
      const result = await handle.read(bytes, total, bytes.length - total, null);
      if (!result.bytesRead) break;
      total += result.bytesRead;
    }
    if (BigInt(total) !== before.size || !same(before, await handle.stat({ bigint: true })) || !same(before, await lstat(file, { bigint: true })) || await realpath(file) !== file) invalid();
    return { file, stat: before, bytes: bytes.subarray(0, total), sha256: hash(bytes.subarray(0, total)), maximum, single };
  } catch (error) { primary = error; throw error; }
  finally {
    try { await handle.close(); }
    catch (cleanup) { if (primary) throw new AggregateError([primary, cleanup], 'Worker input and close failed', { cause: primary }); throw cleanup; }
  }
}
async function recheck(input) {
  const current = await physical(input.file, input.maximum, input.single);
  if (!same(input.stat, current.stat) || input.sha256 !== current.sha256) invalid();
}
// A fixed capture cap, with close and both pipe closes joined even after failure.
// No timeout may retire the generation while the compiler can still write.
function run(bun, args, cwd) {
  return new Promise((resolve, reject) => {
    const child = spawn(bun, args, { cwd, env: { PATH: path.dirname(bun) }, shell: false, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    const chunks = [], closed = new Set(); let total = 0, primary, status, signal;
    const stop = error => { primary ??= error; try { child.kill('SIGKILL'); } catch { /* Retain ownership until actual close. */ } };
    const finish = () => {
      if (closed.size !== 3) return;
      if (primary) reject(primary);
      else if (status !== 0 || signal !== null) reject(Object.assign(new Error('PRODUCT_SDK_WORKER_COMPILER_FAILED'), { code: 'PRODUCT_SDK_WORKER_COMPILER_FAILED' }));
      else resolve(Buffer.concat(chunks).toString('utf8'));
    };
    child.on('error', stop);
    child.on('close', (code, value) => { status = code; signal = value; closed.add('child'); finish(); });
    for (const name of ['stdout', 'stderr']) {
      const stream = name === 'stdout' ? child.stdout : child.stderr;
      stream.on('error', stop);
      stream.on('data', chunk => {
        total += chunk.length;
        if (total > 262144) stop(Object.assign(new Error('PRODUCT_SDK_WORKER_OUTPUT_LIMIT'), { code: 'PRODUCT_SDK_WORKER_OUTPUT_LIMIT' }));
        else if (name === 'stdout') chunks.push(chunk);
      });
      stream.on('close', () => { closed.add(name); finish(); });
    }
  });
}
/** Explicit trusted build input, checked before generation mutation. */
export async function admitProductSdkWorkerBun(bunPath) {
  const executable = await physical(bunPath, 256 * 1024 * 1024);
  if (process.platform !== 'win32' && !(executable.stat.mode & 0o111n)) invalid();
  if ((await run(bunPath, ['--version'], path.dirname(bunPath))).trim() !== '1.4.2') invalid();
  await recheck(executable);
  return executable;
}

function object(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) invalid();
  return value;
}
function graphCheck(graph, root, expected, output, workerText) {
  object(graph); const inputs = Object.entries(object(graph.inputs)), outputs = Object.entries(object(graph.outputs));
  if (inputs.length !== expected.size || outputs.length !== 1 || path.resolve(root, outputs[0][0]) !== output) invalid();
  const outputRecord = object(outputs[0][1]);
  if (outputRecord.bytes !== Buffer.byteLength(workerText) || path.resolve(root, outputRecord.entryPoint) !== path.join(root, 'worker-entry.mjs')) invalid();
  const contributions = Object.keys(object(outputRecord.inputs));
  if (contributions.length !== expected.size || contributions.some(name => !expected.has(path.resolve(root, name)))) invalid();
  const seen = new Set(), externalInputs = new Set();
  const edges = record => {
    if (!Number.isSafeInteger(record.bytes) || record.bytes < 1 || !Array.isArray(record.imports) || record.imports.length > 64) invalid();
    return record.imports;
  };
  for (const [name, record] of inputs) {
    const file = path.resolve(root, name), source = expected.get(file);
    if (!source || seen.has(file) || record.bytes !== source.bytes.length) invalid();
    seen.add(file);
    const actual = [];
    for (const edge of edges(record)) {
      object(edge);
      if (typeof edge.path !== 'string' || !['import-statement', 'require-call'].includes(edge.kind)) invalid();
      if (edge.external === true) { if (!builtin.has(edge.path)) invalid(); actual.push(edge.path); externalInputs.add(edge.path); }
      else { const resolved = path.resolve(root, edge.path); if (!expected.has(resolved)) invalid(); actual.push(resolved); }
    }
    // Exact source import graph, including bundled tar's static builtin requires.
    const sourceEdges = [...source.bytes.toString('utf8').matchAll(/(?:\bfrom\s*|\brequire\(\s*)["']([^"']+)["']/g)].map(match => {
      const specifier = match[1];
      return builtin.has(specifier) ? specifier : path.resolve(path.dirname(file), specifier);
    });
    if (canonical([...new Set(actual)].sort()) !== canonical([...new Set(sourceEdges)].sort())) invalid();
  }
  const emitted = [];
  for (const edge of edges(outputs[0][1])) {
    if (edge.external !== true || !builtin.has(edge.path) || edge.kind !== 'require-call') invalid();
    emitted.push(edge.path);
  }
  const requires = [...workerText.matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map(match => match[1]);
  if (!requires.length || requires.some(name => !builtin.has(name)) || requires.some(name => !externalInputs.has(name)) || emitted.some(name => !requires.includes(name))) invalid();
  // Fixed trusted compiler output must not contain unresolved/dynamic call sites.
  if (/\brequire\s*\(/.test(workerText.replace(/\brequire\(\s*["'][^"']+["']\s*\)/g, ''))) invalid();
}

export async function buildProductSdkStageWorker({ applicationCodeRoot, bunPath }) {
  const tool = await admitProductSdkWorkerBun(bunPath);
  const root = await lstat(applicationCodeRoot, { bigint: true });
  if (!path.isAbsolute(applicationCodeRoot) || await realpath(applicationCodeRoot) !== applicationCodeRoot || !root.isDirectory() || root.isSymbolicLink() ||
    (typeof process.getuid === 'function' && (root.uid !== BigInt(process.getuid()) || (root.mode & 0o077n))) || (await readdir(applicationCodeRoot)).length) invalid();
  const req = createRequire(local('tools/package.json'));
  const arboristMetadata = await realpath(req.resolve('@npmcli/arborist/package.json'));
  const tarRequire = createRequire(arboristMetadata);
  const tarMetadata = await realpath(tarRequire.resolve('tar/package.json'));
  const tarEntry = await realpath(tarRequire.resolve('tar'));
  const metadataPaths = [local('tools/package.json'), local('tools/pnpm-lock.yaml'), arboristMetadata, tarMetadata, local('sdk/package.json'), local('sdk/package-lock.json')];
  const metadata = await Promise.all(metadataPaths.map(file => physical(file, limit, false)));
  if (JSON.parse(metadata[2].bytes.toString()).version !== '9.4.0' || JSON.parse(metadata[3].bytes.toString()).version !== '7.5.22' ||
    metadata[4].sha256 !== '4129dbab935b7ee959557c6b6e4c5dea29e93f77c41ec9c056a379426b0e2536' || metadata[5].sha256 !== SDK_LOCK_SHA256) invalid();
  const core = local('../../engine-dependencies/sdk-stage-decoder-core.mjs'), entryModule = local('../../engine-dependencies/sdk-stage-decoder-entry.mjs');
  const entry = path.join(applicationCodeRoot, 'worker-entry.mjs'), output = path.join(applicationCodeRoot, 'worker.cjs'), metafile = path.join(applicationCodeRoot, 'worker-closure.json');
  await writeFile(entry, `import * as tar from ${JSON.stringify(tarEntry)};\nimport { createProductSdkStageDecoder } from ${JSON.stringify(core)};\nimport { runSdkStageDecoderEntry } from ${JSON.stringify(entryModule)};\nconst decode = createProductSdkStageDecoder({ tar, acceptedInputText: ${JSON.stringify(metadata[4].bytes.toString())}, acceptedLockText: ${JSON.stringify(metadata[5].bytes.toString())} });\nrunSdkStageDecoderEntry(decode).then(code => { process.exitCode = code; }, () => { process.exitCode = 1; });\n`, { flag: 'wx', mode: 0o600 });
  const files = [entry, tarEntry, core, entryModule, ...['contract', 'wire'].map(name => local(`../../engine-dependencies/sdk-stage-decoder-${name}.mjs`)),
    ...['validate.mjs', 'notices.mjs', 'product-capsule-format.mjs', 'product-capsule-identity.mjs'].map(local)];
  const inputs = await Promise.all(files.map(file => physical(file, limit, false)));
  await recheck(tool);
  await run(bunPath, ['build', entry, '--outfile', output, '--target=node', '--format=cjs', `--metafile=${metafile}`, '--reject-unresolved'], applicationCodeRoot);
  const worker = await physical(output), graphFile = await physical(metafile, 1024 * 1024);
  const graph = JSON.parse(graphFile.bytes.toString('utf8'));
  graphCheck(graph, applicationCodeRoot, new Map(inputs.map(input => [input.file, input])), output, worker.bytes.toString('utf8'));
  for (const input of [tool, ...metadata, ...inputs, worker, graphFile]) await recheck(input);
  const after = await lstat(applicationCodeRoot, { bigint: true });
  if (after.dev !== root.dev || after.ino !== root.ino || await realpath(applicationCodeRoot) !== applicationCodeRoot) invalid();
  const compositionSha256 = hash(canonical({ schema: 1, bun: { version: '1.4.2', file: tool.file, sha256: tool.sha256 },
    inputs: [...metadata, ...inputs].map(input => ({ file: input.file, bytes: input.bytes.length, sha256: input.sha256 })), graph }));
  return Object.freeze({ format: 'cjs', file: 'worker.cjs', bytes: worker.bytes.length, sha256: worker.sha256, compositionSha256 });
}
