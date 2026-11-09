// LAWOSS: zoznam pluginov enginu pred syncom na OpenCode 2 (v0.3.0, ADR 0016) a dôkaz, že ich
// ZOSTAVENÝ balík aj konfigurácia enginu po porte na API v2 obsahujú. Upstream builder
// (`scripts/build-opencode-plugins.ts`) zmaže `dist/opencode-plugins` a zostaví len svoj zoznam.
// Test beží nad výsledkom `pnpm --filter legalwork-server build` (ako CI po builde servera).
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, readFile, realpath, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { isAbsolute, join } from "node:path";
import { pathToFileURL } from "node:url";
import { buildLegalworkRuntimeConfigObject, mandatoryRuntimeConfigFilePath, writeLegalworkRuntimeConfigFile } from "../legalwork-runtime-config.js";
import { legalworkPluginPath } from "../legalwork-extensions-plugin-path.js";
import type { ServerConfig } from "../types.js";
import { LAWOSS_PLUGIN_NAMES } from "./engine-plugin-names.js";

/** Pred mergom (8e5bd583b): vstupy `apps/server/src/opencode-plugins/lawoss-*.ts` v builde servera a v konfigurácii enginu. */
const BEFORE_MERGE_ENTRIES = ["lawoss-okf-handoff", "lawoss-linked-folders", "lawoss-file-operations", "lawoss-memory-tools", "lawoss-view-tools"];
/** Pomocníci bez vlastného vstupu, ktoré sa zbalia do pluginov, čo ich importujú. */
const BEFORE_MERGE_HELPERS = ["lawoss-editor-approval", "lawoss-file-paths", "lawoss-file-operations-text"];
/** Balík npm v1, ktorý LAWOSS registroval navyše (rozhodnutie MČ: prihlásenie Anthropic ostáva). Engine v2 ho
 * nenačíta a cieľ bez absolútnej cesty by pri štarte inštaloval z npm (`core/src/plugin/module.ts`, `npm.add`);
 * nahrádza ho pribalený port `lawoss-anthropic-auth`. */
const NPM_PLUGIN = "opencode-anthropic-auth";
/** Pluginy LAWOSS pridané pri porte na v2 (nemali vstup v builde pred mergom). */
const V2_ENTRIES = ["lawoss-anthropic-auth"];
const ENTRIES = [...BEFORE_MERGE_ENTRIES, ...V2_ENTRIES];

const cleanup: Array<() => Promise<unknown>> = [];
const previousDb = process.env.LEGALWORK_RUNTIME_DB;
afterEach(async () => {
  while (cleanup.length) await cleanup.pop()?.();
  if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
});

test("každý plugin LAWOSS spred mergu ostáva vstupom buildu, port prihlásenia Anthropic pribudol", () => {
  expect([...LAWOSS_PLUGIN_NAMES].map(String).sort()).toEqual([...ENTRIES].sort());
});

test.each(ENTRIES)("zostavený balík obsahuje %s ako natívny plugin v2 (Plugin.define)", async name => {
  const entry = legalworkPluginPath(name);
  expect(entry.endsWith(join("dist", "opencode-plugins", name, "index.js"))).toBe(true);
  expect((await stat(entry)).isFile()).toBe(true);
  const source = await readFile(entry, "utf8");
  // Engine v2 dodá len @opencode/plugin a effect; nič iné nesmie zostať ako holý import.
  const bare = new Bun.Transpiler({ loader: "js" }).scanImports(source).map(item => item.path)
    .filter(specifier => !specifier.startsWith("node:") && !specifier.startsWith(".") && !/^(?:@opencode\/plugin|effect)(?:\/|$)/.test(specifier));
  expect(bare).toEqual([]);
  for (const helper of BEFORE_MERGE_HELPERS) expect(source).not.toContain(`./${helper}.js`);
  // v2 loader (core/src/plugin/module.ts) vyžaduje default export s id a setup alebo effect.
  const loaded: unknown = (await import(pathToFileURL(entry).href)).default;
  expect(loaded).toMatchObject({ id: expect.any(String) });
  const definition = loaded !== null && typeof loaded === "object" ? loaded : {};
  expect(("setup" in definition && typeof definition.setup === "function") || ("effect" in definition && typeof definition.effect === "function")).toBe(true);
});

test("konfigurácia enginu zaregistruje každý plugin LAWOSS a prihlásenie Anthropic bez npm", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-plugin-inventory-")));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], authorizedRoots: [root], readOnly: false, startedAt: Date.now(),
    tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
    workspaces: [{ id: "ws_1", name: "Klient", path: root, preset: "starter", workspaceType: "local" }],
  };
  const built = await buildLegalworkRuntimeConfigObject(config, "ws_1");
  // LAWOSS: lawoss-linked-folders is a mandatory plugin after legalwork-managed-config (hook order).
  await writeLegalworkRuntimeConfigFile(config, "ws_1");
  const mandatory: unknown = JSON.parse(await readFile(mandatoryRuntimeConfigFilePath(config), "utf8"));
  const mandatoryPlugins = mandatory !== null && typeof mandatory === "object" && "plugins" in mandatory && Array.isArray(mandatory.plugins) ? mandatory.plugins : [];
  const plugins = [...(Array.isArray(built.plugins) ? built.plugins : []), ...mandatoryPlugins];
  const targets = plugins.map((plugin: unknown) => typeof plugin === "string" ? plugin
    : plugin !== null && typeof plugin === "object" && "package" in plugin && typeof plugin.package === "string" ? plugin.package : "")
    // `-<id>` je direktíva enginu, ktorá vypne vstavaný plugin (napr. `-opencode.config.command`), nie cieľ inštalácie.
    .filter(target => !target.startsWith("-"));
  // Každý cieľ je pribalený priečinok: engine pri štarte nič nesťahuje z npm.
  expect(targets).not.toContain(NPM_PLUGIN);
  expect(targets.filter(target => !isAbsolute(target))).toEqual([]);
  const bundled = await Promise.all(targets.map(async target => readFile(join(target, "index.js"), "utf8")));
  for (const name of ENTRIES) {
    const original = await readFile(legalworkPluginPath(name), "utf8");
    expect([name, bundled.includes(original)]).toEqual([name, true]);
  }
});
