import { test, expect, spyOn } from 'bun:test';
import { Database, type SQLQueryBindings } from 'bun:sqlite';
import { mkdtemp, mkdir, writeFile, rm, realpath } from 'node:fs/promises';
import * as fs from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, sep } from 'node:path';
import { inspectSyntheticRemainder, removeSyntheticTestDir } from './inspect-cleanup.js';
import type { ServerConfig } from '../../types.js';

test('cleanup metadata reveals locked DB roles without names, absolute paths or contents',async()=>{
  const root=await mkdtemp(join(tmpdir(),'synthetic-cleanup-'));
  try {
    await writeFile(join(root,'runtime.sqlite'),'private contents');
    await mkdir(join(root,'secret-client'));
    await writeFile(join(root,'secret-client','credential-secret.txt'),'private credentials');
    const result=await inspectSyntheticRemainder(root);
    expect(result.entries).toContainEqual({depth:0,type:'file',role:'runtime-db'});
    expect(result.entries).toContainEqual({depth:1,type:'file',role:'other'});
    expect(JSON.stringify(result)).not.toMatch(/secret|private|credential|synthetic-cleanup/);
  }finally{await rm(root,{recursive:true,force:true});}
});

async function runtimeFixture() {
  const root = await realpath(await mkdtemp(join(tmpdir(), 'synthetic-server-cleanup-')));
  const owns = (filename: string) => filename.startsWith(root + sep);
  const connections = new Set<Database>();
  const statements = new Set<{ get(): unknown; finalize(): void }>();
  const originalPrepare = Database.prototype.prepare;
  const prepare = spyOn(Database.prototype, 'prepare').mockImplementation(function<Result, Params extends SQLQueryBindings | SQLQueryBindings[]>(this: Database, sql: string, bindings?: Params) {
    const prepareStatement = originalPrepare<Result, Params>;
    const statement = prepareStatement.call(this, sql, bindings);
    if (owns(this.filename)) statements.add(statement);
    return statement;
  });
  const originalRun = Database.prototype.run;
  const originalExec = Database.prototype.exec;
  const run = spyOn(Database.prototype, 'run').mockImplementation(function(this: Database, sql, ...bindings) {
    if (owns(this.filename)) connections.add(this);
    return originalRun.call(this, sql, ...bindings);
  });
  const exec = spyOn(Database.prototype, 'exec').mockImplementation(function(this: Database, sql, ...bindings) {
    if (owns(this.filename)) connections.add(this);
    return originalExec.call(this, sql, ...bindings);
  });
  const config: ServerConfig = {
    host: '127.0.0.1', port: 0, token: 'synthetic', hostToken: 'synthetic-host', configPath: join(root, 'server.json'),
    approval: { mode: 'auto', timeoutMs: 0 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false,
    startedAt: Date.now(), tokenSource: 'generated', hostTokenSource: 'generated', logFormat: 'pretty', logRequests: false,
  };
  const servers: Array<Awaited<ReturnType<typeof import('../../server.js').startServer>>> = [];
  return {
    root, connections, statements, config,
    async start(overrides?: Partial<ServerConfig>, options?: Parameters<typeof import('../../server.js').startServer>[1]) {
      const { startServer } = await import('../../server.js');
      const server = await startServer(overrides ? { ...config, ...overrides } : config, options);
      servers.push(server);
      return server;
    },
    async dispose() {
      for (const server of servers) await server.stop();
      run.mockRestore(); exec.mockRestore(); prepare.mockRestore();
      for (const statement of statements) statement.finalize();
      for (const connection of connections) connection.close();
      await rm(root, { recursive: true, force: true });
    },
  };
}

test('stopped synthetic servers release every runtime connection before strict removal', async () => {
  const fixture = await runtimeFixture();
  try {
    const server = await fixture.start();
    await server.stop();
    // Unix permits unlinking live SQLite files; exercise the connection state too.
    expect(fixture.connections.size).toBeGreaterThan(0);
    for (const connection of fixture.connections) expect(() => connection.query('SELECT 1').get()).toThrow();
    // Bun can close a Database logically while uncached prepared statements
    // retain SQLite's physical file handle (and remain executable).
    for (const statement of fixture.statements) expect(() => statement.get()).toThrow();
    await removeSyntheticTestDir(fixture.root);
  } finally { await fixture.dispose(); }
});

test('stopping one shared-runtime listener preserves cached connections until its last owner stops', async () => {
  const fixture = await runtimeFixture();
  try {
    const first = await fixture.start(), second = await fixture.start({});
    const { readEigenweltConnection } = await import('../../eigenwelt-connection-store.js');
    await readEigenweltConnection(fixture.config);
    const opened = fixture.connections.size;
    const stopping = first.stop();
    expect(first.stop()).toBe(stopping);
    await stopping;
    expect(first.stop()).toBe(stopping);
    await readEigenweltConnection(fixture.config);
    // Closing/reopening a sibling's cached connection would create another handle.
    expect(fixture.connections.size).toBe(opened);
    expect([...fixture.connections].some(connection => {
      try { connection.query('SELECT 1').get(); return true; } catch { return false; }
    })).toBe(true);
    await second.stop();
    for (const connection of fixture.connections) expect(() => connection.query('SELECT 1').get()).toThrow();
    await removeSyntheticTestDir(fixture.root);
  } finally { await fixture.dispose(); }
});

test('shutdown releases the original runtime when config and environment paths change', async () => {
  const fixture = await runtimeFixture();
  const originalDb = process.env.LEGALWORK_RUNTIME_DB;
  try {
    const server = await fixture.start();
    const { runtimeDbPath } = await import('../../runtime-db.js');
    fixture.config.configPath = join(fixture.root, 'config-changed', 'server.json');
    process.env.LEGALWORK_RUNTIME_DB = join(fixture.root, 'environment-changed', 'runtime.sqlite');
    await server.stop();
    for (const connection of fixture.connections) expect(() => connection.query('SELECT 1').get()).toThrow();
    expect(runtimeDbPath(fixture.config)).toBe(join(fixture.root, 'environment-changed', 'runtime.sqlite'));
    delete process.env.LEGALWORK_RUNTIME_DB;
    expect(runtimeDbPath(fixture.config)).toBe(join(fixture.root, 'config-changed', 'runtime.sqlite'));
    await removeSyntheticTestDir(fixture.root);
  } finally {
    if (originalDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
    else process.env.LEGALWORK_RUNTIME_DB = originalDb;
    await fixture.dispose();
  }
});

test('two listeners sharing one config retain its runtime identity until the last stop', async () => {
  const fixture = await runtimeFixture();
  try {
    const first = await fixture.start(), second = await fixture.start();
    const { runtimeDbPath } = await import('../../runtime-db.js');
    fixture.config.configPath = join(fixture.root, 'changed', 'server.json');
    await first.stop();
    expect(runtimeDbPath(fixture.config)).toBe(join(fixture.root, 'runtime.sqlite'));
    await second.stop();
    for (const connection of fixture.connections) expect(() => connection.query('SELECT 1').get()).toThrow();
    expect(runtimeDbPath(fixture.config)).toBe(join(fixture.root, 'changed', 'runtime.sqlite'));
    await removeSyntheticTestDir(fixture.root);
  } finally { await fixture.dispose(); }
});

test('a failed listening callback releases its runtime pin after owned work stops', async () => {
  const fixture = await runtimeFixture();
  try {
    const failure = new Error('Synthetic listening failure');
    await expect(fixture.start(undefined, { onListening: async () => {
      fixture.config.configPath = join(fixture.root, 'changed', 'server.json');
      throw failure;
    } })).rejects.toBe(failure);
    const { runtimeDbPath } = await import('../../runtime-db.js');
    expect(runtimeDbPath(fixture.config)).toBe(join(fixture.root, 'changed', 'runtime.sqlite'));
    for (const connection of fixture.connections) expect(() => connection.query('SELECT 1').get()).toThrow();
    await removeSyntheticTestDir(fixture.root);
  } finally { await fixture.dispose(); }
});

test('stopping a runtime does not close an independent live server', async () => {
  const fixture = await runtimeFixture();
  const other = await mkdtemp(join(tmpdir(), 'synthetic-independent-runtime-'));
  try {
    const first = await fixture.start();
    const secondConfig = { ...fixture.config, configPath: join(other, 'server.json') };
    const second = await fixture.start(secondConfig);
    const { readEigenweltConnection } = await import('../../eigenwelt-connection-store.js');
    await first.stop();
    for (const connection of fixture.connections) expect(() => connection.query('SELECT 1').get()).toThrow();
    expect(await readEigenweltConnection(secondConfig)).toBeDefined();
    expect((await fetch(`http://127.0.0.1:${second.port}/health`)).ok).toBe(true);
    await removeSyntheticTestDir(fixture.root);
    await second.stop();
    await removeSyntheticTestDir(other);
  } finally { await fixture.dispose(); await rm(other, { recursive: true, force: true }); }
});

test('persistent locked synthetic resources retain their exact failure and bounded diagnostics', async () => {
  const root = await mkdtemp(join(tmpdir(), 'synthetic-locked-cleanup-'));
  await writeFile(join(root, 'runtime.sqlite'), 'private source bytes');
  await writeFile(join(root, 'private-client-secret.txt'), 'private credentials');
  const locked = Object.assign(new Error('private raw path and source detail'), { code: 'EBUSY' });
  const originalRm = fs.rm;
  const removal = spyOn(fs, 'rm').mockImplementation(async (path, options) => {
    if (path === root) throw locked;
    return originalRm(path, options);
  });
  const errors = spyOn(console, 'error').mockImplementation(() => {});
  try {
    await expect(removeSyntheticTestDir(root)).rejects.toBe(locked);
    const diagnostic = String(errors.mock.calls[0]?.[1]);
    expect(JSON.parse(diagnostic)).toEqual({ entries: expect.arrayContaining([
      { depth: 0, type: 'file', role: 'other' },
      { depth: 0, type: 'file', role: 'runtime-db' },
    ]), capped: false });
    expect(JSON.parse(diagnostic).entries).toHaveLength(2);
    expect(diagnostic).not.toMatch(/private|secret|credentials|synthetic-locked|raw path/);
  } finally {
    removal.mockRestore(); errors.mockRestore();
    await originalRm(root, { recursive: true, force: true });
  }
});

test('scheduled shutdown waits for accepted delivery before closing its runtime store', async () => {
  const { ScheduledTaskStore } = await import('../../scheduled-tasks/store.js');
  const { ScheduledTaskRunner } = await import('../../scheduled-tasks/runner.js');
  const root = await mkdtemp(join(tmpdir(), 'synthetic-scheduled-cleanup-'));
  const store = await ScheduledTaskStore.open(join(root, 'runtime.sqlite'));
  const task = store.create('synthetic', {
    title: 'Synthetic', prompt: 'Synthetic', projectAccess: 'project', sessionId: 'synthetic-chat', reuseChat: false,
    pinSession: false, model: null, schedule: { kind: 'once', startAt: '2026-10-06T11:00:00Z', timeZone: 'Europe/Prague' },
  }, Date.parse('2026-10-06T10:00:00Z'));
  let release = () => {}, entered = () => {};
  const sending = new Promise<void>(resolve => { entered = resolve; });
  const delivered = new Promise<void>(resolve => { release = resolve; });
  const runner = new ScheduledTaskRunner(store, {
    available: async () => true, createSession: async () => 'synthetic-chat',
    send: async () => { entered(); await delivered; },
  }, () => Date.parse('2026-10-06T11:05:00Z'));
  const stop = runner.start();
  try {
    await sending;
    let stopped = false;
    const stopping = Promise.resolve(stop()).then(() => { stopped = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(stopped).toBe(false);
    release(); await stopping;
    expect(store.runs(task.id)[0]?.status).toBe('sent');
  } finally { release(); await stop(); store.close(); await removeSyntheticTestDir(root); }
});

test('server shutdown drains accepted settings replies before releasing shared runtime handles', async () => {
  const fixture = await runtimeFixture();
  const previousAccount = process.env.LAWOSS_EIGENWELT_ACCOUNT;
  process.env.LAWOSS_EIGENWELT_ACCOUNT = '1';
  let release = () => {}, entered = () => {};
  const waiting = new Promise<void>(resolve => { release = resolve; });
  const fetching = new Promise<void>(resolve => { entered = resolve; });
  const request = spyOn(globalThis, 'fetch').mockImplementation(Object.assign(async (input: RequestInfo | URL) => {
    if (!String(input).endsWith('/api/desktop/settings')) return new Response(null, { status: 404 });
    entered(); await waiting;
    return Response.json({ revision: 0, sandbox: { enabled: false, networkMode: 'allow' } });
  }, { preconnect: globalThis.fetch.preconnect }));
  try {
    const { parseEigenweltEntitlements, eigenweltPlatformUrl } = await import('../../eigenwelt-auth.js');
    const { writeEigenweltConnection } = await import('../../eigenwelt-connection-store.js');
    await writeEigenweltConnection(fixture.config, {
      account: { userId: 'synthetic', orgId: 'synthetic', orgName: 'Synthetic', userName: null, userEmail: null },
      entitlements: parseEigenweltEntitlements({ plan: 'sync', subscriptionStatus: 'active', features: ['settings_presets'] }),
      platformURL: eigenweltPlatformUrl(), platformToken: 'synthetic', accessTokenExpiresAt: Date.now() + 3600000,
    });
    const server = await fixture.start();
    await fetching;
    let stopped = false;
    const stopping = Promise.resolve(server.stop()).then(() => { stopped = true; });
    await new Promise<void>(resolve => setImmediate(resolve));
    expect(stopped).toBe(false);
    release(); await stopping;
    for (const connection of fixture.connections) expect(() => connection.query('SELECT 1').get()).toThrow();
    for (const statement of fixture.statements) expect(() => statement.get()).toThrow();
    await removeSyntheticTestDir(fixture.root);
  } finally {
    release();
    await fixture.dispose();
    request.mockRestore();
    if (previousAccount === undefined) delete process.env.LAWOSS_EIGENWELT_ACCOUNT;
    else process.env.LAWOSS_EIGENWELT_ACCOUNT = previousAccount;
  }
});
