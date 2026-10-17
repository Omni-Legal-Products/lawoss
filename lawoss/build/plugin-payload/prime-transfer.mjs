// Transport primitive only: no SDK resolution, installation or accepted-input admission.
import https from 'node:https';
import { Writable } from 'node:stream';
import { pipeline, finished } from 'node:stream/promises';
import { fail } from './validate.mjs';
export const LIMITS = Object.freeze({ requests: 32, archiveBytes: 32 * 1024 * 1024, totalBytes: 256 * 1024 * 1024, requestMs: 45000, deadlineMs: 300000 });
export function checkArtifacts(records, maximum = 32) {
  if (!Array.isArray(records) || records.length < 1 || records.length > maximum) fail('ALLOWLIST_INVALID');
  for (const record of records) {
    let url; try { url = new URL(record.resolved); } catch { fail('ALLOWLIST_INVALID'); }
    if (url.origin !== 'https://registry.npmjs.org' || url.username || url.password || url.search || url.hash || url.href !== record.resolved || !/^\/(?:@[\w.-]+\/)?[\w.-]+\/-\/[\w.-]+\.tgz$/.test(url.pathname) || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(record.integrity ?? '')) fail('ALLOWLIST_INVALID');
  }
}
function exactGet(url, callback) {
  // node:https does not follow redirects. No proxy, auth, retry or npm/profile config.
  return https.get(url, { agent: false, headers: { 'accept-encoding': 'identity' } }, callback);
}
export async function acquireArtifacts({ cache, records, cacheApi, signal, limits = LIMITS, open = exactGet, now = () => performance.now(), deadline = now() + limits.deadlineMs }) {
  checkArtifacts(records, limits.requests);
  let totalBytes = 0; let verified = 0;
  const check = () => { if (signal?.aborted) fail('CANCELLED'); if (now() >= deadline) fail('PRIMER_DEADLINE'); };
  for (const record of records) {
    let request, response, collector, reason, cacheOperation, body, readback;
    const chunks = [];
    let requestClosed;
    const closures = [];
    const watch = stream => { closures.push(finished(stream).catch(() => {})); return stream; };
    const controller = new AbortController();
    const stop = code => {
      if (reason) return;
      reason = Object.assign(new Error(code), { code }); controller.abort(reason);
      request?.destroy(); response?.destroy(); collector?.destroy();
    };
    const active = () => { if (reason) throw reason; check(); };
    const abort = () => stop('CANCELLED');
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => stop('PRIMER_DEADLINE'), Math.max(0, deadline - now()));
    const requestTimer = setTimeout(() => stop('REQUEST_TIMEOUT'), limits.requestMs);
    try {
      active();
      response = await new Promise((resolve, reject) => {
        controller.signal.addEventListener('abort', () => reject(reason), { once: true });
        request = open(record.resolved, value => { response = watch(value); if (reason) { value.destroy(); reject(reason); } else resolve(value); });
        requestClosed = new Promise(resolve => request.once('close', resolve));
        request.on('error', () => { stop('TRANSPORT_FAILED'); reject(reason); });
      });
      if (response.statusCode !== 200) fail('HTTP_STATUS');
      if (response.headers['content-encoding'] && response.headers['content-encoding'] !== 'identity') fail('HTTP_ENCODING');
      let bytes = 0;
      collector = new Writable({ write(chunk, encoding, callback) {
        bytes += chunk.length; totalBytes += chunk.length;
        const code = bytes > limits.archiveBytes ? 'ARCHIVE_LIMIT' : totalBytes > limits.totalBytes ? 'TOTAL_LIMIT' : null;
        if (code) callback(Object.assign(new Error(code), { code }));
        else { chunks.push(chunk); callback(); }
      } });
      await pipeline(response, collector, { signal: controller.signal });
      active(); body = Buffer.concat(chunks, bytes); chunks.length = 0;
      // These public promises, unlike outer Minipass close, join real content,
      // index insertion and verified reads. Never race them against cancellation.
      active(); cacheOperation = cacheApi.put(cache, 'lawoss:accepted:' + record.resolved, body, { integrity: record.integrity });
      await cacheOperation; cacheOperation = null; body = null;
      active(); cacheOperation = cacheApi.get.byDigest(cache, record.integrity, { memoize: false, size: bytes });
      readback = await cacheOperation; cacheOperation = null; active();
      if (readback.length !== bytes) fail('CACHE_INTEGRITY');
      readback = null;
      active(); verified++;
    } catch (error) {
      if (!reason) reason = Object.assign(new Error(error.code === 'EINTEGRITY' ? 'CACHE_INTEGRITY' : /^[A-Z_]{1,40}$/.test(error.code) ? error.code : 'TRANSFER_FAILED'), { code: error.code === 'EINTEGRITY' ? 'CACHE_INTEGRITY' : /^[A-Z_]{1,40}$/.test(error.code) ? error.code : 'TRANSFER_FAILED' });
      reason.progress = { records: records.length, verified, totalBytes };
      throw reason;
    } finally {
      // Already-started cache I/O must settle before ownership is released. This
      // wait is cleanup, never permission to start more work after cancellation.
      if (cacheOperation) await Promise.allSettled([cacheOperation]);
      chunks.length = 0; body = null; readback = null;
      for (const stream of [response, collector]) if (stream && !stream.destroyed) stream.destroy();
      request?.destroy();
      if (requestClosed) await requestClosed;
      await Promise.all(closures);
      clearTimeout(timer); clearTimeout(requestTimer); signal?.removeEventListener('abort', abort);
    }
    if (reason) { reason.progress = { records: records.length, verified, totalBytes }; throw reason; }
  }
  check(); return { records: records.length, verified, totalBytes };
}
