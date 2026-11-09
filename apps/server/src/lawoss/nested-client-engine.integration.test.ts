// LAWOSS #264 v skutočnom engine v2 (voliteľné: LEGALWORK_TEST_OPENCODE_BIN = engine 2.1.4, zostavené pluginy
// `pnpm --filter legalwork-server build:plugins`). Klient P má v sebe zaregistrovaného klienta N. Natívne nástroje enginu
// (`read`, `glob`, `grep`, `write`) z chatu P do N engine nepýta `external_directory` (cesta je v priečinku chatu),
// preto kartu s varovaním otvorí plugin `lawoss-linked-folders` v `permission.evaluate`, aj nad `allow` a aj v YOLO.
// Hľadanie (`glob`, `grep`) z koreňa P kartu nemá; výsledky z N plugin vynechá v `tool.execute.after` (MČ 9. 11. 2026).
// Pluginy sa načítajú ako v produkcii (`mandatoryPlugins`: `legalwork-managed-config`, potom `lawoss-linked-folders`).
// Nástroje volá skúšobný plugin cez RPC (`tool.execute` s rovnakým vyhodnotením povolení ako pri modeli), karty číta
// `permission.request.list` a odpovedá `permission.reply`. Bez modelu. Údaje sú syntetické.
import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode, type JsonValue } from "@opencode/client";
import { z } from "zod";
import { LINKED_FOLDERS_MAP_FILE, NESTED_CLIENT_CARD_PREFIX, type LinkedFoldersMap } from "./linked-folders-rules.js";
import { startRealEngineV2 } from "./test-support/fake-engine-v2.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const plugins = join(import.meta.dir, "..", "..", "dist", "opencode-plugins");
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });
const ready = !!binary && existsSync(join(plugins, "lawoss-linked-folders", "index.js")) && existsSync(join(plugins, "legalwork-managed-config", "index.js"));

const rpc = { id: "lawoss.nested-client-probe", methods: { run: { input: { type: "object", properties: { sessionID: { type: "string" }, tool: { type: "string" }, input: { type: "object" } }, required: ["sessionID", "tool", "input"] }, output: { type: "string" } } }, events: {} };
// Nástroj sa spustí na pozadí; výsledok („allowed: …“ alebo „rejected“) sa vyzdvihne neskôr podľa id volania.
const probePlugin = `import { Plugin } from "@opencode/plugin";
const results = new Map();
export default Plugin.define({ id: "lawoss.nested-client-probe", async setup(ctx) {
  await ctx.rpc.register(${JSON.stringify(rpc)}, { async run(input) {
    if (input.tool === "result") return results.get(input.input.call) ?? "pending";
    const tool = (await ctx.tool.list()).find((entry) => entry.name === input.tool);
    if (!tool) throw new Error("No tool " + input.tool);
    const call = input.input.call; const { call: _, ...args } = input.input;
    void tool.execute(args, { sessionID: input.sessionID, agent: "legalwork", messageID: "msg_nested", id: "call_" + call, signal: new AbortController().signal, progress: async () => {} })
      .then((result) => results.set(call, "allowed: " + JSON.stringify(result.output ?? result.content).slice(0, 2000)), (error) => results.set(call, "rejected: " + String(error).slice(0, 300)));
    return "started";
  } });
} });
`;

test.skipIf(!ready)("natívne nástroje z chatu nadradeného klienta do vnoreného iného klienta: karta s varovaním aj v YOLO, hľadanie z koreňa bez karty a bez výsledkov N; spis a vlastné súbory bez karty", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-nested-engine-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const parent = join(root, "prax", "Klienti", "Tatran"), nested = join(parent, "Dcéra"), matter = join(parent, "Spisy", "Úhrada");
  for (const folder of [join(nested, "Zmluvy"), matter]) await mkdir(folder, { recursive: true });
  const nestedFile = join(nested, "Zmluvy", "zmluva.txt");
  await writeFile(nestedFile, "syntetický obsah vnoreného klienta");
  await writeFile(join(parent, "poznámky.txt"), "syntetický obsah nadradeného klienta");
  const runtime = join(root, "runtime"), probe = join(root, "probe");
  await Promise.all([mkdir(runtime), mkdir(probe)]);
  await writeFile(join(probe, "index.js"), probePlugin);
  const writeMap = (cards: "both" | "none" | "parent", yolo = true) => writeFile(join(runtime, LINKED_FOLDERS_MAP_FILE), JSON.stringify({
    version: 1, officeRoot: join(root, "prax"), firmManaged: false, ...(yolo ? { yolo: true } : {}),
    clients: [{ root: parent, folders: [], client: cards === "none" ? null : parent }, { root: nested, folders: [], client: cards === "both" ? nested : cards === "parent" ? parent : null }],
  } satisfies LinkedFoldersMap));
  // Pravidlá ako v YOLO: všetko povolené, priečinky mimo chatu sa pýtajú (rozhodne plugin).
  const permissions = [{ action: "*", resource: "*", effect: "allow" }, { action: "external_directory", resource: "*", effect: "ask" }];
  const workspace = (directory: string) => ({ directory, configuration: { permissions }, providerActivation: {}, projectPermissionApprovals: [] });
  const settingsPath = join(runtime, "runtime-opencode-settings.json");
  await writeFile(settingsPath, JSON.stringify({ version: 2, workspaces: { p: workspace(parent), n: workspace(nested) }, sharedConfiguration: {} }));
  const engineConfig = join(runtime, "runtime-opencode-config.json");
  // Skúšobný poskytovateľ (OpenAI Responses): prvá požiadavka ťahu zavolá nástroj, druhá prečíta jeho výsledok a skončí.
  const script: { call?: { name: string; arguments: string; id: string }; output?: string } = {};
  const relay = Bun.serve({ port: 0, async fetch(request) {
    const body = z.object({ input: z.array(z.unknown()) }).passthrough().parse(await request.json());
    const done = body.input.map((item) => z.object({ type: z.literal("function_call_output"), call_id: z.string(), output: z.unknown() }).safeParse(item))
      .find((item) => item.success && item.data.call_id === script.call?.id);
    const item = !done && script.call ? { type: "function_call", id: `fc_${script.call.id}`, call_id: script.call.id, name: script.call.name, arguments: script.call.arguments, status: "completed" }
      : { type: "message", id: "msg_fixture", role: "assistant", content: [{ type: "output_text", text: "Hotovo" }], status: "completed" };
    if (done?.success) script.output = typeof done.data.output === "string" ? done.data.output : JSON.stringify(done.data.output);
    const response = { id: "resp_fixture", status: "completed", output: [item], usage: { input_tokens: 1, output_tokens: 1, total_tokens: 2 } };
    const events = [{ type: "response.created", response: { ...response, status: "in_progress", output: [] } },
      { type: "response.output_item.added", output_index: 0, item }, { type: "response.output_item.done", output_index: 0, item }, { type: "response.completed", response }];
    return new Response(events.map((event) => "data: " + JSON.stringify(event) + "\n\n").join(""), { headers: { "content-type": "text/event-stream" } });
  } });
  cleanups.push(() => relay.stop(true));
  // Chatový agent LAWOSS (`CHAT_AGENT`): YOLO platí len preň.
  await writeFile(engineConfig, JSON.stringify({ update: "disable", permissions, agents: { legalwork: { description: "LAWOSS chat agent", mode: "primary", permissions } },
    providers: { fixture: { package: "@opencode/ai/providers/openai", settings: { baseURL: relay.url.origin + "/v1", apiKey: "fixture" }, models: { fixture: { capabilities: { tools: true } } } } } }));
  const mandatory = { update: "disable", warming: false, plugins: [{ package: join(plugins, "legalwork-managed-config"), options: { settingsPath } }, join(plugins, "lawoss-linked-folders"), probe] };
  const engine = await startRealEngineV2(binary ?? "", join(root, "engine"), cleanups, { OPENCODE_CONFIG: engineConfig, OPENCODE_CONFIG_CONTENT: JSON.stringify(mandatory) });
  const client = OpenCode.make({ baseUrl: engine.url, headers: { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}` } });

  let calls = 0;
  /** Spustí nástroj v chate priečinka `directory`; na kartu odpovie `reply` a vráti kartu a výsledok nástroja. */
  const run = async (directory: string, tool: string, input: Record<string, JsonValue>, reply: "reject" | "once" = "reject") => {
    const location = { directory };
    await client.model.list({ location });
    for (let attempt = 0; attempt < 100; attempt++) {
      const states = (await client.plugin.list({ location })).data;
      if (["lawoss.linked-folders", "legalwork.managed-config", "lawoss.nested-client-probe"].every((id) => states.some((entry) => entry.id === id && entry.state.status === "active"))) break;
      await Bun.sleep(100);
    }
    const session = await client.session.create({ location });
    const call = String(++calls);
    const invoke = (name: string, args: Record<string, JsonValue>) => client.rpc.call({ rpcID: rpc.id, method: "run", input: { sessionID: session.id, tool: name, input: args }, location }, { signal: AbortSignal.timeout(10_000) });
    expect((await invoke(tool, { ...input, call })).output).toBe("started");
    let card: { action: string; resources: readonly string[]; message?: string } | undefined;
    for (let attempt = 0; attempt < 300; attempt++) {
      const result = String((await invoke("result", { call })).output);
      if (result !== "pending") return { card: card ? { action: card.action, message: card.message } : null, result };
      const asked = (await client.permission.request.list({ location })).data.find((item) => item.sessionID === session.id);
      if (asked) { card = asked; await client.permission.reply({ sessionID: session.id, requestID: asked.id, decision: reply }); }
      await Bun.sleep(20);
    }
    throw new Error(`Tool ${tool} did not finish`);
  };
  const warning = { message: `${NESTED_CLIENT_CARD_PREFIX}${nested}` };
  /** Ťah modelu v chate priečinka `directory`, ktorý zavolá nástroj; vráti karty a výsledok nástroja, ako ho dostal model. */
  const modelSearch = async (directory: string, tool: string, input: Record<string, JsonValue>, reply: "reject" | "once" = "reject") => {
    const location = { directory };
    const session = await client.session.create({ location, agent: "legalwork", model: { providerID: "fixture", id: "fixture" } });
    script.call = { name: tool, arguments: JSON.stringify(input), id: `call_${++calls}` };
    script.output = undefined;
    await client.session.prompt({ sessionID: session.id, text: "Nájdi súbory." });
    const cards: { action: string; message?: string }[] = [];
    // Výsledok zapíše skúšobný poskytovateľ počas čakania (mimo dosahu zúženia typu v tejto funkcii).
    const received = (): string | undefined => script.output;
    for (let attempt = 0; attempt < 500 && received() === undefined; attempt++) {
      const asked = (await client.permission.request.list({ location })).data.find((item) => item.sessionID === session.id);
      if (asked) { cards.push({ action: asked.action, message: asked.message }); await client.permission.reply({ sessionID: session.id, requestID: asked.id, decision: reply }); }
      await Bun.sleep(20);
    }
    await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(10_000) });
    const output = received();
    if (output === undefined) throw new Error(`Model did not receive the ${tool} result`);
    return { cards, output };
  };

  // Oba majú kartu = oddelení klienti: čítanie, hľadanie aj zápis do N z chatu P dostanú kartu; zamietnutie nič nepustí.
  await writeMap("both");
  const read = await run(parent, "read", { path: nestedFile });
  expect(read.card).toEqual({ action: "read", ...warning });
  expect(read.result).toStartWith("rejected");
  expect(read.result).not.toContain("syntetický obsah");
  const relative = await run(parent, "read", { path: "Dcéra/Zmluvy/zmluva.txt" });
  expect(relative.card).toEqual({ action: "read", ...warning });
  const write = await run(parent, "write", { path: join(nested, "nový.txt"), content: "x" });
  expect(write.card).toEqual({ action: "edit", ...warning });
  expect(existsSync(join(nested, "nový.txt"))).toBe(false);
  // Rozhodnutie MČ 9. 11. 2026: hľadanie z koreňa P kartu nemá a výsledky z N sa ticho vynechajú; cielené do N kartu má.
  // Bez karty; to, čo z výsledku dostane model, overuje `modelSearch` nižšie (háčik `tool.execute.after` beží len v ťahu modelu).
  expect((await run(parent, "grep", { pattern: "syntetický" })).card).toBeNull();
  const grepModel = await modelSearch(parent, "grep", { pattern: "syntetický" });
  expect(grepModel.cards).toEqual([]);
  expect(grepModel.output).toContain("syntetický obsah nadradeného klienta");
  expect(grepModel.output).not.toContain("vnoreného");
  expect(grepModel.output).not.toContain("Dcéra");
  expect((await run(parent, "grep", { pattern: "syntetický", path: nested })).card).toEqual({ action: "grep", ...warning });
  expect((await run(parent, "glob", { pattern: "*.txt", path: join(nested, "Zmluvy") })).card).toEqual({ action: "glob", ...warning });
  expect((await run(parent, "glob", { pattern: "Dcéra/**/*.txt" })).card).toEqual({ action: "glob", ...warning });
  // Po „Povoliť raz“ advokáta nástroj prebehne.
  const approved = await run(parent, "read", { path: nestedFile }, "once");
  expect(approved.card).toEqual({ action: "read", ...warning });
  expect(approved.result).toContain("syntetický obsah vnoreného klienta");

  // Kartu nemá ani jeden = oddelení: glob z koreňa P bez karty a bez súborov N; po povolení cieleného hľadania áno.
  await writeMap("none");
  expect((await run(parent, "glob", { pattern: "**/*.txt" })).card).toBeNull();
  const globModel = await modelSearch(parent, "glob", { pattern: "**/*.txt" });
  expect(globModel.cards).toEqual([]);
  expect(globModel.output).toContain("poznámky.txt");
  expect(globModel.output).not.toContain("Dcéra");
  // Cielené hľadanie povolené advokátom model dostane celé.
  const globModelTargeted = await modelSearch(parent, "glob", { pattern: "**/*.txt", path: nested }, "once");
  expect(globModelTargeted.cards).toEqual([{ action: "glob", ...warning }]);
  expect(globModelTargeted.output).toContain("zmluva.txt");
  const globTargeted = await run(parent, "glob", { pattern: "**/*.txt", path: nested }, "once");
  expect(globTargeted.card).toEqual({ action: "glob", ...warning });
  expect(globTargeted.result).toContain("zmluva.txt");
  // Chat spisu P (priečinok N je mimo chatu, engine sa pýta `external_directory`): karta aj v YOLO.
  const fromMatter = await run(matter, "read", { path: nestedFile });
  expect(fromMatter.card).toEqual({ action: "external_directory", ...warning });
  expect(fromMatter.result).toStartWith("rejected");

  // Vlastné súbory P: bez karty.
  await writeMap("both");
  const own = await run(parent, "read", { path: join(parent, "poznámky.txt") });
  expect(own).toMatchObject({ card: null });
  expect(own.result).toContain("syntetický obsah nadradeného klienta");
  expect((await run(parent, "glob", { pattern: "*.txt" })).card).toBeNull();

  // P má kartu a N nie = ten istý klient (spis): bez karty, aj zo spisu v YOLO.
  await writeMap("parent");
  const sameClient = await run(parent, "read", { path: nestedFile });
  expect(sameClient.card).toBeNull();
  expect(sameClient.result).toContain("syntetický obsah vnoreného klienta");
  // Prípad b: hľadanie z koreňa sa nefiltruje.
  const sameGrep = await modelSearch(parent, "grep", { pattern: "syntetický" });
  expect(sameGrep.cards).toEqual([]);
  expect(sameGrep.output).toContain("syntetický obsah vnoreného klienta");
  expect((await run(matter, "read", { path: nestedFile })).card).toBeNull();
  expect(await readFile(nestedFile, "utf8")).toBe("syntetický obsah vnoreného klienta");
}, 120_000);
