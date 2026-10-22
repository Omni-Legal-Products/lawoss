// Parent test harness only. Never bundled into the worker or used by production.
import assert from 'node:assert/strict';
import { createRequire, builtinModules } from 'node:module';
import { spawnSync } from 'node:child_process';
import { copyFile, lstat, mkdir, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { metadata, hostTarget, fixture, owned, receipt } from '../../build/plugin-payload/embedded-runtime-verifier-fixture.mjs';
import { canonical, inventory, sha256, SDK_LOCK_SHA256, sdkConsumerMode } from '../../build/plugin-payload/validate.mjs';

const verifierNames = ['validate.mjs', 'notices.mjs', 'sdk/package.json', 'sdk/package-lock.json', 'sdk/notices/index.json',
  'sdk/notices/THIRD_PARTY_NOTICES.md', 'sdk/notices/licenses/opencode-MIT.txt', 'sdk/notices/licenses/msgpackr-extract-MIT.txt', 'sdk/notices/licenses/kubernetes-Apache-2.0.txt'];
const identity = stat => ({ dev: String(stat.dev), ino: String(stat.ino) });
const payload = new URL('../../build/plugin-payload/', import.meta.url);
const bound = result => {
  assert.ifError(result.error); assert.equal(result.signal, null); assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
};

export async function createStageBundleFixture(t, { node22, bun }) {
  // Capture P's unconditional removals instead of registering them on t. The
  // new owner runs them only after every retained real child and pipe closes.
  const cleanups = [], children = new Map();
  const contained = { after: callback => cleanups.push(callback) };
  let cleaned = false;
  async function cleanup() {
    if ([...children.values()].some(state => !state.close || !state.stdin || !state.stdout || !state.stderr)) throw new Error('FIXTURE_CHILD_CLOSURE_UNCERTAIN');
    if (!cleaned) { cleaned = true; for (const remove of cleanups.reverse()) await remove(); }
  }
  t.after(cleanup);
  const base = await owned(contained), f = await fixture(contained);
  const manifestSha256 = await receipt(f);
  assert.equal(bound(spawnSync(node22, ['--version'], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 })), 'v22.23.2');
  assert.equal(bound(spawnSync(bun, ['--version'], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 })), '1.4.2');
  const toolsAnchor = fileURLToPath(new URL('tools/package.json', payload));
  const toolsRequire = createRequire(toolsAnchor), arboristMetadata = toolsRequire.resolve('@npmcli/arborist/package.json');
  const arboristRequire = createRequire(arboristMetadata), tarMetadata = arboristRequire.resolve('tar/package.json');
  assert.equal(arboristRequire('tar/package.json').version, '7.5.22');
  const tarEntry = arboristRequire.resolve('tar'), tar = arboristRequire('tar');
  const resourceRoot = path.join(base, 'resource'), parent = path.join(base, 'parent'), stage = path.join(parent, 'stage');
  await mkdir(resourceRoot); await mkdir(parent, { mode: 0o700 }); await mkdir(stage, { mode: 0o700 });
  const verifier = path.join(resourceRoot, 'verifier');
  for (const name of verifierNames) {
    const destination = path.join(verifier, name);
    await mkdir(path.dirname(destination), { recursive: true }); await copyFile(new URL(name, payload), destination);
  }
  const capsule = path.join(resourceRoot, 'payload.tgz');
  tar.c({ cwd: f.root, file: capsule, gzip: true, sync: true, portable: true, noMtime: true }, ['.']);
  const capsuleBytes = await readFile(capsule), resourceInventory = await inventory(resourceRoot), stageInventory = await inventory(f.root);
  const request = { schema: 1, kind: 'lawoss-sdk-stage-decode', generation: 'a'.repeat(32), resourceRoot,
    resourceIdentity: identity(await lstat(resourceRoot, { bigint: true })),
    stageGrant: { path: stage, identity: identity(await lstat(stage, { bigint: true })), parent: { path: parent, ...identity(await lstat(parent, { bigint: true })) } },
    sdkIdentity: { schema: 1, kind: 'lawoss-product-sdk-capsule', status: 'verified', manifestSha256, target: hostTarget,
      lockSha256: SDK_LOCK_SHA256, inputSha256: sha256(metadata.acceptedInputText), sourceSetSha256: sha256(canonical(stageInventory)),
      consumerMode: sdkConsumerMode(hostTarget, SDK_LOCK_SHA256), verifierSha256: sha256(canonical(await inventory(verifier))),
      capsule: { format: 'tar+gzip', file: 'payload.tgz', sha256: sha256(capsuleBytes), bytes: capsuleBytes.length } }, deadline: Date.now() + 60000 };
  const build = path.join(base, 'build'), codeDirectory = path.join(base, 'isolated');
  await mkdir(build); await mkdir(codeDirectory);
  const entry = path.join(build, 'entry.mjs'), artifact = path.join(build, 'worker.cjs'), metafile = path.join(build, 'closure.json');
  const entryModule = fileURLToPath(new URL('../sdk-stage-decoder-entry.mjs', import.meta.url));
  const coreModule = fileURLToPath(new URL('../sdk-stage-decoder-core.mjs', import.meta.url));
  await writeFile(entry, `import * as tar from ${JSON.stringify(tarEntry)};\nimport { createProductSdkStageDecoder } from ${JSON.stringify(coreModule)};\nimport { runSdkStageDecoderEntry } from ${JSON.stringify(entryModule)};\nconst decode = createProductSdkStageDecoder({ tar, acceptedInputText: ${JSON.stringify(metadata.acceptedInputText)}, acceptedLockText: ${JSON.stringify(metadata.acceptedLockText)} });\nrunSdkStageDecoderEntry(decode).then(code => { process.exitCode = code; }, () => { process.exitCode = 1; });\n`);
  // Both flags are verified against this actual builder's help before use.
  const help = bound(spawnSync(bun, ['build', '--help'], { encoding: 'utf8', timeout: 10000, maxBuffer: 65536 }));
  assert.match(help, /--metafile=<val>/); assert.match(help, /--reject-unresolved/);
  const buildArgs = ['build', entry, '--outfile', artifact, '--target=node', '--format=cjs', `--metafile=${metafile}`, '--reject-unresolved'];
  const built = spawnSync(bun, buildArgs, { cwd: build, encoding: 'utf8', timeout: 20000, maxBuffer: 262144, env: { PATH: path.dirname(bun) } });
  bound(built);
  const graph = JSON.parse(await readFile(metafile, 'utf8'));
  const outputs = Object.values(graph.outputs); assert.equal(outputs.length, 1);
  const builtins = new Set(builtinModules.flatMap(name => [name, `node:${name}`]));
  const externals = [...outputs.flatMap(output => output.imports ?? []), ...Object.values(graph.inputs).flatMap(input => input.imports ?? []).filter(edge => edge.external)];
  for (const dependency of externals) {
    assert.ok(dependency.external && builtins.has(dependency.path), `unclosed worker import: ${dependency.path}`);
    assert.ok(!['child_process', 'node:child_process', 'module', 'node:module'].includes(dependency.path), `forbidden worker capability: ${dependency.path}`);
  }
  const closure = [];
  const expectedInputs = new Set([entry, tarEntry, coreModule, entryModule,
    fileURLToPath(new URL('../sdk-stage-decoder-contract.mjs', import.meta.url)), fileURLToPath(new URL('../sdk-stage-decoder-wire.mjs', import.meta.url)),
    ...['validate.mjs', 'notices.mjs', 'product-capsule-format.mjs', 'product-capsule-identity.mjs'].map(name => fileURLToPath(new URL(name, payload)))]);
  for (const [name, record] of Object.entries(graph.inputs)) {
    const resolved = path.resolve(build, name);
    assert.ok(expectedInputs.delete(resolved), `unexpected bundle input: ${resolved}`);
    assert.ok(!/\/(?:@npmcli\/arborist|sdk\/node_modules)\//.test(resolved));
    assert.ok(!/\/(?:prepare|installer)\.[cm]?js$/.test(resolved));
    const source = await readFile(resolved);
    closure.push({ path: resolved, bytes: source.length, sha256: sha256(source), imports: record.imports });
  }
  assert.equal(expectedInputs.size, 0, 'missing expected fixed composition input');
  const worker = path.join(codeDirectory, 'worker.cjs'); await copyFile(artifact, worker);
  const workerBytes = await readFile(worker);
  const emittedRequires = [...workerBytes.toString('utf8').matchAll(/\brequire\(\s*["']([^"']+)["']\s*\)/g)].map(match => match[1]);
  assert.ok(emittedRequires.length > 0, 'inspect the actual CJS emitted builtin calls');
  for (const name of emittedRequires) assert.ok(builtins.has(name) && !['child_process', 'node:child_process', 'module', 'node:module'].includes(name), `unexpected emitted require: ${name}`);
  // Actual graph + unresolved rejection are the closure proof; the emitted
  // artifact is retained by hash and runs alone below, not a substring oracle.
  const provenance = { synthetic: true, node22, node22Version: 'v22.23.2', node22Sha256: sha256(await readFile(node22)),
    bun, bunVersion: '1.4.2', bunSha256: sha256(await readFile(bun)), toolsAnchor, arboristMetadata, tarMetadata,
    arboristMetadataSha256: sha256(await readFile(arboristMetadata)), tarMetadataSha256: sha256(await readFile(tarMetadata)),
    tarVersion: '7.5.22', tarEntry, tarEntrySha256: sha256(await readFile(tarEntry)), buildArgs,
    builderStdout: built.stdout, builderStderr: built.stderr, closure, graph, externals, emittedRequires,
    acceptedInputSha256: sha256(metadata.acceptedInputText), acceptedLockSha256: sha256(metadata.acceptedLockText), workerSha256: sha256(workerBytes) };
  await rm(build, { recursive: true }); assert.deepEqual(await readdir(codeDirectory), ['worker.cjs']);
  function retainChild(child) {
    assert.equal(cleaned, false, 'cannot retain a child after fixture removal');
    const state = { close: false, stdin: false, stdout: false, stderr: false };
    assert.ok(!children.has(child)); children.set(child, state);
    child.once('close', () => { state.close = true; });
    for (const name of ['stdin', 'stdout', 'stderr']) child[name].once('close', () => { state[name] = true; });
    return Object.freeze({ get close() { return state.close; }, get stdin() { return state.stdin; },
      get stdout() { return state.stdout; }, get stderr() { return state.stderr; } });
  }
  return { base, f, stage, parent, resourceRoot, verifier, capsule, capsuleBytes, request, worker, codeDirectory,
    provenance, stageInventory, resourceInventory, retainChild, cleanup };
}
