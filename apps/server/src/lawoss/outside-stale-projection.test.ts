// LAWOSS: starý vygenerovaný `.opencode/opencode.json` klienta outside (lawoss/outside-stale-projection.ts). Projekciu
// zapíše skutočný generátor servera (klient je najprv inside), potom sa klient prepne na outside a server pri
// publikovaní nastavení (aj pri štarte) odstráni len vlastnú projekciu; súbor advokáta ostane. Údaje sú syntetické.
import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { closeOrgPolicyRuntime } from "../org-policy.js";
import { runtimeDbPath } from "../runtime-db-lifecycle.js";
import { readLegalworkWorkspaceConfig } from "../legalwork-workspace-config-store.js";
import { writeLegalworkRuntimeConfigFile } from "../legalwork-runtime-config.js";
import type { ServerConfig } from "../types.js";
import { GENERATED_PROJECTION_HEADER, isGeneratedProjectionText, RETIRED_PROJECTION_DIR, retireOutsideProjection } from "./outside-stale-projection.js";
import { externalAppFilesRoot } from "./workspace-app-files.js";

const roots: string[] = [];
const cleanups: Array<() => unknown> = [];
let previousDb: string | undefined;
afterEach(async () => {
  while (cleanups.length) await cleanups.pop()?.();
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  if (previousDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = previousDb;
});

/** Klient Tatran s projekciou, ktorú server zapísal, kým bol inside. */
async function setup() {
  const temporary = await realpath(await mkdtemp(join(tmpdir(), "lawoss-outside-stale-")));
  roots.push(temporary);
  const client = join(temporary, "Klienti", "Tatran");
  await mkdir(client, { recursive: true });
  await writeFile(join(client, "zmluva.txt"), "Syntetická zmluva\n");
  previousDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_RUNTIME_DB = join(temporary, "runtime.sqlite");
  const config: ServerConfig = { configPath: join(temporary, "server.json"), host: "127.0.0.1", port: 0, token: "client", hostToken: "host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "ws_a", name: "Tatran", path: client, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [client], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const path = runtimeDbPath(config);
  cleanups.push(() => closeOrgPolicyRuntime(config, path));
  await writeLegalworkRuntimeConfigFile(config, "ws_a");
  const generated = join(client, ".opencode", "opencode.json");
  const bytes = await readFile(generated, "utf8");
  const workspace = config.workspaces[0]!;
  return { config, client, workspace, generated, bytes, outside: () => { workspace.appFiles = "outside"; } };
}

const copies = async (config: ServerConfig, workspace: ServerConfig["workspaces"][number]) =>
  readdir(join(externalAppFilesRoot(config, workspace), RETIRED_PROJECTION_DIR)).catch(() => []);

test("vlastnú projekciu (potvrdenie aj bez neho) server pri publikovaní odstráni a kópiu uloží do app files klienta", async () => {
  const { config, client, workspace, generated, bytes, outside } = await setup();
  expect(bytes.startsWith(GENERATED_PROJECTION_HEADER)).toBe(true);
  expect(isGeneratedProjectionText(config, bytes)).toBe(true);
  outside();
  await writeLegalworkRuntimeConfigFile(config, "ws_a");
  expect(existsSync(generated)).toBe(false);
  // Prázdny priečinok `.opencode` zmizne, súbory klienta ostanú.
  expect(await readdir(client)).toEqual(["zmluva.txt"]);
  const saved = await copies(config, workspace);
  expect(saved).toHaveLength(1);
  expect(await readFile(join(externalAppFilesRoot(config, workspace), RETIRED_PROJECTION_DIR, saved[0]!), "utf8")).toBe(bytes);
  expect(Reflect.get(Object((await readLegalworkWorkspaceConfig(config, "ws_a")).nativeEngineProject), "projection")).toBeUndefined();
  // Ďalšie publikovanie (napr. nový štart) už nič nerobí.
  await writeLegalworkRuntimeConfigFile(config, "ws_a");
  expect(await copies(config, workspace)).toHaveLength(1);

  // Bez súkromného potvrdenia (napr. iná databáza nastavení) rozhodne štruktúra a značka generátora.
  await mkdir(join(client, ".opencode"));
  await writeFile(generated, bytes);
  await writeFile(join(client, ".opencode", "opencode.jsonc"), bytes);
  expect(await retireOutsideProjection(config, workspace)).toEqual([generated, join(client, ".opencode", "opencode.jsonc")]);
  expect(await readdir(client)).toEqual(["zmluva.txt"]);
  expect((await copies(config, workspace)).sort()).toHaveLength(2);
});

test("súbor, ktorý napísal alebo zmenil advokát, ostane; klient inside sa nerieši", async () => {
  const { config, client, workspace, generated, bytes, outside } = await setup();
  // Klient inside: projekcia je jeho platný súbor.
  expect(await retireOutsideProjection(config, workspace)).toEqual([]);
  expect(await readFile(generated, "utf8")).toBe(bytes);
  outside();
  const parsed: unknown = JSON.parse(bytes.slice(GENERATED_PROJECTION_HEADER.length));
  const variants = {
    // Vlastný súbor advokáta.
    authored: JSON.stringify({ commands: { "a-vlastny": { template: "Vlastný príkaz", description: "Vlastný príkaz" } } }),
    // Projekcia s úpravou advokáta: iný formát, vlastný reťazec, poznámka navyše.
    reformatted: `${GENERATED_PROJECTION_HEADER}${JSON.stringify(parsed)}\n`,
    ownString: `${GENERATED_PROJECTION_HEADER}${JSON.stringify({ ...Object(parsed), model: "openai/gpt-5" }, null, 2)}\n`,
    comment: `${bytes}// poznámka advokáta\n`,
    // Značka bez odkazov do súkromnej knižnice.
    headerOnly: `${GENERATED_PROJECTION_HEADER}${JSON.stringify({ commands: {} }, null, 2)}\n`,
    foreignLibrary: `${GENERATED_PROJECTION_HEADER}${JSON.stringify({ agents: { legalwork: { system: "{file:/tmp/native-config-strings/x.txt}" } } }, null, 2)}\n`,
  };
  for (const [name, text] of Object.entries(variants)) {
    await writeFile(generated, text);
    await writeLegalworkRuntimeConfigFile(config, "ws_a");
    expect({ name, kept: await readFile(generated, "utf8") }).toEqual({ name, kept: text });
  }
  // Potvrdenie projekcie z čias klienta inside stále platí, ale bajty sa líšia: súbor ostal.
  expect(Reflect.get(Object((await readLegalworkWorkspaceConfig(config, "ws_a")).nativeEngineProject), "projection")).toMatchObject({ path: generated });
  // Odkaz (symlink) na projekciu sa neodstráni.
  await rm(generated);
  const elsewhere = join(client, "..", "projekcia.json");
  await writeFile(elsewhere, bytes);
  await symlink(elsewhere, generated);
  expect(await retireOutsideProjection(config, workspace)).toEqual([]);
  expect(await readFile(elsewhere, "utf8")).toBe(bytes);
  expect(await copies(config, workspace)).toEqual([]);
});
