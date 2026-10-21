// Cold GET /mcp builds an OpenCode instance, including npm install. On Windows
// that takes several minutes. Short client polls abort at 20s; forwarding each
// abort starts another install, the losers never answer, and the native smoke
// test's 5 minute wait expires. One in-flight GET for the same URL is shared.
// A different directory waits until that install finishes. A caller's abort
// stops only that caller.

export type CachedEngineResponse = {
  status: number;
  statusText: string;
  headers: [string, string][];
  body: Uint8Array;
};

const inflight = new Map<string, Promise<CachedEngineResponse>>();
const ownedInflight = new WeakMap<object, Map<string, Promise<CachedEngineResponse>>>();
let warmupLane: Promise<void> = Promise.resolve();

const HOP_BY_HOP = new Set(["content-encoding", "content-length", "transfer-encoding"]);

function enqueueWarmup<T>(run: () => Promise<T>): Promise<T> {
  const previous = warmupLane;
  let release: () => void = () => {};
  warmupLane = new Promise<void>((resolve) => { release = resolve; });
  return previous.then(run, run).finally(release);
}

export function sharedEngineResponse(
  key: string,
  start: (signal: AbortSignal) => Promise<Response>,
  timeoutMs = 600_000,
  owner?: object,
): Promise<CachedEngineResponse> {
  const requests = owner ? ownedInflight.get(owner) ?? new Map<string, Promise<CachedEngineResponse>>() : inflight;
  if (owner) ownedInflight.set(owner, requests);
  const existing = requests.get(key);
  if (existing) return existing;
  const pending = enqueueWarmup(async () => {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const response = await start(controller.signal);
      const body = new Uint8Array(await response.arrayBuffer());
      const headers: [string, string][] = [];
      response.headers.forEach((value, name) => {
        if (!HOP_BY_HOP.has(name)) headers.push([name, value]);
      });
      return { status: response.status, statusText: response.statusText, headers, body };
    } finally {
      clearTimeout(timer);
    }
  }).finally(() => {
    if (requests.get(key) === pending) requests.delete(key);
  });
  requests.set(key, pending);
  return pending;
}

export function abortable<T>(promise: Promise<T>, signal?: AbortSignal | null): Promise<T> {
  if (!signal) return promise;
  if (signal.aborted) return Promise.reject(signal.reason ?? abortError());
  return new Promise((resolve, reject) => {
    const onAbort = () => reject(signal.reason ?? abortError());
    signal.addEventListener("abort", onAbort, { once: true });
    promise.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function cachedEngineResponse(cached: CachedEngineResponse): Response {
  const bytes = new ArrayBuffer(cached.body.byteLength);
  new Uint8Array(bytes).set(cached.body);
  const body = [204, 205, 304].includes(cached.status) ? null : bytes;
  return new Response(body, { status: cached.status, statusText: cached.statusText, headers: cached.headers });
}

function abortError(): DOMException {
  return new DOMException("This operation was aborted", "AbortError");
}
