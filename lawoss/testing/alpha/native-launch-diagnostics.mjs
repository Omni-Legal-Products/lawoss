// Private observations, never authenticated causes or raw child output.
const diagnostics = new WeakMap();
const limit = 64 * 1024;
const markers = [
  ['no-usable-sandbox', Buffer.from('No usable sandbox!')],
  ['suid-helper-not-configured', Buffer.from('The SUID sandbox helper binary was found, but is not configured correctly.')],
  ['namespace-failure', Buffer.from('Failed to move to new namespace:')],
];
const carryLimit = Math.max(...markers.map(([, marker]) => marker.length)) - 1;
const signals = new Set(['SIGABRT','SIGBUS','SIGFPE','SIGHUP','SIGILL','SIGINT','SIGKILL','SIGPIPE','SIGQUIT','SIGSEGV','SIGSYS','SIGTERM','SIGTRAP','SIGUSR1','SIGUSR2','SIGXCPU','SIGXFSZ']);

export function createNativeLaunchDiagnostics() {
  let scannedBytes = 0, truncated = false, carry = Buffer.alloc(0), frozen;
  const found = new Set();
  return {
    stderr(chunk) {
      if (frozen) return;
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
      const count = Math.min(bytes.length, limit - scannedBytes);
      if (bytes.length > count) truncated = true;
      if (!count) return;
      const scan = Buffer.concat([carry, bytes.subarray(0, count)]);
      for (const [category, marker] of markers) if (scan.includes(marker)) found.add(category);
      scannedBytes += count;
      // Copy the small carry: a subarray alone would retain the large buffer.
      carry = scannedBytes === limit ? Buffer.alloc(0) : Buffer.from(scan.subarray(Math.max(0, scan.length - carryLimit)));
    },
    freeze(child) {
      if (!frozen) {
        const code = child?.exitCode, signal = child?.signalCode;
        const categories = markers.map(([category]) => category).filter(category => found.has(category));
        frozen = Object.freeze({
          exitObserved: code !== null && code !== undefined || signal !== null && signal !== undefined,
          exitCode: Number.isInteger(code) && code >= 0 && code <= 255 ? code : null,
          signal: signal === null || signal === undefined ? null : signals.has(signal) ? signal : 'unknown',
          stderr: Object.freeze({ categories: Object.freeze(categories.length ? categories : ['unknown']), scannedBytes, truncated }),
        });
        carry = Buffer.alloc(0);
      }
      return frozen;
    },
    associate(error) {
      if (frozen && error !== null && (typeof error === 'object' || typeof error === 'function')) diagnostics.set(error, frozen);
    },
  };
}

export function nativeLaunchDiagnostic(error) {
  return diagnostics.get(error) ?? null;
}
