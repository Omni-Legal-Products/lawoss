// Preparation-only, one first-helper experiment; never a production launcher.
// Reporter import is inert. Native admission and every CLI effect are below main.
import { spawn, execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { lstat, realpath, mkdir, readFile, writeFile, open } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { types } from 'node:util';

export const TITLE = 'native Windows job stops root and detached grandchild before returning verified closure';
export const MARKER = 'chore: spustit jediny cold-helper experiment 20261023';
export const REF = 'refs/heads/fix/spolahliva-alfa-sest-platform-20261021';
export const SCHEMA = 1;
export const LIMIT = 1024 * 1024;
export const INPUTS = Object.freeze({
  'windows-job.ps1': Object.freeze([14365, '4bf127b8f0878db796521845f5abd77cf2f6c499d5f561ee51cba3991e34af95']),
  'windows-job.mjs': Object.freeze([12043, '94712ee2ffc11983020512b9c8e3dff7f036f9cab9044c249b822025120755c8']),
  'windows-job.test.mjs': Object.freeze([24547, '2a7a855c351c8a980c0244af220544ca49c8e59b1053eb19920a840b240f176c']),
});
export const INSERT = String.raw`  Write-CallBoundary 'import' 'before'
  try {
    Import-Module -Name ([System.IO.Path]::Combine($PSHOME, 'Modules\Microsoft.PowerShell.Utility\Microsoft.PowerShell.Utility.psd1'))
  } catch {
    Write-CallBoundary 'import' 'error'
    throw
  }
  Write-CallBoundary 'import' 'return'
`;
const IMPORT_KIND = 'lawoss-windows-cold-import-observer';
const LAUNCH_KIND = 'lawoss-windows-job-launch-observer';
export const hash = bytes => createHash('sha256').update(bytes).digest('hex');
function refuse(code) { throw new Error(code); }
function requireThat(value, code) { if (!value) refuse(code); }
function replaceOnce(source, anchor, replacement) {
  requireThat(source.split(anchor).length === 2, 'source-anchor');
  return source.replace(anchor, replacement);
}

// This self-contained function is copied verbatim into BOTH observed modules.
// No timer, filesystem, await or backpressure wait can precede original cancel.
export function createImportObserver(clock = () => performance.now(), publish = value => {
  process.stderr.once('error', () => {});
  process.stderr.write(`${JSON.stringify(value)}\n`, () => {});
}) {
  const origin = clock(), slots = { before: null, return: null, error: null };
  let line = '', overflow = false, frozen = false, terminal = false;
  return {
    write(chunk) {
      if (frozen) return;
      for (const character of chunk) {
        if (character !== '\n') {
          if (!overflow) {
            if (line.length === 256) { line = ''; overflow = true; } else line += character;
          }
          continue;
        }
        const complete = line.endsWith('\r') ? line.slice(0, -1) : line;
        const match = !overflow && /^LAWOSS_WINDOWS_JOB_CALL:import:(before|return|error):(0|[1-9][0-9]{0,4}):(0|1)$/.exec(complete);
        line = ''; overflow = false;
        if (!match || Number(match[2]) > 60000 || match[3] === '1' && match[2] !== '60000') continue;
        const boundary = match[1];
        if (boundary === 'before' ? slots.before !== null : terminal) continue;
        if (boundary !== 'before') terminal = true;
        const elapsed = Math.max(0, Math.round(clock() - origin));
        slots[boundary] = Object.freeze({ childElapsedMs: Number(match[2]), childElapsedCapped: match[3] === '1',
          parentDeliveryElapsedMs: Math.min(60000, elapsed), parentDeliveryElapsedCapped: elapsed > 60000 });
      }
    },
    freeze(error) {
      if (frozen) return;
      frozen = true; line = '';
      const code = error === null ? null : Object.getOwnPropertyDescriptor(error, 'code')?.value === 'windows-job-start-timeout' ? 'windows-job-start-timeout' : 'other';
      const snapshot = { kind: 'lawoss-windows-cold-import-observer', schema: 1, parentClock: 'copied-launcher-entry',
        childClock: 'helper-stopwatch', failureCode: code, slots: { ...slots } };
      try { const result = publish(snapshot); if (result && typeof result.catch === 'function') result.catch(() => {}); } catch { /* Observation cannot change supervision. */ }
      return snapshot;
    },
  };
}

export function composeSources(sources, arm) {
  requireThat(['control', 'absolute-import'].includes(arm), 'arm');
  for (const [name, [bytes, sha]] of Object.entries(INPUTS)) requireThat(Buffer.isBuffer(sources[name]) && sources[name].length === bytes && hash(sources[name]) === sha, 'source-binding');
  const original = sources['windows-job.mjs'].toString('utf8'), edits = [
    ['export async function launchWindowsJob(input, onCheckpoint, onCallBoundary) {', 'export async function launchWindowsJob(input, onCheckpoint, onCallBoundary) {\n  let coldObserver; try { coldObserver = createImportObserver(); } catch {}'],
    ["  child.stderr.on('data', chunk => diagnostics.write(chunk));", "  child.stderr.on('data', chunk => { diagnostics.write(chunk); try { coldObserver?.write(chunk); } catch {} });"],
    ['diagnostics.freeze(); await cancel(); throw error;', 'diagnostics.freeze(); try { coldObserver?.freeze(error); } catch {} await cancel(); throw error;'],
    ['  diagnostics.freeze();\n  return {', '  diagnostics.freeze(); try { coldObserver?.freeze(null); } catch {}\n  return {'],
  ];
  const prefix = `// Common observation-only experiment transform.\n${createImportObserver.toString()}\n`;
  let module = original;
  for (const [before, after] of edits) module = replaceOnce(module, before, after);
  let inverse = module;
  for (const [before, after] of [...edits].reverse()) inverse = replaceOnce(inverse, after, before);
  requireThat(inverse === original, 'source-inverse');
  const control = sources['windows-job.ps1'].toString('utf8');
  const anchor = '  $configuration = Microsoft.PowerShell.Utility\\ConvertFrom-Json -InputObject $line\n';
  const treatment = replaceOnce(control, anchor, INSERT + anchor);
  requireThat(replaceOnce(treatment, INSERT, '') === control, 'source-inverse');
  requireThat(control.split("  Add-Type @'\n").length === 2 && treatment.slice(treatment.indexOf("  Add-Type @'\n")) === control.slice(control.indexOf("  Add-Type @'\n")), 'source-csharp');
  return { 'windows-job.ps1': Buffer.from(arm === 'control' ? control : treatment),
    'windows-job.mjs': Buffer.from(prefix + module), 'windows-job.test.mjs': Buffer.from(sources['windows-job.test.mjs']) };
}

// Read own data descriptors only: getters and proxies cannot become evidence.
function dataObject(value) {
  requireThat(value !== null && typeof value === 'object' && !Array.isArray(value) && !types.isProxy(value), 'object');
  const descriptors = Object.getOwnPropertyDescriptors(value), result = Object.create(null);
  requireThat(Object.keys(descriptors).length <= 32 && Reflect.ownKeys(value).length === Object.keys(descriptors).length, 'object');
  for (const [key, descriptor] of Object.entries(descriptors)) {
    requireThat(Object.hasOwn(descriptor, 'value'), 'accessor'); result[key] = descriptor.value;
  }
  return result;
}
function closed(value, keys) {
  const data = dataObject(value);
  requireThat(Object.keys(data).length === keys.length && keys.every(key => Object.hasOwn(data, key)), 'fields');
  return data;
}
function elapsed(value) { return Number.isInteger(value) && value >= 0 && value <= 60000 && !Object.is(value, -0); }
function timing(value) {
  if (value === null) return;
  const d = closed(value, ['childElapsedMs', 'childElapsedCapped', 'parentDeliveryElapsedMs', 'parentDeliveryElapsedCapped']);
  for (const [number, cap] of [[d.childElapsedMs, d.childElapsedCapped], [d.parentDeliveryElapsedMs, d.parentDeliveryElapsedCapped]]) requireThat(elapsed(number) && typeof cap === 'boolean' && (!cap || number === 60000), 'timing');
}
function ordered(slots, beforeKey, returnKey, errorKey) {
  const before = slots[beforeKey], terminal = slots[returnKey] ?? slots[errorKey];
  requireThat(!(slots[returnKey] && slots[errorKey]) && (!terminal || before !== null), 'order');
  if (terminal) requireThat(terminal.childElapsedMs >= before.childElapsedMs && terminal.parentDeliveryElapsedMs >= before.parentDeliveryElapsedMs, 'order');
}
export function validateProjection(value, kind) {
  const d = kind === IMPORT_KIND ? closed(value, ['kind', 'schema', 'parentClock', 'childClock', 'failureCode', 'slots'])
    : closed(value, ['kind', 'timingSemantics', 'snapshotBoundary', 'checkpointFirstObservedMs', 'callBoundaryFirstObserved', 'callTimingSemantics', 'elapsedMs', 'elapsedCapped', 'elapsedMayIncludeInternalCancellation', 'outcome']);
  requireThat(d.kind === kind, 'kind');
  if (kind === IMPORT_KIND) {
    requireThat(d.schema === 1 && d.parentClock === 'copied-launcher-entry' && d.childClock === 'helper-stopwatch' && [null, 'other', 'windows-job-start-timeout'].includes(d.failureCode), 'projection');
    const slots = closed(d.slots, ['before', 'return', 'error']); Object.values(slots).forEach(timing); ordered(slots, 'before', 'return', 'error');
  } else {
    requireThat(d.timingSemantics === 'parent-observed-checkpoint-delivery' && d.snapshotBoundary === 'observer-released-before-cancel-or-ready-return' &&
      d.callTimingSemantics === 'child-relative-source-bracket-and-parent-delivery-independent-origins' && ['ready', 'failed'].includes(d.outcome) && elapsed(d.elapsedMs) && typeof d.elapsedCapped === 'boolean' && (!d.elapsedCapped || d.elapsedMs === 60000) && d.elapsedMayIncludeInternalCancellation === (d.outcome === 'failed'), 'projection');
    const checkpoints = closed(d.checkpointFirstObservedMs, ['entry', 'encoding', 'input-read', 'decoded', 'configured', 'compiled', 'created']);
    let previous = -1;
    for (const value of Object.values(checkpoints)) if (value !== null) { requireThat(elapsed(value) && value >= previous, 'checkpoint'); previous = value; }
    const slots = closed(d.callBoundaryFirstObserved, ['decode-before', 'decode-return', 'decode-error', 'compile-before', 'compile-return', 'compile-error']);
    Object.values(slots).forEach(timing);
    for (const operation of ['decode', 'compile']) ordered(slots, `${operation}-before`, `${operation}-return`, `${operation}-error`);
  }
  return value;
}
function canonical(text) {
  requireThat(typeof text === 'string' && text.length <= 8192 && !text.includes('\ufffd'), 'json');
  const value = JSON.parse(text); requireThat(JSON.stringify(value) === text, 'canonical'); return value;
}

// Fixed byte bound, fatal UTF-8, CRLF support and discard-until-newline overflow.
// The callback never receives a truncated or malformed line.
export function lineDecoder(onLine, onInvalid, max = 8192) {
  let line = [], overflow = false, total = 0;
  return {
    write(chunk) {
      if (typeof chunk === 'string' && chunk.includes('\ufffd')) onInvalid('utf8');
      const bytes = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
      for (const byte of bytes) {
        if (++total > LIMIT) { if (total === LIMIT + 1) onInvalid('overflow'); continue; }
        if (byte !== 10) { if (!overflow) { if (line.length === max) { overflow = true; line = []; onInvalid('line-overflow'); } else line.push(byte); } continue; }
        if (!overflow) {
          try {
            if (line.at(-1) === 13) line.pop();
            const value = new TextDecoder('utf-8', { fatal: true }).decode(Uint8Array.from(line)); onLine(value);
          } catch { onInvalid('malformed'); }
        }
        line = []; overflow = false;
      }
    },
    end() { if (line.length || overflow) onInvalid('truncated'); line = []; },
  };
}
function countsOf(value) {
  const d = closed(value, ['cancelled', 'failed', 'passed', 'skipped', 'suites', 'tests', 'todo', 'topLevel']);
  requireThat(d.tests === 1 && d.topLevel === 1 && d.suites === 0 && d.cancelled === 0 && d.skipped === 0 && d.todo === 0 && [0, 1].includes(d.passed) && d.failed === 1 - d.passed, 'counts');
  return { passed: d.passed, failed: d.failed };
}

export async function* reportEvents(events, expectedFile) {
  let invalid = null, sentInvalid = false, start = 0, testId = null, result = null, plan = 0, fileSummary = null, runSummary = null, launch = null, imports = null;
  let queued = [];
  const bad = reason => { invalid ??= reason; };
  const stderr = lineDecoder(line => {
    if (!line.startsWith('{')) return;
    // Other arbitrary raw strings are ignored and never become result records.
    if (!line.includes(IMPORT_KIND)) return;
    const value = validateProjection(canonical(line), IMPORT_KIND);
    requireThat(imports === null, 'duplicate-projection'); imports = value; queued.push({ kind: 'import-observation', value });
  }, () => bad('stderr'));
  try {
    const iterator = events[Symbol.asyncIterator]?.() ?? events[Symbol.iterator]();
    for (;;) {
      const step = await iterator.next(); if (step.done) break;
      const event = step.value; // Do not assimilate an untrusted event's `then` getter.
      if (!invalid) try {
        const e = closed(event, ['type', 'data']), d = dataObject(e.data);
        requireThat(Object.keys(d).every(key => ['name', 'nesting', 'testNumber', 'testId', 'parentId', 'details', 'tags', 'classname', 'file', 'entryFile', 'line', 'column', 'skip', 'todo', 'expectFailure', 'count', 'success', 'counts', 'duration_ms', 'message', 'level', 'type'].includes(key)), 'event-fields');
        const provenance = () => requireThat(typeof expectedFile === 'string' && d.file === expectedFile && d.entryFile === expectedFile, 'provenance');
        switch (e.type) {
          case 'test:start': case 'test:pass': case 'test:fail': {
            provenance();
            // Public Node24 events give top-level tests the root's parentId 0.
            requireThat(d.name === TITLE && d.nesting === 0 && d.parentId === 0 && Number.isSafeInteger(d.testId) && d.testId > 0 && d.skip === undefined && d.todo === undefined && d.expectFailure === undefined && d.expectedFailure === undefined && d.attempt === undefined, 'selected');
            if (e.type === 'test:start') { requireThat(++start === 1 && result === null, 'duplicate-start'); testId = d.testId; queued.push({ kind: 'selected-start', matched: true }); }
            else {
              const details = dataObject(d.details);
              requireThat(Object.keys(details).every(key => ['duration_ms', 'type', 'error', 'passed', 'classname', 'attempt', 'passed_on_attempt'].includes(key)), 'detail-fields');
              requireThat(start === 1 && d.testId === testId && result === null && d.testNumber === 1 && (details.type === undefined || details.type === 'test') && details.attempt === undefined && details.passed_on_attempt === undefined && details.expectedFailure === undefined && details.expectFailure === undefined, 'result');
              result = e.type === 'test:pass' ? 'pass' : 'fail'; queued.push({ kind: 'selected-result', result });
            }
            break;
          }
          case 'test:plan':
            requireThat(d.nesting === 0 && d.count === 1 && d.file === undefined && d.entryFile === undefined && ++plan === 1, 'plan'); queued.push({ kind: 'root-plan', count: 1 }); break;
          case 'test:summary': {
            const counts = countsOf(d.counts); requireThat(typeof d.success === 'boolean' && d.success === (counts.passed === 1), 'summary');
            const value = { ...counts, success: d.success };
            if (d.file === expectedFile) { requireThat(fileSummary === null && runSummary === null, 'file-summary'); fileSummary = value; queued.push({ kind: 'file-summary', ...value }); }
            else { requireThat(d.file === undefined && runSummary === null && fileSummary !== null, 'run-summary'); runSummary = value; queued.push({ kind: 'run-summary', ...value }); }
            break;
          }
          case 'test:diagnostic':
            requireThat(typeof d.message === 'string', 'diagnostic');
            if (d.message.includes(LAUNCH_KIND)) { provenance(); requireThat(launch === null && d.nesting === 0, 'launch'); launch = validateProjection(canonical(d.message), LAUNCH_KIND); queued.push({ kind: 'launch-observation', value: launch }); }
            break;
          case 'test:stderr': provenance(); requireThat(typeof d.message === 'string', 'stderr'); stderr.write(d.message); break;
          case 'test:stdout': provenance(); requireThat(typeof d.message === 'string' && Buffer.byteLength(d.message) <= LIMIT, 'stdout'); break;
          // These overlap start/result; they do not count another execution.
          case 'test:enqueue': case 'test:dequeue': case 'test:complete': break;
          default: refuse('event-kind');
        }
      } catch { bad('event'); }
      if (invalid) { queued = []; if (!sentInvalid) { sentInvalid = true; yield `${JSON.stringify({ schema: SCHEMA, kind: 'invalid', reason: invalid })}\n`; } }
      else for (const record of queued.splice(0)) yield `${JSON.stringify({ schema: SCHEMA, ...record })}\n`;
    }
  } catch { bad('iterable'); }
  stderr.end();
  if (!(start === 1 && result && plan === 1 && fileSummary && runSummary && launch && imports &&
    fileSummary.passed === Number(result === 'pass') && runSummary.passed === fileSummary.passed)) bad('incomplete');
  if (invalid && !sentInvalid) yield `${JSON.stringify({ schema: SCHEMA, kind: 'invalid', reason: invalid })}\n`;
  yield `${JSON.stringify({ schema: SCHEMA, kind: 'end', valid: invalid === null })}\n`;
}

export default async function* reporter(events) {
  // Read-only binding to the single positional CLI path; no env, I/O or spawn.
  yield* reportEvents(events, process.argv.at(-1));
}

export function admitContext(context) {
  const { platform, arch, node, execArgv, sourceSha, actualSha, actualMessage, env, event } = context;
  requireThat(platform === 'win32' && ['x64', 'arm64'].includes(arch) && node === 'v24.21.0' && /^[a-f0-9]{40}$/.test(sourceSha) &&
    sourceSha === actualSha && sourceSha === env.GITHUB_SHA && actualMessage === MARKER &&
    Array.isArray(execArgv) && execArgv.length === 0 && !env.NODE_OPTIONS && env.NODE_TEST_CONTEXT === undefined &&
    env.GITHUB_ACTIONS === 'true' && env.CI === 'true' && env.RUNNER_ENVIRONMENT === 'github-hosted' && env.RUNNER_OS === 'Windows' &&
    env.RUNNER_ARCH === (arch === 'x64' ? 'X64' : 'ARM64') && env.GITHUB_EVENT_NAME === 'push' && env.GITHUB_REF === REF && env.GITHUB_RUN_ATTEMPT === '1' &&
    /^[1-9][0-9]{0,19}$/.test(env.GITHUB_RUN_ID) && env.GITHUB_JOB === 'first-helper' &&
    event.ref === REF && event.deleted === false && event.forced === false && event.after === sourceSha && event.head_commit?.id === sourceSha && event.head_commit?.message === MARKER, 'admission');
  return context;
}

export async function admitOutput(output, runnerTemp) {
  requireThat(typeof output === 'string' && typeof runnerTemp === 'string' && path.isAbsolute(output) && path.isAbsolute(runnerTemp) &&
    !output.split(/[\\/]/).some(piece => piece === '.' || piece === '..') && path.dirname(output) === runnerTemp && path.basename(output).length <= 80, 'output-admission');
  // Every existing ancestor must be a physical directory. Never repair a link.
  for (let ancestor = runnerTemp;; ancestor = path.dirname(ancestor)) {
    const stat = await lstat(ancestor); requireThat(stat.isDirectory() && !stat.isSymbolicLink(), 'output-admission');
    if (path.dirname(ancestor) === ancestor) break;
  }
  const canonicalRoot = await realpath(runnerTemp);
  requireThat(canonicalRoot.toLowerCase() === runnerTemp.toLowerCase(), 'output-admission');
  await mkdir(output, { mode: 0o700 }); // Exclusive: EEXIST is a refusal.
  const stat = await lstat(output); requireThat(stat.isDirectory() && !stat.isSymbolicLink() && await realpath(output) === path.join(canonicalRoot, path.basename(output)), 'output-admission');
  return output;
}

export function validateRecords(bytes) {
  let valid = true; const records = [], seen = new Set();
  const decoder = lineDecoder(line => {
    try {
      requireThat(records.length < 16 && !seen.has('end'), 'records');
      const r = canonical(line), d = dataObject(r); requireThat(d.schema === SCHEMA && typeof d.kind === 'string' && !seen.has(d.kind), 'record');
      const keys = {
        'selected-start': ['schema', 'kind', 'matched'], 'selected-result': ['schema', 'kind', 'result'], 'root-plan': ['schema', 'kind', 'count'],
        'file-summary': ['schema', 'kind', 'passed', 'failed', 'success'], 'run-summary': ['schema', 'kind', 'passed', 'failed', 'success'],
        'launch-observation': ['schema', 'kind', 'value'], 'import-observation': ['schema', 'kind', 'value'],
        invalid: ['schema', 'kind', 'reason'], end: ['schema', 'kind', 'valid'],
      }[d.kind];
      requireThat(keys, 'record-kind'); closed(r, keys);
      if (d.kind === 'selected-start') requireThat(d.matched === true, 'start');
      if (d.kind === 'selected-result') requireThat(['pass', 'fail'].includes(d.result) && seen.has('selected-start'), 'result');
      if (d.kind === 'root-plan') requireThat(d.count === 1, 'plan');
      if (d.kind.endsWith('-summary')) requireThat([0, 1].includes(d.passed) && d.failed === 1 - d.passed && d.success === (d.passed === 1) &&
        (d.kind !== 'run-summary' || seen.has('file-summary')), 'summary');
      if (d.kind === 'launch-observation') validateProjection(d.value, LAUNCH_KIND);
      if (d.kind === 'import-observation') validateProjection(d.value, IMPORT_KIND);
      if (d.kind === 'invalid') { requireThat(['event', 'stderr', 'iterable', 'incomplete'].includes(d.reason), 'invalid'); valid = false; }
      if (d.kind === 'end') requireThat(typeof d.valid === 'boolean' && d.valid === !seen.has('invalid'), 'end');
      seen.add(d.kind); records.push(r);
    } catch { valid = false; }
  }, () => { valid = false; });
  decoder.write(bytes); decoder.end();
  const find = kind => records.find(r => r.kind === kind);
  if (!['selected-start', 'selected-result', 'root-plan', 'file-summary', 'run-summary', 'launch-observation', 'import-observation', 'end'].every(kind => seen.has(kind)) ||
    find('end')?.valid !== true || find('file-summary')?.passed !== Number(find('selected-result')?.result === 'pass') || find('run-summary')?.passed !== find('file-summary')?.passed) valid = false;
  return { valid, records };
}

export function cellOutcome(arm, records, close) {
  if (!validateRecords(Buffer.from(records.map(r => JSON.stringify(r) + '\n').join(''))).valid || close.spawnAttempts !== 1 || close.spawnObserved !== 1 ||
    !close.closed || !close.exitObserved || close.exitCode !== close.code || close.exitSignal !== close.signal || !close.pipeClosed?.every(Boolean) || close.pipeClosed?.length !== 2 || !close.writersClosed?.every(Boolean) || close.writersClosed?.length !== 2 ||
    close.errors?.length !== 0 || close.overflow?.length !== 2 || close.overflow.some(Boolean) || close.signal !== null) return 'INCONCLUSIVE';
  const find = kind => records.find(r => r.kind === kind), launch = find('launch-observation').value, imports = find('import-observation').value;
  if (arm === 'control' && find('selected-result').result === 'fail' && Number.isInteger(close.code) && close.code > 0 && launch.outcome === 'failed' &&
    imports.failureCode === 'windows-job-start-timeout' && Object.values(imports.slots).every(value => value === null)) return 'CONTROL_ORIGINAL_START_TIMEOUT';
  if (arm === 'absolute-import' && find('selected-result').result === 'pass' && close.code === 0 && launch.outcome === 'ready' && imports.failureCode === null &&
    imports.slots.before && imports.slots.return && imports.slots.error === null) return 'TREATMENT_READY_AND_CLOSED';
  return 'INCONCLUSIVE';
}

export function decodeBracket(launch, imports, arm) {
  const inconclusive = { state: 'INCONCLUSIVE', durationMs: null };
  try {
    validateProjection(launch, LAUNCH_KIND); validateProjection(imports, IMPORT_KIND);
    const before = launch.callBoundaryFirstObserved['decode-before'], returned = launch.callBoundaryFirstObserved['decode-return'];
    if (!before || !returned || before.childElapsedCapped || returned.childElapsedCapped) return inconclusive;
    if (arm === 'absolute-import') {
      const entered = imports.slots.before, completed = imports.slots.return;
      if (!entered || !completed || imports.slots.error || entered.childElapsedCapped || completed.childElapsedCapped ||
        entered.childElapsedMs < before.childElapsedMs || completed.childElapsedMs > returned.childElapsedMs) return inconclusive;
    } else if (arm !== 'control' || Object.values(imports.slots).some(value => value !== null)) return inconclusive;
    // Only the SAME helper stopwatch is subtracted. No parent-origin arithmetic.
    return { state: 'OBSERVED_UNCAPPED', durationMs: returned.childElapsedMs - before.childElapsedMs };
  } catch { return inconclusive; }
}

// Caller installs this immediately after its ONE spawn. No watchdog or kill.
// A byte cap bounds queued writes as well as retained buffers; pipes still drain.
export async function captureInvocation(child, stdoutWriter, stderrWriter) {
  const observed = { spawnAttempts: 1, spawnObserved: 0, exitObserved: false, exitCode: null, exitSignal: null, code: null, signal: null, closed: false, pipeClosed: [false, false], pipeEnded: [false, false], writersClosed: [false, false], errors: [], overflow: [false, false], bytes: [0, 0] };
  const buffers = [[], []], uniqueError = category => { if (!observed.errors.includes(category)) observed.errors.push(category); };
  let resolveChild; const childClosed = new Promise(resolve => { resolveChild = resolve; });
  child.once('spawn', () => { observed.spawnObserved++; });
  child.on('error', () => uniqueError('spawn'));
  child.once('exit', (code, signal) => { observed.exitObserved = true; observed.exitCode = code; observed.exitSignal = signal; });
  child.once('close', (code, signal) => { observed.code = code; observed.signal = signal; observed.closed = true; resolveChild(); });
  const settled = [[child.stdout, stdoutWriter], [child.stderr, stderrWriter]].map(([pipe, writer], index) => {
    let writerFailed = false, ending = false;
    const endWriter = () => { if (!ending) { ending = true; try { writer.end(); } catch { uniqueError('sink'); } } };
    const writerClose = new Promise(resolve => {
      writer.on('error', () => { writerFailed = true; uniqueError('sink'); });
      writer.once('close', () => { observed.writersClosed[index] = true; resolve(); });
    });
    const pipeClose = new Promise(resolve => {
      pipe.on('error', () => uniqueError('pipe'));
      pipe.on('data', chunk => {
        const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk), available = Math.max(0, LIMIT - observed.bytes[index]);
        const retained = bytes.subarray(0, available); observed.bytes[index] += retained.length;
        if (retained.length < bytes.length) observed.overflow[index] = true;
        if (retained.length) { buffers[index].push(Buffer.from(retained)); if (!writerFailed) try { writer.write(retained); } catch { writerFailed = true; uniqueError('sink'); } }
      });
      pipe.once('end', () => { observed.pipeEnded[index] = true; endWriter(); });
      pipe.once('close', () => { observed.pipeClosed[index] = true; if (!observed.pipeEnded[index]) uniqueError('pipe-incomplete'); endWriter(); resolve(); });
    });
    return Promise.all([pipeClose, writerClose]);
  });
  await Promise.all([childClosed, ...settled]);
  return { ...observed, stdout: Buffer.concat(buffers[0]), stderr: Buffer.concat(buffers[1]) };
}

export function parseArgs(args) {
  requireThat(args.length === 8, 'arguments'); const result = {};
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i]; requireThat(['--arm', '--arch', '--source-sha', '--output'].includes(key) && !Object.hasOwn(result, key), 'arguments');
    requireThat(typeof args[i + 1] === 'string' && args[i + 1].length <= 4096 && !/[\0\r\n]/.test(args[i + 1]), 'arguments'); result[key] = args[i + 1];
  }
  requireThat(['control', 'absolute-import'].includes(result['--arm']) && ['x64', 'arm64'].includes(result['--arch']) && /^[a-f0-9]{40}$/.test(result['--source-sha']), 'arguments');
  return { arm: result['--arm'], arch: result['--arch'], sourceSha: result['--source-sha'], output: result['--output'] };
}
export function testArgv(composedTest, reporterFile) {
  requireThat(path.isAbsolute(composedTest) && path.isAbsolute(reporterFile), 'argv');
  return ['--test', `--test-reporter=${pathToFileURL(reporterFile).href}`, `--test-name-pattern=^${TITLE}$`, composedTest];
}

async function boundedRead(filename, maximum) {
  const before = await lstat(filename);
  requireThat(before.isFile() && !before.isSymbolicLink() && before.nlink === 1 && before.size <= maximum, 'bounded-input');
  const handle = await open(filename, 'r');
  try {
    const stat = await handle.stat(); requireThat(stat.dev === before.dev && stat.ino === before.ino && stat.size === before.size, 'input-identity');
    const bytes = Buffer.alloc(before.size + 1); let offset = 0;
    while (offset < bytes.length) { const { bytesRead } = await handle.read(bytes, offset, bytes.length - offset, offset); if (!bytesRead) break; offset += bytesRead; }
    const after = await lstat(filename), end = await handle.stat();
    requireThat(offset === before.size && [after, end].every(value => value.isFile() && value.dev === before.dev && value.ino === before.ino && value.size === before.size && value.mtimeMs === before.mtimeMs && value.nlink === 1), 'input-identity');
    return bytes.subarray(0, offset);
  } finally { await handle.close(); }
}
const ARTIFACTS = ['receipt.json', 'source-manifest.json', 'native.stdout.ndjson', 'native.stderr.log'];
const CONFOUNDS = ['common-observer-and-clock-overhead', 'public-reporter-and-pipe-overhead', 'private-composition-location', 'standard-checkout-setup-node-provisioning', 'hosted-image-and-first-helper-variation', 'single-job-per-cell-exploratory-only'];
async function writeJson(filename, value) {
  const handle = await open(filename, 'w');
  try { await handle.writeFile(JSON.stringify(value) + '\n'); await handle.sync(); } finally { await handle.close(); }
}

async function main() {
  let receipt = null, manifest = null, output = null, stage = 'admission', capture = null, resultCode = 1, writers = [];
  try {
    const args = parseArgs(process.argv.slice(2)), ownFile = fileURLToPath(import.meta.url), root = path.resolve(path.dirname(ownFile), '../../..');
    const env = process.env;
    const eventBytes = await boundedRead(env.GITHUB_EVENT_PATH, LIMIT), event = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(eventBytes));
    const gitOptions = { cwd: root, encoding: 'utf8', maxBuffer: 32768, windowsHide: true };
    const actualSha = execFileSync('git', ['rev-parse', 'HEAD'], gitOptions).replace(/\n$/, '').replace(/\r$/, '');
    const rawCommit = execFileSync('git', ['cat-file', 'commit', 'HEAD'], gitOptions), body = rawCommit.slice(rawCommit.indexOf('\n\n') + 2);
    const actualMessage = body.endsWith('\n') ? body.slice(0, -1) : body;
    admitContext({ platform: process.platform, arch: process.arch, node: process.version, execArgv: process.execArgv, sourceSha: args.sourceSha, actualSha, actualMessage, env, event });
    const ownPaths = ['.github/workflows/ci-alpha-windows-qualified-cold-experiment.yml', 'lawoss/testing/alpha/windows-qualified-cold-experiment.mjs', 'lawoss/testing/alpha/windows-qualified-cold-experiment.test.mjs'];
    execFileSync('git', ['ls-files', '--error-unmatch', '--', ...ownPaths], gitOptions);
    requireThat(execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=no', '--', ...ownPaths], gitOptions) === '', 'source-checkout');
    requireThat(args.arch === process.arch && args.output === path.join(env.RUNNER_TEMP, `qualified-cold-${args.arch}-${args.arm}`), 'admission');
    await admitOutput(args.output, env.RUNNER_TEMP); output = args.output;
    receipt = { schema: SCHEMA, state: 'initial', classification: 'INCONCLUSIVE', comparison: 'INCONCLUSIVE', decodeBracket: { state: 'INCONCLUSIVE', durationMs: null }, valid: false,
      binding: { W: args.sourceSha, runId: env.GITHUB_RUN_ID, job: env.GITHUB_JOB, attempt: 1, arm: args.arm, arch: process.arch, node: process.version,
        nodeBinary: { bytes: 0, sha256: null }, ref: REF, event: 'push', selector: `^${TITLE}$`, eventSchema: SCHEMA,
        reporter: null, runner: { os: env.RUNNER_OS, architecture: env.RUNNER_ARCH,
          imageOS: /^[A-Za-z0-9._+-]{1,100}$/.test(env.ImageOS ?? '') ? env.ImageOS : null,
          imageVersion: /^[A-Za-z0-9._+-]{1,100}$/.test(env.ImageVersion ?? '') ? env.ImageVersion : null } },
      invocation: { spawnAttempts: 0, spawnObserved: 0, code: null, signal: null, closed: false }, wrapperFailure: null, observations: null, logs: null, artifactsComplete: false, confounds: CONFOUNDS };
    manifest = { schema: SCHEMA, W: args.sourceSha, eventSchema: SCHEMA, reporter: null, acceptedInputs: INPUTS, actualInputs: null, composed: null, inverseVerified: false };
    // All four bounded initial files exist BEFORE composition or native attempt.
    await writeJson(path.join(output, 'receipt.json'), receipt); await writeJson(path.join(output, 'source-manifest.json'), manifest);
    for (const name of ARTIFACTS.slice(2)) { const handle = await open(path.join(output, name), 'wx', 0o600); await handle.close(); }
    stage = 'source';
    const reporterBytes = await boundedRead(ownFile, LIMIT), nodeBytes = await boundedRead(process.execPath, 256 * LIMIT);
    receipt.binding.reporter = manifest.reporter = { bytes: reporterBytes.length, sha256: hash(reporterBytes) };
    manifest.experimentInputs = {};
    for (const filename of ownPaths) { const bytes = await boundedRead(path.join(root, filename), LIMIT); manifest.experimentInputs[filename] = { bytes: bytes.length, sha256: hash(bytes) }; }
    receipt.binding.nodeBinary = { bytes: nodeBytes.length, sha256: hash(nodeBytes) };
    const sources = {};
    for (const name of Object.keys(INPUTS)) sources[name] = await boundedRead(path.join(root, 'lawoss/testing/alpha', name), LIMIT);
    const composed = composeSources(sources, args.arm), control = composeSources(sources, 'control'), treatment = composeSources(sources, 'absolute-import');
    requireThat(control['windows-job.mjs'].equals(treatment['windows-job.mjs']) && sources['windows-job.test.mjs'].equals(composed['windows-job.test.mjs']), 'source-common');
    manifest.actualInputs = Object.fromEntries(Object.entries(sources).map(([name, bytes]) => [name, { bytes: bytes.length, sha256: hash(bytes) }]));
    manifest.composed = Object.fromEntries(Object.entries(composed).map(([name, bytes]) => [name, { bytes: bytes.length, sha256: hash(bytes) }])); manifest.inverseVerified = true;
    stage = 'composition';
    const composition = path.join(output, 'composition'); await mkdir(composition, { mode: 0o700 });
    for (const [name, bytes] of Object.entries(composed)) await writeFile(path.join(composition, name), bytes, { flag: 'wx', mode: 0o600 });
    for (const [name, bytes] of Object.entries(composed)) requireThat(bytes.equals(await boundedRead(path.join(composition, name), LIMIT)), 'composed-binding');
    // No experiment flags or profile overrides are forwarded into the fixture.
    // The original fixture still constructs its own minimal native helper env.
    const childEnv = { ...env };
    requireThat(hash(await boundedRead(ownFile, LIMIT)) === manifest.reporter.sha256 && execFileSync('git', ['status', '--porcelain=v1', '--untracked-files=no', '--', ...ownPaths], gitOptions) === '', 'reporter-binding');
    stage = 'invocation';
    const stdoutWriter = createWriteStream(path.join(output, 'native.stdout.ndjson'), { flags: 'r+' });
    const stderrWriter = createWriteStream(path.join(output, 'native.stderr.log'), { flags: 'r+' });
    writers = [stdoutWriter, stderrWriter];
    // Open owned sinks before spawn so opening failure cannot strand a child.
    await Promise.all([stdoutWriter, stderrWriter].map(writer => new Promise((resolve, reject) => { writer.once('open', resolve); writer.once('error', reject); })));
    receipt.invocation.spawnAttempts = 1;
    let child;
    try { child = spawn(process.execPath, testArgv(path.join(composition, 'windows-job.test.mjs'), ownFile), { cwd: root, env: childEnv, windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] }); }
    catch (error) {
      await Promise.all([stdoutWriter, stderrWriter].map(writer => new Promise(resolve => { writer.once('close', resolve); writer.end(); })));
      throw error;
    }
    capture = await captureInvocation(child, stdoutWriter, stderrWriter);
    const { stdout, stderr, ...original } = capture; receipt.invocation = original;
    stage = 'validation';
    const parsed = validateRecords(stdout); receipt.observations = parsed.records.filter(record => record.kind.endsWith('-observation'));
    receipt.classification = cellOutcome(args.arm, parsed.records, capture);
    receipt.decodeBracket = decodeBracket(parsed.records.find(record => record.kind === 'launch-observation')?.value, parsed.records.find(record => record.kind === 'import-observation')?.value, args.arm);
    receipt.valid = receipt.classification !== 'INCONCLUSIVE';
    receipt.logs = { 'native.stdout.ndjson': { bytes: stdout.length, sha256: hash(stdout) }, 'native.stderr.log': { bytes: stderr.length, sha256: hash(stderr) } };
    resultCode = Number.isInteger(capture.code) && capture.code !== 0 ? capture.code : receipt.valid && capture.code === 0 && capture.signal === null ? 0 : 1;
    if (!parsed.valid || capture.errors.length || capture.overflow.some(Boolean)) receipt.wrapperFailure = 'validation';
  } catch {
    if (receipt) { receipt.wrapperFailure = stage; receipt.valid = false; receipt.classification = 'INCONCLUSIVE'; }
  } finally {
    // Includes partial sink opening and synchronous spawn failure. Never hash
    // while a wrapper-owned writer can still flush into either artifact.
    await Promise.all(writers.map(writer => writer.closed ? undefined : new Promise(resolve => { writer.on('error', () => {}); writer.once('close', resolve); writer.end(); })));
    if (output && receipt && manifest) try {
      for (const name of ARTIFACTS.slice(2)) {
        const bytes = await boundedRead(path.join(output, name), LIMIT);
        if (receipt.logs?.[name]) requireThat(receipt.logs[name].sha256 === hash(bytes), 'log-binding');
        else { receipt.logs ??= {}; receipt.logs[name] = { bytes: bytes.length, sha256: hash(bytes) }; }
      }
      receipt.state = 'complete';
      await writeJson(path.join(output, 'source-manifest.json'), manifest);
      receipt.manifest = { bytes: (await boundedRead(path.join(output, 'source-manifest.json'), LIMIT)).length, sha256: hash(await boundedRead(path.join(output, 'source-manifest.json'), LIMIT)) };
      receipt.artifactsComplete = true;
      await writeJson(path.join(output, 'receipt.json'), receipt);
      for (const name of ARTIFACTS) await boundedRead(path.join(output, name), LIMIT);
    } catch {
      resultCode = Number.isInteger(capture?.code) && capture.code !== 0 ? capture.code : 1;
      receipt.wrapperFailure = 'finalization'; receipt.valid = false; receipt.classification = 'INCONCLUSIVE'; receipt.artifactsComplete = false;
      try { await writeJson(path.join(output, 'receipt.json'), receipt); } catch { /* Missing artifact is inconclusive. */ }
    }
  }
  process.exitCode = resultCode;
}

if (import.meta.main === true) {
  await main().catch(() => { process.exitCode = 1; });
}
