// LAWOSS: rozpočet RAM 2 GB (issue #367, ADR 0017) so skutočným enginom v2 (LEGALWORK_TEST_OPENCODE_BIN = 2.1.4).
// Engine 2.1.4 lokáciu po uvoľnení (`DELETE /api/debug/location`) pri ďalšej požiadavke postaví bez aktivácie:
// agenti, príkazy a pluginy sú prázdne a vytvorenie povolenia vráti `deny`, kým ju neaktivuje `GET /api/model`.
// Appka si po prvom čítaní modelov pamätá, že lokácia je pripravená, preto server pri prijatí lokácie do rozpočtu
// najprv počká na jej aktiváciu. Údaje sú syntetické.
import { afterAll, afterEach, beforeAll, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";

import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { startRealEngineV2 } from "./lawoss/test-support/fake-engine-v2.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const saved = { budget: process.env.LAWOSS_ENGINE_MCP_INSTANCES, db: process.env.LEGALWORK_RUNTIME_DB };
const cleanups: (() => Promise<unknown> | unknown)[] = [];
beforeAll(() => { process.env.LAWOSS_ENGINE_MCP_INSTANCES = "1"; });
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
afterAll(() => {
  for (const [key, value] of [["LAWOSS_ENGINE_MCP_INSTANCES", saved.budget], ["LEGALWORK_RUNTIME_DB", saved.db]] as const) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
});

const list = z.object({ data: z.array(z.object({}).passthrough()) });
const names = (entries: z.infer<typeof list>["data"]) => entries.map((entry) => String(entry.name ?? entry.id)).sort();

test.skipIf(!binary)("engine v2: klient uvoľnený rozpočtom MCP po návrate dostane úplný katalóg aj rozhodnutie o povolení", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-engine-mcp-budget-released-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const a = join(root, "Klienti", "Tatran"), b = join(root, "Klienti", "Hron");
  await Promise.all([a, b].map((path) => mkdir(path, { recursive: true })));
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const engine = await startRealEngineV2(binary ?? "", join(root, "engine"), cleanups);
  const connection = { baseUrl: engine.url, opencodeUsername: engine.username, opencodePassword: engine.password };
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "client", hostToken: "host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [{ id: "ws_a", name: "Tatran", path: a, preset: "starter", workspaceType: "local", ...connection },
      { id: "ws_b", name: "Hron", path: b, preset: "starter", workspaceType: "local", ...connection }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const server = await startServer(config);
  cleanups.push(() => server.stop());
  const app = async (workspace: string, path: string, init?: RequestInit) => {
    const response = await fetch(`http://127.0.0.1:${server.port}/workspace/${workspace}/opencode${path}`,
      { ...init, headers: { Authorization: "Bearer client", "Content-Type": "application/json" } });
    const body: unknown = await response.json();
    expect(response.status, JSON.stringify(body)).toBe(200);
    return body;
  };
  const catalog = async (workspace: string) => ({
    agents: names(list.parse(await app(workspace, "/agent")).data),
    commands: names(list.parse(await app(workspace, "/command")).data),
    plugins: names(list.parse(await app(workspace, "/plugin")).data),
  });
  const permission = async (workspace: string, sessionID: string) => z.object({ data: z.object({ effect: z.string() }) }).parse(await app(workspace, `/session/${sessionID}/permission`,
    { method: "POST", body: JSON.stringify({ action: "read", resources: ["zmluva.txt"], agent: "build" }) })).data.effect;

  // Appka otvorí klienta A: prvé čítanie modelov (ensureNativeCatalogReady), potom katalóg.
  await app("ws_a", "/model");
  const before = await catalog("ws_a");
  expect(before.agents.length).toBeGreaterThan(0);
  expect(before.commands.length).toBeGreaterThan(0);
  expect(before.plugins.length).toBeGreaterThan(0);
  const sessionA = z.object({ data: z.object({ id: z.string() }) }).parse(await app("ws_a", "/session", { method: "POST", body: JSON.stringify({ title: "Tatran" }) })).data.id;
  expect(await permission("ws_a", sessionA)).toBe("allow");

  // Klient B: limit 1 uvoľní nečinnú lokáciu A.
  await app("ws_b", "/model");
  expect((await catalog("ws_b")).agents).toEqual(before.agents);

  // Návrat k A: appka model znova nečíta (lokáciu má za pripravenú), katalóg aj povolenie musia byť ako pred uvoľnením.
  expect(await catalog("ws_a")).toEqual(before);
  expect(await permission("ws_a", sessionA)).toBe("allow");

  // Limit drží: návrat k A uvoľnil B. Priamo v engine je B neaktivovaná (prázdni agenti); posledný krok, lebo ju dotkne.
  const direct = await fetch(`${engine.url}/api/agent?${new URLSearchParams({ "location[directory]": b })}`,
    { headers: { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` } });
  expect(list.parse(await direct.json()).data).toEqual([]);
}, 120_000);
