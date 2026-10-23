// Route POST /workspace/:id/lawoss/memory/read (LAWOSS alfa 2, N-A3-3): pamäť spisu cez nástroj lawoss_memory, bez shellu.
// Skutočný server: autorizácia, pripojený priečinok z natívneho zoznamu (PUT authorized-folders) a odmietnutie iného klienta.
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";
import { engineAgentSession } from "./lawoss/test-support/engine-agent.js";
import { LawossMemoryTools } from "./opencode-plugins/lawoss-memory-tools.js";

const priorData = process.env.LEGALWORK_DATA_DIR, priorTokens = process.env.LEGALWORK_TOKEN_STORE, priorDb = process.env.LEGALWORK_RUNTIME_DB;
const roots: string[] = [], stops: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0)) await removeTestDir(root);
  if (priorData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = priorData;
  if (priorTokens === undefined) delete process.env.LEGALWORK_TOKEN_STORE; else process.env.LEGALWORK_TOKEN_STORE = priorTokens;
  if (priorDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = priorDb;
});

const record = (id: string, truth: string) =>
  `---\nokf: 1\nid: ${id}\ntype: matter\ntitle: Stav ${id}\ndescription: SYN\nlayer: L2\njurisdiction: sk\nstatus: active\ncreated: 2026-10-23\nupdated: 2026-10-23\n---\n\n## Truth\n\n${truth}\n\n## History\n\n- 2026-10-23 — založené\n`;

async function matter(dir: string, id: string, truth: string) {
  await mkdir(join(dir, "memory"), { recursive: true });
  await writeFile(join(dir, "memory", `${id}.md`), record(id, truth));
}

test("only the chat's tool reads its case and linked-folder memory; another client and unlinked folders are refused", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-matter-memory-e2e-"))); roots.push(base);
  process.env.LEGALWORK_DATA_DIR = join(base, "data"); process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  await mkdir(join(base, "runtime"));
  const client = join(base, "K1"), other = join(base, "K2-Hron"), linked = join(base, "Zdielane", "K1-podklady");
  await matter(join(client, "Spisy", "M001"), "M-001", "SYN vlastný 1101");
  await matter(join(other, "Spisy", "M002"), "M-002", "SECRET-OTHER-2202");
  await matter(join(linked, "M003"), "M-003", "SYN pripojený 3303");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "runtime", "server.json"), token: "synthetic-client", hostToken: "synthetic-host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [
      { id: "k1", name: "K1", preset: "starter", path: client, workspaceType: "local" },
      { id: "k2", name: "K2", preset: "starter", path: other, workspaceType: "local" },
    ], authorizedRoots: [client, other], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  process.env.LEGALWORK_RUNTIME_DB = join(base, "runtime", "runtime.sqlite");
  const server = await startServer(config); stops.push(() => server.stop());
  const base_ = `http://127.0.0.1:${server.port}`, url = `${base_}/workspace/k1`;
  const headers = { authorization: "Bearer synthetic-client", "content-type": "application/json" };
  const body = (matterPath: string) => JSON.stringify({ action: "read", matter: matterPath });

  // Not the chat's credential: no token, and an ordinary client bearer token (even collaborator scope), are refused.
  expect((await fetch(`${url}/lawoss/memory/read`, { method: "POST", body: body(join(client, "Spisy", "M001")) })).status).toBe(401);
  const bearer = await fetch(`${url}/lawoss/memory/read`, { method: "POST", headers, body: body(join(client, "Spisy", "M001")) });
  expect(bearer.status).toBe(403);
  expect(await bearer.text()).not.toContain("SYN vlastný");

  // The chat's tool, with the engine credential bound to this client's folder.
  const previousUrl = process.env.LEGALWORK_SERVER_URL;
  process.env.LEGALWORK_SERVER_URL = base_;
  const agent = await engineAgentSession(config, { sessionID: "ses_memory", directory: client });
  stops.push(() => { agent.restore(); if (previousUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = previousUrl; });
  const tool = (await LawossMemoryTools()).tool.lawoss_memory;
  const read = async (matter: string) => JSON.parse(await tool.execute({ action: "read", matter }, { ...agent.context, ask: async () => { throw new Error("no card expected"); } }));

  expect(await read("Spisy/M001")).toMatchObject({ complete: true, text: expect.stringContaining("SYN vlastný 1101"), untrusted: true });
  const foreign = await read(join(other, "Spisy", "M002"));
  expect(foreign.error).toContain("403");
  expect(JSON.stringify(foreign)).not.toContain("SECRET-OTHER");
  expect(JSON.stringify(foreign)).not.toContain("Hron");

  // Unlinked: refused. Linked through the native list: read.
  expect((await read(join(linked, "M003"))).error).toContain("403");
  expect((await fetch(`${url}/authorized-folders`, { method: "PUT", headers, body: JSON.stringify({ folders: [linked] }) })).status).toBe(200);
  expect((await read(join(linked, "M003"))).text).toContain("SYN pripojený 3303");
});
