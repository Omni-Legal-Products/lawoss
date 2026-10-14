import path from 'node:path';

// Match the runtime's separator normalization, preserving POSIX case and
// allowing Windows' case-insensitive canonical directory spelling.
function directoryKey(value, platform) {
  if (typeof value !== 'string' || !value) return null;
  const paths = platform === 'win32' ? path.win32 : path.posix;
  if (!paths.isAbsolute(value)) return null;
  const normalized = paths.normalize(value);
  return platform === 'win32' ? normalized.replace(/\\/g, '/').replace(/\/+$/, '').toLowerCase() : normalized.replace(/\/+$/, '');
}

// /path awaits the pinned engine's selected-directory InstanceContextMiddleware.
// One request and its entire body consume the existing absolute startup budget.
// Only initial bootstrap calls this: never probe a missing historical move root.
export async function awaitDirectoryInstance({ request, baseUrl, headers, directory, deadline, platform = process.platform }) {
  const remaining = deadline - Date.now();
  if (!Number.isFinite(remaining) || remaining <= 0) throw new DOMException('Startup readiness budget expired', 'TimeoutError');
  if (!new Headers(headers).get('authorization') || directoryKey(directory, platform) === null) throw new Error('Selected instance readiness scope required');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(new DOMException('Startup readiness budget expired', 'TimeoutError')), remaining);
  let response;
  try {
    response = await request(`${baseUrl}/path?directory=${encodeURIComponent(directory)}`, { headers, signal: controller.signal });
    if (response.status !== 200) throw new Error('Selected instance readiness HTTP contract failed');
    let body;
    try { body = await response.json(); }
    catch (error) {
      // Node's JSON syntax errors may quote response bytes in message/stack.
      // Do not attach that parser error as a cause; transport/abort stays exact.
      if (!(error instanceof SyntaxError)) throw error;
      throw new Error('Selected instance readiness JSON contract failed');
    }
    if (directoryKey(body?.directory, platform) !== directoryKey(directory, platform)) throw new Error('Selected instance readiness scope mismatch');
    if (Date.now() >= deadline) throw new DOMException('Startup readiness budget expired', 'TimeoutError');
    return { status: 200, authenticated: true, directoryMatches: true, worktreeMatchesDirectory: directoryKey(body.worktree, platform) === directoryKey(directory, platform), bodyCompleted: true };
  } finally {
    clearTimeout(timer);
    if (response && !response.bodyUsed) await response.body?.cancel().catch(() => {});
  }
}
