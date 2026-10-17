import fs from 'node:fs/promises';
import { constants } from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { loadEngineNpmConfig } from './npm-config.mjs';
import { withEngineDependencyLease } from './dependency-lease.mjs';
import { localRuntimePackage } from './runtime-tools.mjs';

const SDK = '@opencode-ai/plugin';
const VERSION = '1.18.29';
const sections = ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies'];
const bounds = { 'package.json': 1024 * 1024, 'package-lock.json': 16 * 1024 * 1024 };
const codes = new Set(['INVALID_INPUT', 'UNSUPPORTED_RUNTIME', 'TOOLING_UNAVAILABLE', 'CONFIG_LOAD_FAILED',
  'NATIVE_HOME_MISMATCH', 'UNSUPPORTED_CONFIG', 'TARGET_INVALID', 'METADATA_INVALID', 'TARGET_CHANGED', 'REIFY_FAILED',
  'POSTCONDITION_FAILED', 'CANCELLED', 'RECOVERY_FAILED']);
const fail = code => Object.assign(new Error(code), { code });
const absolute = p => typeof p === 'string' && !p.includes('\0') && path.isAbsolute(p);
const object = v => v !== null && typeof v === 'object' && !Array.isArray(v);
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const identity = s => `${s.dev}:${s.ino}`;

async function directoryIdentity(directory) {
  const s = await fs.lstat(directory);
  if (!s.isDirectory() || s.isSymbolicLink()) throw fail('TARGET_INVALID');
  return { real: await fs.realpath(directory), id: identity(s) };
}
async function unchangedIdentity(directory, before) {
  if (!isDeepStrictEqual(await directoryIdentity(directory), before)) throw fail('TARGET_CHANGED');
}
async function optionalStat(file) {
  try { return await fs.lstat(file); }
  catch (e) { if (e.code === 'ENOENT') return; throw e; }
}
async function metadata(directory, name) {
  const file = path.join(directory, name);
  const before = await optionalStat(file);
  if (!before) return { exists: false };
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size > bounds[name]) throw fail('METADATA_INVALID');
  const handle = await fs.open(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
  let primary, result;
  try {
    const opened = await handle.stat();
    if (!opened.isFile() || identity(opened) !== identity(before)) throw fail('TARGET_CHANGED');
    const buffer = Buffer.alloc(bounds[name] + 1);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await handle.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > bounds[name]) throw fail('METADATA_INVALID');
    const after = await handle.stat();
    const current = await fs.lstat(file);
    if (identity(after) !== identity(current) || after.size !== opened.size || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs) throw fail('TARGET_CHANGED');
    const bytes = buffer.subarray(0, length);
    result = { exists: true, hash: hash(bytes), bytes, id: identity(after) };
  } catch (e) { primary = e; }
  try { await handle.close(); }
  catch (e) { throw new AggregateError([...(primary ? [primary] : []), e], 'METADATA_CLOSE_FAILED'); }
  if (primary) throw primary;
  return result;
}
async function readMetadata(directory) {
  const result = {};
  for (const name of Object.keys(bounds)) result[name] = await metadata(directory, name);
  return result;
}
function parsed(entry) {
  if (!entry.exists) return {};
  try {
    const value = JSON.parse(entry.bytes.toString('utf8'));
    if (!object(value)) throw Error();
    return value;
  } catch { throw fail('METADATA_INVALID'); }
}
function manifest(entry) {
  const value = parsed(entry);
  for (const section of sections) {
    if (value[section] !== undefined && (!object(value[section]) || Object.values(value[section]).some(v => typeof v !== 'string'))) throw fail('METADATA_INVALID');
  }
  // Workspace trees and shrinkwrap precedence require a separate preserving contract.
  if (value.workspaces !== undefined) throw fail('METADATA_INVALID');
  return value;
}
function lock(entry) {
  const value = parsed(entry);
  if (entry.exists && (![2, 3].includes(value.lockfileVersion) || !object(value.packages) || !object(value.packages['']) || Object.values(value.packages).some(v => !object(v)))) throw fail('METADATA_INVALID');
  return value;
}
async function supportedFiles(directory) {
  if (await optionalStat(path.join(directory, 'npm-shrinkwrap.json'))) throw fail('METADATA_INVALID');
  const modules = await optionalStat(path.join(directory, 'node_modules'));
  if (modules && (!modules.isDirectory() || modules.isSymbolicLink())) throw fail('TARGET_INVALID');
}
function summary(entries) {
  return Object.fromEntries(Object.entries(entries).map(([name, value]) => [name, value.exists ? { exists: true, sha256: value.hash, identity: value.id } : { exists: false }]));
}
async function saveEvidence(recovery, label, entries) {
  for (const [name, entry] of Object.entries(entries)) {
    if (entry.exists) await fs.writeFile(path.join(recovery, `${label}-${name}`), entry.bytes, { flag: 'wx', mode: 0o600 });
  }
  await fs.writeFile(path.join(recovery, `${label}.json`), JSON.stringify(summary(entries)), { flag: 'wx', mode: 0o600 });
}
function preserved(before, after) {
  const project = value => {
    const copy = structuredClone(value);
    for (const section of sections) {
      if (copy[section]) {
        delete copy[section][SDK];
        if (!Object.keys(copy[section]).length) delete copy[section];
      }
    }
    return copy;
  };
  if (!isDeepStrictEqual(project(before), project(after)) || after.dependencies?.[SDK] !== VERSION) throw fail('POSTCONDITION_FAILED');
}
async function verifyTree(Arborist, options, entries, signal) {
  const saved = lock(entries['package-lock.json']);
  if (!entries['package-lock.json'].exists || saved.packages[''].dependencies?.[SDK] !== VERSION) throw fail('POSTCONDITION_FAILED');
  // A new reader avoids accepting reify's in-memory ideal/actualTree cache.
  const tree = await new Arborist(options).loadActual({ signal, forceActual: true });
  const sdk = tree.children.get(SDK);
  if (!sdk || sdk.isLink || sdk.package.name !== SDK || sdk.package.version !== VERSION || sdk.location !== `node_modules/${SDK}`) throw fail('POSTCONDITION_FAILED');
  const pending = [sdk], visited = new Set();
  while (pending.length) {
    signal.throwIfAborted();
    const node = pending.pop();
    if (visited.has(node)) continue;
    visited.add(node);
    const record = saved.packages[node.location];
    if (!record || record.version !== node.package.version || node.errors?.length) throw fail('POSTCONDITION_FAILED');
    const physical = await metadata(node.path, 'package.json');
    const pkg = parsed(physical);
    if (!physical.exists || pkg.name !== node.package.name || pkg.version !== node.package.version) throw fail('POSTCONDITION_FAILED');
    // Check concrete public entrypoints without evaluating any user package code.
    const targets = new Set();
    const collect = value => {
      if (typeof value === 'string' && value.startsWith('./') && !value.includes('*')) targets.add(value);
      else if (Array.isArray(value)) value.forEach(collect);
      else if (object(value)) {
        for (const [key, child] of Object.entries(value)) {
          if (key.startsWith('.') || ['node', 'import', 'require', 'default', 'types'].includes(key)) collect(child);
        }
      }
    };
    collect(pkg.exports);
    if (typeof pkg.main === 'string') targets.add(pkg.main);
    for (const target of targets) {
      const file = path.resolve(node.path, target);
      const relative = path.relative(node.path, file);
      if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) throw fail('POSTCONDITION_FAILED');
      const info = await optionalStat(file);
      if (!info?.isFile() || info.isSymbolicLink()) throw fail('POSTCONDITION_FAILED');
    }
    for (const edge of node.edgesOut.values()) {
      if (edge.type === 'dev' || edge.optional) continue;
      if (!edge.valid || !edge.to) throw fail('POSTCONDITION_FAILED');
      pending.push(edge.to);
    }
  }
  // Root declarations must resolve unless the actual captured omit policy allows absence.
  const omit = new Set(options.omit || []);
  for (const edge of tree.edgesOut.values()) {
    if (edge.optional || (edge.dev && omit.has('dev')) || (edge.peer && omit.has('peer'))) continue;
    if (!edge.valid || !edge.to || edge.to.errors?.length) throw fail('POSTCONDITION_FAILED');
  }
  return visited.size;
}
function result(status, code, recoveryDirectory, cause, verifiedNodes) {
  const value = { status, code };
  if (verifiedNodes !== undefined) value.verifiedSdkNodes = verifiedNodes;
  // For the trusted owner only: raw errors and recovery paths must never reach product transport.
  Object.defineProperty(value, 'private', { value: { recoveryDirectory, cause }, enumerable: false });
  return value;
}

/** Existing explicitly authorized target only. No discovery, creation, rollback or runtime hook.
 * factory is a narrow test seam around genuine Arborist, never an installation acceptance substitute.
 */
export async function prepareEngineDependencyTarget(input, { arboristFactory } = {}) {
  let captured, recoveryDirectory, verifiedNodes;
  try {
    if (!object(input) || !['directory', 'stateDirectory', 'recoveryParent', 'engineExecPath', 'engineNpmPath', 'nativeHome'].every(k => absolute(input[k])) ||
        !object(input.environment) || Object.values(input.environment).some(v => typeof v !== 'string') ||
        !Array.isArray(input.logicalDirectories) || !input.logicalDirectories.length || input.logicalDirectories.some(v => typeof v !== 'string' || !v || v.includes('\0')) ||
        !Number.isFinite(input.deadline) || (input.signal !== undefined && !(input.signal instanceof AbortSignal))) throw fail('INVALID_INPUT');
    captured = { ...input, environment: { ...input.environment }, logicalDirectories: [...input.logicalDirectories] };
    if (process.versions.node.split('.')[0] !== '22') throw fail('UNSUPPORTED_RUNTIME');
    await withEngineDependencyLease(captured, async signal => {
      const guard = () => { if (signal.aborted) throw fail('CANCELLED'); };
      guard();
      const initialIdentity = await directoryIdentity(captured.directory);
      await supportedFiles(captured.directory);
      const initial = await readMetadata(captured.directory);
      const before = manifest(initial['package.json']);
      lock(initial['package-lock.json']);
      const parentIdentity = await directoryIdentity(captured.recoveryParent);
      const recoveryRelative = path.relative(initialIdentity.real, parentIdentity.real);
      if (!recoveryRelative || (!recoveryRelative.startsWith(`..${path.sep}`) && recoveryRelative !== '..' && !path.isAbsolute(recoveryRelative))) throw fail('INVALID_INPUT');
      recoveryDirectory = await fs.mkdtemp(path.join(captured.recoveryParent, 'prepare-'));
      await unchangedIdentity(captured.recoveryParent, parentIdentity);
      try {
        await saveEvidence(recoveryDirectory, 'original', initial);
        guard();
        const npmOptions = await loadEngineNpmConfig(captured);
        // Global installation has different save/tree semantics; do not reinterpret
        // the captured policy or authorize mutation beyond this configuration tree.
        if (npmOptions.global) throw fail('UNSUPPORTED_CONFIG');
        const load = localRuntimePackage('@npmcli/arborist', '9.4.0');
        const Arborist = load('@npmcli/arborist');
        const options = { ...npmOptions, path: captured.directory, binLinks: true, progress: false, savePrefix: '', ignoreScripts: true, signal };
        const arborist = arboristFactory ? arboristFactory(Arborist, options) : new Arborist(options);
        await unchangedIdentity(captured.directory, initialIdentity);
        await supportedFiles(captured.directory);
        if (!isDeepStrictEqual(summary(await readMetadata(captured.directory)), summary(initial))) throw fail('TARGET_CHANGED');
        guard();
        // Exact declared + existing genuine lock permits repair without a registry packument refresh.
        const repair = before.dependencies?.[SDK] === VERSION && initial['package-lock.json'].exists;
        try { await arborist.reify({ ...npmOptions, add: repair ? [] : [`${SDK}@${VERSION}`], save: true, saveType: 'prod', signal }); }
        catch (cause) { throw Object.assign(fail('REIFY_FAILED'), { cause }); }
        guard();
        await unchangedIdentity(captured.directory, initialIdentity);
        await supportedFiles(captured.directory);
        const after = await readMetadata(captured.directory);
        preserved(before, manifest(after['package.json']));
        verifiedNodes = await verifyTree(Arborist, options, after, signal);
        guard();
        await unchangedIdentity(captured.directory, initialIdentity);
        if (!isDeepStrictEqual(summary(await readMetadata(captured.directory)), summary(after))) throw fail('TARGET_CHANGED');
        await saveEvidence(recoveryDirectory, 'observed', after);
        guard();
      } catch (primary) {
        const errors = [primary];
        try {
          await unchangedIdentity(captured.directory, initialIdentity);
          await saveEvidence(recoveryDirectory, 'failed', await readMetadata(captured.directory));
        }
        catch (e) { errors.push(e); }
        try { await fs.writeFile(path.join(recoveryDirectory, 'failure.json'), JSON.stringify({ status: 'blocked', code: codes.has(primary.code) ? primary.code : 'PREPARATION_FAILED' }), { flag: 'wx', mode: 0o600 }); }
        catch (e) { errors.push(e); }
        if (errors.length > 1) throw Object.assign(new AggregateError(errors, 'RECOVERY_FAILED'), { code: 'RECOVERY_FAILED' });
        throw primary;
      }
    });
    if (captured.signal?.aborted || Date.now() >= captured.deadline) throw fail('CANCELLED');
    return result('ready', 'READY', recoveryDirectory, undefined, verifiedNodes);
  } catch (cause) {
    const code = codes.has(cause.code) ? cause.code : 'PREPARATION_FAILED';
    if (recoveryDirectory) {
      try {
        await fs.writeFile(path.join(recoveryDirectory, 'result.json'), JSON.stringify({ status: 'blocked', code }), { flag: 'wx', mode: 0o600 });
      } catch (cleanup) {
        cause = new AggregateError([cause, cleanup], 'RECOVERY_RESULT_FAILED');
      }
    }
    return result('blocked', code, recoveryDirectory, cause);
  }
}
