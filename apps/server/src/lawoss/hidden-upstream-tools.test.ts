import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { permissionAction } from "../agent-sandbox/permissions.js";
import { legalworkRuntimeConfigFilePath, writeLegalworkRuntimeConfigFile } from "../legalwork-runtime-config.js";
import { GLOBAL_TOOL_PERMISSIONS_ID, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { appendLawossToolDenials, LAWOSS_DENIED_UPSTREAM_TOOLS, LAWOSS_LOAD_WIKI_TOOLS } from "./hidden-upstream-tools.js";

const roots: string[] = [];
let previousDb: string | undefined;

afterEach(async () => {
  while (roots.length) await rm(roots.pop() ?? "", { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB;
  else process.env.LEGALWORK_RUNTIME_DB = previousDb;
});

async function setup(): Promise<ServerConfig> {
  const root = await mkdtemp(join(tmpdir(), "lawoss-hidden-upstream-tools-"));
  roots.push(root);
  previousDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  return {
    host: "127.0.0.1",
    port: 0,
    token: "owt_test_token",
    hostToken: "owt_host_token",
    approval: { mode: "auto", timeoutMs: 1000 },
    corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root],
    readOnly: false,
    startedAt: Date.now(),
    tokenSource: "cli",
    hostTokenSource: "cli",
    logFormat: "pretty",
    logRequests: false,
  };
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

async function readRuntimeConfig(config: ServerConfig): Promise<Record<string, unknown>> {
  const parsed: unknown = JSON.parse(await readFile(legalworkRuntimeConfigFilePath(config), "utf8"));
  if (!isRecord(parsed)) throw new Error("runtime config is not an object");
  return parsed;
}

function permissionOf(value: unknown): Record<string, unknown> {
  if (!isRecord(value) || !isRecord(value.permission)) throw new Error("permission config missing");
  return value.permission;
}

test("S1: runtime config nenačíta plugin wiki", async () => {
  expect(LAWOSS_LOAD_WIKI_TOOLS).toBe(false);
  const config = await setup();
  await writeLegalworkRuntimeConfigFile(config, "ws_1");
  const plugins = (await readRuntimeConfig(config)).plugin;
  if (!Array.isArray(plugins)) throw new Error("plugin list missing");
  expect(plugins.some((spec) => typeof spec === "string" && spec.includes("legalwork-wiki-tools"))).toBe(false);
  // Ostatné pribalené pluginy ostávajú.
  expect(plugins.some((spec) => typeof spec === "string" && spec.includes("legalwork-calendar-tools"))).toBe(true);
});

test("S2: zapisujúce nástroje upstreamu sú zamietnuté aj pri širokom povolení používateľa", async () => {
  const config = await setup();
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, (current) => ({
    ...current,
    permission: { legalwork_calendar_create: "allow", "wiki_*": "allow", "*": "allow", bash: "ask" },
  }));
  await writeLegalworkRuntimeConfigFile(config, "ws_1");
  const parsed = await readRuntimeConfig(config);
  const permission = permissionOf(parsed);
  const keys = Object.keys(permission);
  for (const tool of LAWOSS_DENIED_UPSTREAM_TOOLS) {
    expect(permission[tool]).toBe("deny");
    // Za pravidlami používateľa: engine berie posledné zhodné pravidlo.
    expect(keys.indexOf(tool)).toBeGreaterThan(keys.indexOf("*"));
  }
  // Upstream pravidlo pokynov projektu ostáva posledné.
  expect(keys.at(-1)).toBe("legalwork_project_set_instructions");
  // Vyhodnotenie ako v engine: zástupné znaky zachytia nástroje wiki aj pohľadov.
  for (const tool of ["legalwork_calendar_create", "legalwork_schedule_delete", "legalwork_project_set_metadata", "wiki_write", "wiki_suggest", "view_create", "view_update"]) {
    expect(permissionAction(permission, tool, "*")).toBe("deny");
  }
  // Čítanie a ostatné nástroje sa nemenia.
  expect(permissionAction(permission, "legalwork_calendar_list", "*")).toBe("allow");
  expect(permissionAction(permission, "bash", "*")).toBe("ask");

  // Plánovaný beh nad všetkými projektami dedí zamietnutia (jeho pravidlá idú v engine až za globálnymi).
  const agents = parsed.agent;
  if (!isRecord(agents)) throw new Error("agents missing");
  const scheduled = permissionOf(agents["legalwork-scheduled-all"]);
  for (const tool of ["legalwork_schedule_create", "wiki_write", "view_create"]) {
    expect(permissionAction(scheduled, tool, "*")).toBe("deny");
  }
  expect(permissionAction(permissionOf(agents["legalwork-scheduled-project"]), "legalwork_calendar_update", "*")).toBe("deny");
});

test("zamietnutie presunie existujúci kľúč na koniec", () => {
  const permission: Record<string, unknown> = { "view_*": "allow", "*": "allow" };
  appendLawossToolDenials(permission);
  const keys = Object.keys(permission);
  expect(keys.indexOf("view_*")).toBeGreaterThan(keys.indexOf("*"));
  expect(permissionAction(permission, "view_read", "*")).toBe("deny");
});
