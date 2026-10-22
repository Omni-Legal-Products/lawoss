import assert from 'node:assert/strict';
import test from 'node:test';
import { createOwnerCensusRefusal, ownerCensusRefusalDiagnostic } from './native-owner-census-diagnostics.mjs';
import { NativeAlphaLaunchError, nativeOwnerCensusDiagnostic } from './native-app.mjs';

const unknown = { stage: 'initial-pre-lock', category: 'unknown', code: 'unknown', exitCode: null, signal: null, killed: null };
const project = (raw, stage = 'initial-pre-lock') => ownerCensusRefusalDiagnostic(createOwnerCensusRefusal(raw, stage));

for (const [name, raw, expected] of [
  ['explicit timeout precedes signal', { code: 'ETIMEDOUT', signal: 'SIGTERM', killed: true }, { category: 'timeout-reported', code: 'ETIMEDOUT', signal: 'SIGTERM', killed: true }],
  ['buffer precedes signal', { code: 'ENOBUFS', signal: 'SIGKILL' }, { category: 'buffer-reported', code: 'ENOBUFS', signal: 'SIGKILL' }],
  ['async maxbuffer', { code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }, { category: 'buffer-reported', code: 'ERR_CHILD_PROCESS_STDIO_MAXBUFFER' }],
  ['numeric exit precedes signal', { code: 7, signal: 'SIGINT' }, { category: 'exit-reported', exitCode: 7, signal: 'SIGINT' }],
  ['lower exit bound', { code: -65536 }, { category: 'exit-reported', exitCode: -65536 }],
  ['upper exit bound', { code: 65535 }, { category: 'exit-reported', exitCode: 65535 }],
  ['signal precedes spawn', { code: 'EIO', signal: 'SIGSEGV' }, { category: 'signal-reported', code: 'EIO', signal: 'SIGSEGV' }],
  ['killed alone remains unknown', { killed: true }, { killed: true }],
  ['false killed remains false', { killed: false }, { killed: false }],
  ['unlisted code and signal', { code: 'PRIVATE_CODE', signal: 'PRIVATE_SIGNAL' }, {}],
]) test(`census projects ${name}`, () => assert.deepEqual(project(raw), { ...unknown, ...expected }));

for (const code of ['ENOENT', 'EACCES', 'EPERM', 'EIO']) test(`census retains reported spawn code ${code}`, () => {
  assert.deepEqual(project({ code }), { ...unknown, category: 'spawn-reported', code });
});
for (const signal of ['SIGTERM', 'SIGKILL', 'SIGABRT', 'SIGSEGV', 'SIGINT', 'SIGHUP']) test(`census retains finite signal ${signal}`, () => {
  assert.deepEqual(project({ signal }), { ...unknown, category: 'signal-reported', signal });
});

test('malformed numeric and primitive facts stay unknown without coercion', () => {
  for (const code of [NaN, Infinity, -Infinity, -65537, 65536, 1.5, '7', 7n, Symbol('private'), null, undefined]) {
    assert.deepEqual(project({ code, signal: 15, killed: 1 }), unknown);
  }
  for (const raw of [null, undefined, 'PRIVATE', 7, Symbol('private'), true]) assert.deepEqual(project(raw), unknown);
  let coerced = 0;
  const hostile = { toString() { coerced++; throw new Error('PRIVATE'); }, valueOf() { coerced++; throw new Error('PRIVATE'); },
    [Symbol.toPrimitive]() { coerced++; throw new Error('PRIVATE'); } };
  assert.deepEqual(project({ code: hostile, signal: hostile, killed: hostile }), unknown);
  assert.equal(coerced, 0);
});

test('only own data descriptors are read once and unrelated getters are never invoked', () => {
  let getters = 0;
  const raw = Object.create({ code: 'ETIMEDOUT', signal: 'SIGTERM', killed: true });
  for (const key of ['code', 'signal', 'killed', 'message', 'stdout', 'stderr', 'cause']) Object.defineProperty(raw, key, {
    get() { getters++; throw new Error('PRIVATE'); },
  });
  assert.deepEqual(project(raw), unknown);
  assert.deepEqual(project(Object.create({ code: 'ETIMEDOUT', signal: 'SIGTERM', killed: true })), unknown);
  const reads = [];
  const proxy = new Proxy({ code: 'EPERM', signal: 'SIGKILL', killed: true }, {
    get() { getters++; throw new Error('PRIVATE'); },
    getOwnPropertyDescriptor(target, key) { reads.push(key); return Reflect.getOwnPropertyDescriptor(target, key); },
  });
  assert.deepEqual(project(proxy), { ...unknown, category: 'signal-reported', code: 'EPERM', signal: 'SIGKILL', killed: true });
  assert.deepEqual(reads, ['code', 'signal', 'killed']);
  assert.equal(getters, 0);
});

test('accessor descriptors cannot borrow a primitive value from the descriptor prototype', () => {
  let getters = 0;
  const raw = {};
  Object.defineProperty(raw, 'code', { get() { getters++; throw new Error('PRIVATE'); } });
  const prior = Object.getOwnPropertyDescriptor(Object.prototype, 'value');
  try {
    Object.defineProperty(Object.prototype, 'value', { value: 'ETIMEDOUT', configurable: true, writable: true });
    assert.deepEqual(project(raw), unknown);
    assert.equal(getters, 0);
  } finally {
    delete Object.prototype.value;
    if (prior) Object.defineProperty(Object.prototype, 'value', prior);
  }
});

test('descriptor traps and revoked proxies cannot replace the original refusal', () => {
  let reads = 0;
  const trapped = new Proxy({}, { getOwnPropertyDescriptor() { reads++; throw new Error('PRIVATE'); } });
  assert.deepEqual(project(trapped), unknown);
  assert.equal(reads, 3);
  const revoked = Proxy.revocable({}, {}); revoked.revoke();
  assert.deepEqual(project(revoked.proxy), unknown);
});

test('registered frozen projection preserves exact refusal without publishing raw error or mutable metadata', () => {
  const raw = Object.assign(new Error('PRIVATE command /path pid=123'), { code: 'EIO', stdout: 'PRIVATE', stderr: 'PRIVATE', env: 'PRIVATE' });
  const refusal = createOwnerCensusRefusal(raw, 'observe');
  assert.equal(Object.getPrototypeOf(refusal), Error.prototype);
  assert.equal(refusal.message, 'installed-app-owner-census-unavailable');
  assert.equal(refusal.code, 'installed-app-owner-census-unavailable');
  assert.equal(refusal.status, 'blocked');
  assert.deepEqual(Object.getOwnPropertyNames(refusal).sort(), ['code', 'message', 'stack', 'status']);
  const diagnostic = nativeOwnerCensusDiagnostic(refusal);
  assert.deepEqual(diagnostic, { ...unknown, stage: 'observe', category: 'spawn-reported', code: 'EIO' });
  assert.ok(Object.isFrozen(diagnostic));
  assert.throws(() => { diagnostic.code = 'PRIVATE'; }, TypeError);
  raw.code = 'ETIMEDOUT';
  assert.equal(nativeOwnerCensusDiagnostic(refusal), diagnostic);
  assert.equal(diagnostic.code, 'EIO');
});

test('only explicitly constructed known wrapper receives registered refusal metadata', () => {
  const refusal = createOwnerCensusRefusal({ code: 'ENOENT' }, 'initial-pre-lock');
  const cleanup = { status: 'stopped', method: 'no-child-started' };
  const wrapper = new NativeAlphaLaunchError(refusal, cleanup);
  assert.equal(wrapper.cause, refusal);
  assert.equal(wrapper.code, refusal.code);
  assert.equal(wrapper.status, refusal.status);
  assert.equal(wrapper.message, refusal.message);
  assert.equal(wrapper.nativeCleanup, cleanup);
  assert.equal(nativeOwnerCensusDiagnostic(wrapper), nativeOwnerCensusDiagnostic(refusal));
  assert.equal(ownerCensusRefusalDiagnostic(wrapper), null);
  assert.equal(nativeOwnerCensusDiagnostic(new Error('unregistered', { cause: refusal })), null);
  assert.equal(nativeOwnerCensusDiagnostic(new AggregateError([wrapper], 'unregistered')), null);
  wrapper.cause = new Error('replacement');
  assert.equal(nativeOwnerCensusDiagnostic(wrapper), nativeOwnerCensusDiagnostic(refusal));
});

test('forged fields, proxies, copied errors and arbitrary causes cannot supply metadata or invoke getters', () => {
  let getters = 0;
  const refusal = createOwnerCensusRefusal({ code: 'ETIMEDOUT' }, 'initial-pre-lock');
  const fake = { ...refusal, diagnostic: { ...unknown, category: 'timeout-reported' }, cause: refusal };
  for (const value of [fake, new Error('ordinary'), null, undefined, 7, Symbol('private'), new Proxy(refusal, {
    get() { getters++; throw new Error('PRIVATE'); }, getOwnPropertyDescriptor() { getters++; throw new Error('PRIVATE'); },
  })]) assert.equal(nativeOwnerCensusDiagnostic(value), null);
  const gettersOnly = {};
  for (const key of ['cause', 'code', 'diagnostic', 'nativeOwnerCensusDiagnostic']) Object.defineProperty(gettersOnly, key, {
    get() { getters++; throw new Error('PRIVATE'); },
  });
  assert.equal(nativeOwnerCensusDiagnostic(gettersOnly), null);
  assert.equal(getters, 0);
  const wrapper = new NativeAlphaLaunchError(fake, {});
  assert.equal(nativeOwnerCensusDiagnostic(wrapper), null);
});

test('unsupported stage cannot publish arbitrary text or change primary refusal', () => {
  const stage = { toString() { throw new Error('PRIVATE'); } };
  for (const value of ['PRIVATE /path', undefined, null, stage]) {
    const refusal = createOwnerCensusRefusal({ code: 'ETIMEDOUT' }, value);
    assert.equal(refusal.message, 'installed-app-owner-census-unavailable');
    assert.equal(refusal.code, refusal.message);
    assert.equal(refusal.status, 'blocked');
    assert.equal(nativeOwnerCensusDiagnostic(refusal), null);
  }
});
