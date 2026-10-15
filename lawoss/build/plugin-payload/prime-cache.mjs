import { readFile, readdir, lstat, mkdir, rmdir, open } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { verifyWorkspace } from './prepare.mjs';
import { validateInputs, sha256, fail } from './validate.mjs';
import { acquireArtifacts, checkArtifacts, LIMITS } from './prime-transfer.mjs';
export const ACCEPTED = Object.freeze({ lockSha256: '59f4b854ddab534533fd878c5a7c325a7a1bc3382294d68111cff005920a4053', inputSha256: '4129dbab935b7ee959557c6b6e4c5dea29e93f77c41ec9c056a379426b0e2536', toolsLockSha256: '906e9f8595d14d63f97b0fc4279ff56512b652d6f86215ee64518cce7fe12352' });
async function regular(url) {
  const stat = await lstat(url);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > 1024 * 1024) fail('INPUT_INVALID');
  return readFile(url);
}
export async function acceptedArtifacts() {
  const input = await regular(new URL('./sdk/package.json', import.meta.url));
  const lock = await regular(new URL('./sdk/package-lock.json', import.meta.url));
  const tools = await regular(new URL('./tools/pnpm-lock.yaml', import.meta.url));
  if (sha256(input) !== ACCEPTED.inputSha256 || sha256(lock) !== ACCEPTED.lockSha256 || sha256(tools) !== ACCEPTED.toolsLockSha256) fail('INPUT_DRIFT');
  const accepted = validateInputs(JSON.parse(input), JSON.parse(lock));
  const records = Object.entries(accepted.packages).filter(([name]) => name !== '').map(([, pkg]) => ({ resolved: pkg.resolved, integrity: pkg.integrity }));
  if (records.length !== 32 || new Set(records.map(record => record.resolved + '\0' + record.integrity)).size > 32) fail('ALLOWLIST_INVALID');
  checkArtifacts(records);
  return { ...ACCEPTED, records };
}
const sameIdentity = (a, b) => b?.isDirectory() && !b.isSymbolicLink() && a.ino === b.ino && a.dev === b.dev;
export async function primeAcceptedCache(options = {}) {
  if (Object.keys(options).some(key => !['workspace', 'signal'].includes(key))) fail('ARGUMENT_INVALID');
  const { workspace, signal } = options;
  if (process.version !== 'v24.21.0') fail('NODE_VERSION');
  const deadline = performance.now() + LIMITS.deadlineMs;
  const check = () => { if (signal?.aborted) fail('CANCELLED'); if (performance.now() >= deadline) fail('PRIMER_DEADLINE'); };
  check(); await verifyWorkspace(workspace);
  const admission = path.join(workspace, '.admit-primer');
  try { await mkdir(admission, { mode: 0o700 }); } catch (error) { if (error.code === 'EEXIST') fail('PRIMER_BUSY'); throw error; }
  const identity = await lstat(admission); const workspaceIdentity = await lstat(workspace);
  const cache = path.join(workspace, 'cache'); const cacheIdentity = await lstat(cache);
  let receiptHandle, receiptIdentity;
  const receiptPath = path.join(workspace, 'acquisition.json');
  const writeReceipt = async value => {
    const current = await lstat(receiptPath);
    if (!current.isFile() || current.nlink !== 1 || current.ino !== receiptIdentity.ino || current.dev !== receiptIdentity.dev) fail('WORKSPACE_INVALID');
    const bytes = Buffer.from(JSON.stringify(value));
    await receiptHandle.write(bytes, 0, bytes.length, 0); await receiptHandle.truncate(bytes.length);
  };
  try {
    if ((await readdir(cache)).length) fail('CACHE_NOT_EMPTY');
    // Completion or failure is a one-shot workspace state; no in-place retries.
    receiptHandle = await open(receiptPath, 'wx', 0o600); receiptIdentity = await receiptHandle.stat();
    await writeReceipt({ schema: 1, outcome: 'incomplete' });
    const accepted = await acceptedArtifacts(); check();
    if (globalThis[Symbol.for('lawoss.payload.networkDisabled')] || process.env.LAWOSS_PAYLOAD_OFFLINE_ONLY === '1') fail('NETWORK_DISABLED');
    const require = createRequire(new URL('./tools/package.json', import.meta.url));
    const toolRequire = createRequire(require.resolve('@npmcli/arborist'));
    if (require('@npmcli/arborist/package.json').version !== '9.4.0' || toolRequire('cacache/package.json').version !== '20.0.4') fail('TOOLS_INVALID');
    const result = await acquireArtifacts({ cache, records: accepted.records, cacheApi: toolRequire('cacache'), signal, deadline });
    await acceptedArtifacts(); await verifyWorkspace(workspace); check();
    if (!sameIdentity(workspaceIdentity, await lstat(workspace)) || !sameIdentity(cacheIdentity, await lstat(cache)) || !sameIdentity(identity, await lstat(admission))) fail('WORKSPACE_INVALID');
    const complete = { schema: 1, outcome: 'complete', ...ACCEPTED, ...result };
    await writeReceipt(complete); check();
    return complete;
  } catch (error) {
    // Retain incomplete acquisition; never publish or remove its partial cache.
    if (receiptHandle) await writeReceipt({ schema: 1, outcome: 'incomplete', ...ACCEPTED, ...(error.progress ?? {}) }).catch(() => {});
    throw error;
  } finally {
    await receiptHandle?.close().catch(() => {});
    if (sameIdentity(identity, await lstat(admission).catch(() => null))) await rmdir(admission).catch(() => {});
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [workspace, ...extra] = process.argv.slice(2); const controller = new AbortController(); const abort = () => controller.abort();
  process.once('SIGINT', abort); process.once('SIGTERM', abort);
  try { if (!workspace || extra.length) fail('ARGUMENT_INVALID'); console.log(JSON.stringify(await primeAcceptedCache({ workspace, signal: controller.signal }))); }
  catch (error) { console.error(JSON.stringify({ outcome: 'incomplete', code: /^[A-Z_]{1,40}$/.test(error.code) ? error.code : 'PRIMER_FAILED' })); process.exitCode = 1; }
  finally { process.removeListener('SIGINT', abort); process.removeListener('SIGTERM', abort); }
}
