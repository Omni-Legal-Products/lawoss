import { createHash } from 'node:crypto';
import { lstat, readFile, readdir, readlink, realpath } from 'node:fs/promises';
import path from 'node:path';
import { assertSupplementalNotices } from './notices.mjs';

export const INPUT = Object.freeze({ name: 'lawoss-plugin-sdk-payload', version: '1.0.0', private: true, dependencies: Object.freeze({ '@opencode-ai/plugin': '1.18.29' }) });
export const REGISTRY = 'https://registry.npmjs.org/';
export const SDK_INTEGRITY = 'sha512-IhF83EU4I/ASgWwvm0FIh1O3a8ZVuCLqPrCbmSHdSYq7GHxIYe773i6dHqcbrzCzvlG/lP2H+dyTQ+xPAwFpbw==';
export const SDK_LOCK_SHA256 = '59f4b854ddab534533fd878c5a7c325a7a1bc3382294d68111cff005920a4053';
export const DIRECT = { zod: '4.1.8', effect: '4.0.0-beta.83', '@ai-sdk/provider': '3.0.8', '@opencode-ai/sdk': '1.18.29' };
export const PEERS = { '@opentui/core': '>=0.4.5', '@opentui/solid': '>=0.4.5', '@opentui/keymap': '>=0.4.5' };
export const fail = code => { throw Object.assign(new Error(code), { code }); };
// Build-only failure metadata. Own data is structural evidence, not authenticated
// error provenance. Never read accessors, messages, paths or arbitrary fields.
// Observers are synchronous; thrown callbacks cannot change the primary refusal.
const buildFailureGuards = new Set(['manifest-digest', 'requested-target', 'manifest-stat', 'manifest-read',
  'manifest-parse', 'inputs', 'manifest-identity', 'imports', 'closure', 'inventory', 'notices',
  'files-equality', 'physical', 'inventory-stat', 'inventory-limit', 'inventory-read',
  'inventory-symlink', 'inventory-nlink', 'inventory-identity', 'inventory-type',
  'options', 'binding', 'root', 'input-stat', 'payload', 'root-recheck']);
const buildFailureCodes = new Set(['PAYLOAD_INVALID', 'CONSUMER_TARGET_UNSUPPORTED', 'INPUT_INVALID',
  'TREE_UNSAFE', 'TREE_LIMIT', 'NOTICES_INVALID', 'PHYSICAL_INVALID', 'PRODUCT_SDK_BUNDLE_INVALID',
  'ENOENT', 'EACCES', 'EPERM', 'ENOTDIR', 'ELOOP', 'EIO']);
const buildFailureProjections = new WeakSet();
export function observeBuildFailure(observer, guard, error) {
  if (typeof observer !== 'function' || !buildFailureGuards.has(guard)) return;
  let code = 'unknown';
  try {
    const value = error && Object.getOwnPropertyDescriptor(error, 'code')?.value;
    if (typeof value === 'string' && buildFailureCodes.has(value)) code = value;
  } catch {}
  const projection = Object.freeze({ guard, code });
  buildFailureProjections.add(projection);
  try { observer(projection); } catch {}
}
// Only locally registered immutable projections can be given a fixed call-site
// context. Registration proves the projection's origin, not the error's origin.
export function withBuildFailureContext(observer, context) {
  if (typeof observer !== 'function' || !['source-admission', 'copied-admission',
    'capsule-original', 'capsule-roundtrip'].includes(context)) return undefined;
  return projection => {
    if (!buildFailureProjections.has(projection)) return;
    try { observer(Object.freeze({ context, ...projection })); } catch {}
  };
}
export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
export const sha256 = value => createHash('sha256').update(value).digest('hex');
const equal = (a, b) => canonical(a) === canonical(b);
// Capabilities of this exact accepted closure, not a generic architecture rule.
// WinARM has no prebuild; LinuxARM's accepted prebuilds are musl-only. The
// upstream codec keeps its JavaScript implementation when native is unavailable.
const consumerModes = new Map([
  ['darwin/arm64', 'native-loaded'], ['darwin/x64', 'native-loaded'],
  ['linux/x64/glibc', 'native-loaded'], ['win32/x64', 'native-loaded'],
  ['linux/arm64/glibc', 'javascript-fallback'], ['win32/arm64', 'javascript-fallback'],
]);
export function sdkConsumerMode(target, lockSha256) {
  try {
    if (lockSha256 !== SDK_LOCK_SHA256 || !target || typeof target !== 'object' || Array.isArray(target)) fail('CONSUMER_TARGET_UNSUPPORTED');
    const fields = Object.getOwnPropertyDescriptors(target);
    const platform = fields.platform?.value, arch = fields.arch?.value, libc = fields.libc?.value;
    const keys = platform === 'linux' ? ['arch', 'libc', 'platform'] : ['arch', 'platform'];
    if (!['darwin', 'linux', 'win32'].includes(platform) || !['x64', 'arm64'].includes(arch) ||
      !equal(Object.keys(fields).sort(), keys) || (platform === 'linux' && libc !== 'glibc')) fail('CONSUMER_TARGET_UNSUPPORTED');
    const mode = consumerModes.get([platform, arch, ...(platform === 'linux' ? [libc] : [])].join('/'));
    if (!mode) fail('CONSUMER_TARGET_UNSUPPORTED');
    return mode;
  } catch { fail('CONSUMER_TARGET_UNSUPPORTED'); }
}
const maps = ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'engines', 'os', 'cpu', 'libc'];
export function validateInputs(input, lock) {
  if (!equal(input, INPUT) || !lock || lock.name !== INPUT.name || lock.version !== INPUT.version || lock.lockfileVersion !== 3 || !lock.packages || Object.keys(lock.packages).length < 6 || Object.keys(lock.packages).length > 256) fail('INPUT_INVALID');
  const root = lock.packages[''];
  if (!root || root.name !== INPUT.name || root.version !== INPUT.version || !equal(root.dependencies, INPUT.dependencies) || root.devDependencies || root.optionalDependencies || root.peerDependencies || root.workspaces) fail('INPUT_INVALID');
  const sdk = lock.packages['node_modules/@opencode-ai/plugin'];
  if (!sdk || sdk.version !== '1.18.29' || sdk.integrity !== SDK_INTEGRITY || !equal(sdk.dependencies, DIRECT) || !equal(sdk.peerDependencies, PEERS) || !equal(sdk.peerDependenciesMeta, Object.fromEntries(Object.keys(PEERS).map(key => [key, { optional: true }])))) fail('INPUT_INVALID');
  for (const [location, pkg] of Object.entries(lock.packages)) {
    if (location === '') continue;
    if (!/^(?:node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)(?:\/node_modules\/(?:@[a-z0-9._-]+\/)?[a-z0-9._-]+)*$/.test(location) || location.split('/').some(part => part === '.' || part === '..')) fail('INPUT_INVALID');
    if (!pkg || pkg.link || pkg.inBundle || !/^\d+\.\d+\.\d+(?:-[\w.-]+)?$/.test(pkg.version) || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(pkg.integrity ?? '')) fail('INPUT_INVALID');
    let url;
    try { url = new URL(pkg.resolved); } catch { fail('INPUT_INVALID'); }
    if (url.origin !== REGISTRY.slice(0, -1) || url.username || url.password || url.search || url.hash || url.href !== pkg.resolved || !/^\/(?:@[\w.-]+\/)?[\w.-]+\/-\/[\w.-]+\.tgz$/.test(url.pathname)) fail('INPUT_INVALID');
    for (const field of ['dependencies', 'optionalDependencies', 'peerDependencies']) {
      for (const spec of Object.values(pkg[field] ?? {})) if (typeof spec !== 'string' || !spec || /(?:https?:|git|file:|link:|workspace:|npm:|[\\/])/.test(spec)) fail('INPUT_INVALID');
    }
  }
  return lock;
}

// Copies primitive data, including resolved edges, before Arborist mutates the virtual tree.
export function snapshot(tree) {
  return [...tree.inventory.values()].map(node => ({
    location: node.location, name: node.name, version: node.version,
    resolved: node.resolved ?? null, integrity: node.integrity ?? null,
    optional: !!node.optional, dev: !!node.dev, devOptional: !!node.devOptional,
    peer: !!node.peer, link: !!node.isLink,
    package: structuredClone(Object.fromEntries(maps.map(key => [key, node.package[key] ?? null]))),
    edges: [...node.edgesOut.values()].map(edge => ({ name: edge.name, spec: edge.spec, type: edge.type, to: edge.to?.location ?? null, valid: !!edge.valid, optional: !!edge.optional })).sort((a, b) => a.name.localeCompare(b.name, 'en')),
  })).sort((a, b) => a.location.localeCompare(b.location, 'en'));
}
export function validateGraph(tree, lock) {
  const records = snapshot(tree);
  if (records.length !== Object.keys(lock.packages).length) fail('GRAPH_INVALID');
  for (const node of records) {
    const accepted = lock.packages[node.location];
    if (!accepted || node.link || node.version !== accepted.version || (node.location && (node.integrity !== accepted.integrity || node.resolved !== accepted.resolved))) fail('GRAPH_INVALID');
    for (const key of maps) if (!equal(node.package[key] ?? null, accepted[key] ?? null)) fail('GRAPH_INVALID');
    for (const edge of node.edges) if ((!edge.valid || edge.to === null) && !edge.optional) fail('GRAPH_INVALID');
  }
  return records;
}
export function unchangedGraph(before, tree) {
  if (!equal(before, snapshot(tree))) fail('GRAPH_DRIFT');
}

export async function inventory(root, onFailure) {
  let guard = 'inventory-stat';
  const records = [];
  let bytes = 0;
  let entries = 0;
  const identities = new Set();
  const canonicalRoot = await realpath(root);
  async function visit(relative) {
    const full = path.join(root, relative);
    guard = 'inventory-stat';
    const stat = await lstat(full);
    guard = 'inventory-limit';
    if (++entries > 30000 || relative.split('/').length > 64 || bytes > 256 * 1024 * 1024) fail('TREE_LIMIT');
    if (stat.isDirectory()) {
      guard = 'inventory-read';
      for (const name of (await readdir(full)).sort()) await visit(relative ? `${relative}/${name}` : name);
    } else if (stat.isSymbolicLink()) {
      guard = 'inventory-symlink';
      const target = await readlink(full);
      const resolved = await realpath(full);
      if (!relative.includes('/.bin/') || path.isAbsolute(target) || !resolved.startsWith(`${canonicalRoot}${path.sep}`)) fail('TREE_UNSAFE');
      records.push({ path: relative, link: target });
    } else if (stat.isFile()) {
      guard = 'inventory-nlink';
      if (stat.nlink !== 1) fail('TREE_UNSAFE');
      guard = 'inventory-identity';
      if (identities.has(`${stat.dev}:${stat.ino}`)) fail('TREE_UNSAFE');
      identities.add(`${stat.dev}:${stat.ino}`);
      bytes += stat.size;
      guard = 'inventory-limit';
      if (bytes > 256 * 1024 * 1024 || stat.size > 32 * 1024 * 1024) fail('TREE_LIMIT');
      guard = 'inventory-read';
      records.push({ path: relative, bytes: stat.size, executable: !!(stat.mode & 0o111), sha256: sha256(await readFile(full)) });
    } else {
      guard = 'inventory-type';
      fail('TREE_UNSAFE');
    }
  }
  try {
    await visit('');
    return records;
  } catch (error) { observeBuildFailure(onFailure, guard, error); throw error; }
}

export async function validatePhysical(root, lock, applicable, Arborist) {
  const tree = await new Arborist({ path: root, packageLock: false, cache: path.join(root, '.validation-cache'), offline: true, ignoreScripts: true, audit: false }).loadActual();
  const locations = [...tree.inventory.keys()].sort();
  if (!equal(locations, [...applicable].sort())) fail('PHYSICAL_INVALID');
  const licenses = [];
  for (const node of tree.inventory.values()) {
    const expected = lock.packages[node.location];
    if (!expected || node.isLink || node.extraneous || node.version !== expected.version) fail('PHYSICAL_INVALID');
    if (!node.location) continue;
    const manifest = JSON.parse(await readFile(path.join(root, node.location, 'package.json'), 'utf8'));
    if (manifest.name !== node.name || manifest.version !== expected.version) fail('PHYSICAL_INVALID');
    for (const field of maps) if (!equal(manifest[field] ?? null, expected[field] ?? null)) fail('PHYSICAL_INVALID');
    for (const edge of node.edgesOut.values()) if (!edge.valid && !edge.optional) fail('PHYSICAL_INVALID');
    const names = await readdir(path.join(root, node.location));
    const files = names.filter(name => /^(?:licen[sc]e|copying|notice)(?:[.-].*)?$/i.test(name)).sort();
    licenses.push({ location: node.location, license: manifest.license ?? null, files: files.map(name => `${node.location}/${name}`) });
  }
  return licenses.sort((a, b) => a.location.localeCompare(b.location, 'en'));
}

export const IMPORTS = [
  '@opencode-ai/plugin', '@opencode-ai/plugin/tool',
  '@opencode-ai/plugin/v2/effect', '@opencode-ai/plugin/v2/promise',
  '@opencode-ai/plugin/v2/effect/plugin', '@opencode-ai/plugin/v2/effect/integration',
  'zod', 'effect', '@ai-sdk/provider', '@opencode-ai/sdk',
];
export function assertTargetSdkProbe(value, target, lockSha256) {
  const mode = sdkConsumerMode(target, lockSha256);
  const expectedNative = mode === 'native-loaded' ? 'loaded' : 'fallback';
  if (!equal(value?.imports, IMPORTS) || value.native !== expectedNative || value.guard !== true || value.roundtrip !== true) fail('CONSUMER_INVALID');
  return mode;
}
// The producer gate remains bound to the executing build runtime.
export async function verifyPayload(root, Arborist) {
  return verify(root, Arborist, process.version);
}

// Read-only consumer admission. The caller supplies the digest from its trusted
// build identity, never from the adjacent, potentially replaceable receipt.
// This does not install dependencies, import SDK code or admit an engine launch.
export async function verifyRuntimePayload(root, manifestSha256) {
  if (process.version !== 'v22.23.2' || process.versions.bun) fail('PAYLOAD_RUNTIME_UNSUPPORTED');
  if (typeof manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifestSha256)) fail('PAYLOAD_INVALID');
  return verify(root, undefined, 'v24.21.0', manifestSha256);
}

// Build-only static admission of independently accepted target bytes. This is
// separate from both executing-host gates above and never loads target code.
export async function verifyBuildPayload(root, manifestSha256, requestedTarget, onFailure) {
  let guard = 'manifest-digest', target;
  try {
    if (typeof manifestSha256 !== 'string' || !/^[a-f0-9]{64}$/.test(manifestSha256)) fail('PAYLOAD_INVALID');
    guard = 'requested-target';
    sdkConsumerMode(requestedTarget, SDK_LOCK_SHA256);
    const fields = Object.getOwnPropertyDescriptors(requestedTarget);
    target = Object.freeze(Object.fromEntries(Object.entries(fields).map(([key, field]) => [key, field.value])));
  } catch (error) { observeBuildFailure(onFailure, guard, error); throw error; }
  return verify(root, undefined, 'v24.21.0', manifestSha256, target, onFailure);
}

async function verify(root, Arborist, producerNode, manifestSha256, requestedTarget, onFailure) {
  let guard = 'manifest-stat';
  try {
    const stat = await lstat(path.join(root, 'payload-manifest.json'));
    if (!stat.isFile() || stat.nlink !== 1 || stat.size > 8 * 1024 * 1024) fail('PAYLOAD_INVALID');
    guard = 'manifest-read';
    const manifestBytes = await readFile(path.join(root, 'payload-manifest.json'));
    guard = 'manifest-digest';
    if (manifestBytes.length > 8 * 1024 * 1024 || (manifestSha256 !== undefined && sha256(manifestBytes) !== manifestSha256)) fail('PAYLOAD_INVALID');
    guard = 'manifest-parse';
    const manifest = JSON.parse(manifestBytes.toString('utf8'));
    guard = 'inputs';
    const inputBytes = await readFile(path.join(root, 'package.json'));
    const lockBytes = await readFile(path.join(root, 'package-lock.json'));
    const acceptedBytes = await readFile(new URL('./sdk/package-lock.json', import.meta.url));
    const lock = validateInputs(JSON.parse(inputBytes.toString('utf8')), JSON.parse(lockBytes.toString('utf8')));
    const target = requestedTarget ?? { platform: process.platform, arch: process.arch,
      ...(process.platform === 'linux' ? { libc: /** @type {{ header: { glibcVersionRuntime?: string } }} */ (process.report.getReport()).header.glibcVersionRuntime ? 'glibc' : 'musl' } : {}) };
    guard = 'manifest-identity';
    if (manifest.schema !== 1 || manifest.sdk.name !== '@opencode-ai/plugin' || manifest.sdk.version !== '1.18.29' || manifest.sdk.integrity !== SDK_INTEGRITY || manifest.node !== producerNode || manifest.arborist !== '9.4.0' || manifest.scripts !== false || manifest.target.platform !== target.platform || manifest.target.arch !== target.arch || manifest.lockSha256 !== sha256(lockBytes) || manifest.lockSha256 !== sha256(acceptedBytes) || manifest.inputSha256 !== sha256(inputBytes) || manifest.inputSha256 !== sha256(await readFile(new URL('./sdk/package.json', import.meta.url)))) fail('PAYLOAD_INVALID');
    if (target.platform === 'linux' && manifest.target.libc !== target.libc) fail('PAYLOAD_INVALID');
    if (requestedTarget !== undefined && !equal(manifest.target, target)) fail('PAYLOAD_INVALID');
    guard = 'imports';
    if (!equal(manifest.imports?.imports, IMPORTS) || !['loaded', 'fallback', 'absent'].includes(manifest.imports?.native)) fail('PAYLOAD_INVALID');
    if (manifestSha256 !== undefined) assertTargetSdkProbe(manifest.imports, manifest.target, manifest.lockSha256);
    guard = 'closure';
    if (!Array.isArray(manifest.closure) || !Array.isArray(manifest.inertOptional) || new Set([...manifest.closure, ...manifest.inertOptional]).size !== Object.keys(lock.packages).length || !equal([...manifest.closure, ...manifest.inertOptional].sort(), Object.keys(lock.packages).sort())) fail('PAYLOAD_INVALID');
    for (const location of manifest.inertOptional) if (!lock.packages[location]?.optional) fail('PAYLOAD_INVALID');
    guard = 'inventory';
    const files = (await inventory(root, onFailure)).filter(record => record.path !== 'payload-manifest.json');
    guard = 'notices';
    assertSupplementalNotices(files);
    guard = 'files-equality';
    if (!equal(files, manifest.files)) fail('PAYLOAD_INVALID');
    if (Arborist) {
      guard = 'physical';
      const licenses = await validatePhysical(root, lock, manifest.closure, Arborist);
      if (!equal(licenses, manifest.licenses)) fail('PAYLOAD_INVALID');
    }
    return manifest;
  } catch (error) { observeBuildFailure(onFailure, guard, error); fail('PAYLOAD_INVALID'); }
}
