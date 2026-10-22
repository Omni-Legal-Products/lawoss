// Minimal Electron fixture, not the product main. Parent owns lifetime/closure.
import { constants, closeSync, fstatSync, lstatSync, openSync, readSync, realpathSync, renameSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const documentsProbeCases = Object.freeze(['alpha-environment', 'home-documents-present', 'explicit-documents-control']);
const bad = () => { throw Object.assign(new Error('windows-documents-fixture-invalid'), { code: 'windows-documents-fixture-invalid' }); };
const same = (a, b) => a.dev === b.dev && a.ino === b.ino;
const unchanged = (a, b) => same(a, b) && a.size === b.size && a.mtimeMs === b.mtimeMs && a.ctimeMs === b.ctimeMs;
export function readDocumentsProbeJson(file) {
  const before = lstatSync(file);
  if (!before.isFile() || before.isSymbolicLink() || before.nlink !== 1 || before.size < 1 || before.size > 8192 || realpathSync(file) !== file) bad();
  const handle = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
  try {
    if (!unchanged(before, fstatSync(handle))) bad();
    const bytes = Buffer.alloc(before.size + 1), length = readSync(handle, bytes, 0, bytes.length, 0);
    if (length !== before.size || !unchanged(before, fstatSync(handle)) || !unchanged(before, lstatSync(file)) || realpathSync(file) !== file) bad();
    const text = bytes.subarray(0, length).toString('utf8');
    if (!Buffer.from(text).equals(bytes.subarray(0, length))) bad();
    return JSON.parse(text);
  } finally { closeSync(handle); }
}
function ownedFixture(input) {
  if (!input || Object.getPrototypeOf(input) !== Object.prototype) bad();
  const fields = Object.getOwnPropertyDescriptors(input), keys = ['schema', 'root', 'owner', 'nonce', 'caseId'];
  if (Reflect.ownKeys(fields).length !== keys.length || keys.some(key => !fields[key]?.enumerable || !Object.hasOwn(fields[key], 'value'))) bad();
  const f = Object.fromEntries(keys.map(key => [key, fields[key].value]));
  if (f.schema !== 1 || !documentsProbeCases.includes(f.caseId) || typeof f.root !== 'string' || f.root.length > 4096 ||
    !path.isAbsolute(f.root) || path.resolve(f.root) !== f.root || typeof f.owner !== 'string' || !/^[a-f0-9-]{36}$/.test(f.owner) ||
    typeof f.nonce !== 'string' || !/^[a-f0-9]{64}$/.test(f.nonce)) bad();
  const root = lstatSync(f.root);
  if (!root.isDirectory() || root.isSymbolicLink() || realpathSync(f.root) !== f.root ||
    (typeof process.getuid === 'function' && (root.uid !== process.getuid() || (root.mode & 0o077)))) bad();
  const marker = readDocumentsProbeJson(path.join(f.root, '.lawoss-release-acceptance-profile.json'));
  if (marker.schemaVersion !== 1 || marker.synthetic !== true || marker.kind !== 'fresh' || marker.root !== f.root || marker.owner !== f.owner) bad();
  return { ...f, identity: root };
}
export function classifyWindowsDocumentsPath(root, value) {
  if (typeof value !== 'string') return 'not-string';
  if (value.length > 4096) return 'oversized';
  if (!path.win32.isAbsolute(value)) return 'not-absolute';
  const relative = path.win32.relative(root, value);
  return relative === '' || (!path.win32.isAbsolute(relative) && relative !== '..' && !relative.startsWith('..\\')) ? 'inside-owned-root' : 'outside-owned-root';
}
const ownCode = error => {
  try { const field = error && Object.getOwnPropertyDescriptor(error, 'code'); return field && Object.hasOwn(field, 'value') && ['ENOENT', 'EACCES', 'EPERM'].includes(field.value) ? field.value : 'other'; }
  catch { return 'other'; }
};
function publishRecord(root, kind, value) {
  const final = path.join(root, `documents-${kind}.json`), pending = path.join(root, `.documents-${kind}.pending`);
  const absent = () => { try { lstatSync(final); } catch (error) { if (error.code === 'ENOENT') return; throw error; } bad(); };
  absent();
  writeFileSync(pending, JSON.stringify(value), { flag: 'wx', mode: 0o600 });
  absent();
  // Fixed names in the caller's exclusive fixture; no hostile no-replace claim.
  // Failures retain pending bytes rather than retrying or exposing a partial final.
  renameSync(pending, final);
}

/** Unit callers provide a controlled app; native CLI always uses real Electron. */
export function observeWindowsDocumentsPath({ app, fixture, runtime }) {
  const f = ownedFixture(fixture);
  if (runtime?.electron !== '43.7.5' || !['x64', 'arm64'].includes(runtime.arch)) bad();
  const base = { schema: 1, nonce: f.nonce, caseId: f.caseId, electron: runtime.electron, arch: runtime.arch };
  let phase = 'user-data-setup', beforeReady = null, outcome, scope = 'not-observed', started, durationMs = null, durationCapped = false, errorName = 'none', errorCode = 'none';
  try {
    app.setPath('userData', path.join(f.root, 'userdata'));
    phase = 'logs-setup'; app.setAppLogsPath(path.join(f.root, 'userdata/logs'));
    if (f.caseId === 'explicit-documents-control') {
      phase = 'documents-override';
      const documents = path.join(f.root, 'documents'), stat = lstatSync(documents);
      if (!stat.isDirectory() || stat.isSymbolicLink() || realpathSync(documents) !== documents) bad();
      app.setPath('documents', documents);
    }
    phase = 'userData'; app.getPath('userData');
    phase = 'home'; app.getPath('home');
    phase = 'ready-state'; beforeReady = !app.isReady();
    phase = 'record-entered';
    publishRecord(f.root, 'entered', { ...base, phase: 'documents', beforeReady });
    phase = 'documents'; started = performance.now();
    const value = app.getPath('documents');
    outcome = 'returned'; scope = classifyWindowsDocumentsPath(f.root, value);
  } catch (error) {
    outcome = phase === 'documents' ? 'threw' : 'before-documents-failure';
    errorName = error instanceof TypeError ? 'TypeError' : error instanceof Error ? 'Error' : 'other';
    errorCode = ownCode(error);
  }
  if (started !== undefined) { const elapsed = Math.max(0, Math.round(performance.now() - started)); durationMs = Math.min(60000, elapsed); durationCapped = elapsed > 60000; }
  if (!same(f.identity, lstatSync(f.root)) || realpathSync(f.root) !== f.root) bad();
  const result = { ...base, phase, beforeReady, outcome, scope, durationMs, durationCapped, errorName, errorCode };
  publishRecord(f.root, 'result', result);
  return result;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.platform !== 'win32' || process.env.GITHUB_ACTIONS !== 'true' || process.env.RUNNER_ENVIRONMENT !== 'github-hosted' || process.argv.length !== 3) bad();
  const fixtureFile = path.resolve(process.argv[2]), fixture = readDocumentsProbeJson(fixtureFile);
  if (path.dirname(fixtureFile) !== fixture.root) bad();
  const { app } = await import('electron');
  // Keep a completed observation alive until the original JobObject stops it;
  // the fixture does not share or invent a supervisor control protocol.
  setInterval(() => {}, 1000);
  observeWindowsDocumentsPath({ app, fixture, runtime: { electron: process.versions.electron, arch: process.arch } });
}
