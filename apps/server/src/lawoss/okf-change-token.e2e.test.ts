// LAWOSS #460: odtlačok zmeny pre tichú obnovu prehľadu OKF. Úprava súboru na mieste aj nový súbor ho zmenia, nezmenený
// strom nie. Cesta mimo klienta a priečinok vnoreného iného klienta (#264) dostanú stály stav bez chyby. Údaje sú syntetické.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, utimes, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";

const previous = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE, db: process.env.LEGALWORK_RUNTIME_DB };
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: previous.data, LEGALWORK_TOKEN_STORE: previous.tokens, LEGALWORK_RUNTIME_DB: previous.db })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

const OLD = new Date("2026-01-01T00:00:00Z");
const NESTED = "Dcéra s.r.o.";

async function serve() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-okf-change-token-")));
  cleanups.push(() => removeTestDir(base));
  const client = join(base, "Klienti", "Tatran"), nested = join(client, NESTED);
  await mkdir(join(client, "Spisy", "M1"), { recursive: true });
  await mkdir(nested, { recursive: true });
  await writeFile(join(client, "client.md"), "---\ntitle: SYN Tatran\n---\n");
  await writeFile(join(client, "Spisy", "M1", "matter.md"), "---\ntitle: SYN vec\n---\n");
  await writeFile(join(nested, "client.md"), "---\ntitle: SYN Dcéra\n---\n");
  for (const path of [join(client, "Spisy", "M1", "matter.md"), join(client, "Spisy", "M1"), join(client, "Spisy"), client]) await utimes(path, OLD, OLD);
  process.env.LEGALWORK_DATA_DIR = join(base, "data"); process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(base, "private", "runtime.sqlite");
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => new URL(request.url).pathname === "/api/info" ? Response.json({ version: "2.1.4", pid: process.pid }) : Response.json({ data: [], cursor: {} }) });
  cleanups.push(() => engine.stop(true));
  const url = `http://127.0.0.1:${engine.port}`;
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "server.json"), token: "client", hostToken: "host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [{ id: "p", name: "Tatran", preset: "starter", path: client, workspaceType: "local", baseUrl: url }, { id: "n", name: "Dcéra", preset: "starter", path: nested, workspaceType: "local", baseUrl: url }],
    authorizedRoots: [client, nested], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config);
  cleanups.push(() => server.stop());
  const changeToken = (paths: unknown) => fetch(`http://127.0.0.1:${server.port}/workspace/p/lawoss/okf/change-token`, {
    method: "POST", headers: { authorization: "Bearer client", "content-type": "application/json" }, body: JSON.stringify({ paths }) });
  const token = async (paths: string[]) => { const response = await changeToken(paths); expect(response.status).toBe(200); return (await response.json()) as { token: string; newest: number }; };
  return { client, nested, changeToken, token };
}

const PATHS = ["", "Spisy", "Spisy/M1", "Spisy/M1/matter.md", "client.md", "Spisy/M1/memory"];

test("nezmenený strom má rovnaký odtlačok; úprava na mieste aj nový súbor ho zmenia", async () => {
  const { client, token } = await serve();
  const first = await token(PATHS);
  expect((await token(PATHS)).token).toBe(first.token);
  expect(first.newest).toBeGreaterThanOrEqual(OLD.getTime());

  const matter = join(client, "Spisy", "M1", "matter.md");
  await writeFile(matter, "---\ntitle: SYN vec zmenená\n---\n");
  await utimes(matter, OLD, new Date(OLD.getTime() + 60_000));
  await utimes(join(client, "Spisy", "M1"), OLD, OLD);
  const edited = await token(PATHS);
  expect(edited.token).not.toBe(first.token);
  expect(edited.newest).toBeGreaterThanOrEqual(OLD.getTime() + 60_000);

  await mkdir(join(client, "Spisy", "M1", "memory"));
  expect((await token(PATHS)).token).not.toBe(edited.token);
});

test("cesta mimo klienta a vnorený iný klient: stály stav bez chyby a bez prezradenia zmien", async () => {
  const { nested, token, changeToken } = await serve();
  const outside = ["../../outside.md", `${NESTED}/client.md`, NESTED];
  const before = await token(outside);
  await writeFile(join(nested, "client.md"), "---\ntitle: SYN Dcéra zmenená\n---\n");
  await writeFile(join(nested, "novy.md"), "x");
  const after = await token(outside);
  expect(after.token).toBe(before.token);
  expect(after.newest).toBe(0);
  expect((await changeToken(Array.from({ length: 20_001 }, (_, i) => `f${i}.md`))).status).toBe(400);
  expect((await changeToken("Spisy")).status).toBe(400);
});
