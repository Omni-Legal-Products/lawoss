import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { createRequire } from 'node:module';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import {
  FIXTURE_POLICY, PUBLIC_MANIFEST_SHA256, FIXTURE_ACCEPT,
  projectAcceptedMetadata, validateAcceptedClosure, fixtureCacheKey, fixtureCacheMetadata,
} from './native-merged-cache-projection.mjs';

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, '../..');
const sdk = path.join(root, 'lawoss/build/plugin-payload/sdk');
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const clone = value => JSON.parse(JSON.stringify(value));
const publicBytes = await fs.readFile(path.join(sdk, 'public-package-manifests.json'));
const lockBytes = await fs.readFile(path.join(sdk, 'package-lock.json'));
assert.equal(digest(lockBytes), '59f4b854ddab534533fd878c5a7c325a7a1bc3382294d68111cff005920a4053');
assert.equal(digest(publicBytes), 'c32b99452423523be83ebf1c5f2d2d756be69646275b6dc1c60da1de53d01e2d');
const acceptedLock = JSON.parse(lockBytes), acceptedPublic = JSON.parse(publicBytes);
const selection = ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'engines', 'os', 'cpu', 'libc', 'bundleDependencies', 'bundledDependencies'];
const missingPublic = ['darwin-x64', 'linux-arm', 'linux-arm64', 'linux-x64', 'win32-x64'].map(s => `@msgpackr-extract/msgpackr-extract-${s}`);

// Resolve only the accepted physical distribution, including each transitive
// caller's manifest AND entry. No ambient aliases, installation or acquisition.
const physical = await fs.realpath(path.join(root, 'apps/desktop/resources/engine-dependencies/runtime-tools/node_modules'));
async function bind(require, name, version) {
  const manifest = await fs.realpath(require.resolve(`${name}/package.json`));
  const entry = await fs.realpath(require.resolve(name));
  for (const file of [manifest, entry]) {
    const relative = path.relative(physical, file);
    assert.ok(relative && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative));
  }
  const pkg = JSON.parse(await fs.readFile(manifest));
  assert.equal(pkg.name, name); assert.equal(pkg.version, version);
  assert.ok(entry.startsWith(path.dirname(manifest) + path.sep));
  return { api: require(name), require: createRequire(entry) };
}
const tools = createRequire(path.join(physical, '../package.json'));
const arborist = await bind(tools, '@npmcli/arborist', '9.4.0');
await bind(tools, '@npmcli/config', '10.8.1');
const pacote = await bind(arborist.require, 'pacote', '21.5.1');
const registry = await bind(pacote.require, 'npm-registry-fetch', '19.1.1');
const fetchBinding = await bind(registry.require, 'make-fetch-happen', '15.0.6');
const cacheBinding = await bind(arborist.require, 'cacache', '20.0.4');
const fetch = fetchBinding.api, cacache = cacheBinding.api;
for (const [name, version] of [['minipass-fetch', '5.0.2'], ['negotiator', '1.1.0'], ['http-cache-semantics', '4.3.0'], ['ssri', '13.0.1']]) await bind(fetchBinding.require, name, version);
await bind(cacheBinding.require, 'ssri', '13.0.1');
const npa = (await bind(arborist.require, 'npm-package-arg', '13.0.2')).api;
const semver = (await bind(arborist.require, 'semver', '7.8.5')).api;
const apis = { npa, semver };
function record(name, lock = acceptedLock) { return { name, ...lock.packages[`node_modules/${name}`] }; }
function raw(name, representation = 'full') {
  const r = record(name);
  const version = clone(acceptedPublic[`node_modules/${name}`] ?? { name, version: r.version });
  for (const field of selection) if (Object.hasOwn(r, field)) version[field] = clone(r[field]);
  version.dist = { tarball: r.resolved, integrity: r.integrity, signatures: [{ keyid: 'inert', sig: representation }] };
  version.scripts = { ...(version.scripts ?? {}), fixture: 'inert text only; never execute' };
  version.fixture = { representation, nested: [false, null, { '__proto__': null, value: 'é' }] };
  return { name, versions: { [r.version]: version }, 'dist-tags': { approved: r.version }, fixture: { representation } };
}
function graph(representation) {
  return new Map(Object.keys(acceptedLock.packages).filter(key => key !== '').map(key => {
    const name = key.slice('node_modules/'.length);
    return [name, projectAcceptedMetadata(raw(name, representation), record(name))];
  }));
}
function fixture() { return { graph: graph('full'), lock: clone(acceptedLock), manifests: clone(acceptedPublic) }; }
function run(f) { return validateAcceptedClosure(f.graph, f.lock, f.manifests, apis); }
function version(f, name) { const packument = f.graph.get(name); return packument.versions[packument['dist-tags'].approved]; }
function setSelection(f, name, field, value) {
  version(f, name)[field] = clone(value);
  f.lock.packages[`node_modules/${name}`][field] = clone(value);
  if (f.manifests[`node_modules/${name}`]) f.manifests[`node_modules/${name}`][field] = clone(value);
}
function drift(action) {
  assert.throws(action, error => error instanceof Error && error.code === 'INPUT_DRIFT' && error.message === 'INPUT_DRIFT' && !Object.hasOwn(error, 'cause'));
}
function freeze(value) { if (value && typeof value === 'object') { Object.freeze(value); for (const child of Object.values(value)) freeze(child); } return value; }

test('fixed policy and pinned witnesses retain all32, public27, foreign5 and optional plugin3 in each independent representation', () => {
  assert.equal(FIXTURE_POLICY, 'accepted-version-fixture-v1');
  assert.equal(PUBLIC_MANIFEST_SHA256, digest(publicBytes));
  assert.equal(Object.keys(acceptedPublic).length, 27);
  for (const representation of ['full', 'corgi']) {
    const projected = graph(representation);
    assert.equal(projected.size, 32);
    assert.equal(validateAcceptedClosure(projected, freeze(clone(acceptedLock)), freeze(clone(acceptedPublic)), apis), undefined);
    for (const name of missingPublic) { assert.ok(projected.has(name)); assert.equal(Object.hasOwn(acceptedPublic, `node_modules/${name}`), false); }
    const plugin = projected.get('@opencode-ai/plugin').versions['1.18.29'];
    assert.deepEqual(Object.keys(plugin.peerDependencies), ['@opentui/core', '@opentui/keymap', '@opentui/solid']);
    for (const name of Object.keys(plugin.peerDependencies)) { assert.equal(projected.has(name), false); assert.deepEqual(plugin.peerDependenciesMeta[name], { optional: true }); }
  }
});

test('multipasta newer0.2.9/latest is removed; accepted0.2.8 JSON values and unchanged effect ^0.2.7 survive without mutation or aliases', () => {
  for (const representation of ['full', 'corgi']) {
    const source = raw('multipasta', representation);
    source.versions['0.2.9'] = { ...clone(source.versions['0.2.8']), version: '0.2.9' };
    source['dist-tags'] = { latest: '0.2.9', stable: '0.2.8', beta: '0.2.7' };
    const bytes = JSON.stringify(source), retainedDigest = digest(JSON.stringify(source.versions['0.2.8']));
    const projected = projectAcceptedMetadata(freeze(source), freeze(record('multipasta')));
    assert.deepEqual(Object.keys(projected.versions), ['0.2.8']);
    assert.deepEqual(projected['dist-tags'], { stable: '0.2.8' });
    assert.equal(digest(JSON.stringify(projected.versions['0.2.8'])), retainedDigest);
    assert.equal(JSON.stringify(source), bytes);
    projected.versions['0.2.8'].dist.signatures[0].sig = 'changed'; projected.fixture.representation = 'changed';
    assert.equal(JSON.stringify(source), bytes);
    const f = fixture(); f.graph.set('multipasta', projectAcceptedMetadata(source, record('multipasta'))); run(f);
    assert.equal(version(f, 'effect').dependencies.multipasta, '^0.2.7');
    assert.equal(npa.resolve('multipasta', '^0.2.7').type, 'range');
    assert.equal(semver.satisfies('0.2.8', '^0.2.7'), true);
    assert.equal(semver.satisfies('0.2.9', '^0.2.7'), true);
  }
});

test('absent/empty/latest tag states and absent/empty alternate maps preserve own-key presence exactly', () => {
  for (const tags of [undefined, {}, { latest: '0.2.8' }, { latest: '0.2.9' }]) {
    const source = raw('multipasta'); if (tags === undefined) delete source['dist-tags']; else source['dist-tags'] = tags;
    for (const field of ['stagedVersions', 'policyRestrictions']) source[field] = {};
    const projected = projectAcceptedMetadata(source, record('multipasta'));
    assert.equal(Object.hasOwn(projected, 'dist-tags'), tags !== undefined);
    if (tags !== undefined) assert.deepEqual(projected['dist-tags'], tags.latest === '0.2.8' ? tags : {});
    for (const field of ['stagedVersions', 'policyRestrictions']) assert.deepEqual(projected[field], {});
  }
  const source = raw('multipasta');
  for (const field of ['stagedVersions', 'policyRestrictions']) assert.equal(Object.hasOwn(projectAcceptedMetadata(source, record('multipasta')), field), false);
});

test('malformed root/maps, alternate candidates and accepted own-key identity drift refuse with finite errors', () => {
  const cases = [
    () => null, () => [], x => ({ ...x, name: 'other' }), x => ({ ...x, versions: [] }),
    x => ({ ...x, versions: {} }), x => ({ ...x, versions: null }),
    ...['name', 'version', 'dist'].map(field => x => { delete x.versions['0.2.8'][field]; return x; }),
    ...['name', 'version'].map(field => x => { x.versions['0.2.8'][field] = 'wrong'; return x; }),
    ...['tarball', 'integrity'].flatMap(field => [x => { delete x.versions['0.2.8'].dist[field]; return x; }, x => { x.versions['0.2.8'].dist[field] = 'wrong'; return x; }]),
    ...['dist-tags', 'stagedVersions', 'policyRestrictions'].flatMap(field => [null, [], 'text', 1].map(value => x => ({ ...x, [field]: value }))),
    x => ({ ...x, 'dist-tags': { latest: 8 } }),
    x => ({ ...x, stagedVersions: { '0.2.9': {} } }),
    x => ({ ...x, policyRestrictions: { versions: { '0.2.9': {} } } }),
  ];
  for (const mutate of cases) drift(() => projectAcceptedMetadata(mutate(raw('multipasta')), record('multipasta')));
});

test('each selection field requires exact presence and JSON equality against both available witnesses', () => {
  for (const field of selection) {
    const f = fixture(); version(f, 'multipasta')[field] = field.endsWith('Dependencies') || field === 'engines' || field === 'peerDependenciesMeta' ? {} : [];
    drift(() => run(f));
  }
  for (const [name, field] of [['effect', 'dependencies'], ['msgpackr', 'optionalDependencies'], ['@opencode-ai/plugin', 'peerDependencies'], ['@opencode-ai/plugin', 'peerDependenciesMeta'], ['ini', 'engines'], [missingPublic[0], 'cpu'], [missingPublic[0], 'os']]) {
    const f = fixture(); delete version(f, name)[field]; drift(() => run(f));
  }
  const changed = fixture(); version(changed, 'effect').dependencies.multipasta = '^0.2.8'; drift(() => run(changed));
  const contradictory = fixture(); contradictory.manifests['node_modules/effect'].dependencies.multipasta = '^0.2.8'; drift(() => run(contradictory));
  const reordered = fixture(); version(reordered, 'effect').dependencies = Object.fromEntries(Object.entries(version(reordered, 'effect').dependencies).reverse()); run(reordered);
  const dev = fixture(); version(dev, 'multipasta').devDependencies = { 'not-installed': 'git+https://example.invalid/inert' }; run(dev);
});

test('closure refuses count substitution, wrong public identities, extra candidates and lock identity drift', () => {
  const cases = [
    f => f.graph.delete(missingPublic[0]), f => f.graph.set('extra', f.graph.get('multipasta')),
    f => delete f.lock.packages['node_modules/multipasta'],
    f => { f.lock.packages['node_modules/extra'] = clone(f.lock.packages['node_modules/multipasta']); },
    f => delete f.manifests['node_modules/multipasta'],
    f => { delete f.manifests['node_modules/multipasta']; f.manifests[`node_modules/${missingPublic[0]}`] = { name: missingPublic[0], version: '3.0.4' }; },
    f => { f.manifests[`node_modules/${missingPublic[0]}`] = { name: missingPublic[0], version: '3.0.4' }; },
    f => { f.manifests['node_modules/multipasta'].name = 'wrong'; }, f => { f.manifests['node_modules/multipasta'].version = '0.2.9'; },
    f => { f.graph.get('multipasta').versions['0.2.9'] = clone(version(f, 'multipasta')); },
    ...['version', 'resolved', 'integrity'].map(field => f => { f.lock.packages['node_modules/multipasta'][field] = 'wrong'; }),
  ];
  for (const mutate of cases) { const f = fixture(); mutate(f); drift(() => run(f)); }
  drift(() => validateAcceptedClosure({}, acceptedLock, acceptedPublic, apis));
});

test('supported pinned npa version/range semantics close effective optional overrides; unsupported/tag/unsatisfied edges refuse unchanged', () => {
  for (const spec of ['latest', 'approved', 'npm:multipasta@0.2.8', 'git+https://example.invalid/pkg.git', 'file:../pkg', 'https://example.invalid/pkg.tgz', 'workspace:*', '^9.0.0', '0.2.9']) {
    const f = fixture(); setSelection(f, 'effect', 'dependencies', { ...version(f, 'effect').dependencies, multipasta: spec });
    drift(() => run(f)); assert.equal(version(f, 'effect').dependencies.multipasta, spec);
  }
  for (const spec of ['0.2.8', '^0.2.7', '>=0.2.7 <0.3.0']) {
    const f = fixture(); setSelection(f, 'effect', 'dependencies', { ...version(f, 'effect').dependencies, multipasta: spec }); run(f);
    assert.equal(version(f, 'effect').dependencies.multipasta, spec);
  }
  const override = fixture(); setSelection(override, 'effect', 'dependencies', { multipasta: '^9.0.0' }); setSelection(override, 'effect', 'optionalDependencies', { multipasta: '^0.2.7' }); run(override);
  for (const field of ['dependencies', 'optionalDependencies']) {
    const f = fixture(); setSelection(f, 'effect', field, { missing: '*' }); drift(() => run(f));
    for (const malformed of [[], null, { multipasta: 7 }]) { const f = fixture(); setSelection(f, 'effect', field, malformed); drift(() => run(f)); }
  }
});

test('only exact witnessed optional plugin3 omissions pass; raw flags, other optional peers and missing mandatory peers never authorize omission', () => {
  for (const flags of [undefined, { optional: false }, { optional: true, extra: true }]) {
    const f = fixture(); const plugin = version(f, '@opencode-ai/plugin');
    if (flags === undefined) delete plugin.peerDependenciesMeta['@opentui/core']; else plugin.peerDependenciesMeta['@opentui/core'] = flags;
    drift(() => run(f));
  }
  for (const name of ['effect', '@opencode-ai/plugin']) {
    const f = fixture(); setSelection(f, name, 'peerDependencies', { missing: '^1.0.0' }); setSelection(f, name, 'peerDependenciesMeta', { missing: { optional: true } }); drift(() => run(f));
  }
  const mandatory = fixture(); setSelection(mandatory, 'effect', 'peerDependencies', { missing: '^1.0.0' }); drift(() => run(mandatory));
  const wrongRange = fixture(); setSelection(wrongRange, '@opencode-ai/plugin', 'peerDependencies', { ...version(wrongRange, '@opencode-ai/plugin').peerDependencies, '@opentui/core': '>=0.4.6' }); drift(() => run(wrongRange));
  const installed = fixture(); setSelection(installed, 'effect', 'peerDependencies', { multipasta: '^0.2.7' }); run(installed);
  const unsatisfied = fixture(); setSelection(unsatisfied, 'effect', 'peerDependencies', { multipasta: '^9.0.0' }); drift(() => run(unsatisfied));
});

test('cache adapter admits only canonical registry metadata URLs, exact Accept variants and lowercase SHA256 provenance', () => {
  assert.deepEqual(FIXTURE_ACCEPT, ['application/json', 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*']);
  for (const name of ['multipasta', '@opencode-ai/plugin']) {
    const url = `https://registry.npmjs.org/${npa.resolve(name, record(name).version).escapedName}`;
    assert.equal(fixtureCacheKey(url), `make-fetch-happen:request-cache:${url}`);
    for (const [index, accept] of FIXTURE_ACCEPT.entries()) assert.deepEqual(fixtureCacheMetadata({ url, accept, rawBodySha256: 'a'.repeat(64) }), {
      time: 1, url, reqHeaders: { accept }, resHeaders: { 'content-type': index ? 'application/vnd.npm.install-v1+json' : 'application/json', vary: 'accept', 'cache-control': 'max-age=0' },
      options: { compress: true }, lawossFixture: { schema: 1, policy: FIXTURE_POLICY, rawBodySha256: 'a'.repeat(64) },
    });
  }
  for (const url of ['http://registry.npmjs.org/multipasta', 'https://user@registry.npmjs.org/multipasta', 'https://registry.npmjs.org:443/multipasta', 'https://registry.npmjs.org/multipasta?x=1', 'https://registry.npmjs.org/multipasta#x', 'https://registry.npmjs.org/@opencode-ai/plugin', 'https://registry.npmjs.org/@opencode-ai%2Fplugin', 'https://registry.npmjs.org/../multipasta', 'https://registry.npmjs.org/multipasta/-/x.tgz', 'https://other.invalid/multipasta']) drift(() => fixtureCacheKey(url));
  for (const accept of [undefined, '*/*', 'text/plain', 'application/json ']) drift(() => fixtureCacheMetadata({ url: 'https://registry.npmjs.org/multipasta', accept, rawBodySha256: 'a'.repeat(64) }));
  for (const rawBodySha256 of [undefined, 'a'.repeat(63), 'A'.repeat(64), 'g'.repeat(64)]) drift(() => fixtureCacheMetadata({ url: 'https://registry.npmjs.org/multipasta', accept: FIXTURE_ACCEPT[0], rawBodySha256 }));
});

test('malformed API option records refuse with INPUT_DRIFT rather than an uncontrolled destructuring error', () => {
  for (const options of [null, [], 7, 'text']) {
    drift(() => fixtureCacheMetadata(options));
    drift(() => validateAcceptedClosure(graph('full'), acceptedLock, acceptedPublic, options));
  }
});

async function withCache(action) {
  const cache = await fs.mkdtemp(path.join(os.tmpdir(), 'lawoss-accepted-policy-'));
  let primary;
  try { await action(cache); } catch (error) { primary = error; }
  try { await fs.rm(cache, { recursive: true, force: true }); } catch (cleanup) {
    if (primary) throw new AggregateError([primary, cleanup], 'primary and owned cleanup failures', { cause: primary });
    throw cleanup;
  }
  if (primary) throw primary;
}
const url = 'https://registry.npmjs.org/multipasta';
function body(index) { return Buffer.from(JSON.stringify(projectAcceptedMetadata(raw('multipasta', index ? 'corgi' : 'full'), record('multipasta')))); }
async function put(cache, index) {
  const bytes = body(index);
  return cacache.put(cache, fixtureCacheKey(url), bytes, { time: 1, algorithms: ['sha512'], size: bytes.length,
    metadata: fixtureCacheMetadata({ url, accept: FIXTURE_ACCEPT[index], rawBodySha256: digest(bytes) }) });
}
async function read(cache, accept, compress = true) {
  const response = await fetch(url, { cachePath: cache, cache: 'only-if-cached', headers: { accept }, compress, retry: { retries: 0 }, redirect: 'error', strictSSL: true });
  try { assert.equal(response.status, 200); return { bytes: await response.buffer(), response }; }
  finally { response.body?.destroy(); }
}
test('public cacache20.0.4 writes and pinned make-fetch-happen15.0.6 offline stale reads distinguish exact bytes in both insertion orders', async () => {
  assert.notDeepEqual(body(0), body(1));
  for (const order of [[0, 1], [1, 0]]) await withCache(async cache => {
    for (const index of order) await put(cache, index);
    assert.equal(Object.keys(await cacache.ls(cache)).length, 1, 'one URL key is two representations');
    for (const index of [0, 1, 0, 1]) {
      const result = await read(cache, FIXTURE_ACCEPT[index]);
      assert.deepEqual(result.bytes, body(index));
      assert.ok(Number(result.response.headers.get('age')) > 1000, 'time1/max-age0 entries really are stale');
    }
  });
});

test('missing/corrupt representation and concrete disjoint Accept/compress cannot supply accepted exact byte proof', async () => {
  for (const missing of [0, 1]) await withCache(async cache => {
    await put(cache, 1 - missing);
    await assert.rejects(read(cache, FIXTURE_ACCEPT[missing]), { code: 'ENOTCACHED' });
    assert.deepEqual((await read(cache, FIXTURE_ACCEPT[1 - missing])).bytes, body(1 - missing));
  });
  await withCache(async cache => {
    for (const index of [0, 1]) await put(cache, index);
    await assert.rejects(read(cache, 'text/plain'), { code: 'ENOTCACHED' });
    await assert.rejects(read(cache, FIXTURE_ACCEPT[0], false), { code: 'ENOTCACHED' });
  });
  for (const corrupt of [0, 1]) await withCache(async cache => {
    let integrity;
    for (const index of [1 - corrupt, corrupt]) { const stored = await put(cache, index); if (index === corrupt) integrity = stored; }
    assert.deepEqual((await read(cache, FIXTURE_ACCEPT[1 - corrupt])).bytes, body(1 - corrupt));
    // Deliberately corrupt only an exclusive temporary fixture content file.
    // cacache's pinned content layout is inspected here, never used by policy.
    const hex = Buffer.from(String(integrity).slice('sha512-'.length), 'base64').toString('hex');
    const contentPath = path.join(cache, 'content-v2/sha512', hex.slice(0, 2), hex.slice(2, 4), hex.slice(4));
    await fs.chmod(contentPath, 0o600); await fs.writeFile(contentPath, 'corrupt owned fixture');
    await assert.rejects(read(cache, FIXTURE_ACCEPT[corrupt]), error => ['EINTEGRITY', 'ENOTCACHED', 'ENOENT'].includes(error.code));
    // The real reader may invalidate the whole URL key after corruption; it
    // need not preserve the sibling representation to refuse exact-byte proof.
  });
});

test('original47 sources, SDK/public pins, raw worker and parent remain frozen; supplemental is outside TEST_FILES', async () => {
  const hashes = {
    'npm-config.test.mjs': '6fc121f989e5e1393b80a0e4a8387c4494572d2a4603e69023cb75c28536f4a1',
    'dependency-lease.test.mjs': '1d9f121d3ad573050cb70e4c914c9b943efd7342b58e8ea35409e0be14c481e9',
    'prepare-target.test.mjs': 'e990d30946b1022ce00a9c05801aea127ee75db4418b2e2a091b528529ae9f28',
    'native-merged-cache-worker.mjs': '7851587697fb067766f83421ed6675cf0c77c3b8245ea9fbaf478fc9c85ee323',
    'native-merged-validation.mjs': 'c8d1467dbe8b7a7ef4db990139234972498d5366edd8016fe5238e9d661a1f48',
  };
  const counts = [];
  const { sourceTestCount, TEST_FILES } = await import('./native-merged-validation.mjs');
  for (const [name, hash] of Object.entries(hashes)) {
    const bytes = await fs.readFile(path.join(here, name)); assert.equal(digest(bytes), hash);
    if (TEST_FILES.includes(name)) counts.push(sourceTestCount(bytes.toString()));
  }
  assert.deepEqual(counts, [8, 25, 14]);
  const parent = await fs.readFile(path.join(here, 'native-merged-validation.mjs'), 'utf8');
  assert.match(parent, /TEST_FILES = Object.freeze\(\['npm-config.test.mjs', 'dependency-lease.test.mjs', 'prepare-target.test.mjs'\]\)/);
  const source = await fs.readFile(new URL('./native-merged-cache-projection.mjs', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /\bimport\b|\brequire\s*\(|\bprocess\b|CacheEntry|npm-pick-manifest/);
});
