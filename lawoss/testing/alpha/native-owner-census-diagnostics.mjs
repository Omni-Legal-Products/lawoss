// Failure-only observations. Raw subprocess errors never become public causes.
const diagnostics = new WeakMap();
const codes = new Set(['ETIMEDOUT', 'ENOBUFS', 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER', 'ENOENT', 'EACCES', 'EPERM', 'EIO']);
const signals = new Set(['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT', 'SIGHUP']);

function ownValue(error, key) {
  try {
    const descriptor = Object.getOwnPropertyDescriptor(error, key);
    return descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : undefined;
  }
  catch { return undefined; }
}

export function createOwnerCensusRefusal(error, stage) {
  const refusal = Object.assign(new Error('installed-app-owner-census-unavailable'), {
    code: 'installed-app-owner-census-unavailable', status: 'blocked',
  });
  if (stage !== 'initial-pre-lock' && stage !== 'observe') return refusal;
  const rawCode = ownValue(error, 'code'), rawSignal = ownValue(error, 'signal'), rawKilled = ownValue(error, 'killed');
  const code = typeof rawCode === 'string' && codes.has(rawCode) ? rawCode : 'unknown';
  const exitCode = Number.isInteger(rawCode) && rawCode >= -65536 && rawCode <= 65535 ? rawCode : null;
  const signal = typeof rawSignal === 'string' && signals.has(rawSignal) ? rawSignal : null;
  const killed = typeof rawKilled === 'boolean' ? rawKilled : null;
  const category = code === 'ETIMEDOUT' ? 'timeout-reported'
    : code === 'ENOBUFS' || code === 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' ? 'buffer-reported'
    : exitCode !== null ? 'exit-reported' : signal !== null ? 'signal-reported'
    : code !== 'unknown' ? 'spawn-reported' : 'unknown';
  diagnostics.set(refusal, Object.freeze({ stage, category, code, exitCode, signal, killed }));
  return refusal;
}

export function ownerCensusRefusalDiagnostic(error) {
  return diagnostics.get(error) ?? null;
}
