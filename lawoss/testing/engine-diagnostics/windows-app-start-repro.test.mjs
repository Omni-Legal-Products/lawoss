import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { admit, createReceipt, encodeReceipt, validateReceipt, boundedFrame, runGates } from './windows-app-start-repro.mjs';
import { privateEnvironment, observeNormalStop } from './windows-app-start-host.mjs';
import { exactResolver, createObservation } from './windows-app-start-embedded-observer.mjs';
const context = {
  platform: 'win32',
  arch: 'x64',
  node: '24.21.0',
  env: {
    GITHUB_EVENT_NAME: 'workflow_dispatch',
    GITHUB_RUN_ATTEMPT: '1',
    LAWOSS_REPRO_PLATFORM: 'windows-2022',
    GITHUB_REF_TYPE: 'branch',
    GITHUB_REF: 'refs/heads/chore/windows-app-start-repro-test',
    GITHUB_SHA: 'a'.repeat(40)
  }
};
test('admission refuses before acquisition for wrong platform/ref/runtime/attempt', () => {
  admit(context);
  for (const change of [{
    platform: 'linux'
  }, {
    node: '26.0.0'
  }, {
    env: {
      ...context.env,
      GITHUB_REF: 'refs/heads/chore/windows-instance-repro-test'
    }
  }, {
    env: {
      ...context.env,
      GITHUB_RUN_ATTEMPT: '2'
    }
  }]) assert.throws(() => admit({
    ...context,
    ...change
  }), {
    diagnosticCode: 'REFUSED'
  });
});
test('strict public protocol refuses a claimed positive without resource and lifetime evidence', () => {
  const r = createReceipt();
  r.finalized = true;
  r.outcome = 'NOT_REPRODUCED';
  r.cleanup = 'CLOSED';
  r.rootsRemoved = true;
  assert.throws(() => validateReceipt(encodeReceipt(r)));
});
test('strict public protocol refuses unfinished/extra/nonfinite/unbounded receipts', () => {
  for (const mutate of [r => {}, r => r.private = 'sentinel', r => r.elapsedMs = Infinity, r => r.host.spawn = 10001]) {
    const r = createReceipt();
    mutate(r);
    assert.throws(() => validateReceipt(JSON.stringify(r)));
  }
});
test('bounded frame refuses bytes before retention and never keeps later contamination', () => {
  const frame = boundedFrame(8);
  assert.equal(frame.push(Buffer.from('1234')), true);
  assert.equal(frame.push(Buffer.alloc(9)), false);
  assert.throws(() => frame.finish());
});
test('all real preflights precede original acquisition and app run', async () => {
  let acquired = 0,
    run = 0;
  await assert.rejects(runGates({
    preflight: async () => {
      throw Error('prerequisite');
    },
    acquire: async () => {
      acquired++;
    },
    run: async () => {
      run++;
    }
  }));
  assert.equal(acquired, 0);
  assert.equal(run, 0);
});
test('private parent environment excludes inherited credentials and RUN_AS_NODE before spread', () => {
  const env = privateEnvironment('C:\\owned space#%', 'http://127.0.0.1:1/v1', {
    PATH: 'C:\\Windows',
    SystemRoot: 'C:\\Windows',
    SECRET_SENTINEL: 'sentinel',
    ELECTRON_RUN_AS_NODE: '1'
  });
  assert.equal('SECRET_SENTINEL' in env, false);
  assert.equal('ELECTRON_RUN_AS_NODE' in env, false);
  assert.equal(env.LEGALWORK_DEV_MODE, '1');
  assert.ok(env.LEGALWORK_ENV_STORE.endsWith('empty-env.json'));
});
test('exact import observer leaves unrelated parent and target edges unchanged', () => {
  const next = (s, c) => ({
    url: s,
    parent: c.parentURL
  });
  const resolve = exactResolver({
    parent: 'file:///runtime',
    target: 'file:///embedded',
    observer: 'file:///observer'
  });
  assert.deepEqual(resolve('file:///other', {
    parentURL: 'file:///runtime'
  }, next), {
    url: 'file:///other',
    parent: 'file:///runtime'
  });
  assert.deepEqual(resolve('file:///embedded', {
    parentURL: 'file:///other'
  }, next), {
    url: 'file:///embedded',
    parent: 'file:///other'
  });
  assert.equal(resolve('file:///embedded', {
    parentURL: 'file:///runtime'
  }, next).url, 'file:///observer');
});
test('actual start options/handle/stop receiver/result identity stay delegated', async () => {
  const options = {
    private: true
  };
  const result = {};
  let originalHandle;
  const observe = createObservation(async value => {
    assert.equal(value, options);
    originalHandle = {
      config: {
        actual: true
      },
      async stop() {
        assert.equal(this, originalHandle);
        return result;
      }
    };
    return originalHandle;
  });
  const handle = await observe.start(options);
  assert.equal(handle, originalHandle);
  assert.equal(await handle.stop(), result);
  assert.equal(observe.state.starts, 1);
  assert.equal(observe.state.fulfilled, 1);
  assert.equal(observe.state.pending, 0);
});
test('start failure and swallowed stop error retain original error identity independently', async () => {
  const error = Error('private');
  const failed = createObservation(async () => {
    throw error;
  });
  await assert.rejects(failed.start({}), e => e === error);
  assert.equal(failed.state.startRejected, 1);
  const observe = createObservation(async () => ({
    async stop() {
      throw error;
    }
  }));
  const handle = await observe.start({});
  try {
    await handle.stop();
  } catch {}
  assert.equal(observe.state.rejected, 1);
  assert.equal(observe.state.fulfilled, 0);
});
test('stop deadline freezes UNKNOWN and late fulfillment cannot revise closure', {
  timeout: 1000
}, async () => {
  let resolve;
  const observe = createObservation(async () => ({
    stop: () => new Promise(r => resolve = r)
  }));
  const handle = await observe.start({});
  const result = await observeNormalStop({
    stop: () => handle.stop(),
    observation: observe,
    timeoutMs: 5
  });
  assert.equal(result.closed, false);
  assert.equal(result.pending, true);
  resolve();
  await new Promise(r => setImmediate(r));
  assert.equal(result.closed, false);
});
test('stop rejection remains UNKNOWN despite normal manager swallowing it', async () => {
  const observe = createObservation(async () => ({
    stop: async () => {
      throw Error('private');
    }
  }));
  const handle = await observe.start({});
  const result = await observeNormalStop({
    stop: async () => {
      try {
        await handle.stop();
      } catch {}
    },
    observation: observe,
    timeoutMs: 10
  });
  assert.equal(result.closed, false);
  assert.equal(result.rejected, true);
});
function completeReceipt() {
  const r = createReceipt();
  r.finalized = true;
  r.elapsedMeasured = true;
  r.elapsedMs = 1;
  r.source = {
    revision: 'a'.repeat(40),
    digest: 'b'.repeat(64),
    verified: true,
    finalVerified: true
  };
  r.build = {
    digest: 'c'.repeat(64),
    verified: true,
    finalVerified: true
  };
  r.preflight = {
    attempted: true,
    verified: true,
    features: true,
    sqlite: true,
    imports: true,
    electronIdentity: true,
    node: '24.8.0'
  };
  for (const k of Object.keys(r.coverage)) if (!['renderer', 'main'].includes(k)) r.coverage[k] = 'verified-observed';
  r.mcp = {
    requests: 1,
    headers: 1,
    body: 1,
    overlap: 0
  };
  r.registrationCount = 1;
  r.acquisition = {
    control: true,
    archive: true,
    engine: true,
    closed: true
  };
  r.health = {
    headers: true,
    body: true,
    verified: true
  };
  r.path = {
    requests: 1,
    headers: true,
    body: true,
    verified: true,
    timeout: false
  };
  r.engine = {
    spawn: 1,
    exit: 1,
    close: 1,
    outputBytes: 1
  };
  r.host = {
    spawn: 1,
    exit: 1,
    close: 1,
    outputBytes: 1
  };
  r.stop = {
    invoked: 1,
    fulfilled: 1,
    rejected: 0,
    pending: 0
  };
  for (const k of Object.keys(r.input)) r.input[k] = true;
  r.provider.closed = true;
  r.cleanup = 'CLOSED';
  r.rootsRemoved = true;
  r.appStartMeasured = true;
  r.selectedMeasured = true;
  r.stopMeasured = true;
  r.outcome = 'NOT_REPRODUCED';
  return r;
}
test('independent reader requires every positive prerequisite and lifecycle fact', () => {
  const r = completeReceipt();
  assert.equal(validateReceipt(encodeReceipt(r)).outcome, 'NOT_REPRODUCED');
  for (const mutate of [x => x.source.finalVerified = false, x => x.build.finalVerified = false, x => x.source.verified = false, x => x.build.verified = false, x => x.preflight.imports = false, x => x.input.shim = false, x => x.input.plugins = false, x => x.health.body = false, x => x.path.body = false, x => x.path.requests = 0, x => x.host.close = 0, x => x.engine.close = 0, x => x.stop.fulfilled = 0, x => x.stop.pending = 1, x => x.provider.closed = false, x => x.provider.calls = 1, x => x.rootsRemoved = false, x => x.selectedMeasured = false, x => x.selectedMs = 90000, x => x.coverage.httpHost = 'source-only', x => x.finalized = false, x => x.primary = 'PATH_FAILED']) {
    const bad = structuredClone(r);
    mutate(bad);
    assert.throws(() => validateReceipt(JSON.stringify(bad)));
  }
});
test('positive protocol requires no overflow, contradictory path or invisible additional keys', () => {
  for (const mutate of [x => x.engine.outputBytes = 65537, x => x.consoleBytes = 65537, x => x.host.outputBytes = 32769, x => x.path.timeout = true, x => x.path.requests = 2, x => x.registrationCount = 2, x => x.mcp.body = 2, x => x.source.digest = '0'.repeat(64), x => x.identity.engineVersion = 'other', x => x.stop.extra = 'sentinel', x => x.passed = true]) {
    const r = structuredClone(completeReceipt());
    mutate(r);
    assert.throws(() => validateReceipt(JSON.stringify(r)));
  }
});
test('reproduced requires actual verified health and a measured unchanged selected deadline', () => {
  const r = completeReceipt();
  r.path.verified = false;
  r.path.timeout = true;
  r.primary = 'PATH_TIMEOUT';
  r.selectedMs = 90000;
  r.outcome = 'REPRODUCED';
  assert.equal(validateReceipt(encodeReceipt(r)).outcome, 'REPRODUCED');
  for (const mutate of [x => x.selectedMs = 89999, x => x.health.verified = false, x => x.path.timeout = false, x => x.cleanupFailure = 'PIPES_PENDING']) {
    const bad = structuredClone(r);
    mutate(bad);
    assert.throws(() => validateReceipt(JSON.stringify(bad)));
  }
});
test('UNKNOWN finalized prerequisite failure cannot pretend acquisition or native acceptance', () => {
  const r = createReceipt();
  r.finalized = true;
  r.elapsedMeasured = true;
  r.primary = 'PREREQUISITE_FAILED';
  r.outcome = 'PREREQUISITE_FAILED';
  assert.equal(validateReceipt(encodeReceipt(r)).outcome, 'PREREQUISITE_FAILED');
  for (const mutate of [x => x.acquisition.engine = true, x => x.fullNativeAcceptance = true, x => x.cause = 'plugin', x => x.fullAppWindows = 'GREEN']) {
    const bad = structuredClone(r);
    mutate(bad);
    assert.throws(() => validateReceipt(JSON.stringify(bad)));
  }
});
test('restoration encloses rejected setup/start/stop observation without replacing error', async () => {
  const {
    withObservation
  } = await import('./windows-app-start-host.mjs');
  const {
    BRIDGE
  } = await import('./windows-app-start-embedded-observer.mjs');
  for (const phase of ['setup', 'start', 'stop']) {
    let deregistered = 0;
    const error = Error('synthetic');
    const observation = createObservation(async () => {
      if (phase === 'start') throw error;
      return {
        stop: async () => {
          throw error;
        }
      };
    });
    await assert.rejects(withObservation({
      runtimeURL: 'file:///runtime',
      targetURL: 'file:///embedded',
      observation,
      register: () => {
        if (phase === 'setup') throw error;
        return {
          deregister() {
            deregistered++;
          }
        };
      },
      work: async observer => {
        const handle = await observer.start({});
        await handle.stop();
      }
    }), e => e === error);
    assert.equal(globalThis[BRIDGE], undefined);
    assert.equal(deregistered, phase === 'setup' ? 0 : 1);
    if (phase === 'start') assert.equal(observation.state.startRejected, 1);
    if (phase === 'stop') assert.equal(observation.state.rejected, 1);
  }
});
test('duplicate actual embedded start is refused and packaged fallback never redirects', async () => {
  const observe = createObservation(async () => ({
    stop: async () => {}
  }));
  await observe.start({});
  await assert.rejects(observe.start({}), {
    diagnosticCode: 'REFUSED'
  });
  const resolve = exactResolver({
    parent: 'file:///runtime',
    target: 'file:///dev/embedded.js',
    observer: 'file:///observer'
  });
  assert.throws(() => resolve('file:///packaged/embedded.js', {
    parentURL: 'file:///runtime'
  }, s => ({
    url: s
  })), {
    diagnosticCode: 'REFUSED'
  });
});
test('actual private environment topology uses one PATH and fresh owned stores', () => {
  const env = privateEnvironment('C:\\case space#%', 'http://127.0.0.1:1/v1', {
    Path: 'C:\\Windows',
    PATH: 'C:\\Windows',
    AWS_TOKEN: 'private',
    NODE_OPTIONS: 'private'
  });
  assert.equal(Object.keys(env).filter(k => k.toLowerCase() === 'path').length, 1);
  assert.equal('AWS_TOKEN' in env, false);
  assert.equal('NODE_OPTIONS' in env, false);
  assert.equal(env.LEGALWORK_RUNTIME_DB, 'C:\\case space#%\\runtime\\runtime.db');
  assert.equal(env.OPENCODE_DB, 'C:\\case space#%\\runtime\\opencode.db');
});
for (const scenario of ['stop-rejected', 'pipes-pending', 'start-pending', 'provider-close', 'remove-failed', 'output-violation']) test(`cleanup fault ${scenario} preserves primary and retains root`, async () => {
  const {
    finalizeCase
  } = await import('./windows-app-start-host.mjs');
  const r = completeReceipt();
  r.cleanup = 'UNKNOWN';
  r.rootsRemoved = false;
  r.primary = scenario === 'output-violation' ? 'OUTPUT_LIMIT' : 'PATH_TIMEOUT';
  r.path.verified = false;
  r.path.timeout = scenario !== 'output-violation';
  let removed = 0;
  const provider = {
    count: () => 0,
    close: async () => {
      if (scenario === 'provider-close') throw Error('synthetic');
    }
  };
  await finalizeCase({
    r,
    startSettled: scenario !== 'start-pending',
    stopResult: {
      closed: scenario !== 'stop-rejected',
      pending: scenario === 'start-pending'
    },
    children: [],
    provider,
    root: 'fake-owned',
    close: async () => scenario !== 'pipes-pending',
    remove: async () => {
      removed++;
      if (scenario === 'remove-failed') throw Error('synthetic');
    }
  });
  assert.equal(r.primary, scenario === 'output-violation' ? 'OUTPUT_LIMIT' : 'PATH_TIMEOUT');
  assert.equal(r.rootsRemoved, false);
  assert.equal(r.cleanup, 'UNKNOWN');
  assert.equal(removed, scenario === 'remove-failed' ? 1 : 0);
});
test('unknown pending stop snapshot cannot become closed after late continuation', async () => {
  const {
    finalizeCase
  } = await import('./windows-app-start-host.mjs');
  const r = completeReceipt();
  r.cleanup = 'UNKNOWN';
  r.rootsRemoved = false;
  let removed = 0;
  const stopped = {
    closed: false,
    pending: true
  };
  await finalizeCase({
    r,
    startSettled: false,
    stopResult: stopped,
    children: [],
    provider: {
      count: () => 0,
      close: async () => {}
    },
    root: 'fake-owned',
    close: async () => true,
    remove: async () => {
      removed++;
    }
  });
  stopped.closed = true;
  await new Promise(r => setImmediate(r));
  assert.equal(r.cleanup, 'UNKNOWN');
  assert.equal(r.rootsRemoved, false);
  assert.equal(removed, 0);
});
test('ordinary resource admission rejects symlink, empty and unexpected physical files before work', async () => {
  const {
    ordinaryFile
  } = await import('./windows-app-start-repro.mjs');
  const fs = await import('node:fs/promises'),
    os = await import('node:os'),
    path = await import('node:path');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'app-start-pure-')));
  try {
    await fs.writeFile(path.join(root, 'real'), 'bytes');
    await fs.writeFile(path.join(root, 'empty'), '');
    await fs.symlink(path.join(root, 'real'), path.join(root, 'link'));
    assert.equal((await ordinaryFile(path.join(root, 'real'), root)).size, 5);
    await assert.rejects(ordinaryFile(path.join(root, 'empty'), root));
    await assert.rejects(ordinaryFile(path.join(root, 'link'), root));
    await assert.rejects(ordinaryFile(path.join(root, 'real'), path.join(root, 'other')));
  } finally {
    await fs.rm(root, {
      recursive: true
    });
  }
});
test('unchanged selected helper rejects body scope, cancellation and completion after deadline', async () => {
  const {
    awaitDirectoryInstance
  } = await import('../isir/native/startup-readiness.mjs');
  const directory = 'C:\\space#%';
  const call = request => awaitDirectoryInstance({
    request,
    baseUrl: 'http://127.0.0.1:1',
    headers: {
      authorization: 'Basic synthetic'
    },
    directory,
    platform: 'win32',
    deadline: Date.now() + 5
  });
  await assert.rejects(call(async () => new Response(JSON.stringify({
    directory: 'C:\\other'
  }))), /scope mismatch/);
  await assert.rejects(call(async (_url, {
    signal
  }) => new Promise((_, reject) => signal.addEventListener('abort', () => reject(signal.reason), {
    once: true
  }))), {
    name: 'TimeoutError'
  });
  await assert.rejects(call(async () => ({
    status: 200,
    bodyUsed: true,
    json: async () => {
      await new Promise(r => setTimeout(r, 10));
      return {
        directory
      };
    }
  })), {
    name: 'TimeoutError'
  });
});
test('health and MCP paths classify independently; no app traffic becomes selected evidence', async () => {
  const {
    trafficKind
  } = await import('./windows-app-start-host.mjs');
  const origins = new Set(['http://127.0.0.1:1']);
  assert.equal(trafficKind('http://127.0.0.1:1/global/health', origins, 'C:\\case'), 'health');
  assert.equal(trafficKind('http://127.0.0.1:1/mcp?directory=C%3A%5Ccase', origins, 'C:\\case'), 'mcp');
  assert.equal(trafficKind('http://127.0.0.1:2/workspaces', origins, 'C:\\case'), 'other');
  assert.equal(trafficKind('http://127.0.0.1:2/path', origins, 'C:\\case'), 'other');
});
test('outer host collector records real exit and close and refuses raw overflow before buffering', async () => {
  const {
    command
  } = await import('./windows-app-start-repro.mjs');
  const launch = () => {
    const child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    queueMicrotask(() => {
      child.stdout.emit('data', Buffer.alloc(10));
      child.emit('exit', 0);
      child.emit('close', 0);
    });
    return child;
  };
  const track = {};
  await assert.rejects(command('fake', ['fixed'], {
    launch,
    keep: true,
    cap: 8,
    track
  }), {
    diagnosticCode: 'OUTPUT_LIMIT'
  });
  assert.deepEqual(track, {
    spawn: 1,
    exit: 1,
    close: 1,
    outputBytes: 9
  });
});
test('outer host timeout freezes UNKNOWN child counts even when child closes late', async () => {
  const {
    command
  } = await import('./windows-app-start-repro.mjs');
  let child;
  const launch = () => {
    child = new EventEmitter();
    child.stdout = new EventEmitter();
    child.stderr = new EventEmitter();
    return child;
  };
  const track = {};
  await assert.rejects(command('fake', [], {
    launch,
    keep: true,
    ms: 5,
    track
  }), {
    diagnosticCode: 'HOST_PENDING'
  });
  assert.deepEqual(track, {
    spawn: 1,
    exit: 0,
    close: 0,
    outputBytes: 0
  });
  child.emit('exit', 0);
  child.emit('close', 0);
  assert.deepEqual(track, {
    spawn: 1,
    exit: 0,
    close: 0,
    outputBytes: 0
  });
});
test('public receipt cannot serialize sentinel payload in any closed field or extra key', () => {
  const r = completeReceipt();
  r.preflight.node = 'SECRET_SENTINEL';
  assert.throws(() => validateReceipt(JSON.stringify(r)));
  r.preflight.node = '24.0.0';
  r.source.digest = 'SECRET_SENTINEL';
  assert.throws(() => validateReceipt(JSON.stringify(r)));
  assert.equal(encodeReceipt(completeReceipt()).includes('SECRET_SENTINEL'), false);
});
test('engine stream cap is applied before the genuine factory collector sees data', async () => {
  const {
    observeSpawn
  } = await import('./windows-instance-repro.mjs');
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  const state = {
    spawnCount: 0,
    exitCount: 0,
    closeCount: 0,
    outputBytes: 0
  };
  let collected = 0,
    refused = 0;
  const observer = observeSpawn({
    bin: 'fixed-original',
    spawn: () => child,
    state,
    onFailure: () => {
      refused++;
    }
  });
  observer.spawn('fixed-original', [], {});
  child.stdout.on('data', chunk => {
    collected += chunk.length;
  });
  child.stdout.emit('data', Buffer.alloc(65536));
  child.stdout.emit('data', Buffer.alloc(1));
  assert.equal(collected, 65536);
  assert.equal(refused, 1);
  child.emit('exit', 0);
  child.emit('close', 0);
  assert.equal(state.closeCount, 1);
});
test('exact original doctor argv delegates genuine sync result with finite per-stream bounds', async () => {
  const {
    boundedDoctor
  } = await import('./windows-app-start-host.mjs');
  const doctor = {
    calls: 0,
    exited: 0,
    timeout: 0,
    overflow: 0,
    failed: 0
  };
  const result = {
    status: 0,
    stdout: 'synthetic',
    stderr: ''
  };
  const receiver = {};
  const observe = boundedDoctor({
    bin: 'original',
    doctor,
    spawnSync: function (bin, args, options) {
      assert.equal(this, receiver);
      assert.equal(bin, 'original');
      assert.ok(args.length >= 1);
      assert.equal(options.timeout, 15000);
      assert.equal(options.maxBuffer, 65536);
      return result;
    }
  });
  assert.equal(observe.call(receiver, 'original', ['--version'], {
    encoding: 'utf8'
  }), result);
  assert.equal(observe.call(receiver, 'original', ['serve', '--help'], {
    encoding: 'utf8'
  }), result);
  assert.equal(doctor.calls, 2);
  assert.equal(doctor.exited, 2);
});
test('unrelated synchronous children retain exact options and sync error identity', async () => {
  const {
    boundedDoctor
  } = await import('./windows-app-start-host.mjs');
  const doctor = {
    calls: 0,
    exited: 0,
    timeout: 0,
    overflow: 0,
    failed: 0
  };
  const options = {},
    error = Error('synthetic');
  let observed;
  const observe = boundedDoctor({
    bin: 'original',
    doctor,
    spawnSync: (bin, args, value) => {
      observed = value;
      if (bin === 'original' && args[0] === '--version') throw error;
      return {};
    }
  });
  observe('other', ['--version'], options);
  assert.equal(observed, options);
  observe('original', ['serve'], options);
  assert.equal(observed, options);
  assert.equal(doctor.calls, 0);
  assert.throws(() => observe('original', ['--version'], options), e => e === error);
  assert.equal(doctor.failed, 1);
});
test('doctor timeout/overflow are independent and forbid closed success even with selected success', async () => {
  const {
    boundedDoctor
  } = await import('./windows-app-start-host.mjs');
  const doctor = {
    calls: 0,
    exited: 0,
    timeout: 0,
    overflow: 0,
    failed: 0
  };
  const observe = boundedDoctor({
    bin: 'original',
    doctor,
    spawnSync: () => ({
      status: null,
      error: {
        code: 'ETIMEDOUT'
      },
      stdout: Buffer.alloc(65537),
      stderr: ''
    })
  });
  observe('original', ['--version'], {});
  assert.equal(doctor.timeout, 1);
  assert.equal(doctor.overflow, 1);
  const r = completeReceipt();
  r.doctor = doctor;
  assert.throws(() => validateReceipt(JSON.stringify(r)));
});
test('fix1 I1 actual run entry reaches protected initialization with inert preflight', async () => {
  const {
    runEntry
  } = await import('./windows-app-start-host.mjs');
  const r = createReceipt();
  let reached = false;
  const originalFetch = globalThis.fetch;
  try {
    await runEntry('fake-owned', {}, r, {
      preflight: async () => {
        reached = true;
        throw Object.assign(Error('REFUSED'), {
          diagnosticCode: 'REFUSED'
        });
      },
      verifyIdentity: async () => false
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
  assert.equal(reached, true);
  assert.equal(r.primary, 'REFUSED');
  assert.equal(r.finalized, true);
});
test('fix1 I2 zero or unknown MCP cannot support either positive outcome', () => {
  for (const reproduced of [false, true]) for (const missing of ['zero', 'unknown', 'partial']) {
    const r = completeReceipt();
    r.mcp = {
      requests: 1,
      headers: 1,
      body: 1,
      overlap: 0
    };
    if (reproduced) {
      r.path.verified = false;
      r.path.timeout = true;
      r.primary = 'PATH_TIMEOUT';
      r.selectedMs = 90000;
      r.outcome = 'REPRODUCED';
    }
    if (missing === 'zero') r.mcp = {
      requests: 0,
      headers: 0,
      body: 0,
      overlap: 0
    };
    if (missing === 'unknown') r.coverage.automaticMcp = 'unknown';
    if (missing === 'partial') r.mcp.body = 0;
    assert.throws(() => validateReceipt(JSON.stringify(r)));
  }
});
test('fix1 I4 post-host identity failure preserves actual closed and removed facts in UNKNOWN receipt', () => {
  const r = completeReceipt();
  r.source.finalVerified = false;
  r.build.finalVerified = false;
  r.identityFailure = 'BUILD_MISMATCH';
  r.primary = 'BUILD_MISMATCH';
  r.outcome = 'UNKNOWN';
  const decoded = validateReceipt(JSON.stringify(r));
  assert.equal(decoded.cleanup, 'CLOSED');
  assert.equal(decoded.rootsRemoved, true);
  assert.equal(decoded.cleanupFailure, 'NONE');
});
test('fix1 I5 quarantine counts binary bytes and never serializes console objects', async () => {
  const {
    quarantine
  } = await import('./windows-app-start-host.mjs');
  const r = completeReceipt(),
    sink = quarantine(r);
  let coerced = false;
  try {
    process.stdout.write(Buffer.alloc(65537));
    console.log({
      toString() {
        coerced = true;
        throw Error('private');
      }
    });
  } finally {
    sink.restore();
  }
  assert.equal(coerced, false);
  assert.equal(r.consoleBytes, 65537);
  assert.throws(() => validateReceipt(JSON.stringify(r)));
});
test('fix1 M1 both admitted outer observation caps are fixed public fields', () => {
  const r = completeReceipt();
  assert.equal(r.appStartCapMs, 120000);
  assert.equal(r.outerHostCapMs, 300000);
  for (const key of ['appStartCapMs', 'outerHostCapMs']) {
    const bad = structuredClone(r);
    bad[key]++;
    assert.throws(() => validateReceipt(JSON.stringify(bad)));
  }
});
test('fix1 I3 composed outer expiry retains root and pending containment across late doctor work', async () => {
  const {
    runEntry,
    hostDecision
  } = await import('./windows-app-start-host.mjs');
  const cp = (await import('node:child_process')).default;
  const fs = await import('node:fs/promises');
  const os = await import('node:os');
  const path = await import('node:path');
  const {
    BRIDGE
  } = await import('./windows-app-start-embedded-observer.mjs');
  const moduleApi = await import('node:module');
  const root = await fs.realpath(await fs.mkdtemp(path.join(os.tmpdir(), 'fix1-compose-'))),
    env = {
      ...process.env
    },
    original = {
      spawn: cp.spawn,
      spawnSync: cp.spawnSync,
      fetch: globalThis.fetch
    };
  let finishStart,
    finishProvider,
    providerEntered,
    removed = 0,
    bounded = false,
    deregistered = 0;
  const providerReady = new Promise(resolve => {
    providerEntered = resolve;
  });
  const startPromise = new Promise(resolve => {
    finishStart = resolve;
  });
  const providerPending = new Promise(resolve => {
    finishProvider = resolve;
  });
  const bin = path.join(root, 'opencode-x86_64-pc-windows-msvc.exe');
  cp.spawnSync = (_bin, _args, options) => {
    bounded = options.timeout === 15000 && options.maxBuffer === 65536;
    return {
      status: 0,
      stdout: 'synthetic',
      stderr: ''
    };
  };
  let now = 0;
  const decision = hostDecision(1, () => now);
  const r = createReceipt();
  const store = {
    writeWorkspaceState: async value => {
      store.value = value;
    },
    readWorkspaceState: async () => store.value,
    listLocalWorkspacePaths: async () => [path.join(root, 'case space#%')]
  };
  try {
    const pending = runEntry(root, {}, r, {
      preflight: async () => {},
      verifyIdentity: async () => false,
      decision,
      startMs: 5,
      stopMs: 5,
      register: () => ({
        deregister() {
          deregistered++;
        }
      }),
      provider: async () => ({
        url: 'http://127.0.0.1:1/v1',
        count: () => 0,
        close: async () => {
          providerEntered();
          await providerPending;
        }
      }),
      loadStore: async () => ({
        createWorkspaceStore: () => store
      }),
      loadRuntime: async () => ({
        createRuntimeManager: () => ({
          engineStart: () => startPromise.then(() => {
            cp.spawnSync(bin, ['--version'], {
              encoding: 'utf8'
            });
          }),
          engineStop: () => new Promise(() => {})
        })
      }),
      close: async () => true,
      remove: async () => {
        removed++;
      }
    });
    await providerReady;
    const {
      command
    } = await import('./windows-app-start-repro.mjs');
    await assert.rejects(command('fake', [], {
      ms: 5,
      launch: () => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.stderr = new EventEmitter();
        return child;
      }
    }), {
      diagnosticCode: 'HOST_PENDING'
    });
    now = 2;
    finishStart();
    await new Promise(resolve => setImmediate(resolve));
    assert.equal(bounded, true);
    assert.notEqual(cp.spawnSync, original.spawnSync);
    assert.equal(deregistered, 0);
    finishProvider();
    const result = await pending;
    assert.equal(removed, 0);
    assert.equal(r.rootsRemoved, false);
    assert.equal(result.released, false);
    assert.equal(r.doctor.calls, 1);
    assert.equal(result.doctor.calls, 1);
    cp.spawnSync(bin, ['serve', '--help'], {});
    assert.equal(result.doctor.calls, 2);
    assert.equal(r.doctor.calls, 1);
    assert.equal(deregistered, 0);
  } finally {
    finishStart?.();
    finishProvider?.();
    cp.spawn = original.spawn;
    cp.spawnSync = original.spawnSync;
    moduleApi.syncBuiltinESMExports();
    globalThis.fetch = original.fetch;
    delete globalThis[BRIDGE];
    for (const key of Object.keys(process.env)) delete process.env[key];
    Object.assign(process.env, env);
    await fs.rm(root, {
      recursive: true
    });
  }
});
test('fix1 I3 outer observer expiry during otherwise closed finalization forbids later removal', async () => {
  const {
    finalizeCase,
    hostDecision
  } = await import('./windows-app-start-host.mjs');
  const {
    command
  } = await import('./windows-app-start-repro.mjs');
  const r = completeReceipt();
  r.rootsRemoved = false;
  r.cleanup = 'UNKNOWN';
  let now = 0,
    settle,
    entered,
    removed = 0;
  const waiting = new Promise(resolve => {
    entered = resolve;
  });
  const pending = new Promise(resolve => {
    settle = resolve;
  });
  const decision = hostDecision(1, () => now);
  const finalizing = finalizeCase({
    r,
    startSettled: true,
    stopResult: {
      closed: true
    },
    children: [],
    provider: {
      count: () => 0,
      close: async () => {
        entered();
        await pending;
      }
    },
    root: 'fake-owned',
    decision,
    close: async () => true,
    remove: async () => {
      removed++;
    }
  });
  await waiting;
  await assert.rejects(command('fake', [], {
    ms: 5,
    launch: () => {
      const child = new EventEmitter();
      child.stdout = new EventEmitter();
      child.stderr = new EventEmitter();
      return child;
    }
  }), {
    diagnosticCode: 'HOST_PENDING'
  });
  now = 2;
  settle();
  await finalizing;
  assert.equal(removed, 0);
  assert.equal(r.rootsRemoved, false);
  assert.equal(r.primary, 'HOST_PENDING');
  assert.equal(r.cleanup, 'UNKNOWN');
});
test('fix1 I4 both late identity call sites preserve primary and actual cleanup facts', async () => {
  const {
    recordIdentityFailure
  } = await import('./windows-app-start-repro.mjs');
  for (const code of ['IDENTITY_FAILED', 'BUILD_MISMATCH']) {
    const r = completeReceipt();
    r.primary = 'PATH_TIMEOUT';
    r.path.timeout = true;
    r.path.verified = false;
    r.selectedMs = 90000;
    recordIdentityFailure(r, code);
    const decoded = validateReceipt(encodeReceipt(r));
    assert.equal(decoded.outcome, 'UNKNOWN');
    assert.equal(decoded.primary, 'PATH_TIMEOUT');
    assert.equal(decoded.identityFailure, code);
    assert.equal(decoded.cleanup, 'CLOSED');
    assert.equal(decoded.rootsRemoved, true);
    assert.equal(decoded.cleanupFailure, 'NONE');
  }
  const r = completeReceipt();
  r.cleanup = 'UNKNOWN';
  r.rootsRemoved = false;
  r.cleanupFailure = 'STOP_FAILED';
  recordIdentityFailure(r, 'BUILD_MISMATCH');
  assert.equal(validateReceipt(encodeReceipt(r)).cleanupFailure, 'STOP_FAILED');
});
test('fix1 I3 retained output remains bounded after publication without revising frozen receipt', async () => {
  const {
    quarantine
  } = await import('./windows-app-start-host.mjs');
  const r = completeReceipt(),
    sink = quarantine(r);
  try {
    sink.freeze();
    process.stderr.write(new Uint8Array(65537));
    assert.equal(r.consoleBytes, 0);
    assert.equal(sink.counts.bytes, 65537);
    assert.equal(process.stderr.write === undefined, false);
  } finally {
    sink.restore();
  }
});
test('fix1 I5 direct quarantine binary overflow retains an otherwise removable root', async () => {
  const {
    quarantine,
    finalizeCase
  } = await import('./windows-app-start-host.mjs');
  const r = completeReceipt();
  r.cleanup = 'UNKNOWN';
  r.rootsRemoved = false;
  let removed = 0;
  const output = quarantine(r);
  try {
    process.stdout.write(new Uint8Array(65537));
  } finally {
    output.restore();
  }
  await finalizeCase({
    r,
    startSettled: true,
    stopResult: {
      closed: true
    },
    children: [],
    provider: {
      count: () => 0,
      close: async () => {}
    },
    root: 'fake-owned',
    close: async () => true,
    remove: async () => {
      removed++;
    }
  });
  assert.equal(removed, 0);
  assert.equal(r.rootsRemoved, false);
});

// Task44 controls exercise the real admission/command/build composition without native tools.
import * as diagnostic from './windows-app-start-repro.mjs';
import * as fixtureFs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
const BUILD_PHASES = ['admit', 'node-binding', 'source-pins', 'pnpm-location', 'pnpm-manifest', 'pnpm-file', 'node-file', 'bun-file', 'node-version', 'pnpm-version', 'bun-version', 'fresh-root', 'revision', 'source-before', 'install', 'electron-admission', 'electron-install', 'dist-reset', 'server-build', 'source-after', 'dist-identity', 'electron-identity', 'manifest-write'];
const fixtureRoot = path.join(path.parse(process.cwd()).root, 'task44-fixture');
const fixtureTools = path.join(fixtureRoot, 'tools');
const fixturePnpm = path.join(fixtureTools, 'pnpm', 'node_modules', 'pnpm');
const fixtureElectron = path.join(fixtureRoot, 'packages', 'electron');
const fixtureCache = path.join(fixtureRoot, 'owned', 'lawoss-app-start-build', 'electron-cache');
const buildContext = { ...context.env, LAWOSS_NODE_EXE: path.join(fixtureTools, 'node.exe'), LAWOSS_PNPM_DEST: path.join(fixtureTools, 'pnpm'), LAWOSS_BUN_EXE: path.join(fixtureTools, 'bun.exe'), RUNNER_TEMP: path.join(fixtureRoot, 'owned'), PATH: path.join(fixtureRoot, 'system'), NODE_OPTIONS: 'must-be-removed', electron_override: 'must-be-removed', npm_config_arch: 'must-be-removed', SENTINEL: 'private' };
function buildFixture({ at, error = Error('SECRET_SENTINEL'), nodeSize = 93580104, bunSize = 86097473, commandFault, stale = false, writeError } = {}) {
  const calls = [], writes = [], commands = [], children = [], commandOptions = [];
  let sourceCalls = 0;
  const hit = name => { calls.push(name); if (at === name) throw error; };
  const io = {
    async realpath(p) { if (p === fixturePnpm) hit('pnpm-location'); return p; },
    async lstat(p) {
      if (p.endsWith('windows-app-start-receipt.json')) { if (stale) return { isFile: () => true }; throw Object.assign(Error('private'), { code: 'ENOENT' }); }
      const name = path.basename(p) === 'pnpm.mjs' ? 'pnpm-file' : p === buildContext.LAWOSS_NODE_EXE ? 'node-file' : p === buildContext.LAWOSS_BUN_EXE ? 'bun-file' : null;
      if (name) hit(name);
      return { isSymbolicLink: () => false, isFile: () => true, size: p === buildContext.LAWOSS_NODE_EXE ? nodeSize : p === buildContext.LAWOSS_BUN_EXE ? bunSize : 100 };
    },
    async readFile(p) {
      if (p === path.join(fixturePnpm, 'package.json')) { hit('pnpm-manifest'); return JSON.stringify({ name: 'pnpm', version: '11.4.0', bin: { pnpm: 'bin/pnpm.mjs' } }); }
      if (p === path.join(fixtureElectron, 'package.json')) return JSON.stringify({ version: '43.7.5', bin: { 'install-electron': 'install.js' } });
      return Buffer.from('bounded-fixture');
    },
    async mkdir() { hit('fresh-root'); },
    async rm() { hit('dist-reset'); },
    async writeFile(p, text, options) {
      if (p.endsWith('manifest.json')) hit('manifest-write');
      else if (writeError) throw writeError;
      writes.push({ p, text, options });
    }
  };
  const launch = (exe, args, options) => {
    const role = args[0] === '--version' ? (exe === buildContext.LAWOSS_BUN_EXE ? 'bun-version' : 'node-version') : args[1] === '--version' ? 'pnpm-version' : exe === 'git' ? 'revision' : args[1] === 'install' ? 'install' : args[0].endsWith('install.js') ? 'electron-install' : 'server-build';
    commands.push({ role, exe, args, options });
    hit(role);
    if (commandFault?.role === role && commandFault.kind === 'throw') throw error;
    const child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); children.push(child);
    queueMicrotask(() => {
      const fault = commandFault?.role === role ? commandFault.kind : null;
      if (fault === 'error') child.emit('error', error);
      const version = { 'node-version': 'v24.21.0', 'pnpm-version': '11.4.0', 'bun-version': '1.4.2', revision: context.env.GITHUB_SHA }[role];
      if (version) child.stdout.emit('data', Buffer.from(version + '\n'));
      child.emit('exit', fault === 'nonzero' ? 1 : 0); child.emit('close');
    });
    return child;
  };
  return { calls, writes, commands, children, commandOptions, options: {
    io, env: { ...buildContext }, node: buildContext.LAWOSS_NODE_EXE,
    admission: () => { hit('admit'); admit(context); },
    verifySources: async () => hit('source-pins'),
    sourceIdentity: async () => { hit(++sourceCalls === 1 ? 'source-before' : 'source-after'); return 'b'.repeat(64); },
    distIdentity: async () => { hit('dist-identity'); return [{ name: 'server.js', size: 100, sha256: 'c'.repeat(64) }]; },
    electronIdentity: async () => { hit('electron-identity'); return { cacheRoot: fixtureCache }; },
    resolveElectron: async () => { hit('electron-admission'); return fixtureElectron; },
    command: (exe, args, options) => { commandOptions.push(options); return diagnostic.command(exe, args, { ...options, launch }); }
  } };
}
test('task44 ordinary file observation comes from actual stat before size refusal', async () => {
  const root = await fixtureFs.realpath(await fixtureFs.mkdtemp(path.join(os.tmpdir(), 'lawoss-task44-')));
  try {
    const filename = path.join(root, 'tool'); await fixtureFs.writeFile(filename, '12345');
    const events = [];
    await assert.rejects(diagnostic.ordinaryFile(filename, root, 4, e => events.push(e)));
    assert.ok(events.some(e => e.stage === 'SIZE' && e.sizeBytes === 5));
    assert.equal(events.at(-1).reason, 'SIZE');
    assert.equal(JSON.stringify(events).includes(root), false);
  } finally { await fixtureFs.rm(root, { recursive: true, force: true }); }
});
test('task44 official-metadata sized Node and Bun reach hashing/version through initial and recheck tools', async () => {
  const f = buildFixture();
  const result = await diagnostic.runBuildPreparation(f.options);
  assert.equal(result.primaryError, null);
  assert.equal(result.publicationError, null);
  assert.equal(f.writes.length, 1);
  const manifest = JSON.parse(f.writes[0].text);
  assert.equal(manifest.tools.nodeIdentity.size, 93580104);
  assert.equal(manifest.tools.bunIdentity.size, 86097473);
  assert.equal(f.commands.length, 7);
  await diagnostic.verifyBuild(manifest, { ...f.options, sourceIdentity: async () => 'b'.repeat(64) });
  assert.equal(f.commands.length, 10);
  assert.equal(f.writes.some(x => x.p.endsWith('windows-app-start-receipt.json')), false);
});
test('task44 Node cap boundary and oversize preinstall failure preserve observed clamping', async () => {
  for (const [size, succeeds] of [[134217728, true], [134217729, false]]) {
    const f = buildFixture({ nodeSize: size }); const result = await diagnostic.runBuildPreparation(f.options);
    assert.equal(result.primaryError === null, succeeds);
    if (!succeeds) {
      const p = diagnostic.validatePublication(f.writes[0].text).payload;
      assert.equal(p.tools.node.sizeBytes, 134217729); assert.equal(p.tools.node.sizeExact, false);
      assert.equal(p.tools.node.refusal, 'SIZE'); assert.equal(p.tools.node.hashVerified, false);
      assert.equal(f.commands.length, 0); assert.equal(p.rootState, 'NOT_CREATED');
    }
  }
});
for (const name of BUILD_PHASES) test(`task44 actual phase ${name} failure preserves prefix and private error`, async () => {
  const error = Error('SECRET_SENTINEL');
  const f = buildFixture({ at: name, error });
  if (name === 'node-binding') f.options.env.LAWOSS_NODE_EXE = path.join(fixtureRoot, 'different', 'node.exe');
  const result = await diagnostic.runBuildPreparation(f.options);
  assert.ok(result.primaryError);
  if (name !== 'node-binding' && !['node-version', 'pnpm-version', 'bun-version', 'revision', 'install', 'electron-install', 'server-build'].includes(name)) assert.equal(result.primaryError, error);
  const p = result.observation;
  assert.equal(p.phases[BUILD_PHASES.indexOf(name)].state, 'FAILED');
  assert.ok(p.phases.slice(0, BUILD_PHASES.indexOf(name)).every(x => x.state === 'COMPLETED'));
  assert.ok(p.phases.slice(BUILD_PHASES.indexOf(name) + 1).every(x => x.state === 'NOT_ENTERED'));
  assert.equal(JSON.stringify(p).includes('SECRET_SENTINEL'), false);
  assert.equal(p.appStage, 'NOT_RUN'); assert.equal(p.resourceClosure, 'UNKNOWN');
  assert.ok(f.calls.every(call => BUILD_PHASES.indexOf(call) <= BUILD_PHASES.indexOf(name)));
  assert.equal(f.writes.some(write => write.p.endsWith('manifest.json')), false);
  if (name === 'admit') assert.equal(f.writes.length, 0);
  else { assert.equal(f.writes.length, 1); diagnostic.validatePublication(f.writes[0].text); }
});
test('task44 command options preserve original seven roles and filtered install environment', async () => {
  const f = buildFixture(); await diagnostic.runBuildPreparation(f.options);
  assert.deepEqual(f.commands.map(x => [x.role, x.exe, x.args]), [
    ['node-version', buildContext.LAWOSS_NODE_EXE, ['--version']], ['pnpm-version', buildContext.LAWOSS_NODE_EXE, [path.join(fixturePnpm, 'bin', 'pnpm.mjs'), '--version']], ['bun-version', buildContext.LAWOSS_BUN_EXE, ['--version']], ['revision', 'git', ['rev-parse', 'HEAD']], ['install', buildContext.LAWOSS_NODE_EXE, [path.join(fixturePnpm, 'bin', 'pnpm.mjs'), 'install', '--frozen-lockfile']], ['electron-install', buildContext.LAWOSS_NODE_EXE, [path.join(fixtureElectron, 'install.js')]], ['server-build', buildContext.LAWOSS_NODE_EXE, [path.join(fixturePnpm, 'bin', 'pnpm.mjs'), '--filter', 'legalwork-server', 'build']]
  ]);
  assert.deepEqual(f.commandOptions.map(o => [o.cap, o.ms, Boolean(o.keep)]), [[1024,15000,true],[1024,15000,true],[1024,15000,true],[1024,15000,true],[1048576,600000,false],[65536,300000,false],[1048576,600000,false]]);
  const expectedEnv = { ...buildContext }; delete expectedEnv.NODE_OPTIONS; delete expectedEnv.electron_override; delete expectedEnv.npm_config_arch;
  expectedEnv.PATH = [fixtureTools, fixtureTools, buildContext.PATH].join(path.delimiter); expectedEnv.electron_config_cache = fixtureCache;
  for (const c of f.commands) {
    assert.equal(c.options.cwd, diagnostic.REPO); assert.equal(c.options.windowsHide, true); assert.deepEqual(c.options.stdio, ['ignore', 'pipe', 'pipe']);
    if (['install', 'electron-install', 'server-build'].includes(c.role)) {
      assert.equal(JSON.stringify(c.options.env) === JSON.stringify(expectedEnv), true);
      assert.equal('NODE_OPTIONS' in c.options.env, false); assert.equal('electron_override' in c.options.env, false); assert.equal('npm_config_arch' in c.options.env, false);
      assert.equal(c.options.env.electron_config_cache, fixtureCache);
      assert.equal(c.options.env.PATH, [fixtureTools, fixtureTools, buildContext.PATH].join(path.delimiter));
    }
  }
});
for (const kind of ['nonzero', 'throw', 'error']) test(`task44 install ${kind} has finite command terminality and stops later work`, async () => {
  const f = buildFixture({ commandFault: { role: 'install', kind } }); const result = await diagnostic.runBuildPreparation(f.options);
  const p = diagnostic.validatePublication(f.writes[0].text).payload;
  assert.equal(p.outcome, 'PREREQUISITE_FAILED'); assert.equal(p.commands.install.reason, { nonzero: 'NONZERO_EXIT', throw: 'SPAWN_THROW', error: 'CHILD_ERROR' }[kind]);
  assert.equal(p.commands.install.spawnReturned, kind !== 'throw'); assert.equal(p.commands.install.closeObserved, kind !== 'throw');
  assert.equal(p.rootCreated, true); assert.equal(p.rootRetained, true);
  assert.equal(p.tools.node.refusal, 'NONE'); assert.equal(p.phases[16].state, 'NOT_ENTERED');
  assert.equal(result.primaryError.diagnosticCode, 'PREREQUISITE_FAILED');
});
test('task44 publication is exclusive, frozen, and independent from primary failure', async () => {
  const primary = Error('private-primary'), publication = Error('private-publication');
  const f = buildFixture({ at: 'source-before', error: primary, writeError: publication });
  const result = await diagnostic.runBuildPreparation(f.options);
  assert.equal(result.primaryError, primary); assert.equal(result.publicationError, publication); assert.equal(f.writes.length, 0);
  const g = buildFixture({ at: 'source-before', error: primary }); const failed = await diagnostic.runBuildPreparation(g.options);
  assert.equal(failed.primaryError, primary); assert.equal(g.writes.length, 1); assert.deepEqual(g.writes[0].options, { flag: 'wx', mode: 0o600 });
  assert.ok(Object.isFrozen(failed.observation)); assert.ok(Object.isFrozen(failed.observation.phases[0]));
  const stale = buildFixture({ stale: true }); const refused = await diagnostic.runBuildPreparation(stale.options);
  assert.ok(refused.primaryError); assert.equal(stale.writes.length, 0); assert.equal(stale.commands.length, 0);
});
test('task44 mode envelope dispatch preserves app payload and binds workflow branch', async () => {
  const app = completeReceipt();
  const text = diagnostic.encodePublication('APP_START', app);
  assert.deepEqual(diagnostic.validatePublication(text, { build: 'success', app: 'failure' }).payload, validateReceipt(encodeReceipt(app)));
  assert.throws(() => diagnostic.validatePublication(encodeReceipt(app)));
  assert.throws(() => diagnostic.validatePublication(text, { build: 'failure', app: 'skipped' }));
  const f = buildFixture({ at: 'source-pins', error: diagnostic.fail('PREREQUISITE_FAILED') }); await diagnostic.runBuildPreparation(f.options);
  diagnostic.validatePublication(f.writes[0].text, { build: 'failure', app: 'skipped' });
  assert.throws(() => diagnostic.validatePublication(f.writes[0].text, { build: 'success', app: 'success' }));
  assert.throws(() => diagnostic.validatePublication(' '.repeat(32769)));
  for (const mutate of [x => x.mode = 'OTHER', x => x.extra = 'SECRET_SENTINEL', x => x.payload.finalized = false, x => x.payload.engine = {}, x => x.payload.phases[2].state = 'COMPLETED', x => x.payload.phases[0].elapsedMs = Infinity, x => x.payload.tools.node.sizeExact = true, x => x.payload.commands.install.combinedBytes = 1048578, x => x.payload.source.sourceBeforeDigest = 'SECRET_SENTINEL', x => x.payload.outcome = 'REPRODUCED']) {
    const value = JSON.parse(f.writes[0].text); mutate(value); assert.throws(() => diagnostic.validatePublication(JSON.stringify(value)));
  }
});

test('task44 default64MiB/tree32MiB and pnpm admission stay strict without large allocation', async () => {
  for (const [max, size] of [[undefined, 67108865], [33554432, 33554433], [67108864, 93580104]]) {
    let reads = 0;
    const io = { realpath: async p => p, lstat: async () => ({ isFile: () => true, isSymbolicLink: () => false, size }), readFile: async () => { reads++; return Buffer.from('small'); } };
    await assert.rejects(diagnostic.ordinaryFile(path.join(fixtureRoot, 'ordinary', 'file'), path.join(fixtureRoot, 'ordinary'), max, undefined, io), { diagnosticCode: 'PREREQUISITE_FAILED' });
    assert.equal(reads, 0);
  }
  const f = buildFixture();
  const stat = f.options.io.lstat;
  f.options.io.lstat = async p => p.endsWith('pnpm.mjs') ? { isFile: () => true, isSymbolicLink: () => false, size: 67108865 } : stat(p);
  const result = await diagnostic.runBuildPreparation(f.options);
  assert.equal(result.observation.tools.pnpm.refusal, 'SIZE'); assert.equal(f.commands.length, 0);
});
test('task44 file guard observations preserve original errors and unmeasured missing/lexical identity', async () => {
  const missing = Object.assign(Error('SECRET_SENTINEL'), { code: 'ENOENT' });
  const events = [];
  await assert.rejects(diagnostic.ordinaryFile(path.join(fixtureRoot, 'ordinary', 'file'), path.join(fixtureRoot, 'ordinary'), 10, value => { events.push(value); throw Error('observer-must-be-ignored'); }, { realpath: async () => { throw missing; } }), error => error === missing);
  assert.deepEqual(events.at(-1), { stage: 'REFUSAL', reason: 'MISSING' });
  for (const [kind, want] of [['lexical', 'LEXICAL'], ['outside', 'OUTSIDE'], ['symlink', 'SYMLINK'], ['directory', 'NONREGULAR']]) {
    const log = [];
    const io = { realpath: async p => kind === 'lexical' && path.basename(p) === 'file' ? path.join(fixtureRoot, 'ordinary', 'target') : kind === 'outside' && p === path.join(fixtureRoot, 'ordinary') ? path.join(fixtureRoot, 'other') : p, lstat: async () => ({ isSymbolicLink: () => kind === 'symlink', isFile: () => kind !== 'directory', size: 1 }), readFile: async () => { throw Error('must-not-read'); } };
    await assert.rejects(diagnostic.ordinaryFile(path.join(fixtureRoot, 'ordinary', 'file'), path.join(fixtureRoot, 'ordinary'), 10, e => log.push(e), io));
    assert.equal(log.at(-1).reason, want);
  }
});
test('task44 version and recheck hash mismatches are refused before build use', async () => {
  const version = buildFixture();
  const execute = version.options.command;
  version.options.command = async (...args) => { const r = await execute(...args); if (args[1][0] === '--version') r.text = 'wrong'; return r; };
  const failed = await diagnostic.runBuildPreparation(version.options);
  assert.equal(failed.observation.phases[8].state, 'FAILED'); assert.equal(version.commands.length, 1);
  const f = buildFixture(); await diagnostic.runBuildPreparation(f.options);
  const manifest = JSON.parse(f.writes[0].text);
  f.options.io.readFile = async p => p === path.join(fixturePnpm, 'package.json') ? JSON.stringify({ name: 'pnpm', version: '11.4.0', bin: { pnpm: 'bin/pnpm.mjs' } }) : Buffer.from('identity-changed');
  await assert.rejects(diagnostic.verifyBuild(manifest, { ...f.options, sourceIdentity: async () => 'b'.repeat(64) }), { diagnosticCode: 'BUILD_MISMATCH' });
});
for (const scenario of ['exit-without-close', 'timeout-before-exit', 'overflow', 'keep-stderr', 'child-error-then-timer']) test(`task44 composed ${scenario} freezes failure, preserves first error and never advances late`, async () => {
  const f = buildFixture();
  const normal = f.options.command;
  let child, fire, observedCap, observedMs;
  f.options.command = (exe, args, options) => {
    if (args[1] !== 'install') return normal(exe, args, options);
    observedCap = options.cap; observedMs = options.ms;
    const launch = () => {
      child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
      queueMicrotask(() => {
        if (scenario === 'exit-without-close') child.emit('exit', 0);
        if (scenario === 'overflow') { child.stdout.emit('data', Buffer.alloc(1048575)); child.stderr.emit('data', Buffer.alloc(2)); }
        if (scenario === 'keep-stderr') child.stderr.emit('data', Buffer.from('SECRET_SENTINEL'));
        if (scenario === 'child-error-then-timer') child.emit('error', Error('SECRET_SENTINEL'));
        if (scenario === 'overflow' || scenario === 'keep-stderr') { child.emit('exit', 0); child.emit('close'); } else fire();
      });
      return child;
    };
    // keep:true is a controlled probe of the same command collector branch.
    return diagnostic.command(exe, args, { ...options, keep: scenario === 'keep-stderr', launch, schedule: callback => { fire = callback; return {}; }, cancel: () => {} });
  };
  const result = await diagnostic.runBuildPreparation(f.options);
  assert.equal(observedCap, 1048576); assert.equal(observedMs, 600000);
  const p = result.observation;
  assert.equal(p.phases[14].state, ['overflow', 'keep-stderr'].includes(scenario) ? 'FAILED' : 'PENDING');
  assert.equal(p.phases[15].state, 'NOT_ENTERED'); assert.equal(p.rootRetained, true); assert.equal(p.resourceClosure, 'UNKNOWN');
  assert.equal(p.commands.install.reason, { 'exit-without-close': 'TIMER', 'timeout-before-exit': 'TIMER', overflow: 'OUTPUT_CAP', 'keep-stderr': 'KEEP_STDERR', 'child-error-then-timer': 'CHILD_ERROR' }[scenario]);
  assert.equal(p.commands.install.closeObserved, ['overflow', 'keep-stderr'].includes(scenario));
  if (scenario !== 'keep-stderr') { assert.equal(f.writes.length, 1); diagnostic.validatePublication(f.writes[0].text); }
  else {
    // Install never requests keep:true in the real build, so this injected branch is refused at publication.
    assert.ok(result.publicationError); assert.equal(f.writes.length, 0);
  }
  const frozen = JSON.stringify(p), published = f.writes.map(x => x.text);
  child.stdout.emit('data', Buffer.from('SECRET_SENTINEL')); child.emit('exit', 0); child.emit('close');
  assert.equal(JSON.stringify(p), frozen); assert.deepEqual(f.writes.map(x => x.text), published);
  assert.equal(published.join('').includes('SECRET_SENTINEL'), false);
});
test('task44 direct keep-stderr observer preserves primary while independent overflow/timer flags accumulate', async () => {
  let child, fire;
  const log = [];
  const pending = diagnostic.command('fake', [], { cap: 8, keep: true, observe: e => log.push(e), schedule: callback => { fire = callback; }, cancel: () => {}, launch: () => {
    child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); return child;
  } });
  child.stderr.emit('data', Buffer.from('x')); child.stdout.emit('data', Buffer.alloc(9)); fire();
  await assert.rejects(pending, { diagnosticCode: 'OUTPUT_LIMIT' });
  assert.equal(log.at(-1).reason, 'KEEP_STDERR'); assert.equal(log.at(-1).overflow, true); assert.equal(log.at(-1).timerFired, true); assert.equal(log.at(-1).combinedBytes, 9);
  const frozen = JSON.stringify(log); child.emit('exit', 0); child.emit('close'); assert.equal(JSON.stringify(log), frozen);
});
test('task44 encoding failure cannot replace a private error or publish an invalid source digest', async () => {
  const primary = Error('private'); const f = buildFixture({ at: 'dist-identity', error: primary });
  f.options.sourceIdentity = async () => 'SECRET_SENTINEL';
  const result = await diagnostic.runBuildPreparation(f.options);
  assert.equal(result.primaryError, primary); assert.ok(result.publicationError); assert.equal(f.writes.length, 0);
  const mkdir = buildFixture({ at: 'fresh-root', error: primary }); const root = await diagnostic.runBuildPreparation(mkdir.options);
  assert.equal(root.observation.rootState, 'UNKNOWN'); assert.equal(root.observation.rootRetained, null); assert.equal(root.observation.rootCreated, false);
  diagnostic.validatePublication(mkdir.writes[0].text);
});

test('task44 observation never changes app track on synchronous spawn refusal', async () => {
  const track = {}, log = [];
  await assert.rejects(diagnostic.command('fake', [], { track, observe: e => log.push(e), launch: () => { throw Error('private'); } }), { diagnosticCode: 'PREREQUISITE_FAILED' });
  assert.deepEqual(track, {}); assert.equal(log.at(-1).reason, 'SPAWN_THROW'); assert.equal(log.at(-1).spawnReturned, false);
});
test('task44 unobserved app command retains its original timeout rejection after child error', async () => {
  let child, fire;
  const pending = diagnostic.command('fake', [], { schedule: fn => { fire = fn; }, cancel: () => {}, launch: () => {
    child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter(); return child;
  } });
  child.emit('error', Error('private')); fire();
  await assert.rejects(pending, { diagnosticCode: 'HOST_PENDING' });
  child.emit('exit', 0); child.emit('close');
});
test('task44 closed build schema refuses sentinels in every leaf and contradictory observations', async () => {
  const f = buildFixture({ commandFault: { role: 'install', kind: 'nonzero' } }); await diagnostic.runBuildPreparation(f.options);
  const publication = JSON.parse(f.writes[0].text);
  function leaves(value, prefix = []) { return value && typeof value === 'object' ? Object.entries(value).flatMap(([key, child]) => leaves(child, [...prefix, key])) : [prefix]; }
  for (const keys of leaves(publication)) {
    const bad = structuredClone(publication); let target = bad;
    for (const key of keys.slice(0, -1)) target = target[key]; target[keys.at(-1)] = 'SECRET_SENTINEL';
    assert.throws(() => diagnostic.validatePublication(JSON.stringify(bad)));
  }
  for (const mutate of [r => r.source.revision = [r.source.revision], r => r.source.sourceBeforeDigest = [r.source.sourceBeforeDigest], r => r.rootCreationEntered = false, r => r.tools.node.refusal = 'SIZE', r => r.tools.node.maxBytes++, r => r.tools.node.sizeBytes = Infinity, r => r.commands.install.exitObserved = false, r => r.commands.install.exitCode = 0, r => r.commands.install.spawnReturned = false, r => r.phases[14].state = 'PENDING', r => r.phases[14].elapsedMs = 600001, r => r.commands.install.capBytes++, r => r.commands.install.stdoutBytes = -1]) {
    const bad = structuredClone(publication); mutate(bad.payload); assert.throws(() => diagnostic.validatePublication(JSON.stringify(bad)));
  }
  const exact = f.writes[0].text.trimEnd().padEnd(32768, ' ');
  diagnostic.validatePublication(exact);
  assert.throws(() => diagnostic.validatePublication(exact + ' '));
});
test('task44 Bun admits the128MiB boundary and refuses the next byte with no command', async () => {
  const f = buildFixture({ bunSize: 134217728 }); const good = await diagnostic.runBuildPreparation(f.options);
  assert.equal(good.primaryError, null);
  const g = buildFixture({ bunSize: 134217729 }); const bad = await diagnostic.runBuildPreparation(g.options);
  assert.equal(bad.observation.tools.bun.sizeExact, false); assert.equal(bad.observation.tools.bun.refusal, 'SIZE'); assert.equal(g.commands.length, 0);
});

// R1 starts with publications emitted by the actual collector/build composition.
async function pendingBuildFixture(role, events) {
  const f = buildFixture();
  const normal = f.options.command;
  let child, fire;
  f.options.command = (exe, args, options) => {
    const selected = role === 'install' ? args[1] === 'install' : exe === buildContext.LAWOSS_NODE_EXE && args[0] === '--version';
    if (!selected) return normal(exe, args, options);
    return diagnostic.command(exe, args, { ...options,
      schedule: callback => { fire = callback; return {}; }, cancel: () => {},
      launch: () => {
        child = new EventEmitter(); child.stdout = new EventEmitter(); child.stderr = new EventEmitter();
        queueMicrotask(() => {
          for (const event of events) {
            if (event === 'error') child.emit('error', Error('private'));
            if (event === 'overflow') child.stdout.emit('data', Buffer.alloc(options.cap + 1));
            if (event === 'stderr') child.stderr.emit('data', Buffer.from('private'));
          }
          fire();
        });
        return child;
      }
    });
  };
  const result = await diagnostic.runBuildPreparation(f.options);
  assert.equal(result.publicationError, null);
  assert.equal(f.writes.length, 1);
  const publication = diagnostic.validatePublication(f.writes[0].text, { build: 'failure', app: 'skipped' });
  return { f, result, child, publication };
}
function refuseBuildMutation(publication, mutate) {
  const bad = structuredClone(publication); mutate(bad.payload);
  assert.throws(() => diagnostic.validatePublication(JSON.stringify(bad), { build: 'failure', app: 'skipped' }), { diagnosticCode: 'REFUSED' });
  assert.throws(() => diagnostic.encodePublication('BUILD_PREREQUISITE', bad.payload), { diagnosticCode: 'REFUSED' });
}
test('task44 R1 refuses nonzero exit relabeled NONE on a failed phase', async () => {
  const f = buildFixture({ commandFault: { role: 'install', kind: 'nonzero' } }); await diagnostic.runBuildPreparation(f.options);
  const publication = diagnostic.validatePublication(f.writes[0].text, { build: 'failure', app: 'skipped' });
  assert.equal(publication.payload.commands.install.exitCode, 1);
  refuseBuildMutation(publication, p => { p.commands.install.reason = 'NONE'; });
});
test('task44 R1 refuses no-handle output and uneventful intended pending work', async () => {
  const f = buildFixture({ commandFault: { role: 'install', kind: 'nonzero' } }); await diagnostic.runBuildPreparation(f.options);
  const publication = diagnostic.validatePublication(f.writes[0].text, { build: 'failure', app: 'skipped' });
  refuseBuildMutation(publication, p => {
    Object.assign(p.commands.install, { spawnReturned: false, exitObserved: false, exitKind: 'UNMEASURED', exitCode: null, closeObserved: false, reason: 'NONE', stdoutBytes: 1, stderrBytes: 0, combinedBytes: 1 });
    p.phases[14].state = 'PENDING'; p.outcome = 'UNKNOWN';
  });
});
test('task44 R1 refuses output attached to a no-handle spawn throw', async () => {
  const f = buildFixture({ commandFault: { role: 'install', kind: 'throw' } }); await diagnostic.runBuildPreparation(f.options);
  const publication = diagnostic.validatePublication(f.writes[0].text, { build: 'failure', app: 'skipped' });
  assert.equal(publication.payload.commands.install.reason, 'SPAWN_THROW');
  refuseBuildMutation(publication, p => { p.commands.install.stdoutBytes = 1; p.commands.install.combinedBytes = 1; });
});
test('task44 R1 refuses pending child-error snapshot without the collector rejection boundary', async () => {
  const { publication } = await pendingBuildFixture('install', ['error']);
  assert.equal(publication.payload.commands.install.reason, 'CHILD_ERROR');
  refuseBuildMutation(publication, p => { p.commands.install.timerFired = false; });
});
for (const role of ['node-version', 'revision']) test(`task44 R1 preserves successful ${role} command followed by text mismatch`, async () => {
  const f = buildFixture(); const normal = f.options.command;
  f.options.command = async (exe, args, options) => {
    const result = await normal(exe, args, options);
    if (role === 'revision' ? exe === 'git' : exe === buildContext.LAWOSS_NODE_EXE && args[0] === '--version') return { ...result, text: 'wrong-text' };
    return result;
  };
  const result = await diagnostic.runBuildPreparation(f.options);
  assert.equal(result.primaryError.diagnosticCode, role === 'revision' ? 'SOURCE_MISMATCH' : 'PREREQUISITE_FAILED');
  assert.equal(result.publicationError, null);
  const publication = diagnostic.validatePublication(f.writes[0].text, { build: 'failure', app: 'skipped' });
  const command = publication.payload.commands[role];
  assert.equal(command.reason, 'NONE'); assert.equal(command.spawnReturned, true); assert.equal(command.exitObserved, true);
  assert.equal(command.exitKind, 'CODE'); assert.equal(command.exitCode, 0); assert.equal(command.closeObserved, true);
  assert.equal(publication.payload.phases[BUILD_PHASES.indexOf(role)].state, 'FAILED');
  assert.equal(publication.payload.outcome, 'PREREQUISITE_FAILED');
});
for (const [role, events, reason] of [
  ['install', ['error'], 'CHILD_ERROR'],
  ['install', ['overflow'], 'OUTPUT_CAP'],
  ['node-version', ['stderr'], 'KEEP_STDERR'],
  ['node-version', ['error', 'overflow', 'stderr'], 'CHILD_ERROR'],
  ['install', ['overflow', 'error'], 'OUTPUT_CAP'],
  ['node-version', ['stderr', 'overflow', 'error'], 'KEEP_STDERR']
]) test(`task44 R1 preserves ${events.join('/')} then timer with first reason ${reason}`, async () => {
  const { publication, child, f } = await pendingBuildFixture(role, events);
  const command = publication.payload.commands[role];
  assert.equal(command.reason, reason); assert.equal(command.timerFired, true); assert.equal(command.spawnReturned, true);
  assert.equal(command.spawnError, events.includes('error')); assert.equal(command.overflow, events.includes('overflow'));
  assert.equal(command.keepStderrRefused, events.includes('stderr')); assert.equal(command.closeObserved, false);
  assert.equal(publication.payload.phases[BUILD_PHASES.indexOf(role)].state, 'PENDING'); assert.equal(publication.payload.outcome, 'UNKNOWN');
  const frozen = JSON.stringify(publication), output = f.writes[0].text;
  child.emit('exit', 0); child.emit('close');
  assert.equal(JSON.stringify(publication), frozen); assert.equal(f.writes.length, 1); assert.equal(f.writes[0].text, output);
});
