import path from 'node:path';
import fs from 'node:fs/promises';
import { discoverConfigRoles, ConfigRoleDiscoveryError } from './config-roles.mjs';
import { createProductSdkIdentityModule, readProductSdkIdentityModule } from '../build/plugin-payload/product-identity.mjs';

// PRIVATE data contract, not a cryptographic attestation or mutation capability.
// scope: { product:'desktop-managed-local', agentSandboxEnabled:true,
//          appFiles:'inside', inheritEnvironment:true }
// captured: { environment, cwd, instanceDirectory, nativeHome, globalState }
// The host must capture nativeHome and Global.state under that SAME final env.
// ownedRoots: [{ role:'global'|'explicit', path:<exact logical spelling>,
//   physicalPath:<absolute expected canonical target>, alias:<explicit boolean>,
//   ancestor:{path,dev,ino}, target:{dev,ino}|null,
//   provenance:{kind:'active-app-runtime',lifetimeId:<private lifetime id>} }]
// null target grants only an absent destination below the identified ancestor.
// Each alias spelling/role needs its own grant; no path prefix or UID grants it.
// A plan never authorizes seeding. S4 must lease, create and revalidate separately.
const fault = code => Object.assign(new Error(code), { code });
const fail = code => { throw fault(code); };
const errorCode = error => {
  try {
    const descriptor = error && typeof error === 'object' ? Object.getOwnPropertyDescriptor(error, 'code') : undefined;
    return descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'string' ? descriptor.value : undefined;
  } catch { return undefined; }
};
const snapshotData = operation => { try { return operation(); } catch { fail('INVALID_INPUT'); } };
const plain = value => value && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));
function fields(value) {
  if (!plain(value)) fail('INVALID_INPUT');
  const descriptors = Object.getOwnPropertyDescriptors(value);
  const keys = Reflect.ownKeys(descriptors);
  if (keys.some(key => typeof key !== 'string' || !descriptors[key].enumerable || !Object.hasOwn(descriptors[key], 'value'))) fail('INVALID_INPUT');
  return Object.fromEntries(keys.map(key => [key, descriptors[key].value]));
}
function shape(value, keys) {
  if (!plain(value) || Object.keys(value).length !== keys.length || keys.some(key => !Object.hasOwn(value, key))) fail('INVALID_INPUT');
}
function copy(value, depth = 0, budget = { count: 0, text: 0, active: new WeakSet() }) {
  if (++budget.count > 8192 || depth > 8) fail('INVALID_INPUT');
  if (value === undefined || value === null || typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) return value;
  if (typeof value === 'string') {
    if (value.length > 65536 || (budget.text += value.length) > 1024 * 1024) fail('INVALID_INPUT');
    return value;
  }
  if (!value || typeof value !== 'object' || budget.active.has(value)) fail('INVALID_INPUT');
  budget.active.add(value);
  let result;
  if (Array.isArray(value)) {
    const descriptors = Object.getOwnPropertyDescriptors(value);
    if (value.length > 64 || Reflect.ownKeys(descriptors).length !== value.length + 1) fail('INVALID_INPUT');
    result = [];
    for (let index = 0; index < value.length; index++) {
      const entry = descriptors[index];
      if (!entry?.enumerable || !Object.hasOwn(entry, 'value')) fail('INVALID_INPUT');
      result.push(copy(entry.value, depth + 1, budget));
    }
  } else {
    const entries = fields(value);
    if (Object.keys(entries).length > 2048) fail('INVALID_INPUT');
    result = Object.create(null);
    for (const [key, entry] of Object.entries(entries)) {
      if (key.length > 4096 || (budget.text += key.length) > 1024 * 1024) fail('INVALID_INPUT');
      result[key] = copy(entry, depth + 1, budget);
    }
  }
  budget.active.delete(value);
  return freeze(result);
}
function freeze(value) {
  if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); }
  return value;
}
const result = (status, roles = [], targets = [], uncovered = [], leaseKeys = []) => freeze({ status, roles, targets, uncovered, leaseKeys });
const id = stat => ({ dev: stat.dev, ino: stat.ino });
const same = (stat, expected) => stat.dev === expected.dev && stat.ino === expected.ino;
function validIdentity(value) {
  shape(value, ['dev', 'ino']);
  if (!Number.isSafeInteger(value.dev) || value.dev < 0 || !Number.isSafeInteger(value.ino) || value.ino <= 0) fail('INVALID_INPUT');
}
function budget(deadline, signal) {
  let timer;
  const check = () => {
    if (signal?.aborted) fail('ABORTED');
    if (Date.now() >= deadline) fail('BUDGET_EXCEEDED');
  };
  return {
    check,
    async metadata(operation) {
      check();
      let abort;
      const cancelled = new Promise((_, reject) => {
        abort = () => reject(fault('ABORTED'));
        signal?.addEventListener('abort', abort, { once: true });
        timer = setTimeout(() => reject(fault('BUDGET_EXCEEDED')), Math.max(0, deadline - Date.now()));
      });
      try { const value = await Promise.race([Promise.resolve().then(operation), cancelled]); check(); return value; }
      catch (error) { check(); throw error; }
      finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
    },
  };
}
function environmentSnapshot(environment, platform, p) {
  if (!plain(environment) || Object.values(environment).some(value => value !== undefined && typeof value !== 'string')) fail('INVALID_INPUT');
  if (platform !== 'win32') return environment;
  const folded = Object.create(null);
  for (const [key, value] of Object.entries(environment)) {
    const canonical = key.toUpperCase();
    if (Object.hasOwn(folded, canonical) && folded[canonical] !== value) fail('AMBIGUOUS_ENVIRONMENT');
    folded[canonical] = value;
    if (/^=[A-Z]:$/.test(canonical) && value !== undefined
      && (!p.isAbsolute(value) || value.slice(0, 2).toUpperCase() !== canonical.slice(1))) fail('INVALID_INPUT');
  }
  return freeze(folded);
}

/** Standalone read-only planner. No ambient environment/cwd/home, lease or SDK use. */
export async function planManagedSdkConfigRoles(input, adapters = {}) {
  const supplied = snapshotData(() => fields(input));
  if (Object.keys(supplied).some(key => !['privateProductIdentity', 'scope', 'captured', 'ownedRoots', 'deadline', 'signal'].includes(key))) fail('INVALID_INPUT');
  const scope = snapshotData(() => copy(supplied.scope));
  shape(scope, ['product', 'agentSandboxEnabled', 'appFiles', 'inheritEnvironment']);
  if (scope.product !== 'desktop-managed-local' || scope.agentSandboxEnabled !== true || scope.appFiles !== 'inside'
    || scope.inheritEnvironment !== true) return result('not-applicable');
  if (supplied.privateProductIdentity == null) return result('not-applicable');
  // Reuse the existing bounded own-data closed identity admission, without import
  // or execution of any supplied module and without reading adjacent resources.
  const identity = readProductSdkIdentityModule(createProductSdkIdentityModule(supplied.privateProductIdentity));
  if (identity.mode !== 'sdk') return result('not-applicable');
  const captured = snapshotData(() => copy(supplied.captured)), roots = snapshotData(() => copy(supplied.ownedRoots));
  shape(captured, ['environment', 'cwd', 'instanceDirectory', 'nativeHome', 'globalState']);
  const { deadline, signal } = supplied;
  if (!Number.isFinite(deadline) || deadline - Date.now() > 2 ** 31 - 1
    || (signal !== undefined && !(signal instanceof AbortSignal)) || !Array.isArray(roots)) fail('INVALID_INPUT');
  const p = adapters.pathModel?.path ?? path;
  const platform = adapters.pathModel?.platform ?? process.platform;
  const absolute = value => typeof value === 'string' && value.length > 0 && value.length <= 4096 && p.isAbsolute(value)
    && (platform !== 'win32' || /^(?:[a-zA-Z]:[\\/]|[\\/]{2})/.test(value));
  if (![captured.cwd, captured.nativeHome, captured.globalState].every(absolute)
    || typeof captured.instanceDirectory !== 'string' || !captured.instanceDirectory || captured.instanceDirectory.length > 4096) fail('INVALID_INPUT');
  const environment = environmentSnapshot(captured.environment, platform, p);
  for (const grant of roots) {
    shape(grant, ['role', 'path', 'physicalPath', 'alias', 'ancestor', 'target', 'provenance']);
    shape(grant.ancestor, ['path', 'dev', 'ino']);
    validIdentity({ dev: grant.ancestor.dev, ino: grant.ancestor.ino });
    if (grant.target !== null) validIdentity(grant.target);
    shape(grant.provenance, ['kind', 'lifetimeId']);
    if (!['global', 'explicit'].includes(grant.role) || typeof grant.path !== 'string' || !grant.path || grant.path.length > 4096
      || !absolute(grant.physicalPath) || !absolute(grant.ancestor.path) || typeof grant.alias !== 'boolean'
      || grant.provenance.kind !== 'active-app-runtime' || typeof grant.provenance.lifetimeId !== 'string'
      || !grant.provenance.lifetimeId || grant.provenance.lifetimeId.length > 128) fail('INVALID_INPUT');
  }
  const b = budget(deadline, signal); b.check();
  const filesystem = { lstat: fs.lstat, realpath: fs.realpath, ...adapters.filesystem };
  const read = (method, filename) => b.metadata(() => filesystem[method](filename));
  const statOrMissing = async filename => {
    try { return await read('lstat', filename); }
    catch (error) { if (errorCode(error) === 'ENOENT') return null; throw error; }
  };
  const within = (parent, child) => { const relative = p.relative(parent, child); return relative === '' || (!relative.startsWith(`..${p.sep}`) && relative !== '..' && !p.isAbsolute(relative)); };
  const safeStat = (stat, owner) => platform === 'win32' || (Number.isInteger(stat.mode) && Number.isInteger(stat.uid)
    && (stat.mode & 0o022) === 0 && stat.uid === owner.uid);
  async function checkAncestor(grant) {
    // Check from filesystem root down; never inspect descendants of an uncertain
    // app parent until its original lstat/realpath identity has been revalidated.
    const chain = []; let current = grant.ancestor.path;
    while (true) { chain.unshift(current); const parent = p.dirname(current); if (parent === current) break; current = parent; }
    if (chain.length > 128) fail('PATH_DEPTH_LIMIT');
    let ancestor;
    for (const filename of chain) {
      const stat = await statOrMissing(filename);
      if (!stat) fail('ANCESTOR_MISSING');
      if (stat.isSymbolicLink()) fail('UNEXPECTED_SYMLINK');
      if (!stat.isDirectory()) fail('ANCESTOR_NOT_DIRECTORY');
      if (filename === grant.ancestor.path) ancestor = stat;
    }
    if (!same(ancestor, grant.ancestor)) fail('ANCESTOR_SUBSTITUTED');
    if ((await read('realpath', grant.ancestor.path)) !== grant.ancestor.path) fail('ANCESTOR_SUBSTITUTED');
    if (!safeStat(ancestor, ancestor)) fail('UNSAFE_POSIX_METADATA');
    return ancestor;
  }
  async function inspect(record, grant) {
    const ancestor = await checkAncestor(grant);
    if (!within(grant.ancestor.path, record.physicalPath) || !within(grant.ancestor.path, grant.physicalPath)
      || record.physicalPath === grant.ancestor.path) fail('ROOT_OUTSIDE_GRANT');
    if (!grant.alias && grant.physicalPath !== record.physicalPath) fail('ALIAS_TARGET_MISMATCH');
    const suffix = p.relative(grant.ancestor.path, record.physicalPath);
    const parts = suffix.split(p.sep); if (parts.length > 128) fail('PATH_DEPTH_LIMIT');
    let current = grant.ancestor.path, target;
    for (let index = 0; index < parts.length; index++) {
      current = p.join(current, parts[index]);
      const stat = await statOrMissing(current);
      if (!stat) {
        if (grant.target !== null || grant.alias) fail('ROOT_SUBSTITUTED');
        await checkAncestor(grant);
        return { classification: 'absent-target', physicalPath: record.physicalPath, identity: null,
          ancestor: { path: grant.ancestor.path, ...id(ancestor) }, suffix };
      }
      if (stat.isSymbolicLink()) {
        if (index !== parts.length - 1 || !grant.alias) fail('UNEXPECTED_SYMLINK');
        if ((await read('realpath', current)) !== grant.physicalPath) fail('ALIAS_TARGET_MISMATCH');
        // Authenticate the separately granted canonical spelling's full ancestry.
        const canonical = await inspect({ ...record, physicalPath: grant.physicalPath }, { ...grant, alias: false });
        await checkAncestor(grant);
        let aliasPath = grant.ancestor.path;
        for (const [position, part] of parts.entries()) {
          aliasPath = p.join(aliasPath, part);
          const now = await statOrMissing(aliasPath);
          if (position === parts.length - 1) {
            if (!now?.isSymbolicLink() || !same(now, stat)) fail('ALIAS_TARGET_MISMATCH');
          } else if (!now || now.isSymbolicLink() || !now.isDirectory()) fail('UNEXPECTED_SYMLINK');
        }
        if ((await read('realpath', record.physicalPath)) !== grant.physicalPath) fail('ALIAS_TARGET_MISMATCH');
        return canonical;
      }
      if (!stat.isDirectory()) fail(index === parts.length - 1 ? 'TARGET_NOT_DIRECTORY' : 'ANCESTOR_NOT_DIRECTORY');
      if (!safeStat(stat, ancestor)) fail('UNSAFE_POSIX_METADATA');
      if (index === parts.length - 1) target = stat;
    }
    if (!grant.target || !same(target, grant.target)) fail('ROOT_SUBSTITUTED');
    if ((await read('realpath', record.physicalPath)) !== grant.physicalPath) fail('ALIAS_TARGET_MISMATCH');
    const recheck = async () => {
      await checkAncestor(grant);
      let filename = grant.ancestor.path;
      for (const part of parts) {
        filename = p.join(filename, part);
        const now = await statOrMissing(filename);
        if (now?.isSymbolicLink()) fail('UNEXPECTED_SYMLINK');
        if (!now || !now.isDirectory() || (filename === record.physicalPath && !same(now, grant.target))) fail('ROOT_SUBSTITUTED');
        if (!safeStat(now, ancestor)) fail('UNSAFE_POSIX_METADATA');
      }
      if ((await read('realpath', record.physicalPath)) !== grant.physicalPath) fail('ALIAS_TARGET_MISMATCH');
    };
    const entries = [];
    for (const filename of ['package.json', 'package-lock.json', 'node_modules', 'npm-shrinkwrap.json']) {
      await recheck();
      if (await statOrMissing(p.join(record.physicalPath, filename))) entries.push(filename);
    }
    await recheck();
    return { classification: entries.length ? 'existing-plane-unadmitted' : 'existing-target', physicalPath: grant.physicalPath,
      identity: id(target), ancestor: { path: grant.ancestor.path, ...id(ancestor) }, suffix, dependencyEntries: entries };
  }
  let discovered;
  try {
    discovered = await discoverConfigRoles({ instanceDirectory: captured.instanceDirectory, engineCwd: captured.cwd,
      homeDirectory: captured.nativeHome, environment, deadline, signal }, {
      pathModel: adapters.pathModel, filesystem: adapters.filesystem, gitQuery: adapters.gitQuery,
    });
  } catch (error) {
    if (error instanceof ConfigRoleDiscoveryError) throw error;
    b.check(); throw fault('DISCOVERY_FAILED');
  }
  const uncovered = [], roles = [], targets = [], leaseKeys = discovered.roles.map(record => record.path);
  if (!discovered.roles.some(record => record.roles.includes('explicit'))) uncovered.push({ code: 'EXPLICIT_ROLE_MISSING' });
  const refusalCodes = new Set(['ANCESTOR_MISSING', 'UNEXPECTED_SYMLINK', 'ANCESTOR_NOT_DIRECTORY', 'ANCESTOR_SUBSTITUTED',
    'UNSAFE_POSIX_METADATA', 'ROOT_OUTSIDE_GRANT', 'ALIAS_TARGET_MISMATCH', 'ROOT_SUBSTITUTED', 'TARGET_NOT_DIRECTORY', 'PATH_DEPTH_LIMIT']);
  for (const record of discovered.roles) {
    b.check();
    const roleRecord = { path: record.path, physicalPath: record.physicalPath, roles: [...record.roles], targetIndex: null };
    roles.push(roleRecord);
    const grants = record.roles.map(role => roots.filter(grant => grant.role === role && grant.path === record.path));
    if (grants.some(matches => matches.length !== 1)) {
      uncovered.push({ path: record.path, code: 'UNGRANTED_ROLE' }); continue;
    }
    let observation;
    try {
      for (const [grant] of grants) {
        const next = await inspect(record, grant);
        if (observation && (next.physicalPath !== observation.physicalPath || JSON.stringify(next.identity) !== JSON.stringify(observation.identity))) fail('ALIAS_TARGET_MISMATCH');
        observation = next;
      }
    } catch (error) {
      b.check();
      const code = errorCode(error);
      uncovered.push({ path: record.path, code: refusalCodes.has(code) ? code : 'METADATA_FAILED' }); continue;
    }
    if (observation.classification === 'existing-plane-unadmitted') uncovered.push({ path: record.path, code: 'EXISTING_PLANE_UNADMITTED' });
    // Only identified existing targets can group. Missing paths have no inode.
    let index = observation.identity ? targets.findIndex(target => target.identity && same(target.identity, observation.identity)) : -1;
    if (index < 0) { index = targets.length; targets.push({ ...observation, logicalPaths: [], roles: [] }); }
    const target = targets[index]; target.logicalPaths.push(record.path);
    for (const role of record.roles) if (!target.roles.includes(role)) target.roles.push(role);
    roleRecord.targetIndex = index;
  }
  b.check();
  return result(uncovered.length ? 'incomplete' : 'planned', roles, targets, uncovered, leaseKeys);
}
