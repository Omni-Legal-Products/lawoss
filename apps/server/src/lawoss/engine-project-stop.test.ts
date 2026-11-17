import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runtimeStorageDir } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { ENGINE_PROJECT_STOP_ENV, engineProjectStopEnv, engineProjectStopRoots } from "./engine-project-stop.js";
import { officeProfilePath } from "./linked-folders.js";

const roots: string[] = [];
const prior = process.env.LEGALWORK_DATA_DIR;
afterEach(async () => {
  if (prior === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = prior;
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

const workspace = (id: string, path: string, preset = "starter"): ServerConfig["workspaces"][number] => ({ id, name: id, path, preset, workspaceType: "local" });
function serverConfig(root: string, workspaces: ServerConfig["workspaces"]): ServerConfig {
  return {
    host: "127.0.0.1", port: 0, configPath: join(root, "server", "server.json"), token: "owt_project_stop", hostToken: "owt_project_stop_host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces, authorizedRoots: workspaces.map((item) => item.path),
    readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
}

test("#530: korene prechodu enginu sú miestne priestory, koreň praxe a pracovný priečinok enginu, v zápise aj ako skutočná cesta", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-project-stop-")));
  roots.push(root);
  process.env.LEGALWORK_DATA_DIR = join(root, "data");
  const practice = join(root, "prax"), client = join(practice, "Klienti", "Alfa"), outside = join(root, "Inde", "Beta");
  const link = join(root, "odkaz-beta"), engineHome = join(root, "engine-home");
  await Promise.all([mkdir(join(practice, "Office"), { recursive: true }), mkdir(client, { recursive: true }), mkdir(outside, { recursive: true }), mkdir(engineHome)]);
  await symlink(outside, link);
  const config = serverConfig(root, [workspace("ws_alfa", client), workspace("ws_beta", link), workspace("ws_wiki", join(root, "wiki"), "wiki"),
    workspace("ws_bez_cesty", "")]);

  // Without an office profile: workspaces and the engine's working folder only.
  expect(await engineProjectStopRoots(config, engineHome)).toEqual([client, link, outside, join(root, "wiki"), engineHome]);

  await mkdir(join(runtimeStorageDir(config), "lawoss-onboarding"), { recursive: true });
  await writeFile(officeProfilePath(config), JSON.stringify({ officeRoot: join(practice, "Office"), jurisdiction: "sk" }));
  const stops = await engineProjectStopRoots(config, engineHome);
  // The practice root (not its Office folder) bounds clients founded after the engine started.
  expect(stops).toContain(practice);
  expect(stops).not.toContain(join(practice, "Office"));
  expect(JSON.parse((await engineProjectStopEnv(config, engineHome))[ENGINE_PROJECT_STOP_ENV]!)).toEqual(stops);
});
