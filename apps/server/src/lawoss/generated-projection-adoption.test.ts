// LAWOSS #439: vlastná projekcia `.opencode/opencode.json` po strate súkromného potvrdenia (reinštalácia, reset dát,
// nový kontajner, ten istý priečinok na druhom počítači). Projekciu zapíše skutočný generátor servera, potom sa potvrdenie
// stratí a advokát má popri nej vlastný `opencode.jsonc`. Údaje sú syntetické.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { engineProjectStatus } from "../engine-project.js";
import { closeOrgPolicyRuntime } from "../org-policy.js";
import { runtimeDbPath } from "../runtime-db-lifecycle.js";
import { writeLegalworkWorkspaceConfig } from "../legalwork-workspace-config-store.js";
import { writeLegalworkRuntimeConfigFile } from "../legalwork-runtime-config.js";
import type { ServerConfig } from "../types.js";

const roots: string[] = [];
const cleanups: Array<() => unknown> = [];
let previousDb: string | undefined;
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
});

const AUTHORED = `// Advokát\n{ "instructions": ["pokyny.md"] }\n`;

async function setup(withAuthored = true) {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "lawoss-projection-adoption-")));
  roots.push(temporary);
  const client = join(temporary, "Klienti", "Tatran");
  await mkdir(client, { recursive: true });
  previousDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(temporary, "runtime.sqlite");
  const config: ServerConfig = { configPath: join(temporary, "server.json"), host: "127.0.0.1", port: 0, token: "client", hostToken: "host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "ws_a", name: "Tatran", path: client, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [client], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  cleanups.push(() => closeOrgPolicyRuntime(config, runtimeDbPath(config)));
  await writeLegalworkRuntimeConfigFile(config, "ws_a");
  const workspace = config.workspaces[0]!;
  const generated = join(client, ".opencode", "opencode.json");
  const authored = join(client, ".opencode", "opencode.jsonc");
  if (withAuthored) await writeFile(authored, AUTHORED);
  await writeLegalworkWorkspaceConfig(config, workspace.id, ({ nativeEngineProject: _lost, ...rest }) => rest);
  return { config, workspace, generated, authored };
}

test("bez potvrdenia server vlastnú projekciu prevezme a autorský súbor nechá tak", async () => {
  const { config, workspace, generated, authored } = await setup();
  await writeLegalworkRuntimeConfigFile(config, "ws_a");
  const status = await engineProjectStatus(config, workspace);
  expect(status.projection.diagnostic).toBeUndefined();
  expect(status.state).toBe("ready");
  expect(status.projection.path).toBe(generated);
  expect(await readFile(authored, "utf8")).toBe(AUTHORED);
});

test("upravenú projekciu bez potvrdenia server za vlastnú nepovažuje", async () => {
  const { config, workspace, generated, authored } = await setup();
  const edited = (await readFile(generated, "utf8")).replace("{\n", `{\n  "username": "advokat",\n`);
  await writeFile(generated, edited);
  await writeLegalworkRuntimeConfigFile(config, "ws_a");
  const status = await engineProjectStatus(config, workspace);
  expect(status.state).toBe("configuration_conflict");
  expect(await readFile(generated, "utf8")).toBe(edited);
  expect(await readFile(authored, "utf8")).toBe(AUTHORED);
});

test("bez potvrdenia a bez autorského súboru server nezapíše druhú projekciu vedľa svojej starej", async () => {
  const { config, workspace, generated } = await setup(false);
  await writeLegalworkRuntimeConfigFile(config, "ws_a");
  const status = await engineProjectStatus(config, workspace);
  expect(status.state).toBe("ready");
  expect(status.projection.path).toBe(generated);
  expect(await readdir(join(generated, ".."))).toEqual(["opencode.json"]);
});
