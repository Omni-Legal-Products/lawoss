// Adapted protocol from opencode 16747470f976aca3d362ad730bcd3fe82ecc2c9a
// packages/core/src/util/{effect-flock,flock}.ts; see LICENSE.opencode.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { hostname } from 'node:os';
import { setTimeout as sleep } from 'node:timers/promises';

const STALE = 60_000;
const fault = code => Object.assign(new Error(code), { code });
const wall = () => performance.timeOrigin + performance.now();
async function stat(file) {
  try { return await fs.stat(file); } catch (error) {
    if (['ENOENT', 'ENOTDIR'].includes(error.code)) return;
    throw error;
  }
}
async function stale(dir) {
  for (const file of [path.join(dir, 'heartbeat'), path.join(dir, 'meta.json'), dir]) {
    const info = await stat(file);
    if (info) return wall() - info.mtimeMs > STALE;
  }
  return false;
}
async function mkdir(dir) {
  try { await fs.mkdir(dir, { mode: 0o700 }); return true; } catch (error) {
    if (error.code === 'EEXIST') return false;
    throw error;
  }
}
async function withClosedHandle(file, operation) {
  let failed = false;
  let primary;
  let result;
  try { result = await operation(); }
  catch (error) { failed = true; primary = error; }
  try { await file.close(); }
  catch (error) {
    if (failed) throw new AggregateError([primary, error], 'LEASE_HANDLE_CLOSE_FAILED');
    throw error;
  }
  if (failed) throw primary;
  return result;
}
async function metadata(dir) {
  const file = await fs.open(path.join(dir, 'meta.json'), 'r');
  return withClosedHandle(file, async () => {
    const info = await file.stat();
    if (!info.isFile() || info.size > 65536) throw fault('LEASE_METADATA_INVALID');
    // Fixed bound even if an external writer grows the file after stat.
    const buffer = Buffer.alloc(65537);
    let length = 0;
    while (length < buffer.length) {
      const { bytesRead } = await file.read(buffer, length, buffer.length - length, null);
      if (!bytesRead) break;
      length += bytesRead;
    }
    if (length > 65536) throw fault('LEASE_METADATA_INVALID');
    let value;
    try { value = JSON.parse(buffer.subarray(0, length).toString('utf8')); }
    catch { throw fault('LEASE_METADATA_INVALID'); }
    if (!value || typeof value.token !== 'string' || !value.token || !Number.isInteger(value.pid) || value.pid < 1 || typeof value.hostname !== 'string' || typeof value.createdAt !== 'string' || !Number.isFinite(Date.parse(value.createdAt))) throw fault('LEASE_METADATA_INVALID');
    return value;
  });
}
async function check(dir, token) {
  if ((await metadata(dir)).token !== token) throw fault('LEASE_TOKEN_MISMATCH');
}
async function claim(dir) {
  if (!await mkdir(dir)) {
    if (!await stale(dir)) return;
    const breaker = dir + '.breaker';
    if (!await mkdir(breaker)) {
      const info = await stat(breaker);
      if (info && wall() - info.mtimeMs > STALE) await fs.rm(breaker, { recursive: true, force: true });
      return;
    }
    let primary;
    let acquired = false;
    try {
      if (await stale(dir)) {
        await fs.rm(dir, { recursive: true, force: true });
        acquired = await mkdir(dir);
      }
    } catch (error) { primary = error; }
    try { await fs.rm(breaker, { recursive: true, force: true }); }
    catch (error) { throw new AggregateError([...(primary ? [primary] : []), error], 'LEASE_BREAKER_CLEANUP_FAILED'); }
    if (primary) throw primary;
    if (!acquired) return;
  }
  const token = randomUUID();
  try {
    await fs.writeFile(path.join(dir, 'heartbeat'), '', { flag: 'wx' });
    await fs.writeFile(path.join(dir, 'meta.json'), JSON.stringify({ token, pid: process.pid, hostname: hostname(), createdAt: new Date().toISOString() }), { flag: 'wx' });
  } catch (cause) {
    // Failed initialization cannot prove token ownership. Retain for stale recovery.
    throw new Error('LEASE_INITIALIZATION_FAILED_STATE_RETAINED', { cause });
  }
  return { dir, token };
}
function heartbeat(handle, controller) {
  let stopped = false;
  let timer;
  let pending = Promise.resolve();
  let failure;
  const tick = () => {
    pending = (async () => {
      await check(handle.dir, handle.token);
      // Bind the update to the opened inode, never a later successor pathname.
      const file = await fs.open(path.join(handle.dir, 'heartbeat'), 'r+');
      await withClosedHandle(file, async () => {
        await check(handle.dir, handle.token);
        const now = new Date();
        await file.utimes(now, now);
      });
    })().catch(error => {
      failure = error;
      controller.abort(error);
    }).finally(() => {
      if (!stopped && !failure) timer = setTimeout(tick, 20_000);
    });
  };
  tick();
  return {
    ready: () => pending,
    async release() {
      stopped = true;
      clearTimeout(timer);
      await pending;
      const errors = failure ? [failure] : [];
      try {
        await check(handle.dir, handle.token);
        await fs.rm(handle.dir, { recursive: true });
      } catch (error) { errors.push(error); }
      if (errors.length) throw new AggregateError(errors, 'LEASE_RELEASE_FAILED');
    },
  };
}

/**
 * Caller supplies captured Global.state and every known exact engine dir alias.
 * operation MUST settle only after all its owned work/children close. Cancellation
 * is cooperative: cleanup may outlive deadline; we never drop operation's promise.
 */
export async function withEngineDependencyLease({ stateDirectory, logicalDirectories, deadline, signal }, operation) {
  if (typeof stateDirectory !== 'string' || !path.isAbsolute(stateDirectory) || !Array.isArray(logicalDirectories) || !logicalDirectories.length || logicalDirectories.some(dir => typeof dir !== 'string' || !dir.length) || !Number.isFinite(deadline) || typeof operation !== 'function' || (signal !== undefined && !(signal instanceof AbortSignal))) throw fault('LEASE_INPUT_INVALID');
  const end = performance.now() + Math.max(0, deadline - Date.now());
  const acquireEnd = Math.min(end, performance.now() + 300_000);
  const controller = new AbortController();
  const cancel = () => controller.abort(signal.reason);
  signal?.addEventListener('abort', cancel, { once: true });
  if (signal?.aborted) cancel();
  let timer;
  const arm = () => {
    const remaining = end - performance.now();
    if (remaining <= 0) controller.abort(fault('LEASE_DEADLINE'));
    else timer = setTimeout(arm, Math.min(remaining, 2_147_483_647));
  };
  arm();
  const owned = [];
  let result;
  let failed = false;
  let primary;
  const guard = () => {
    controller.signal.throwIfAborted();
    if (performance.now() >= acquireEnd) throw fault('LEASE_DEADLINE');
  };
  try {
    guard();
    await fs.mkdir(path.join(stateDirectory, 'locks'), { recursive: true });
    for (const logical of [...new Set(logicalDirectories)].sort()) {
      const dir = path.join(stateDirectory, 'locks', createHash('sha1').update(`npm-install:${logical}`, 'utf8').digest('hex') + '.lock');
      let delay = 100;
      for (;;) {
        guard();
        const handle = await claim(dir);
        if (handle) {
          const lease = heartbeat(handle, controller);
          owned.push(lease);
          await lease.ready();
          guard();
          break;
        }
        guard();
        try { await sleep(Math.min(delay, Math.max(0, acquireEnd - performance.now())), undefined, { signal: controller.signal }); }
        catch { controller.signal.throwIfAborted(); throw fault('LEASE_WAIT_FAILED'); }
        delay = Math.min(2000, delay * 1.7);
      }
    }
    guard();
    result = await operation(controller.signal);
    controller.signal.throwIfAborted();
  } catch (error) { failed = true; primary = error; }
  finally {
    const errors = [];
    for (const lease of owned.reverse()) {
      try { await lease.release(); } catch (error) { errors.push(error); }
    }
    clearTimeout(timer);
    signal?.removeEventListener('abort', cancel);
    if (errors.length) throw new AggregateError([...(failed ? [primary] : []), ...errors], 'LEASE_FAILED_WITH_CLEANUP_ERRORS');
  }
  if (failed) throw primary;
  return result;
}
