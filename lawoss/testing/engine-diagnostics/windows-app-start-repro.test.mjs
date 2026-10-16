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
