// LAWOSS #423: lawoss_new_client v chate klienta založí nového klienta kancelárie tou istou cestou servera ako formulár
// klienta (plán z profilu, vykonanie, registrácia). Skutočný server a poverenie chatu; karta enginu je `context.ask`.
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import { engineAgentSession } from "./lawoss/test-support/engine-agent.js";
import LawossMemoryTools from "./opencode-plugins/lawoss-memory-tools.js";
import { nativePluginTools } from "./opencode-plugins/native-plugin-test-support.js";

const priorData = process.env.LEGALWORK_DATA_DIR, priorTokens = process.env.LEGALWORK_TOKEN_STORE, priorDb = process.env.LEGALWORK_RUNTIME_DB;
const roots: string[] = [], stops: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0)) await removeTestDir(root);
  if (priorData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = priorData;
  if (priorTokens === undefined) delete process.env.LEGALWORK_TOKEN_STORE; else process.env.LEGALWORK_TOKEN_STORE = priorTokens;
  if (priorDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = priorDb;
});

test("lawoss_new_client: one card, the client form's path creates and registers the client; a second call reports the collision", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-new-client-e2e-"))); roots.push(base);
  process.env.LEGALWORK_DATA_DIR = join(base, "data"); process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  await mkdir(join(base, "runtime"));
  const practice = join(base, "Prax"), clients = join(practice, "Klienti"), client = join(clients, "C001-SYN");
  await mkdir(client, { recursive: true });
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "runtime", "server.json"), token: "synthetic-client", hostToken: "synthetic-host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "c1", name: "C001", preset: "starter", path: client, workspaceType: "local" }],
    authorizedRoots: [client], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  process.env.LEGALWORK_RUNTIME_DB = join(base, "runtime", "runtime.sqlite");
  const server = await startServer(config); stops.push(() => server.stop());
  const previousUrl = process.env.LEGALWORK_SERVER_URL;
  process.env.LEGALWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
  const agent = await engineAgentSession(config, { sessionID: "ses_new_client", directory: client });
  stops.push(() => { agent.restore(); if (previousUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = previousUrl; });
  const tools = (await nativePluginTools(LawossMemoryTools)).tool;
  const cards: { patterns: string[] }[] = [];
  const context = { ...agent.context, ask: async (card: { patterns: string[] }) => { cards.push(card); } };

  // No office in the profile: refused, nothing created, no card.
  const none = JSON.parse(await tools.lawoss_new_client.execute({ name: "Nový klient SYN", client_type: "po" }, context));
  expect(none).toMatchObject({ created: false, code: "new_client_no_office" });
  const profileDir = join(runtimeStorageDir(config), "lawoss-onboarding");
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "profile.json"), JSON.stringify({ version: 1, lawyerName: "Advokát SYN", jurisdiction: "sk", language: "sk", officeRoot: practice }));

  const target = join(clients, "Nový klient SYN");
  const created = JSON.parse(await tools.lawoss_new_client.execute({ name: "Nový klient SYN", client_type: "fo-podnikatel", ico: "12345678", note: "Syntetický   klient\n s poznámkou" }, context));
  expect(created).toMatchObject({ created: true, path: target });
  // The card shows what is written: the server's folder, the type as given and the note as one line.
  expect(cards).toEqual([expect.objectContaining({ permission: "lawoss_client_create", patterns: [target],
    metadata: { lawossNewClient: { target, name: "Nový klient SYN", clientType: "fo-podnikatel", ico: "12345678", note: "Syntetický klient s poznámkou" } } })]);
  const card = await readFile(join(target, "client.md"), "utf8");
  expect(card).toContain('ico: "12345678"');
  expect(card).toContain("Syntetický klient s poznámkou");
  expect(card).toContain("fo-podnikatel");
  expect(config.workspaces.map(workspace => workspace.path)).toContain(target);

  // The same name again: refused before any card, the existing folder is untouched.
  const again = JSON.parse(await tools.lawoss_new_client.execute({ name: "Nový klient SYN", client_type: "po" }, context));
  expect(again).toMatchObject({ created: false, code: "new_client_exists" });
  expect(cards).toHaveLength(1);
  expect(await readFile(join(target, "client.md"), "utf8")).toBe(card);

  // `.`, `..`, only dots and path separators are invalid names (not "already exists"), before any card.
  for (const name of [".", "..", "...", "../Prax", "Klienti/Novák", "a\\b", ".skryty"]) {
    const invalid = JSON.parse(await tools.lawoss_new_client.execute({ name, client_type: "po" }, context));
    expect({ name, ...invalid }).toMatchObject({ name, created: false, code: "new_client_name" });
  }
  expect(cards).toHaveLength(1);

  // The wizard stores the office folder (`<practice>/Office`) as officeRoot: Klienti is still the practice's.
  await writeFile(join(profileDir, "profile.json"), JSON.stringify({ version: 1, lawyerName: "Advokát SYN", jurisdiction: "sk", language: "sk", officeRoot: join(practice, "Office") }));
  await mkdir(join(practice, "Office"));
  const second = JSON.parse(await tools.lawoss_new_client.execute({ name: "Druhý klient SYN", client_type: "fo" }, context));
  expect(second).toMatchObject({ created: true, path: join(clients, "Druhý klient SYN") });

  // An ordinary bearer token cannot use the agent route.
  const bearer = await fetch(`http://127.0.0.1:${server.port}/workspace/c1/lawoss/new-client/plan`, { method: "POST", headers: { Authorization: "Bearer synthetic-client", "Content-Type": "application/json" }, body: JSON.stringify({ name: "Iný SYN" }) });
  expect(bearer.status).toBe(403);
  await rm(join(profileDir, "profile.json"));
}, 30_000);

// #433: kancelária s kódovanými priečinkami klientov („podľa zvyklosti kancelárie“): nový klient dostane ďalší kód a slug,
// karta enginu ukáže presne tento priečinok a klient sa v appke volá skutočným menom.
test("lawoss_new_client in a coded office: next code and slug as the folder, the real name as the client", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-new-client-code-"))); roots.push(base);
  process.env.LEGALWORK_DATA_DIR = join(base, "data"); process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  await mkdir(join(base, "runtime"));
  const practice = join(base, "Prax"), clients = join(practice, "Klienti"), client = join(clients, "C001-syn-tatran-automatika-s-r-o");
  await mkdir(client, { recursive: true });
  // Medzera v číslovaní (C003–C006) sa nevypĺňa: ďalší je C008.
  for (const name of ["C002-syn-hron-technologie-a-s", "C007-syn-zuzana-simkova"]) await mkdir(join(clients, name));
  await mkdir(join(practice, "Office"));
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "runtime", "server.json"), token: "synthetic-client", hostToken: "synthetic-host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "c1", name: "SYN Tatran Automatika, s. r. o.", preset: "starter", path: client, workspaceType: "local" }],
    authorizedRoots: [client], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  process.env.LEGALWORK_RUNTIME_DB = join(base, "runtime", "runtime.sqlite");
  const server = await startServer(config); stops.push(() => server.stop());
  const previousUrl = process.env.LEGALWORK_SERVER_URL;
  process.env.LEGALWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
  const agent = await engineAgentSession(config, { sessionID: "ses_new_client_code", directory: client });
  stops.push(() => { agent.restore(); if (previousUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = previousUrl; });
  const profileDir = join(runtimeStorageDir(config), "lawoss-onboarding");
  await mkdir(profileDir, { recursive: true });
  await writeFile(join(profileDir, "profile.json"), JSON.stringify({ version: 1, lawyerName: "Advokát SYN", jurisdiction: "sk", language: "sk", officeRoot: join(practice, "Office") }));
  const tools = (await nativePluginTools(LawossMemoryTools)).tool;
  const cards: { patterns: string[]; metadata?: unknown }[] = [];
  const context = { ...agent.context, ask: async (card: { patterns: string[] }) => { cards.push(card); } };

  const name = "SYN Novák Reality, s. r. o.", target = join(clients, "C008-syn-novak-reality-s-r-o");
  const created = JSON.parse(await tools.lawoss_new_client.execute({ name, client_type: "po" }, context));
  expect(created).toMatchObject({ created: true, path: target, name });
  expect(cards).toEqual([expect.objectContaining({ patterns: [target], metadata: { lawossNewClient: expect.objectContaining({ target, name }) } })]);
  expect(await readFile(join(target, "client.md"), "utf8")).toContain(name);
  expect(config.workspaces.find(workspace => workspace.path === target)?.name).toBe(name);

  // Rovnaké meno znova: priečinok sa neprepíše, dostane ďalší kód (kód je jedinečný, meno klienta nie).
  const again = JSON.parse(await tools.lawoss_new_client.execute({ name, client_type: "po" }, context));
  expect(again).toMatchObject({ created: true, path: join(clients, "C009-syn-novak-reality-s-r-o") });
  await rm(join(profileDir, "profile.json"));
}, 30_000);
