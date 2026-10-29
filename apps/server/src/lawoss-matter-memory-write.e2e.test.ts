// Route POST /workspace/:id/lawoss/memory/write (LAWOSS N-A7-10, test 28. 10. 2026): zápis do pamäte prípadu
// nástrojom lawoss_memory_write s jednou kartou „čo a kam“ namiesto štyroch kariet príkazu `node …`.
// Skutočný server a poverenie chatu; karta enginu je `context.ask`, zamietnutie je výnimka ako `RejectedError`.
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";
import { runtimeStorageDir } from "./runtime-opencode-config-store.js";
import { engineAgentSession } from "./lawoss/test-support/engine-agent.js";
import { writeMatterMemoryForChat } from "./lawoss/matter-memory.js";
import { LawossMemoryTools } from "./opencode-plugins/lawoss-memory-tools.js";

const priorData = process.env.LEGALWORK_DATA_DIR, priorTokens = process.env.LEGALWORK_TOKEN_STORE, priorDb = process.env.LEGALWORK_RUNTIME_DB;
const roots: string[] = [], stops: (() => void | Promise<void>)[] = [];
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0)) await removeTestDir(root);
  if (priorData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = priorData;
  if (priorTokens === undefined) delete process.env.LEGALWORK_TOKEN_STORE; else process.env.LEGALWORK_TOKEN_STORE = priorTokens;
  if (priorDb === undefined) delete process.env.LEGALWORK_RUNTIME_DB; else process.env.LEGALWORK_RUNTIME_DB = priorDb;
});

const PREFERENCE = "Klient podľa pokynu advokáta preferuje komunikáciu e-mailom.";
const record = (id: string, truth: string, updated = "2026-10-23", history = "") =>
  `---\nokf: 1\nid: ${id}\ntype: matter\ntitle: Stav ${id}\ndescription: SYN\nlayer: L2\njurisdiction: sk\nstatus: active\ncreated: 2026-10-23\nupdated: ${updated}\n---\n\n## Truth\n\n${truth}\n\n## History\n\n- 2026-10-23 — založené\n${history}`;
const changed = (id: string, truth: string) => record(id, `${truth}\n\n${PREFERENCE}`, "2026-10-28", "- 2026-10-28 — klient preferuje e-mail\n");

/** A case: a folder with its matter card and memory. */
async function matter(dir: string, id: string, truth: string) {
  await mkdir(join(dir, "memory"), { recursive: true });
  await writeFile(join(dir, "matter.md"), "---\njurisdiction: sk\n---\n");
  await writeFile(join(dir, "memory", `${id}.md`), record(id, truth));
}

/** Every file under `dir` (relative), to show that nothing else appeared: no draft, no scratch folder. */
async function files(dir: string): Promise<string[]> {
  return (await readdir(dir, { recursive: true, withFileTypes: true })).filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name))).sort();
}

async function setup() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-memory-write-e2e-"))); roots.push(base);
  process.env.LEGALWORK_DATA_DIR = join(base, "data"); process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  await mkdir(join(base, "runtime"));
  const practice = join(base, "Prax"), client = join(practice, "Klienti", "C001-SYN"), other = join(practice, "Klienti", "C002-SYN");
  const case1 = join(client, "Spisy", "M001"), case2 = join(other, "Spisy", "M002");
  await matter(case1, "M-001", "SYN stav veci 1101");
  await matter(case2, "M-002", "SYN cudzí 2202");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "runtime", "server.json"), token: "synthetic-client", hostToken: "synthetic-host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [
      { id: "c1", name: "C001", preset: "starter", path: client, workspaceType: "local" },
      { id: "c2", name: "C002", preset: "starter", path: other, workspaceType: "local" },
    ], authorizedRoots: [client, other], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  process.env.LEGALWORK_RUNTIME_DB = join(base, "runtime", "runtime.sqlite");
  const server = await startServer(config); stops.push(() => server.stop());
  const previousUrl = process.env.LEGALWORK_SERVER_URL;
  process.env.LEGALWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
  const agent = await engineAgentSession(config, { sessionID: "ses_memory_write", directory: case1 });
  stops.push(() => { agent.restore(); if (previousUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = previousUrl; });
  const tools = (await LawossMemoryTools()).tool;
  const revision = async () => {
    const read = JSON.parse(await tools.lawoss_memory.execute({ action: "read" }, { ...agent.context, ask: async () => { throw new Error("no card expected"); } }));
    return /Revision M-001: ([0-9a-f]{64})/.exec(read.text)?.[1];
  };
  return { base, practice, config, client, other, case1, case2, agent, tools, revision, url: `http://127.0.0.1:${server.port}/workspace/c1` };
}

type Card = { permission: string; patterns: string[]; always: string[]; metadata: Record<string, unknown> };

test("one card with the text and the target file; declined writes nothing, approved writes the record in memory/", async () => {
  const { client, case1, agent, tools, revision } = await setup();
  const before = await readFile(join(case1, "memory", "M-001.md"), "utf8");
  const listed = await files(client);
  const if_revision = await revision();
  expect(if_revision).toMatch(/^[0-9a-f]{64}$/);
  const input = { record: changed("M-001", "SYN stav veci 1101"), reason: "Pokyn advokáta v chate", if_revision };

  // Declined: the engine rejects the card; nothing changes and no draft is left in the client's folder.
  const declined: Card[] = [];
  await expect(tools.lawoss_memory_write.execute(input, { ...agent.context, ask: async (card: Card) => { declined.push(card); throw new Error("rejected"); } })).rejects.toThrow("rejected");
  expect(declined).toHaveLength(1);
  expect(await readFile(join(case1, "memory", "M-001.md"), "utf8")).toBe(before);
  expect(await files(client)).toEqual(listed);

  // Approved: exactly one card, the lawoss_file_change rule, the text and the file relative to the client.
  const cards: Card[] = [];
  const result = JSON.parse(await tools.lawoss_memory_write.execute(input, { ...agent.context, ask: async (card: Card) => { cards.push(card); } }));
  expect(cards).toHaveLength(1);
  const [card] = cards;
  expect(card).toMatchObject({ permission: "lawoss_file_change", patterns: ["Spisy/M001/memory/M-001.md"], always: [] });
  expect(card?.metadata.lawossMemory).toMatchObject({ target: "Spisy/M001/memory/M-001.md", kind: "update", reason: "Pokyn advokáta v chate",
    truth: expect.stringContaining(PREFERENCE), previousTruth: "SYN stav veci 1101", history: ["2026-10-28 — klient preferuje e-mail"] });
  expect(JSON.stringify(card?.metadata)).not.toContain("approved");
  expect(result).toMatchObject({ written: true, target: "Spisy/M001/memory/M-001.md" });
  expect(await readFile(join(case1, "memory", "M-001.md"), "utf8")).toContain(PREFERENCE);
  expect(await files(client)).toEqual(listed);

  // A new record goes to memory/<id>-<title>.md, also with one card that lists every field it brings.
  const fresh: Card[] = [];
  const created = record("M-010", PREFERENCE).replace("status: active\n", "status: active\ncourt: SYN Okresný súd\nparties: [SYN strana A, SYN strana B]\n");
  await tools.lawoss_memory_write.execute({ record: created, reason: "Nový poznatok" }, { ...agent.context, ask: async (card: Card) => { fresh.push(card); } });
  expect(fresh.map((card) => card.patterns)).toEqual([["Spisy/M001/memory/M-010-stav-m-010.md"]]);
  expect(fresh[0]?.metadata.lawossMemory).toMatchObject({ kind: "create", title: "Stav M-010", type: "matter" });
  expect(Reflect.get(Object(fresh[0]?.metadata.lawossMemory), "fields")).toEqual(expect.arrayContaining([
    "id: M-010", "type: matter", "description: SYN", "layer: L2", "court: SYN Okresný súd", expect.stringMatching(/^parties: .*SYN strana A.*SYN strana B/)]));
  expect(await readFile(join(case1, "memory", "M-010-stav-m-010.md"), "utf8")).toContain(PREFERENCE);
});

test("only a case under this client's own root: no office (also a linked one), linked folder, client root, inbox, memory/ or link", async () => {
  const { base, practice, config, client, case1, agent, tools, url } = await setup();
  const headers = { authorization: "Bearer synthetic-client", "content-type": "application/json" };
  // The practice's office, linked to this client and shaped like a case, and an office folder inside the client.
  const office = join(practice, "Office"), inner = join(client, "Office"), linked = join(base, "Zdielane", "C001-podklady", "M003");
  for (const dir of [office, inner, linked]) await matter(dir, "M-030", "SYN");
  await mkdir(join(runtimeStorageDir(config), "lawoss-onboarding"), { recursive: true });
  await writeFile(join(runtimeStorageDir(config), "lawoss-onboarding", "profile.json"), JSON.stringify({ officeRoot: practice }));
  expect((await fetch(`${url}/authorized-folders`, { method: "PUT", headers, body: JSON.stringify({ folders: [office, join(base, "Zdielane", "C001-podklady")] }) })).status).toBe(200);
  // A case whose memory/ is a link to another folder of the client.
  const linkedMemory = join(client, "Spisy", "M004");
  await mkdir(linkedMemory, { recursive: true });
  await writeFile(join(linkedMemory, "matter.md"), "---\njurisdiction: sk\n---\n");
  await symlink(join(client, "Spisy", "M001", "memory"), join(linkedMemory, "memory"), "dir");
  await mkdir(join(client, "00_Na_zatriedenie"), { recursive: true });

  const refusals: [string, string][] = [[office, "403"], [inner, "403"], [linked, "403"], [linkedMemory, "403"],
    [client, "422"], [join(client, "00_Na_zatriedenie"), "422"], [join(case1, "memory"), "422"]];
  const before = await Promise.all([office, inner, linked].map((dir) => readdir(join(dir, "memory"))));
  const caseFiles = await files(case1);
  for (const [matterPath, status] of refusals) {
    const cards: Card[] = [];
    const attempt = tools.lawoss_memory_write.execute({ matter: matterPath, record: record("M-031", PREFERENCE), reason: "SYN" }, { ...agent.context, ask: async (card: Card) => { cards.push(card); } });
    await expect(attempt).rejects.toThrow(status);
    expect(cards).toHaveLength(0);
  }
  expect(await Promise.all([office, inner, linked].map((dir) => readdir(join(dir, "memory"))))).toEqual(before);
  expect(await files(case1)).toEqual(caseFiles);
});

test("a read-only server writes nothing", async () => {
  const { config, case1, agent, tools } = await setup();
  config.readOnly = true;
  const cards: Card[] = [];
  await expect(tools.lawoss_memory_write.execute({ record: record("M-040", PREFERENCE), reason: "SYN" }, { ...agent.context, ask: async (card: Card) => { cards.push(card); } })).rejects.toThrow("read_only");
  expect(cards).toHaveLength(0);
  expect(await readdir(join(case1, "memory"))).toEqual(["M-001.md"]);
});

test("a case outside this client is refused before any card and nothing is written", async () => {
  const { case2, agent, tools } = await setup();
  const before = await readFile(join(case2, "memory", "M-002.md"), "utf8");
  for (const matter of [case2, "../../../C002-SYN/Spisy/M002"]) {
    const cards: Card[] = [];
    const attempt = tools.lawoss_memory_write.execute({ matter, record: record("M-011", PREFERENCE), reason: "SYN" }, { ...agent.context, ask: async (card: Card) => { cards.push(card); } });
    await expect(attempt).rejects.toThrow("403");
    expect(cards).toHaveLength(0);
  }
  expect(await readdir(join(case2, "memory"))).toEqual(["M-002.md"]);
  expect(await readFile(join(case2, "memory", "M-002.md"), "utf8")).toBe(before);
});

test("an ordinary bearer token cannot write, and a write without the card's token or after a change is refused", async () => {
  const { config, case1, url, revision } = await setup();
  const headers = { authorization: "Bearer synthetic-client", "content-type": "application/json" };
  const body = { matter: case1, record: record("M-012", PREFERENCE), reason: "SYN", apply: true };
  expect((await fetch(`${url}/lawoss/memory/write`, { method: "POST", headers, body: JSON.stringify(body) })).status).toBe(403);

  const workspace = config.workspaces[0]!;
  const none = async () => [] as string[];
  await expect(writeMatterMemoryForChat(config, workspace, body, none)).rejects.toMatchObject({ status: 409, code: "memory_write_changed" });
  const preview = await writeMatterMemoryForChat(config, workspace, { ...body, apply: false }, none);
  expect(preview).toMatchObject({ status: "preview", target: "Spisy/M001/memory/M-012-stav-m-012.md", kind: "create" });
  // The record changed after the card: the token no longer matches, nothing is written.
  const approved = preview.status === "preview" ? preview.approved : "";
  await expect(writeMatterMemoryForChat(config, workspace, { ...body, record: record("M-012", "iný text"), approved }, none)).rejects.toMatchObject({ status: 409 });
  expect(await readdir(join(case1, "memory"))).toEqual(["M-001.md"]);
  // An office layer record is not written by this tool.
  const office = record("A-001", "SYN poučenie").replace("type: matter", "type: lesson").replace("layer: L2", "layer: L1");
  await expect(writeMatterMemoryForChat(config, workspace, { ...body, record: office, apply: false }, none)).rejects.toMatchObject({ status: 422 });
  expect(await revision()).toMatch(/^[0-9a-f]{64}$/);
});
