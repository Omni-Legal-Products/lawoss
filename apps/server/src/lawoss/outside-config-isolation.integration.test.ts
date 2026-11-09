// LAWOSS: klient outside na skutočnom engine v2 (voliteľné, LEGALWORK_TEST_OPENCODE_BIN = engine 2.1.4, zostavené pluginy
// `pnpm --filter legalwork-server build:plugins`). Rozhodnutie MČ 9. 11. 2026 (lawoss/outside-engine-config.ts): koreň
// konfigurácie enginu je neutrálny, projektová konfigurácia je zapnutá a do priečinka klienta outside server nič nezapíše.
// Dvaja klienti outside A a B a klient inside C v jednom spravovanom engine (startEmbeddedServer ako appka). Príkaz, skill
// a nastavenie (MCP konektor) klienta A sú len v lokáciách A, rovnako B; C má svoju projektovú konfiguráciu. Vlastný
// `opencode.json` klienta A engine prečíta len v A. Strom priečinka A a B je po štarte aj po reloade enginu rovnaký ako
// pred ním. Údaje sú syntetické.
import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readdir, realpath, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { startEmbeddedServer } from "../embedded.js";
import { externalOpencodeConfigDir } from "./workspace-app-files.js";
import { hasProjectTaskBoundary } from "../scheduled-tasks/access.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const plugins = join(import.meta.dir, "..", "..", "dist", "opencode-plugins");
const ready = !!binary && existsSync(join(plugins, "lawoss-outside-config", "index.js")) && existsSync(join(plugins, "legalwork-commands", "index.js"));
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

/** Celý strom priečinka s veľkosťou a časom zmeny každého súboru. */
async function tree(root: string) {
  const entries = await readdir(root, { recursive: true });
  return Object.fromEntries(await Promise.all(entries.sort().map(async (entry) => {
    const info = await stat(join(root, entry));
    return [entry, info.isDirectory() ? "dir" : `${info.size}:${info.mtimeMs}`];
  })));
}

const named = z.object({ data: z.array(z.object({ name: z.string() }).passthrough()) });
const command = (text: string) => `---\ndescription: ${text}\n---\n${text}\n`;
const skill = (name: string, text: string) => `---\nname: ${name}\ndescription: ${text}\n---\n${text}\n`;

test.skipIf(!ready)("klient outside: príkaz, skill a konektor A len v lokáciách A (a naopak), C inside má svoju projektovú konfiguráciu, do A ani B sa nič nezapíše", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-outside-config-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const clientA = join(root, "Klienti", "Tatran"), matterA = join(clientA, "Spisy", "Úhrada");
  const clientB = join(root, "Klienti", "Hron"), clientC = join(root, "Klienti", "Vnútri");
  for (const folder of [matterA, clientB, join(clientC, ".opencode", "commands")]) await mkdir(folder, { recursive: true });
  await writeFile(join(clientA, "zmluva.txt"), "Syntetická zmluva A\n");
  await writeFile(join(clientB, "zmluva.txt"), "Syntetická zmluva B\n");
  // Vlastný súbor, ktorý si klient A sám vytvoril (MČ: engine ho prečíta).
  await writeFile(join(clientA, "opencode.json"), JSON.stringify({ commands: { "a-vlastny": { template: "Vlastný príkaz A", description: "Vlastný príkaz A" } } }));
  await writeFile(join(clientC, ".opencode", "commands", "c-prikaz.md"), command("Príkaz klienta C"));
  const before = { A: await tree(clientA), B: await tree(clientB) };

  // The embedded server exports its private engine DB path to process.env; never inherit another test's.
  const previous = { LEGALWORK_DATA_DIR: process.env.LEGALWORK_DATA_DIR, XDG_CONFIG_HOME: process.env.XDG_CONFIG_HOME, OPENCODE_DB: process.env.OPENCODE_DB };
  process.env.LEGALWORK_DATA_DIR = join(root, "data"); process.env.XDG_CONFIG_HOME = join(root, "xdg"); delete process.env.OPENCODE_DB;
  cleanups.push(() => { for (const [key, value] of Object.entries(previous)) if (value === undefined) delete process.env[key]; else process.env[key] = value; });
  const server = await startEmbeddedServer({
    host: "127.0.0.1", port: 0, configPath: join(root, "private", "server.json"), workspaces: [clientA, clientB, clientC],
    token: "client-token", hostToken: "host-token", logRequests: false, wordAddin: false,
    manageOpencode: true, opencodeBin: binary, opencodeDirectory: clientC, defaultApprovalMode: "auto",
    hostWorkspaceAppFiles: [{ path: clientA, appFiles: "outside" }, { path: clientB, appFiles: "outside" }],
  });
  cleanups.push(() => server.stop());
  const workspace = (path: string) => server.config.workspaces.find(entry => entry.path === path)!;
  const owner: Record<string, string> = { [clientA]: clientA, [matterA]: clientA, [clientB]: clientB, [clientC]: clientC };
  const call = async (method: string, path: string, body?: unknown) => {
    const response = await fetch(`${server.url}${path}`, { method, headers: { authorization: "Bearer client-token", ...(body ? { "content-type": "application/json" } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(30_000) });
    expect(response.status, `${method} ${path}: ${await response.clone().text()}`).toBe(200);
    return response.json();
  };
  // Pluginy lokácie sa načítajú pri prvej požiadavke; prvé odpovede môžu byť ešte bez nich.
  const names = async (path: "/api/skill" | "/api/mcp", directory: string, expected?: string) => {
    let listed: string[] = [];
    for (let attempt = 0; attempt < 60; attempt++) {
      listed = named.parse(await call("GET", `/workspace/${workspace(owner[directory]!).id}/opencode${path}?${new URLSearchParams({ "location[directory]": directory })}`)).data.map(item => item.name);
      if (expected === undefined || listed.includes(expected)) break;
      await Bun.sleep(250);
    }
    return listed.filter(name => /^[abc]-/.test(name)).sort();
  };
  // Príkazy lokácie: definície, ktoré plugin legalwork-commands pre lokáciu číta zo servera (natívne položky
  // konfigurácie lokácie, externý priečinok klienta outside, príkazy appky).
  const commands = async (directory: string) => Object.keys(z.object({ commands: z.record(z.string(), z.unknown()) }).parse(
    await call("GET", `/workspace/${workspace(owner[directory]!).id}/commands/definitions?${new URLSearchParams({ directory })}`)).commands).filter(name => /^[abc]-/.test(name)).sort();

  // Externé app files klientov A a B (mimo ich priečinkov): príkaz a skill.
  for (const [client, letter] of [[clientA, "a"], [clientB, "b"]] as const) {
    const external = externalOpencodeConfigDir(server.config, workspace(client))!;
    expect(external.startsWith(client)).toBe(false);
    await mkdir(join(external, "commands"), { recursive: true });
    await mkdir(join(external, "skills", `${letter}-skill`), { recursive: true });
    await writeFile(join(external, "commands", `${letter}-tajny.md`), command(`Tajný príkaz klienta ${letter.toUpperCase()}`));
    await writeFile(join(external, "skills", `${letter}-skill`, "SKILL.md"), skill(`${letter}-skill`, `Syntetický skill klienta ${letter.toUpperCase()}`));
  }
  // Nastavenie klienta: vlastný konektor (vypnutý, nič sa nespustí).
  for (const [client, letter] of [[clientA, "a"], [clientB, "b"]] as const)
    await call("POST", `/workspace/${workspace(client).id}/mcp`, { name: `${letter}-konektor`, scope: "workspace", config: { type: "remote", url: "http://127.0.0.1:7/mcp", enabled: false, oauth: false } });

  const observe = async () => ({
    A: { commands: await commands(clientA), skills: await names("/api/skill", clientA, "a-skill"), mcp: await names("/api/mcp", clientA, "a-konektor") },
    "A prípad": { commands: await commands(matterA), skills: await names("/api/skill", matterA, "a-skill"), mcp: await names("/api/mcp", matterA, "a-konektor") },
    B: { commands: await commands(clientB), skills: await names("/api/skill", clientB, "b-skill"), mcp: await names("/api/mcp", clientB, "b-konektor") },
    // C nemá vlastný skill ani konektor: vstavaný skill a prázdny zoznam konektorov (žiadny a-/b-).
    C: { commands: await commands(clientC), skills: await names("/api/skill", clientC, "opencode"), mcp: await names("/api/mcp", clientC) },
  });
  expect(await observe()).toEqual({
    A: { commands: ["a-tajny", "a-vlastny"], skills: ["a-skill"], mcp: ["a-konektor"] },
    "A prípad": { commands: ["a-tajny", "a-vlastny"], skills: ["a-skill"], mcp: ["a-konektor"] },
    B: { commands: ["b-tajny"], skills: ["b-skill"], mcp: ["b-konektor"] },
    C: { commands: ["c-prikaz"], skills: [], mcp: [] },
  });
  // Príkazy v engine (`/api/command`): plugin legalwork-commands je aktívny v každej lokácii (poverenie lokácie bez chatu)
  // a príkaz klienta je len v jeho lokáciách, aj pre klienta outside.
  const engine = async (directory: string, expected: string) => {
    const query = new URLSearchParams({ "location[directory]": directory }), id = workspace(owner[directory]!).id;
    let listed: string[] = [], status = "";
    for (let attempt = 0; attempt < 80; attempt++) {
      const plugins = z.object({ data: z.array(z.object({ id: z.string(), state: z.object({ status: z.string() }).passthrough() })) })
        .parse(await call("GET", `/workspace/${id}/opencode/api/plugin?${query}`)).data;
      status = plugins.find(plugin => plugin.id === "legalwork.commands")?.state.status ?? "missing";
      listed = named.parse(await call("GET", `/workspace/${id}/opencode/api/command?${query}`)).data.map(item => item.name);
      if (status === "failed" || listed.includes(expected)) break;
      await Bun.sleep(250);
    }
    return { status, commands: listed.filter(name => /^[abc]-/.test(name)).sort() };
  };
  expect({ A: await engine(clientA, "a-tajny"), "A prípad": await engine(matterA, "a-tajny"), B: await engine(clientB, "b-tajny"), C: await engine(clientC, "c-prikaz") }).toEqual({
    A: { status: "active", commands: ["a-tajny", "a-vlastny"] },
    "A prípad": { status: "active", commands: ["a-tajny", "a-vlastny"] },
    B: { status: "active", commands: ["b-tajny"] },
    C: { status: "active", commands: ["c-prikaz"] },
  });

  // C inside: jeho priečinok nesie vygenerovanú projektovú konfiguráciu, A ani B nie.
  expect(existsSync(join(clientC, ".opencode", "opencode.json"))).toBe(true);

  // Reload enginu klientov (ako po zmene poskytovateľa) s novým príkazom A.
  await writeFile(join(externalOpencodeConfigDir(server.config, workspace(clientA))!, "commands", "a-novy.md"), command("Nový príkaz A"));
  for (const client of [clientA, clientB, clientC]) await call("POST", `/workspace/${workspace(client).id}/engine/reload`, {});
  expect(await commands(clientA)).toEqual(["a-novy", "a-tajny", "a-vlastny"]);
  expect(await commands(clientB)).toEqual(["b-tajny"]);
  expect((await engine(clientA, "a-novy")).commands).toEqual(["a-novy", "a-tajny", "a-vlastny"]);
  expect((await engine(clientB, "b-tajny")).commands).toEqual(["b-tajny"]);
  // Nový skill A po reloade (plugin si nastavenia klienta outside načíta znova).
  await mkdir(join(externalOpencodeConfigDir(server.config, workspace(clientA))!, "skills", "a-druhy"), { recursive: true });
  await writeFile(join(externalOpencodeConfigDir(server.config, workspace(clientA))!, "skills", "a-druhy", "SKILL.md"), skill("a-druhy", "Druhý skill A"));
  await call("POST", `/workspace/${workspace(clientA).id}/engine/reload`, {});
  expect(await names("/api/skill", clientA, "a-druhy")).toEqual(["a-druhy", "a-skill"]);
  expect(await names("/api/skill", clientB, "b-skill")).toEqual(["b-skill"]);

  expect({ A: await tree(clientA), B: await tree(clientB) }).toEqual(before);

  // Rozhodnutie MČ 9. 11. 2026: klient outside s vlastným pravidlom (A zakáže `rm *`) a YOLO. Agenti plánovaných úloh
  // a chatový agent `legalwork` sa potom u klientov líšia, spoločný súbor ich nesie len ako kostru. A (aj prípad A)
  // ich má s vlastnými pravidlami, B (outside) a C (inside) so svojimi, bez pravidla A.
  await call("PATCH", `/workspace/${workspace(clientA).id}/config`, { opencode: { permissions: [{ action: "shell", resource: "rm *", effect: "deny" }] } });
  const yolo = await fetch(`${server.url}/lawoss/yolo`, { method: "PUT", headers: { "x-legalwork-host-token": "host-token", "content-type": "application/json" }, body: JSON.stringify({ enabled: true }) });
  expect(yolo.status).toBe(200);
  const agentSchema = z.object({ data: z.array(z.object({ id: z.string(), mode: z.string(), hidden: z.boolean(), system: z.string().optional(),
    permissions: z.array(z.object({ action: z.string(), resource: z.string(), effect: z.string() })) }).passthrough()) });
  const wanted = ["legalwork", "legalwork-scheduled-all", "legalwork-scheduled-project"];
  const agents = async (directory: string, ownRule: boolean) => {
    const query = new URLSearchParams({ "location[directory]": directory }), id = workspace(owner[directory]!).id;
    let listed: z.infer<typeof agentSchema>["data"] = [];
    for (let attempt = 0; attempt < 120; attempt++) {
      listed = agentSchema.parse(await call("GET", `/workspace/${id}/opencode/api/agent?${query}`)).data.filter(agent => wanted.includes(agent.id));
      const chat = listed.find(agent => agent.id === "legalwork");
      const yoloOn = chat?.permissions.some(rule => rule.action === "shell" && rule.resource === "*" && rule.effect === "allow");
      // Nové nastavenia prídu do enginu postupne (súbory, RPC pluginu, prečítanie konfigurácie); čaká sa na všetky.
      if (listed.length === wanted.length && yoloOn && listed.every(agent => agent.permissions.some(rule => rule.resource === "rm *") === ownRule
        && (agent.system ?? "").startsWith("You are LegalWork"))) break;
      await Bun.sleep(250);
    }
    return Object.fromEntries(listed.sort((x, y) => x.id.localeCompare(y.id)).map(agent => {
      const shell = agent.permissions.filter(rule => rule.action === "shell");
      return [agent.id, { mode: agent.mode, hidden: agent.hidden, prompt: (agent.system ?? "").startsWith("You are LegalWork"),
        // Posledné pravidlo pre `rm *` a pre ostatné príkazy (vyhráva posledná zhoda).
        rm: shell.filter(rule => rule.resource === "rm *" || rule.resource === "*").at(-1)?.effect,
        other: shell.filter(rule => rule.resource === "*").at(-1)?.effect,
        // Plánovaný beh projektu sa spustí len s hranicou projektu (server.ts, `hasProjectTaskBoundary`).
        ...(agent.id === "legalwork-scheduled-project" ? { boundary: hasProjectTaskBoundary({ id: agent.id, permissions: agent.permissions.map(rule => ({ ...rule, effect: z.enum(["allow", "deny", "ask"]).parse(rule.effect) })) }) } : {}) }];
    }));
  };
  const expected = (own: boolean) => ({
    legalwork: { mode: "primary", hidden: false, prompt: true, rm: own ? "deny" : "allow", other: "allow" },
    "legalwork-scheduled-all": { mode: "primary", hidden: true, prompt: true, rm: own ? "deny" : "ask", other: "ask" },
    "legalwork-scheduled-project": { mode: "primary", hidden: true, prompt: true, rm: own ? "deny" : "ask", other: "ask", boundary: true },
  });
  const observed = { A: await agents(clientA, true), "A prípad": await agents(matterA, true), B: await agents(clientB, false), C: await agents(clientC, false) };
  expect(observed).toEqual({ A: expected(true), "A prípad": expected(true), B: expected(false), C: expected(false) });
}, 240_000);
