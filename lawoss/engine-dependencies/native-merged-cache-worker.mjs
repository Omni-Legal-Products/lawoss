// CI-only acquisition. The disposable process contains unjoinable HTTP-cache
// abort writes; only the supervisor's positive child close releases ownership.
import { readFile, realpath, readdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { acceptedArtifacts, ACCEPTED } from '../build/plugin-payload/prime-cache.mjs';
import { acquireArtifacts, checkArtifacts } from '../build/plugin-payload/prime-transfer.mjs';
import { verifyWorkspace } from '../build/plugin-payload/prepare.mjs';
import { sha256 } from '../build/plugin-payload/validate.mjs';
export const RUNTIME_LOCK = '78b707c0f4ad96a49e52c14c63d594ddbe125f16dc7a09a7ab83d4f20b35ebc6';
export const METADATA_LIMITS = Object.freeze({ bodyBytes: 16 * 1024 * 1024, totalBytes: 128 * 1024 * 1024, requestMs: 45000 });
export const ACCEPT = Object.freeze(['application/json', 'application/vnd.npm.install-v1+json; q=1.0, application/json; q=0.8, */*']);
export const VERSIONS = Object.freeze({ arborist: '9.4.0', config: '10.8.1', cacache: '20.0.4', pacote: '21.5.1', registryFetch: '19.1.1', fetch: '15.0.6', npa: '13.0.2' });
const codes = new Set(['NODE_VERSION', 'TOOLS_INVALID', 'INPUT_INVALID', 'INPUT_DRIFT', 'ALLOWLIST_INVALID', 'WORKSPACE_INVALID', 'CACHE_NOT_EMPTY', 'NETWORK_DISABLED', 'CANCELLED', 'PRIMER_DEADLINE', 'REQUEST_TIMEOUT', 'HTTP_STATUS', 'HTTP_ENCODING', 'ARCHIVE_LIMIT', 'TOTAL_LIMIT', 'CACHE_INTEGRITY', 'TRANSPORT_FAILED', 'TRANSFER_FAILED', 'METADATA_BODY_LIMIT', 'METADATA_TOTAL_LIMIT', 'METADATA_JSON', 'METADATA_DIST', 'METADATA_FAILED', 'OFFLINE_READBACK', 'ACQUISITION_FAILED']);
export const publicCode = error => codes.has(error?.code) ? error.code : 'ACQUISITION_FAILED';
export function refuse(code) { throw Object.assign(new Error(code), { code }); }
export function active(deadline, signal, now = Date.now) {
  if (signal?.aborted) refuse('CANCELLED');
  if (!Number.isSafeInteger(deadline) || now() >= deadline) refuse('PRIMER_DEADLINE');
}
export async function runtimeApis() {
  try {
    if (sha256(await readFile(new URL('./runtime-tools/pnpm-lock.yaml', import.meta.url))) !== RUNTIME_LOCK) refuse('TOOLS_INVALID');
    const base = await realpath(new URL('./runtime-tools/node_modules/', import.meta.url));
    const root = createRequire(new URL('./runtime-tools/package.json', import.meta.url));
    async function bind(require, name, version) {
      const manifest = await realpath(require.resolve(`${name}/package.json`));
      const entry = await realpath(require.resolve(name));
      for (const file of [manifest, entry]) {
        const relative = path.relative(base, file);
        if (relative.startsWith(`..${path.sep}`) || relative === '..' || path.isAbsolute(relative)) refuse('TOOLS_INVALID');
      }
      const pkg = JSON.parse(await readFile(manifest));
      if (pkg.name !== name || pkg.version !== version || !entry.startsWith(path.dirname(manifest) + path.sep)) refuse('TOOLS_INVALID');
      return { api: require(name), require: createRequire(entry) };
    }
    const a = await bind(root, '@npmcli/arborist', VERSIONS.arborist);
    await bind(root, '@npmcli/config', VERSIONS.config);
    const p = await bind(a.require, 'pacote', VERSIONS.pacote);
    const r = await bind(p.require, 'npm-registry-fetch', VERSIONS.registryFetch);
    const f = await bind(r.require, 'make-fetch-happen', VERSIONS.fetch);
    const c = await bind(a.require, 'cacache', VERSIONS.cacache);
    const n = await bind(a.require, 'npm-package-arg', VERSIONS.npa);
    return { pacote: p.api, fetch: f.api, cacache: c.api, npa: n.api };
  } catch { refuse('TOOLS_INVALID'); }
}
export async function namedArtifacts(npa) {
  const admission = await acceptedArtifacts();
  const bytes = await readFile(new URL('../build/plugin-payload/sdk/package-lock.json', import.meta.url));
  if (sha256(bytes) !== ACCEPTED.lockSha256) refuse('INPUT_DRIFT');
  const names = Object.entries(JSON.parse(bytes).packages).filter(([key]) => key !== '').map(([key, pkg]) => {
    const name = key.replace(/^node_modules\//, '');
    const spec = npa.resolve(name, pkg.version);
    if (key !== `node_modules/${name}` || spec.name !== name || spec.type !== 'version' || spec.fetchSpec !== pkg.version || !spec.registry || !spec.escapedName || spec.escapedName.includes('..')) refuse('ALLOWLIST_INVALID');
    return { name, version: pkg.version, escapedName: spec.escapedName, resolved: pkg.resolved, integrity: pkg.integrity };
  });
  checkArtifacts(names);
  if (names.length !== 32 || new Set(names.map(r => r.name)).size !== 32 || JSON.stringify(names.map(({ resolved, integrity }) => ({ resolved, integrity }))) !== JSON.stringify(admission.records)) refuse('ALLOWLIST_INVALID');
  return names;
}
export function validateMetadata(value, record) {
  const version = value?.versions?.[record.version];
  if (!value || typeof value !== 'object' || Array.isArray(value) || value.name !== record.name || version?.name !== record.name || version?.version !== record.version || version?.dist?.tarball !== record.resolved || version?.dist?.integrity !== record.integrity) refuse('METADATA_DIST');
}
export async function collectMetadata(body, budget, limits = METADATA_LIMITS) {
  const chunks = []; let bytes = 0;
  try {
    for await (const chunk of body) {
      bytes += chunk.length; budget.bytes += chunk.length;
      if (bytes > limits.bodyBytes) refuse('METADATA_BODY_LIMIT');
      if (budget.bytes > limits.totalBytes) refuse('METADATA_TOTAL_LIMIT');
      chunks.push(chunk);
    }
    return Buffer.concat(chunks, bytes);
  } finally { chunks.length = 0; }
}
export async function metadataRequest({ fetch, cache, record, accept, budget, deadline, signal, limits = METADATA_LIMITS }) {
  active(deadline, signal);
  const controller = new AbortController(); let reason, response;
  const stop = code => { reason ??= Object.assign(new Error(code), { code }); controller.abort(reason); response?.body?.destroy(); };
  const cancel = () => stop('CANCELLED');
  signal?.addEventListener('abort', cancel, { once: true });
  const deadlineTimer = setTimeout(() => stop('PRIMER_DEADLINE'), Math.max(0, deadline - Date.now()));
  const requestTimer = setTimeout(() => stop('REQUEST_TIMEOUT'), limits.requestMs);
  try {
    response = await fetch(`https://registry.npmjs.org/${record.escapedName}`, {
      cachePath: cache, cache: 'default', method: 'GET', retry: { retries: 0 }, redirect: 'error', strictSSL: true,
      maxSockets: 1, timeout: limits.requestMs, signal: controller.signal, headers: { accept },
    });
    if (reason) throw reason;
    if (response.status !== 200) refuse('HTTP_STATUS');
    const bytes = await collectMetadata(response.body, budget, limits);
    if (reason) throw reason;
    active(deadline, signal);
    let value; try { value = JSON.parse(bytes); } catch { refuse('METADATA_JSON'); }
    validateMetadata(value, record);
  } catch (error) {
    // The public API cannot join an aborted cache tee. The disposable process,
    // and the parent's joined close, are the containment boundary.
    stop(publicCode(error) === 'ACQUISITION_FAILED' ? 'METADATA_FAILED' : publicCode(error));
    throw reason;
  } finally {
    clearTimeout(deadlineTimer); clearTimeout(requestTimer); signal?.removeEventListener('abort', cancel);
    response?.body?.destroy();
  }
}
export const OPERATION_RECEIPT = 'native-operation.json';
export function validateOperationReceipt(value) {
  if (!value || Object.keys(value).sort().join(',') !== 'code,metadata,offline,schema,stage,status,tarballs' || value.schema !== 1 || value.status !== 'failed' ||
      !['admission', 'tarballs', 'metadata', 'offline', 'revalidation'].includes(value.stage) || !codes.has(value.code) ||
      !['tarballs', 'metadata', 'offline'].every(key => Number.isSafeInteger(value[key]) && value[key] >= 0 && value[key] <= (key === 'tarballs' ? 32 : 64))) refuse('RECEIPT_INVALID');
  return value;
}
export async function writeOperationReceipt(workspace, value) {
  validateOperationReceipt(value); await verifyWorkspace(workspace);
  await writeFile(path.join(workspace, OPERATION_RECEIPT), JSON.stringify(value), { flag: 'wx', mode: 0o600 });
}
export async function acquireNativeCache(workspace, deadline, signal) {
  const progress = { schema: 1, status: 'failed', stage: 'admission', code: 'ACQUISITION_FAILED', tarballs: 0, metadata: 0, offline: 0 };
  try {
  if (process.version !== 'v22.23.2') refuse('NODE_VERSION');
  active(deadline, signal);
  if (deadline - Date.now() > 300000) refuse('PRIMER_DEADLINE');
  await verifyWorkspace(workspace);
  const cache = path.join(workspace, 'cache/_cacache');
  if ((await readdir(cache)).length) refuse('CACHE_NOT_EMPTY');
  const apis = await runtimeApis(); const records = await namedArtifacts(apis.npa);
  active(deadline, signal);
  if (globalThis[Symbol.for('lawoss.payload.networkDisabled')] || process.env.LAWOSS_PAYLOAD_OFFLINE_ONLY === '1') refuse('NETWORK_DISABLED');
  progress.stage = 'tarballs';
  const tarballs = await acquireArtifacts({ cache, records, cacheApi: apis.cacache, signal, deadline, now: Date.now });
  progress.tarballs = tarballs.verified; progress.stage = 'metadata';
  const budget = { bytes: 0 }; let metadata = 0, offline = 0;
  for (const record of records) for (const accept of ACCEPT) {
    await metadataRequest({ fetch: apis.fetch, cache, record, accept, budget, deadline, signal }); metadata++; progress.metadata = metadata;
  }
  progress.stage = 'offline';
  for (const record of records) for (const fullMetadata of [true, false]) {
    active(deadline, signal);
    try {
      const value = await apis.pacote.packument(record.name, { cache, offline: true, fullMetadata, registry: 'https://registry.npmjs.org/', retry: { retries: 0 }, strictSSL: true, signal });
      validateMetadata(value, record);
    } catch { refuse('OFFLINE_READBACK'); }
    active(deadline, signal); offline++; progress.offline = offline;
  }
  progress.stage = 'revalidation';
  await acceptedArtifacts(); await runtimeApis(); await verifyWorkspace(workspace); active(deadline, signal);
  return { schema: 1, phase: 'acquisition', status: 'complete', ...ACCEPTED, runtimeLockSha256: RUNTIME_LOCK,
    node: process.version, platform: process.platform, versions: VERSIONS,
    tarballs: tarballs.verified, names: records.length, metadata, offline, archiveBytes: tarballs.totalBytes, metadataBytes: budget.bytes };
  } catch (primary) {
    let receiptError;
    try { await writeOperationReceipt(workspace, { ...progress, code: publicCode(primary) }); } catch (error) { receiptError = error; }
    const error = Object.assign(new Error(publicCode(primary)), { code: publicCode(primary) });
    Object.defineProperty(error, 'private', { value: { primary, receiptError } }); throw error;
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const controller = new AbortController(); const cancel = () => controller.abort();
  process.once('SIGTERM', cancel); process.once('SIGINT', cancel);
  try {
    if (process.argv.length !== 4) refuse('INPUT_INVALID');
    console.log(JSON.stringify(await acquireNativeCache(process.argv[2], Number(process.argv[3]), controller.signal)));
  } catch (error) { console.error(JSON.stringify({ schema: 1, phase: 'acquisition', status: 'failed', code: publicCode(error) })); process.exitCode = 1; }
  finally { process.removeListener('SIGTERM', cancel); process.removeListener('SIGINT', cancel); }
}
