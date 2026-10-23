// Pure JSON policy only. The owning caller must admit the pinned lock/public
// bytes and APIs before calling; these functions grant no workspace authority.
export const FIXTURE_POLICY = 'accepted-version-fixture-v1';
export const PUBLIC_MANIFEST_SHA256 = 'c32b99452423523be83ebf1c5f2d2d756be69646275b6dc1c60da1de53d01e2d';
export const FIXTURE_ACCEPT = Object.freeze([
  'application/json',
  'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*',
]);
const selectionFields = ['dependencies', 'optionalDependencies', 'peerDependencies', 'peerDependenciesMeta', 'engines', 'os', 'cpu', 'libc', 'bundleDependencies', 'bundledDependencies'];
const missingPublic = new Set(['darwin-x64', 'linux-arm', 'linux-arm64', 'linux-x64', 'win32-x64'].map(s => `@msgpackr-extract/msgpackr-extract-${s}`));
const optionalPluginPeers = new Set(['@opentui/core', '@opentui/keymap', '@opentui/solid']);
const own = (value, key) => Object.hasOwn(value, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function refuse() { throw Object.assign(new Error('INPUT_DRIFT'), { code: 'INPUT_DRIFT' }); }
function need(condition) { if (!condition) refuse(); }

// JSON values and own-key presence, including nested data, are preserved. Raw
// whitespace/token bytes belong to the caller's independent raw-body witness.
function copyJson(value, ancestors = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { need(Number.isFinite(value)); return value; }
  need(Array.isArray(value) || object(value));
  need(!ancestors.has(value)); ancestors.add(value);
  const copy = Array.isArray(value)
    ? Array.from(value, item => copyJson(item, ancestors))
    : Object.fromEntries(Object.entries(value).map(([key, item]) => [key, copyJson(item, ancestors)]));
  ancestors.delete(value); return copy;
}
function same(a, b) {
  if (Object.is(a, b)) return true;
  if (Array.isArray(a) || Array.isArray(b)) return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, i) => same(item, b[i]));
  if (!object(a) || !object(b)) return false;
  const keys = Object.keys(a);
  return keys.length === Object.keys(b).length && keys.every(key => own(b, key) && same(a[key], b[key]));
}
const canonicalName = name => typeof name === 'string' && /^(?:@[a-z0-9][a-z0-9._-]*\/)?[a-z0-9][a-z0-9._-]*$/.test(name);
function identity(record) {
  need(object(record) && own(record, 'name') && canonicalName(record.name));
  for (const field of ['version', 'resolved', 'integrity']) need(own(record, field) && typeof record[field] === 'string');
  need(/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(record.version));
  const leaf = record.name.split('/').at(-1);
  need(record.resolved === `https://registry.npmjs.org/${record.name}/-/${leaf}-${record.version}.tgz`);
  need(/^sha512-[A-Za-z0-9+/]{86}==$/.test(record.integrity));
}
function candidate(value, record) {
  identity(record);
  need(object(value) && own(value, 'name') && value.name === record.name && own(value, 'versions') && object(value.versions) && own(value.versions, record.version));
  const approved = value.versions[record.version];
  need(object(approved) && own(approved, 'name') && approved.name === record.name && own(approved, 'version') && approved.version === record.version);
  need(own(approved, 'dist') && object(approved.dist) && own(approved.dist, 'tarball') && approved.dist.tarball === record.resolved && own(approved.dist, 'integrity') && approved.dist.integrity === record.integrity);
  if (own(value, 'dist-tags')) {
    need(object(value['dist-tags']));
    need(Object.values(value['dist-tags']).every(tag => typeof tag === 'string'));
  }
  for (const field of ['stagedVersions', 'policyRestrictions']) if (own(value, field)) need(object(value[field]) && Object.keys(value[field]).length === 0);
  return approved;
}
export function projectAcceptedMetadata(rawValue, acceptedRecord) {
  candidate(rawValue, acceptedRecord);
  const projected = copyJson(rawValue);
  projected.versions = { [acceptedRecord.version]: projected.versions[acceptedRecord.version] };
  if (own(projected, 'dist-tags')) projected['dist-tags'] = Object.fromEntries(Object.entries(projected['dist-tags']).filter(([, version]) => version === acceptedRecord.version));
  return projected;
}
function selectionMatches(approved, references) {
  for (const field of selectionFields) {
    const witnesses = references.filter(reference => own(reference, field));
    if (!witnesses.length) need(!own(approved, field));
    else need(own(approved, field) && witnesses.every(reference => same(approved[field], reference[field])));
  }
}
function specFor(name, spec, npa) {
  need(canonicalName(name) && typeof spec === 'string');
  let parsed;
  try { parsed = npa.resolve(name, spec); } catch { refuse(); }
  need(parsed?.name === name && parsed.registry === true && ['version', 'range'].includes(parsed.type) && typeof parsed.fetchSpec === 'string');
  return parsed.fetchSpec;
}
function dependencyMap(manifest, field) {
  if (!own(manifest, field)) return {};
  need(object(manifest[field]));
  return manifest[field];
}
function validateEdges(name, approved, records, references, { npa, semver }) {
  const effective = { ...dependencyMap(approved, 'dependencies'), ...dependencyMap(approved, 'optionalDependencies') };
  function range(name, spec, target) {
    const requested = specFor(name, spec, npa);
    let valid;
    try { valid = semver.validRange(requested) !== null && (!target || semver.satisfies(target.version, requested)); } catch { refuse(); }
    need(valid);
  }
  for (const [dependency, spec] of Object.entries(effective)) {
    need(records.has(dependency)); range(dependency, spec, records.get(dependency));
  }
  const peers = dependencyMap(approved, 'peerDependencies');
  const flags = dependencyMap(approved, 'peerDependenciesMeta');
  for (const [peer, spec] of Object.entries(peers)) {
    const target = records.get(peer); range(peer, spec, target);
    if (target) continue;
    need(name === '@opencode-ai/plugin' && optionalPluginPeers.has(peer) && spec === '>=0.4.5' && own(flags, peer) && same(flags[peer], { optional: true }));
    // Raw flags alone never permit omission, nor does some other optional peer.
    need(references.length === 2 && references.every(reference =>
      object(reference.peerDependencies) && own(reference.peerDependencies, peer) && reference.peerDependencies[peer] === spec &&
      object(reference.peerDependenciesMeta) && own(reference.peerDependenciesMeta, peer) && same(reference.peerDependenciesMeta[peer], { optional: true })));
  }
}

export function validateAcceptedClosure(projectedByName, lock, publicManifests, apis = {}) {
  need(object(apis));
  const { npa, semver } = apis;
  need(projectedByName instanceof Map && projectedByName.size === 32 && object(lock) && object(lock.packages) && own(lock.packages, '') && object(lock.packages['']));
  need(object(publicManifests) && Object.keys(publicManifests).length === 27 && typeof npa?.resolve === 'function' && typeof semver?.validRange === 'function' && typeof semver?.satisfies === 'function');
  const entries = Object.entries(lock.packages).filter(([key]) => key !== '');
  need(entries.length === 32);
  const records = new Map();
  for (const [key, value] of entries) {
    need(object(value));
    const name = key.slice('node_modules/'.length);
    need(key === `node_modules/${name}` && canonicalName(name));
    const record = { ...value, name }; identity(record);
    need(specFor(name, record.version, npa) === record.version);
    records.set(name, record);
    need(projectedByName.has(name));
    const hasPublic = own(publicManifests, key);
    need(hasPublic !== missingPublic.has(name));
    if (hasPublic) {
      const manifest = publicManifests[key];
      need(object(manifest) && own(manifest, 'name') && manifest.name === name && own(manifest, 'version') && manifest.version === record.version);
    }
  }
  need([...missingPublic].every(name => records.has(name)));
  for (const key of Object.keys(publicManifests)) need(records.has(key.slice('node_modules/'.length)) && key.startsWith('node_modules/'));
  for (const [name, record] of records) {
    const projected = projectedByName.get(name), approved = candidate(projected, record);
    need(Object.keys(projected.versions).length === 1);
    if (own(projected, 'dist-tags')) need(Object.values(projected['dist-tags']).every(value => value === record.version));
    const references = [lock.packages[`node_modules/${name}`]];
    if (own(publicManifests, `node_modules/${name}`)) references.push(publicManifests[`node_modules/${name}`]);
    selectionMatches(approved, references);
    validateEdges(name, approved, records, references, { npa, semver });
  }
  validateEdges('', lock.packages[''], records, [lock.packages['']], { npa, semver });
}

export function fixtureCacheKey(url) {
  // npa's escapedName uses lowercase %2f. Reject normalization, auth, query,
  // fragment, ports, archive paths and noncanonical spelling at this boundary.
  need(typeof url === 'string' && /^https:\/\/registry\.npmjs\.org\/(?:@[a-z0-9][a-z0-9._-]*%2f)?[a-z0-9][a-z0-9._-]*$/.test(url));
  return `make-fetch-happen:request-cache:${url}`;
}
export function fixtureCacheMetadata(options = {}) {
  need(object(options));
  const { url, accept, rawBodySha256 } = options;
  fixtureCacheKey(url);
  need(FIXTURE_ACCEPT.includes(accept) && typeof rawBodySha256 === 'string' && /^[a-f0-9]{64}$/.test(rawBodySha256));
  return {
    time: 1, url, reqHeaders: { accept },
    resHeaders: { 'content-type': accept === FIXTURE_ACCEPT[0] ? 'application/json' : 'application/vnd.npm.install-v1+json', vary: 'accept', 'cache-control': 'max-age=0' },
    options: { compress: true }, lawossFixture: { schema: 1, policy: FIXTURE_POLICY, rawBodySha256 },
  };
}
