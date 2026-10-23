// Route POST /workspace/:id/lawoss/memory/read (LAWOSS alfa 2, N-A3-3): pamäť spisu cez nástroj lawoss_memory, bez shellu.
// Skutočný server: autorizácia, pripojený priečinok z natívneho zoznamu (PUT authorized-folders) a odmietnutie iného klienta.
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";

const priorData = process.env.LEGALWORK_DATA_DIR, priorTokens = process.env.LEGALWORK_TOKEN_STORE;
const roots: string[] = [], stops: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0)) await removeTestDir(root);
  if (priorData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = priorData;
  if (priorTokens === undefined) delete process.env.LEGALWORK_TOKEN_STORE; else process.env.LEGALWORK_TOKEN_STORE = priorTokens;
});

const record = (id: string, truth: string) =>
  `---\nokf: 1\nid: ${id}\ntype: matter\ntitle: Stav ${id}\ndescription: SYN\nlayer: L2\njurisdiction: sk\nstatus: active\ncreated: 2026-10-23\nupdated: 2026-10-23\n---\n\n## Truth\n\n${truth}\n\n## History\n\n- 2026-10-23 — založené\n`;

async function matter(dir: string, id: string, truth: string) {
  await mkdir(join(dir, "memory"), { recursive: true });
  await writeFile(join(dir, "memory", `${id}.md`), record(id, truth));
}

test("the chat's client reads its case and linked-folder memory; another client and unlinked folders are refused", async () => {
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
  const server = await startServer(config); stops.push(() => server.stop());
  const url = `http://127.0.0.1:${server.port}/workspace/k1`, headers = { authorization: "Bearer synthetic-client", "content-type": "application/json" };
  const read = (matterPath: string, action = "read") => fetch(`${url}/lawoss/memory/read`, { method: "POST", headers, body: JSON.stringify({ action, matter: matterPath }) });

  expect((await fetch(`${url}/lawoss/memory/read`, { method: "POST", body: "{}" })).status).toBe(401);
  const own = await read(join(client, "Spisy", "M001"));
  expect(own.status).toBe(200);
  expect(await own.json()).toMatchObject({ complete: true, text: expect.stringContaining("SYN vlastný 1101"), untrusted: true });

  const foreign = await read(join(other, "Spisy", "M002"));
  expect(foreign.status).toBe(403);
  const foreignText = await foreign.text();
  expect(foreignText).not.toContain("SECRET-OTHER");
  expect(foreignText).not.toContain("Hron");

  // Unlinked: refused. Linked through the native list: read.
  expect((await read(join(linked, "M003"))).status).toBe(403);
  expect((await fetch(`${url}/authorized-folders`, { method: "PUT", headers, body: JSON.stringify({ folders: [linked] }) })).status).toBe(200);
  const viaLink = await read(join(linked, "M003"));
  expect(viaLink.status).toBe(200);
  expect((await viaLink.json()).text).toContain("SYN pripojený 3303");
});
