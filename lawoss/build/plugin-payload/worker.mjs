import { readFile, writeFile, lstat } from 'node:fs/promises';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { INPUT, REGISTRY, SDK_INTEGRITY, validateInputs, validateGraph, unchangedGraph, inventory, validatePhysical, sha256, fail } from './validate.mjs';
import { verifyWorkspace, candidatePreflight } from './prepare.mjs';
import { writeSupplementalNotices } from './notices.mjs';
const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(path.join(HERE, 'tools/package.json'));
const tool = require('@npmcli/arborist/package.json');
const [workspace, stage, mode, ...extra] = process.argv.slice(2);
const INPUT_BYTES = await readFile(path.join(HERE, 'sdk/package.json'));
let phase = 'admission';
try {
  if (extra.length || !['candidate', 'replay'].includes(mode) || process.version !== 'v24.21.0' || tool.version !== '9.4.0') fail('WORKER_INVALID');
  if (mode === 'candidate') {
    let exists = false;
    try { await lstat(path.join(HERE, 'sdk/package-lock.json')); exists = true; } catch (error) { if (error.code !== 'ENOENT') throw error; }
    candidatePreflight(exists);
  }
  await verifyWorkspace(workspace);
  if (path.dirname(stage) !== workspace || !/^\.stage-[a-f0-9-]{36}$/.test(path.basename(stage)) || !(await lstat(stage)).isDirectory()) fail('WORKER_INVALID');
  if (JSON.stringify(JSON.parse(INPUT_BYTES)) !== JSON.stringify(INPUT)) fail('INPUT_INVALID');
  await writeFile(path.join(stage, 'package.json'), INPUT_BYTES, { flag: 'wx' });
  const Arborist = require('@npmcli/arborist');
  const options = {
    path: stage, cache: path.join(workspace, 'cache'), registry: REGISTRY,
    ignoreScripts: true, audit: false, binLinks: true, packageLock: true,
    packageLockOnly: false, lockfileVersion: 3, installStrategy: 'hoisted',
    legacyPeerDeps: false, force: false, engineStrict: true, savePrefix: '', omit: [],
    fetchRetries: 0, fetchTimeout: 45000, offline: mode === 'replay', save: mode === 'candidate',
  };
  phase = 'resolution';
  if (mode === 'candidate') {
    await writeFile(path.join(workspace, '.candidate-once'), 'started\n', { flag: 'wx' });
    await new Arborist(options).reify({ save: true, saveType: 'prod', omit: [] });
    // Keep the genuine generated candidate even if subsequent validation rejects it.
    await writeFile(path.join(workspace, 'candidate-lock.json'), await readFile(path.join(stage, 'package-lock.json')), { flag: 'wx' });
  } else {
    await writeFile(path.join(stage, 'package-lock.json'), await readFile(path.join(HERE, 'sdk/package-lock.json')), { flag: 'wx' });
  }
  const lockBytes = await readFile(path.join(stage, 'package-lock.json'));
  const lock = validateInputs(JSON.parse(INPUT_BYTES), JSON.parse(lockBytes));
  const arb = new Arborist({ ...options, offline: true, save: false });
  const virtual = await arb.loadVirtual();
  const before = validateGraph(virtual, lock);
  phase = 'freeze';
  await arb.buildIdealTree({ save: false });
  unchangedGraph(before, arb.idealTree);
  const applicable = [...arb.idealTree.inventory.values()].filter(node => !node.inert).map(node => node.location);
  const inert = [...arb.idealTree.inventory.values()].filter(node => node.inert).map(node => node.location).sort();
  if (inert.some(location => !lock.packages[location]?.optional)) fail('GRAPH_INVALID');
  if (mode === 'replay') { phase = 'reify'; await arb.reify({ save: false, omit: [] }); }
  phase = 'physical';
  if (sha256(await readFile(path.join(stage, 'package.json'))) !== sha256(INPUT_BYTES) || sha256(await readFile(path.join(stage, 'package-lock.json'))) !== sha256(lockBytes)) fail('INPUT_DRIFT');
  const licenses = await validatePhysical(stage, lock, applicable, Arborist);
  phase = 'notices';
  await writeSupplementalNotices(stage);
  const files = await inventory(stage);
  const target = { platform: process.platform, arch: process.arch };
  if (process.platform === 'linux') target.libc = process.report.getReport().header.glibcVersionRuntime ? 'glibc' : 'musl';
  const manifest = {
    schema: 1, sdk: { name: '@opencode-ai/plugin', version: '1.18.29', integrity: SDK_INTEGRITY },
    lockSha256: sha256(lockBytes), inputSha256: sha256(INPUT_BYTES), node: process.version,
    target, arborist: tool.version, scripts: false,
    closure: applicable.sort(), inertOptional: inert, licenses, files,
  };
  // The closed receipt is the consumer commit point; publication occurs after child exit.
  await writeFile(path.join(stage, 'payload-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
} catch (error) {
  // No raw filesystem, registry or package error strings leave this isolated worker.
  console.error(JSON.stringify({ status: 'failed', phase, code: /^[A-Z_]{1,40}$/.test(error.code) ? error.code : 'WORKER_FAILED' }));
  process.exitCode = 1;
}
