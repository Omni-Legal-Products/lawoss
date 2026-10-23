// Closed observations of existing calls, never authenticated failure causes.
const diagnostics = new WeakMap();
const progressStages = ['none','discovery','build-info','process-identity','snapshot','renderer-identity','interactive-ui','ready'];
const boundaries = new Set(['not-started','process-running','discovery','process-owner','build-info','process-identity','snapshot','renderer-identity','interactive-ui','presentation-wait','ready']);
const codes = new Set(['ENOENT','EACCES','EPERM','ELOOP','unsafe-discovery','shipping-control-request-timeout','shipping-control-request-failed','shipping-control-invalid-json','shipping-control-response-too-large','native-ui-not-ready','installed-app-already-running','installed-app-owner-census-unavailable','installed-app-exited','installed-app-exited-or-job-unavailable','installed-app-spawn-failed','app-stopped']);
const validatorMessages = new Map([
  ['Live packaged IPC identity differs','packaged-identity-mismatch'],
  ['Live process or profile ownership differs','process-identity-mismatch'],
  ['Expected the packaged file renderer','packaged-file-renderer-required'],
  ['Packaged renderer or shipping snapshot unavailable','renderer-or-snapshot-unavailable'],
]);
function classification(error) {
  try {
    const code = error?.code;
    if (typeof code === 'string' && codes.has(code)) return code;
    return validatorMessages.get(error?.message) ?? 'unknown';
  } catch { return 'unknown'; }
}

export function createNativeReadinessDiagnostics() {
  let attempts = 0, attemptsCapped = false, progress = 'none', lastBoundary = 'not-started', lastError = 'unknown', frozen;
  return {
    // Count the existing outer readiness loop only; never schedule an attempt.
    attempt() { if (!frozen) { if (attempts < 128) attempts++; else attemptsCapped = true; } },
    boundary(value) { if (!frozen) lastBoundary = boundaries.has(value) ? value : 'unknown'; },
    passed(value) { if (!frozen && progressStages.indexOf(value) > progressStages.indexOf(progress)) progress = value; },
    failure(error) { if (!frozen) lastError = classification(error); },
    freeze() { return frozen ??= Object.freeze({ attempts, attemptsCapped, progress, lastBoundary, lastError }); },
    associate(error) {
      if (frozen && error !== null && (typeof error === 'object' || typeof error === 'function')) diagnostics.set(error, frozen);
    },
  };
}

export function nativeReadinessDiagnostic(error) {
  return diagnostics.get(error) ?? null;
}
