// LAWOSS #415: kancelária z onboardingu appky nemá okf.config a karty klientov jurisdikciu nenesú. Engine dostane cestu
// k profilu kancelárie a CLI `okf` z neho vezme jurisdikciu nového prípadu bez otázky na advokáta.
import { afterEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rm, stat, symlink, utimes, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { runtimeStorageDir } from "../runtime-opencode-config-store.js";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { officeProfileEnv, officeRoot } from "./linked-folders.js";
import { LEGACY_OFFICE_FACTS_FILE, OFFICE_FACTS_FILE, officeFactsContent, refreshAllOfficeFacts, refreshOfficeFacts, writeOfficeFacts } from "./office-facts.js";

const roots: string[] = [];
const prior = process.env.LEGALWORK_DATA_DIR;
afterEach(async () => {
  if (prior === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = prior;
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

test("#415: engine dostane cestu k profilu onboardingu a CLI z neho vezme jurisdikciu kancelárie bez okf.config", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-office-profile-")));
  roots.push(root);
  process.env.LEGALWORK_DATA_DIR = join(root, "data");
  const practice = join(root, "prax"), client = join(practice, "Klienti", "Alfa");
  await mkdir(join(practice, "Office", "memory"), { recursive: true });
  await writeFile(join(practice, "Office", "AGENTS.md"), "# Kancelária\n");
  await mkdir(client, { recursive: true });
  await writeFile(join(client, "client.md"), "---\ntype: klient\ntitle: Alfa\n---\n");
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(root, "server", "server.json"), token: "owt_office_profile", hostToken: "owt_office_profile_host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: Date.now(),
    tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const env = officeProfileEnv(config);
  // The same file onboarding writes (`<runtimeStorage>/lawoss-onboarding/profile.json`) and `officeRoot` reads.
  expect(env.LAWOSS_OFFICE_PROFILE).toBe(join(runtimeStorageDir(config), "lawoss-onboarding", "profile.json"));
  // The bundled CLI the novy-spis skill runs, with the engine's environment: a new case without --sk/--cz.
  const cli = fileURLToPath(new URL("../../../../lawoss/okf/bundle/okf.js", import.meta.url));
  const okf = (command: "plan" | "apply", extra: Record<string, string>) => spawnSync("node", [cli, command, "spis", "--title", "Spor", "--date", "2026-11-15"],
    { cwd: client, encoding: "utf8", env: { ...process.env, LAWOSS_OFFICE_PROFILE: "", ...extra } });
  expect(okf("plan", env).status).toBe(2);
  await mkdir(join(runtimeStorageDir(config), "lawoss-onboarding"), { recursive: true });
  await writeFile(env.LAWOSS_OFFICE_PROFILE, JSON.stringify({ officeRoot: join(practice, "Office"), jurisdiction: "sk", language: "sk" }));
  expect(await officeRoot(config)).toBe(join(practice, "Office"));
  expect(okf("plan", {}).status).toBe(2);
  expect(okf("apply", env).status).toBe(0);
  expect(await readFile(join(client, "Spisy", "2026-11 Spor", "matter.md"), "utf8")).toMatch(/^jurisdiction: "?sk"?$/m);
});

test("#415: .office.json vedľa okf.js klientov z profilu kancelárie; CLI ho použije bez premennej prostredia", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-office-facts-")));
  roots.push(root);
  process.env.LEGALWORK_DATA_DIR = join(root, "data");
  const practice = join(root, "prax"), client = join(practice, "Klienti", "Alfa"), outside = join(root, "Inde", "Beta");
  await mkdir(join(practice, "Office", "memory"), { recursive: true });
  await writeFile(join(practice, "Office", "AGENTS.md"), "# Kancelária\n");
  const cliSource = await readFile(fileURLToPath(new URL("../../../../lawoss/okf/bundle/okf.js", import.meta.url)));
  for (const folder of [client, outside]) {
    await mkdir(join(folder, ".opencode", "skills", "novy-spis", "resources"), { recursive: true });
    await mkdir(join(folder, ".opencode", "skills", "okf-pamat", "resources"), { recursive: true });
    await writeFile(join(folder, ".opencode", "skills", "novy-spis", "resources", "okf.js"), cliSource);
    await writeFile(join(folder, "client.md"), "---\ntype: klient\ntitle: Klient\n---\n");
  }
  const workspace = (id: string, path: string) => ({ id, name: id, path, preset: "starter", workspaceType: "local" as const });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(root, "server", "server.json"), token: "owt_office_facts", hostToken: "owt_office_facts_host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [workspace("ws_alfa", client), workspace("ws_beta", outside)],
    authorizedRoots: [client, outside], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const facts = (folder: string, skill = "novy-spis") => join(folder, ".opencode", "skills", skill, "resources", OFFICE_FACTS_FILE);
  // Without a profile nothing is written.
  await refreshAllOfficeFacts(config);
  expect(await stat(facts(client)).catch(() => null)).toBeNull();
  await mkdir(join(runtimeStorageDir(config), "lawoss-onboarding"), { recursive: true });
  await writeFile(officeProfileEnv(config).LAWOSS_OFFICE_PROFILE, JSON.stringify({ officeRoot: join(practice, "Office"), jurisdiction: "sk" }));
  await refreshAllOfficeFacts(config);
  expect(await readFile(facts(client), "utf8")).toBe(officeFactsContent("sk"));
  // Only next to okf.js, only for a client of this practice; an unchanged file is not rewritten.
  expect(await stat(facts(client, "okf-pamat")).catch(() => null)).toBeNull();
  expect(await stat(facts(outside)).catch(() => null)).toBeNull();
  expect(await refreshOfficeFacts(config, config.workspaces[0]!)).toBe(0);

  // The deployed CLI in the client folder, with an environment that has no LAWOSS variable (as the server's shells).
  const env = { ...process.env };
  delete env.LAWOSS_OFFICE_PROFILE;
  const cli = join(client, ".opencode", "skills", "novy-spis", "resources", "okf.js");
  const applied = spawnSync("node", [cli, "apply", "spis", "--title", "Spor", "--date", "2026-11-15"], { cwd: client, encoding: "utf8", env });
  expect(applied.status).toBe(0);
  expect(await readFile(join(client, "Spisy", "2026-11 Spor", "matter.md"), "utf8")).toMatch(/^jurisdiction: "?sk"?$/m);

  // A changed profile rewrites it; a client that leaves the practice loses it; a link in its place is replaced, not followed.
  await writeFile(officeProfileEnv(config).LAWOSS_OFFICE_PROFILE, JSON.stringify({ officeRoot: join(practice, "Office"), jurisdiction: "cz" }));
  await refreshAllOfficeFacts(config);
  expect(await readFile(facts(client), "utf8")).toBe(officeFactsContent("cz"));
  const elsewhere = join(root, "elsewhere.json");
  await writeFile(elsewhere, "keep");
  await rm(facts(client));
  await symlink(elsewhere, facts(client));
  expect(await writeOfficeFacts(client, "sk")).toBe(1);
  expect(await readFile(elsewhere, "utf8")).toBe("keep");
  expect((await lstat(facts(client))).isSymbolicLink()).toBe(false);
  await mkdir(join(root, "Iná", "Office"), { recursive: true });
  await writeFile(officeProfileEnv(config).LAWOSS_OFFICE_PROFILE, JSON.stringify({ officeRoot: join(root, "Iná", "Office"), jurisdiction: "sk" }));
  await refreshAllOfficeFacts(config);
  expect(await stat(facts(client)).catch(() => null)).toBeNull();
});

test("#415: .office.json sa nezobrazí medzi prostriedkami skillu; starý office.json appky a staré dočasné súbory zmiznú", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-office-facts-migrate-")));
  roots.push(root);
  process.env.LEGALWORK_DATA_DIR = join(root, "data");
  const practice = join(root, "prax"), client = join(practice, "Klienti", "Alfa"), other = join(practice, "Klienti", "Beta");
  await mkdir(join(practice, "Office"), { recursive: true });
  const resources = (folder: string) => join(folder, ".opencode", "skills", "novy-spis", "resources");
  for (const folder of [client, other]) {
    await mkdir(resources(folder), { recursive: true });
    await writeFile(join(resources(folder), "okf.js"), "// SYN\n");
  }
  // Written by the app before: exactly its own shape goes, anything else of the lawyer's stays.
  await writeFile(join(resources(client), LEGACY_OFFICE_FACTS_FILE), JSON.stringify({ jurisdiction: "cz" }));
  await writeFile(join(resources(other), LEGACY_OFFICE_FACTS_FILE), JSON.stringify({ jurisdiction: "sk", office: "SYN" }));
  const stale = join(resources(client), `${OFFICE_FACTS_FILE}.00000000-0000-4000-8000-000000000000.tmp`);
  const fresh = join(resources(client), `${OFFICE_FACTS_FILE}.11111111-1111-4111-8111-111111111111.tmp`);
  await writeFile(stale, "x"); await writeFile(fresh, "x");
  await utimes(stale, new Date(Date.now() - 3_600_000), new Date(Date.now() - 3_600_000));
  // The profile and the client are stored through a link: real paths decide, so the file is written, not removed.
  await symlink(practice, join(root, "odkaz"));
  const workspace = (id: string, path: string) => ({ id, name: id, path, preset: "starter", workspaceType: "local" as const });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(root, "server", "server.json"), token: "owt_office_facts_m", hostToken: "owt_office_facts_m_host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [workspace("ws_alfa", join(root, "odkaz", "Klienti", "Alfa")), workspace("ws_beta", other)],
    authorizedRoots: [client, other], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  await mkdir(join(runtimeStorageDir(config), "lawoss-onboarding"), { recursive: true });
  await writeFile(officeProfileEnv(config).LAWOSS_OFFICE_PROFILE, JSON.stringify({ officeRoot: join(root, "odkaz", "Office"), jurisdiction: "sk" }));
  await refreshAllOfficeFacts(config);
  expect(await readFile(join(resources(client), OFFICE_FACTS_FILE), "utf8")).toBe(officeFactsContent("sk"));
  expect((await readdir(resources(client))).sort()).toEqual([OFFICE_FACTS_FILE, `${OFFICE_FACTS_FILE}.11111111-1111-4111-8111-111111111111.tmp`, "okf.js"].sort());
  expect(await readFile(join(resources(other), LEGACY_OFFICE_FACTS_FILE), "utf8")).toContain("SYN");
  // The skill's resource listing skips dot files, so the app's file is not an attachment of the lawyer.
  expect((await readdir(resources(client))).filter((name) => !name.startsWith("."))).toEqual(["okf.js"]);
  // A practice whose real path cannot be found (a disconnected drive) changes nothing.
  await writeFile(officeProfileEnv(config).LAWOSS_OFFICE_PROFILE, JSON.stringify({ officeRoot: join(root, "odpojený", "Office"), jurisdiction: "sk" }));
  expect(await refreshOfficeFacts(config, config.workspaces[0]!)).toBe(0);
  expect(await readFile(join(resources(client), OFFICE_FACTS_FILE), "utf8")).toBe(officeFactsContent("sk"));
});

test("#415: zápis okf.js do skillu cez server dopíše .office.json hneď", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-office-facts-route-")));
  roots.push(root);
  const priorTokens = process.env.LEGALWORK_TOKEN_STORE, priorDb = process.env.LEGALWORK_RUNTIME_DB;
  process.env.LEGALWORK_DATA_DIR = join(root, "data");
  process.env.LEGALWORK_TOKEN_STORE = join(root, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(root, "runtime.sqlite");
  const practice = join(root, "prax"), client = join(practice, "Klienti", "Alfa");
  await mkdir(join(practice, "Office"), { recursive: true });
  await mkdir(join(client, ".opencode", "skills", "novy-spis"), { recursive: true });
  await writeFile(join(client, ".opencode", "skills", "novy-spis", "SKILL.md"), "---\nname: novy-spis\ndescription: SYN\n---\n\nSYN\n");
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(root, "server", "server.json"), token: "owt_office_facts_route", hostToken: "owt_office_facts_route_host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [{ id: "ws_alfa", name: "Alfa", path: client, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [client], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  await mkdir(join(runtimeStorageDir(config), "lawoss-onboarding"), { recursive: true });
  await writeFile(officeProfileEnv(config).LAWOSS_OFFICE_PROFILE, JSON.stringify({ officeRoot: join(practice, "Office"), jurisdiction: "sk" }));
  const server = await startServer(config);
  try {
    const response = await fetch(`http://127.0.0.1:${server.port}/workspace/ws_alfa/skills/novy-spis/resources`, {
      method: "POST", headers: { authorization: "Bearer owt_office_facts_route", "content-type": "application/json" }, body: JSON.stringify({ name: "okf.js", content: "// SYN\n" }),
    });
    expect(response.status).toBe(200);
    expect(await readFile(join(client, ".opencode", "skills", "novy-spis", "resources", OFFICE_FACTS_FILE), "utf8")).toBe(officeFactsContent("sk"));
  } finally {
    await server.stop();
    if (priorTokens === undefined) delete process.env.LEGALWORK_TOKEN_STORE; else process.env.LEGALWORK_TOKEN_STORE = priorTokens;
    if (priorDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = priorDb;
  }
});
