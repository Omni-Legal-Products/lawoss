// Actual offline transport on caller-admitted owned caches. No raw-cache fallback.
import { finished } from "node:stream/promises";
import { isDeepStrictEqual } from "node:util";
import path from "node:path";
import { fixtureCacheKey, fixtureCacheMetadata } from "./native-merged-cache-projection.mjs";
import { LIMITS, need, refuse, sha256, integrity } from "./native-merged-projection-contract.mjs";
// Every started promise is joined. Cancellation selects the first reason, aborts
// active bodies, and never races a writer or grants permission for new work.
export function operationScope(deadline, signal) {
  let reason;
  const controller = new AbortController;
  const pending = new Set, aborters = new Set, secondary = [];
  const stop = (code) => {
    reason ??= Object.assign(new Error(code), { code });
    controller.abort(reason);
    for (const abort of aborters)
      try {
        abort(reason);
      } catch (e) {
        secondary.push(e);
      }
  };
  const cancel = () => stop("CANCELLED");
  signal?.addEventListener("abort", cancel, { once: true });
  if (signal?.aborted)
    cancel();
  const timer = Number.isSafeInteger(deadline) ? setTimeout(() => stop("PRIMER_DEADLINE"), Math.max(0, deadline - Date.now())) : null;
  const scope = {
    check() {
      if (reason)
        throw reason;
      if (!Number.isSafeInteger(deadline) || Date.now() >= deadline) {
        stop("PRIMER_DEADLINE");
        throw reason;
      }
    },
    async run(start) {
      scope.check();
      let promise;
      try {
        promise = Promise.resolve(start());
      } catch (error) {
        scope.check();
        throw error;
      }
      pending.add(promise);
      try {
        const value = await promise;
        scope.check();
        return value;
      } catch (error) {
        if (reason) {
          if (error !== reason)
            secondary.push(error);
          throw reason;
        }
        throw error;
      } finally {
        pending.delete(promise);
      }
    },
    watch(abort) {
      aborters.add(abort);
      if (reason)
        abort(reason);
      return () => aborters.delete(abort);
    },
    async drain() {
      const results = await Promise.allSettled([...pending]);
      for (const result of results)
        if (result.status === "rejected")
          secondary.push(result.reason);
      return secondary.length ? "failed" : "settled";
    },
    dispose() {
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);
    },
    recordError(error) {
      secondary.push(error);
    },
    privateErrors: secondary,
    signal: controller.signal
  };
  return scope;
}
async function collect(body, limit, scope) {
  const chunks = [];
  let length = 0, primary;
  const completion = finished(body).catch((error) => error);
  const unwatch = scope.watch((reason) => body.destroy(reason));
  try {
    for await (const chunk of body) {
      scope.check();
      length += chunk.length;
      need(length <= limit, "PROJECTION_LIMIT");
      chunks.push(chunk);
    }
    scope.check();
    const error = await completion;
    if (error)
      throw error;
    return Buffer.concat(chunks, length);
  } catch (error) {
    primary = error;
    body.destroy();
    await completion;
    scope.check();
    throw primary;
  } finally {
    unwatch();
    chunks.length = 0;
  }
}
export async function readRawRepresentation({ fetch, cache, record, accept, scope }) {
  scope.check();
  const controller = new AbortController;
  let response;
  const unwatch = scope.watch((reason) => {
    controller.abort(reason);
    response?.body?.destroy(reason);
  });
  // Watch the original promise as well: cancellation may precede response delivery.
  try {
    let fetched;
    try {
      fetched = await scope.run(async () => {
        const value = await fetch(`https://registry.npmjs.org/${record.escapedName}`, { cachePath: cache, cache: "only-if-cached", method: "GET", retry: { retries: 0 }, redirect: "error", strictSSL: true, maxSockets: 1, signal: controller.signal, headers: { accept } });
        response = value;
        if (controller.signal.aborted) {
          value.body?.destroy();
          if (value.body)
            await finished(value.body).catch(() => {});
        }
        return value;
      });
    } catch (error) {
      if (response?.body) {
        response.body.destroy();
        await finished(response.body).catch(() => {});
      }
      throw error;
    }
    response = fetched;
    need(response.status === 200, "PROJECTION_READBACK");
    const bytes = await scope.run(() => collect(response.body, LIMITS.body, scope));
    scope.check();
    return { bytes, rawSha256: sha256(bytes), response };
  } finally {
    unwatch();
    if (response?.body && !response.body.destroyed) {
      response.body.destroy();
      await finished(response.body).catch(() => {});
    }
  }
}
export async function writeProjectedRepresentation({ cacache, cache, record, accept, bytes, rawBodySha256, scope }) {
  scope.check();
  need(Buffer.isBuffer(bytes) && bytes.length > 0 && bytes.length <= LIMITS.body, "PROJECTION_LIMIT");
  const url = `https://registry.npmjs.org/${record.escapedName}`, key = fixtureCacheKey(url), sri = integrity(bytes);
  await scope.run(() => cacache.put(cache, key, bytes, { integrity: sri, algorithms: ["sha512"], size: bytes.length, time: 1, metadata: fixtureCacheMetadata({ url, accept, rawBodySha256 }) }));
  return { key, integrity: sri, bytes: bytes.length, sha256: sha256(bytes) };
}
export async function verifyProjectedRepresentation({ fetch, cache, record, accept, expected, scope }) {
  const { bytes, response } = await readRawRepresentation({ fetch, cache, record, accept, scope });
  need(bytes.equals(expected), "PROJECTION_READBACK");
  const header = (k) => {
    try {
      return decodeURIComponent(response.headers.get(k) ?? "");
    } catch {
      refuse("PROJECTION_READBACK");
    }
  };
  need(header("x-local-cache") === path.resolve(cache) && header("x-local-cache-key") === fixtureCacheKey(`https://registry.npmjs.org/${record.escapedName}`) && header("x-local-cache-hash") === integrity(expected), "PROJECTION_READBACK");
  return bytes.length;
}
export async function verifyPacoteRepresentation({ pacote, cache, record, fullMetadata, expected, scope }) {
  scope.check();
  let candidate;
  try {
    candidate = await scope.run(() => pacote.packument(record.name, { cache, offline: true, fullMetadata, registry: "https://registry.npmjs.org/", retry: { retries: 0 }, strictSSL: true, signal: scope.signal }));
  } catch (error) {
    scope.check();
    throw error;
  }
  let value;
  try {
    value = JSON.parse(expected);
  } catch {
    refuse("INPUT_DRIFT");
  }
  if (Object.hasOwn(value, "_contentLength"))
    need(value._contentLength === expected.length, "INPUT_DRIFT");
  const retained = { ...candidate };
  if (Object.hasOwn(candidate, "_contentLength")) {
    need(candidate._contentLength === expected.length, "PROJECTION_READBACK");
    if (!Object.hasOwn(value, "_contentLength"))
      delete retained._contentLength;
  }
  need(isDeepStrictEqual(retained, value), "PROJECTION_READBACK");
  return candidate;
}
export async function copyAcceptedArchive({ cacache, source, destination, record, scope }) {
  scope.check();
  const key = "lawoss:accepted:" + record.resolved, info = await scope.run(() => cacache.get.info(source, key));
  need(info && info.key === key && info.integrity === record.integrity && Number.isSafeInteger(info.size) && info.size > 0 && info.size <= LIMITS.archive, "PROJECTION_READBACK");
  const body = await scope.run(() => collect(cacache.get.stream.byDigest(source, record.integrity, { memoize: false, size: info.size }), LIMITS.archive, scope));
  need(body.length === info.size && integrity(body) === record.integrity, "PROJECTION_READBACK");
  await scope.run(() => cacache.put(destination, key, body, { integrity: record.integrity, algorithms: ["sha512"], size: body.length, time: 1 }));
  const actual = await scope.run(() => cacache.get.info(destination, key));
  need(actual && actual.key === key && actual.integrity === record.integrity && actual.size === body.length, "PROJECTION_READBACK");
  const readback = await scope.run(() => collect(cacache.get.stream.byDigest(destination, record.integrity, { memoize: false, size: body.length }), LIMITS.archive, scope));
  need(readback.equals(body), "PROJECTION_READBACK");
  return { name: record.name, version: record.version, integrity: record.integrity, bytes: body.length, sha256: sha256(body) };
}
