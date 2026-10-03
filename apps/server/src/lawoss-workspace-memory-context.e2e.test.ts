// Route GET /workspace/:id/lawoss/memory/context: kontext pamäte pre agenta (granty, profil, handoff) bez obsahu súborov.
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { externalAppFilesRoot, externalMemoryProfilePath } from "./lawoss/workspace-app-files.js";

const priorData = process.env.LEGALWORK_DATA_DIR, priorTokens = process.env.LEGALWORK_TOKEN_STORE;
const roots: string[] = [], stops: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  if (priorData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = priorData;
  if (priorTokens === undefined) delete process.env.LEGALWORK_TOKEN_STORE; else process.env.LEGALWORK_TOKEN_STORE = priorTokens;
});

async function fixture(appFiles?: "outside") {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-context-"))); roots.push(base);
  const root = join(base, "matter"), vault = join(base, "vault"); await mkdir(root); await mkdir(vault);
  process.env.LEGALWORK_DATA_DIR = join(base, "data"); process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  await writeFile(join(vault, "memory.md"), "SECRET-SOURCE-BODY");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "server.json"), token: "synthetic-client", hostToken: "synthetic-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "synthetic", name: "Synthetic", preset: "starter", path: root, workspaceType: "local", ...(appFiles ? { appFiles } : {}) }], authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config); stops.push(() => server.stop());
  const url = `http://127.0.0.1:${server.port}/workspace/synthetic`, headers = { authorization: "Bearer synthetic-client", "content-type": "application/json" };
  const context = async () => { const response = await fetch(`${url}/lawoss/memory/context`, { headers }); expect(response.status).toBe(200); const text = await response.text(); expect(text).not.toContain("SECRET-SOURCE-BODY"); return JSON.parse(text); };
  return { config, url, headers, context, vault, root };
}

test("context requires auth, a known workspace and follows the native runtime grant", async () => {
  const f = await fixture();
  expect((await fetch(`${f.url}/lawoss/memory/context`)).status).toBe(401);
  expect((await fetch(`${f.url.replace("synthetic", "unknown")}/lawoss/memory/context`, { headers: f.headers })).status).toBe(404);
  const before = await f.context();
  expect(before).toMatchObject({ authority: "runtime", workspaceId: "synthetic", folders: [] });
  expect(before).not.toHaveProperty("profile");
  expect(before).not.toHaveProperty("handoffRoot");
  expect((await fetch(`${f.url}/authorized-folders`, { method: "PUT", headers: f.headers, body: JSON.stringify({ folders: [f.vault] }) })).status).toBe(200);
  expect((await f.context()).folders).toEqual([f.vault]);
});

test("outside workspace exposes the host-selected profile and handoff root, also when the profile is missing", async () => {
  const f = await fixture("outside");
  const workspace = f.config.workspaces[0]!;
  const profilePath = externalMemoryProfilePath(f.config, workspace);
  if (!profilePath) throw new Error("outside workspace did not resolve a host profile path");
  const missing = await f.context();
  expect(missing.handoffRoot).toBe(externalAppFilesRoot(f.config, workspace));
  expect(missing.profile).toEqual({ profilePath, profileIdentity: "", profileGrants: [] });
  await mkdir(join(profilePath, ".."), { recursive: true });
  await writeFile(profilePath, JSON.stringify({ version: 1, matterId: "mapped", roots: [], sources: [] }));
  const present = await f.context();
  expect(present.profile.profileIdentity).toBe(await realpath(profilePath));
  expect(present.profile.profileGrants).toEqual([await realpath(join(profilePath, ".."))]);
});
