import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { permissionAction } from "../agent-sandbox/permissions.js";
import { legalworkRuntimeConfigFilePath, writeLegalworkRuntimeConfigFile } from "../legalwork-runtime-config.js";
import { GLOBAL_TOOL_PERMISSIONS_ID, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import type { ServerConfig } from "../types.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";
import { engineSettings, hasBundledPlugin } from "./test-support/native-config.js";
import { appendLawossToolDenials, LAWOSS_DENIED_UPSTREAM_TOOLS, LAWOSS_LOAD_WIKI_TOOLS, lawossToolDenialRules } from "./hidden-upstream-tools.js";

const roots: string[] = [];
let previousDb: string | undefined;

afterEach(async () => {
  // Windows: runtime.sqlite ostáva otvorená (EBUSY), removeTestDir ju nechá v %TEMP%.
  while (roots.length) await removeTestDir(roots.pop() ?? "");
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

type Rule = { action: string; resource: string; effect: "allow" | "deny" | "ask" };
const isRule = (value: unknown): value is Rule => isRecord(value) && typeof value.action === "string" && typeof value.resource === "string"
  && (value.effect === "allow" || value.effect === "deny" || value.effect === "ask");

/** Engine v2: ordered native rules (`permissions`). */
function rulesOf(value: unknown): Rule[] {
  if (!isRecord(value) || !Array.isArray(value.permissions) || !value.permissions.every(isRule)) throw new Error("permissions missing");
  return value.permissions;
}

test("S1: runtime config nenačíta plugin wiki", async () => {
  expect(LAWOSS_LOAD_WIKI_TOOLS).toBe(false);
  const config = await setup();
  const plugins = (await engineSettings(config, "ws_1")).plugins;
  expect(await hasBundledPlugin(plugins, "legalwork-wiki-tools")).toBe(false);
  // Ostatné pribalené pluginy ostávajú.
  expect(await hasBundledPlugin(plugins, "legalwork-calendar-tools")).toBe(true);
  expect(await hasBundledPlugin(plugins, "lawoss-view-tools")).toBe(true);
});

test("S2: zapisujúce nástroje upstreamu sú zamietnuté aj pri širokom povolení používateľa", async () => {
  const config = await setup();
  await writeRuntimeOpencodeConfig(config, GLOBAL_TOOL_PERMISSIONS_ID, (current) => ({
    ...current,
    permissions: [
      { action: "legalwork_calendar_create", resource: "*", effect: "allow" },
      { action: "wiki_*", resource: "*", effect: "allow" },
      { action: "*", resource: "*", effect: "allow" },
      { action: "shell", resource: "*", effect: "ask" },
    ],
  }));
  const parsed: Record<string, unknown> = { ...(await engineSettings(config, "ws_1")) };
  const rules = rulesOf(parsed);
  const lastIndex = (action: string) => rules.reduce((found, rule, index) => rule.action === action ? index : found, -1);
  for (const tool of LAWOSS_DENIED_UPSTREAM_TOOLS) {
    // Za pravidlami používateľa: engine berie posledné zhodné pravidlo.
    expect(lastIndex(tool)).toBeGreaterThan(lastIndex("*"));
    expect(rules[lastIndex(tool)]?.effect).toBe("deny");
  }
  // Upstream pravidlo pokynov projektu ostáva posledné.
  expect(rules.at(-1)?.action).toBe("legalwork_project_set_instructions");
  // Vyhodnotenie ako v engine: zástupné znaky zachytia nástroje wiki aj pohľadov.
  for (const tool of ["legalwork_calendar_create", "legalwork_schedule_delete", "legalwork_project_set_metadata", "wiki_write", "wiki_suggest"]) {
    expect(permissionAction(rules, tool, "*")).toBe("deny");
  }
  expect(permissionAction(rules, "view_create", "*")).toBe("allow");
  // Čítanie a ostatné nástroje sa nemenia.
  expect(permissionAction(rules, "legalwork_calendar_list", "*")).toBe("allow");
  expect(permissionAction(rules, "shell", "*")).toBe("ask");

  // Plánovaný beh nad všetkými projektami dedí zamietnutia (jeho pravidlá idú v engine až za globálnymi).
  const agents = parsed.agents;
  if (!isRecord(agents)) throw new Error("agents missing");
  const scheduled = rulesOf(agents["legalwork-scheduled-all"]);
  for (const tool of ["legalwork_schedule_create", "wiki_write"]) {
    expect(permissionAction(scheduled, tool, "*")).toBe("deny");
  }
  expect(permissionAction(rulesOf(agents["legalwork-scheduled-project"]), "legalwork_calendar_update", "*")).toBe("deny");
});

test("zamietnutie ide za pravidlo používateľa aj vo v2", () => {
  const rules: Rule[] = [{ action: "wiki_*", resource: "*", effect: "allow" }, { action: "*", resource: "*", effect: "allow" }, ...lawossToolDenialRules()];
  expect(permissionAction(rules, "wiki_read", "*")).toBe("deny");
});

test("v1 mapa: zamietnutie presunie existujúci kľúč na koniec", () => {
  const permission: Record<string, unknown> = { "wiki_*": "allow", "*": "allow" };
  appendLawossToolDenials(permission);
  const keys = Object.keys(permission);
  expect(keys.indexOf("wiki_*")).toBeGreaterThan(keys.indexOf("*"));
  expect(permission["wiki_*"]).toBe("deny");
});
