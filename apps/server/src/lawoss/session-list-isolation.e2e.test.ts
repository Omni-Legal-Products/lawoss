import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { OpenCode } from "@opencode/client";
import { z } from "zod";
import { AI_BOUNDARIES_DENIAL_SOURCE } from "@legalwork/types/ai-governance";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { ensureWikiAgentToken } from "../wiki/agent-access.js";
import { enforceAiBoundaries } from "./test-support/ai-boundaries.js";
import { fakeEngineV2, startRealEngineV2, type FakeEngineV2 } from "./test-support/fake-engine-v2.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";

/**
 * Engine v2 (OpenCode 2.1.4) číta, riadi a vypisuje chaty podľa ID pre hocikoho; `GET /api/session`
 * bez filtra vráti chaty všetkých klientov a kurzor nesie vlastné filtre. Proxy priečinka
 * (`/workspace/:id/opencode/...`) a serverové trasy (`/workspace/:id/sessions/...`) preto rozhodujú
 * o vlastníctve podľa priečinka chatu: chat prípadu v podpriečinku klienta patrí klientovi, chat
 * súrodenca `Klient-A` ku `Klient_A`, iného klienta ani klienta vnoreného v klientovi (#264) nie.
 *
 * Bez premennej beží falošný engine v2 (`test-support/fake-engine-v2.ts`, výber ako 2.1.4);
 * `LEGALWORK_TEST_OPENCODE_BIN=<engine 2.1.4>` spustí rovnaké testy so skutočným enginom
 * v izolovanom HOME/XDG pod dočasným priečinkom. Údaje sú syntetické.
 */
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const sessionSchema = z.object({ id: z.string(), title: z.string().optional(), location: z.object({ directory: z.string() }) }).passthrough();
const listSchema = z.object({ data: z.array(sessionSchema), cursor: z.object({ next: z.string().nullish() }).passthrough() }).passthrough();

async function office() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-session-list-")));
  cleanups.push(() => removeTestDir(base));
  const clientA = join(base, "prax", "Klient_A"), matterA = join(clientA, "Spisy", "Úhrada");
  const clientB = join(base, "prax", "Klient-A"), matterB = join(clientB, "Spis");
  // Vnorený klient: priečinok zaregistrovaný ako samostatný klient vnútri klienta A (#264).
  const nested = join(clientA, "Vnorený klient"), nestedMatter = join(nested, "Spis");
  const outside = join(base, "nezaregistrovaný");
  for (const folder of [matterA, matterB, nestedMatter, outside]) await mkdir(folder, { recursive: true });
  return { base, clientA, matterA, clientB, matterB, nested, nestedMatter, outside };
}
type Office = Awaited<ReturnType<typeof office>>;
const titles = [["A koreň", "clientA"], ["A vec", "matterA"], ["B tajné", "clientB"], ["B spis tajný", "matterB"],
  ["Vnorený tajné", "nested"], ["Vnorený spis tajný", "nestedMatter"], ["Mimo klientov", "outside"]] as const;
type Title = typeof titles[number][0];

type Engine = { url: string; auth?: { username: string; password: string }; ids: Record<Title, string>; fake?: FakeEngineV2; create: (directory: string, title: string) => Promise<string> };

function fake(folders: Office): Engine {
  const engine = fakeEngineV2({ sessions: titles.map(([title, key], index) => ({ id: `ses_${index}`, title, directory: folders[key], created: index + 1, updated: 100 - index })) });
  cleanups.push(() => engine.stop());
  const ids = Object.fromEntries(titles.map(([title], index) => [title, `ses_${index}`])) as Record<Title, string>;
  return { url: engine.url, ids, fake: engine, create: async (directory, title) => engine.create({ id: `ses_${title}`, title, directory }).id };
}

/** Skutočný engine v2 v izolovanom HOME/XDG; chaty založí cez jeho API v priečinkoch klientov. */
async function real(bin: string, folders: Office): Promise<Engine> {
  const engine = await startRealEngineV2(bin, join(folders.base, "engine"), cleanups);
  const authorization = `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}`;
  const client = OpenCode.make({ baseUrl: engine.url, headers: { authorization } });
  const create = async (directory: string, title: string) => (await client.session.create({ location: { directory }, title })).id;
  const ids: Partial<Record<Title, string>> = {};
  for (const [title, key] of titles) ids[title] = await create(folders[key], title);
  return { url: engine.url, auth: { username: engine.username, password: engine.password }, ids: ids as Record<Title, string>, create };
}

async function serve(folders: Office, engine: Engine, extra: Record<string, string> = {}) {
  const workspace = (id: string, path: string) => ({ id, name: id, preset: "starter", path, workspaceType: "local" as const, baseUrl: engine.url,
    ...(engine.auth ? { opencodeUsername: engine.auth.username, opencodePassword: engine.auth.password } : {}) });
  const workspaces = { "klient-a": folders.clientA, "klient-b": folders.clientB, "vnoreny": folders.nested, ...extra };
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(folders.base, "server.json"), token: "client", hostToken: "host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: Object.entries(workspaces).map(([id, path]) => workspace(id, path)),
    authorizedRoots: Object.values(workspaces), readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const previous = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE };
  process.env.LEGALWORK_DATA_DIR = join(folders.base, "data"); process.env.LEGALWORK_TOKEN_STORE = join(folders.base, "tokens.json");
  cleanups.push(() => {
    for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: previous.data, LEGALWORK_TOKEN_STORE: previous.tokens }))
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  const server = await startServer(config);
  cleanups.push(() => server.stop());
  const get = async (path: string, init: RequestInit = {}) => {
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { ...init, headers: { authorization: "Bearer client", ...(init.body ? { "content-type": "application/json" } : {}), ...Object.fromEntries(new Headers(init.headers)) } });
    const body: unknown = await response.json().catch(() => null);
    return { status: response.status, body };
  };
  const titleOf = (id: string) => titles.find(([title]) => engine.ids[title] === id)?.[0] ?? id;
  /** Názvy chatov, ktoré proxy klienta pustí (`/session` aj `/api/session`). */
  const list = async (query: Record<string, string>, workspace = "klient-a", prefix = "") => {
    const { status, body } = await get(`/workspace/${workspace}/opencode${prefix}/session?${new URLSearchParams(query)}`);
    return { status, listed: status === 200 ? listSchema.parse(body).data.map((session) => titleOf(session.id)).sort() : [] };
  };
  return Object.assign(list, { get, config, titleOf, base: `http://127.0.0.1:${server.port}` });
}

/** Kurzor ako v 2.1.4 (`Session.ListCursor`): base64url JSON filtrov a kotvy; iné parametre engine ignoruje. */
const cursor = (filters: Record<string, unknown>) => Buffer.from(JSON.stringify({ ...filters, anchor: { id: "ses_zzzz", time: Number.MAX_SAFE_INTEGER, direction: "next" } })).toString("base64url");

const engines = [["falošný engine v2", undefined], ...(binary ? [["skutočný engine v2", binary] as const] : [])] as const;
const start = (bin: string | undefined, folders: Office) => bin ? real(bin, folders) : Promise.resolve(fake(folders));

for (const [name, bin] of engines) {
  test(`${name}: klient A cez proxy nevypíše chaty klienta B, vnoreného klienta ani cudzieho priečinka`, async () => {
    const folders = await office();
    const engine = await start(bin, folders);
    const list = await serve(folders, engine);

    // Proxy pripne `directory` na priečinok požiadavky: engine v2 ho porovná presne.
    expect(await list({})).toEqual({ status: 200, listed: ["A koreň"] });
    expect(await list({}, "klient-a", "/api")).toEqual({ status: 200, listed: ["A koreň"] });
    expect(await list({ directory: folders.matterA })).toEqual({ status: 200, listed: ["A vec"] });
    expect(await list({ "location[directory]": folders.matterA, parentID: "null" })).toEqual({ status: 200, listed: ["A vec"] });
    // macOS: ten istý priečinok prípadu zapísaný v NFD.
    if (process.platform === "darwin") expect((await list({ directory: folders.matterA.normalize("NFD") })).status).toBe(200);
    // Cudzí priečinok v dotaze: súrodenec, prípad súrodenca, nadradená prax, nezaregistrovaný priečinok.
    for (const directory of [folders.clientB, folders.matterB, join(folders.base, "prax"), folders.outside])
      for (const key of ["directory", "location[directory]"])
        expect({ directory, key, status: (await list({ [key]: directory })).status }).toEqual({ directory, key, status: 403 });
    // Vnorený klient leží v koreni A, ale patrí sebe: jeho priečinok sa cez proxy A nevypíše.
    for (const directory of [folders.nested, folders.nestedMatter])
      expect({ directory, ...(await list({ directory })) }).toEqual({ directory, status: 404, listed: [] });
    // Nejednoznačné prepínače miesta.
    expect((await list.get(`/workspace/klient-a/opencode/session?${new URLSearchParams([["directory", folders.clientA], ["directory", folders.clientB]])}`)).status).toBe(400);
    expect((await list.get(`/workspace/klient-a/opencode/session?location=${encodeURIComponent(folders.clientB)}`)).status).toBe(400);
    // `project`/`subpath` a vyhľadávanie len zužujú pripnutý `directory`.
    expect(await list({ search: "tajné" })).toEqual({ status: 200, listed: [] });
    expect(await list({ subpath: "" })).toEqual({ status: 200, listed: ["A koreň"] });

    // Kurzor nesie vlastné filtre a engine ostatné parametre ignoruje: kurzor zoznamu bez filtra (alebo
    // zoznamu klienta B) priamo z enginu by cez proxy A vypísal cudzie chaty. Proxy pustí len chaty klienta A.
    const engineCursor = async (query: Record<string, string>) => {
      const response = await fetch(`${engine.url}/api/session?${new URLSearchParams({ limit: "1", ...query })}`, { headers: engine.auth ? { authorization: `Basic ${Buffer.from(`${engine.auth.username}:${engine.auth.password}`).toString("base64")}` } : {} });
      const next = listSchema.parse(await response.json()).cursor.next;
      if (!next) throw new Error("engine returned no cursor");
      return next;
    };
    const allPages = await list({ cursor: await engineCursor({}), limit: "100" });
    expect(allPages.status).toBe(200);
    expect(allPages.listed.length).toBeGreaterThan(0);
    for (const title of allPages.listed) expect(["A koreň", "A vec"]).toContain(title);
    const forB = await engineCursor({ directory: folders.clientB, order: "asc" }).then(async (value) => list({ cursor: value }));
    expect(forB).toEqual({ status: 200, listed: [] });
    const nestedPages = await list({ cursor: await engineCursor({}), limit: "100" }, "vnoreny");
    for (const title of nestedPages.listed) expect(["Vnorený spis tajný", "Vnorený tajné"]).toContain(title);
    if (engine.fake) {
      expect(await list({ cursor: cursor({}) })).toEqual({ status: 200, listed: ["A koreň", "A vec"] });
      expect(await list({ cursor: cursor({ directory: folders.nested }) })).toEqual({ status: 200, listed: [] });
      expect(await list({ cursor: cursor({}) }, "vnoreny")).toEqual({ status: 200, listed: ["Vnorený spis tajný", "Vnorený tajné"] });
      // Každý zoznam bez kurzora ide do enginu s pripnutým priečinkom.
      for (const request of engine.fake.requests.filter((item) => item.path === "/api/session" && item.method === "GET" && !item.search.has("cursor") && item.search.get("limit") !== "1"))
        expect(request.search.get("directory")).toBeTruthy();
    }

    // Zoznam chatov servera: klient vrátane prípadov, bez vnoreného klienta, súrodenca a cudzích.
    const ordinary = await list.get("/workspace/klient-a/sessions");
    expect(ordinary.status).toBe(200);
    const items = z.object({ items: z.array(z.object({ id: z.string() }).passthrough()) }).parse(ordinary.body).items.map((item) => list.titleOf(item.id)).sort();
    expect(items).toEqual(["A koreň", "A vec"]);
    const nestedOrdinary = z.object({ items: z.array(z.object({ id: z.string() }).passthrough()) }).parse((await list.get("/workspace/vnoreny/sessions")).body).items.map((item) => list.titleOf(item.id)).sort();
    expect(nestedOrdinary).toEqual(["Vnorený spis tajný", "Vnorený tajné"]);
    const b = z.object({ items: z.array(z.object({ id: z.string() }).passthrough()) }).parse((await list.get("/workspace/klient-b/sessions")).body).items.map((item) => list.titleOf(item.id)).sort();
    expect(b).toEqual(["B spis tajný", "B tajné"]);
  }, 60_000);
}

for (const [name, bin] of engines) {
  test(`${name}: klient A cez proxy ani server neprečíta, neriadi a nepresunie chat klienta B ani vnoreného klienta`, async () => {
    const folders = await office();
    const engine = await start(bin, folders);
    // Ten istý priečinok zapísaný cez odkaz (symlink, na Windows junction). Zaregistrovaný priečinok
    // prípadu by bol vnorený klient (#264), preto sa NFD overuje v dotaze zoznamu.
    const alias = join(folders.base, "odkaz-A");
    await symlink(folders.clientA, alias, "junction");
    const { get, config } = await serve(folders, engine, { "klient-a-odkaz": alias });
    const id = engine.ids;
    const own = id["A koreň"], matter = id["A vec"], foreign = id["B tajné"], foreignMatter = id["B spis tajný"];
    const nested = id["Vnorený tajné"], nestedMatter = id["Vnorený spis tajný"], outside = id["Mimo klientov"];
    const proxy = async (workspace: string, path: string, init?: RequestInit) => (await get(`/workspace/${workspace}/opencode/session/${path}`, init)).status;
    const observed: Record<string, number> = {}, expected: Record<string, number> = {};
    const check = async (key: string, actual: Promise<number> | number, wanted: number) => { observed[key] = await actual; expected[key] = wanted; };

    // Vlastné chaty klienta a jeho prípadu sa čítajú ďalej, aj cez odkaz na ten istý priečinok.
    for (const [label, session] of [["koreň", own], ["prípad", matter]] as const) {
      await check(`A číta ${label}`, proxy("klient-a", session), 200);
      await check(`A číta správy ${label}`, proxy("klient-a", `${session}/message`), 200);
      await check(`A číta ${label} cez /api`, get(`/workspace/klient-a/opencode/api/session/${session}`).then((r) => r.status), 200);
      await check(`A číta ${label} cez server`, get(`/workspace/klient-a/sessions/${session}`).then((r) => r.status), 200);
      await check(`A číta správy ${label} cez server`, get(`/workspace/klient-a/sessions/${session}/messages`).then((r) => r.status), 200);
      await check(`odkaz číta ${label}`, proxy("klient-a-odkaz", session), 200);
    }
    // Vnorený klient číta svoje chaty, nie chaty nadradeného klienta.
    await check("vnorený číta svoj", proxy("vnoreny", nested), 200);
    await check("vnorený číta svoj prípad", proxy("vnoreny", nestedMatter), 200);
    await check("vnorený nečíta A", proxy("vnoreny", own), 404);

    // Engine v2 vráti chat podľa ID bez ohľadu na priečinok; proxy klienta A nie.
    for (const [label, session] of [["B", foreign], ["prípad B", foreignMatter], ["vnorený", nested], ["prípad vnoreného", nestedMatter], ["mimo klientov", outside]] as const) {
      for (const suffix of ["", "/message", "/context", "/diff", "/inbox", "/permission", "/form"])
        await check(`A ${label}${suffix}`, proxy("klient-a", `${session}${suffix}`), 404);
      await check(`A ${label} /api`, get(`/workspace/klient-a/opencode/api/session/${session}`).then((r) => r.status), 404);
      await check(`A ${label} server`, get(`/workspace/klient-a/sessions/${session}`).then((r) => r.status), 404);
      await check(`A ${label} server správy`, get(`/workspace/klient-a/sessions/${session}/messages`).then((r) => r.status), 404);
      await check(`A ${label} server mazanie`, get(`/workspace/klient-a/sessions/${session}`, { method: "DELETE" }).then((r) => r.status), 404);
      await check(`A ${label} úprava`, proxy("klient-a", session, { method: "PATCH", body: JSON.stringify({ title: "prepísané" }) }), 404);
      await check(`A ${label} presun k sebe`, proxy("klient-a", `${session}/move`, { method: "POST", body: JSON.stringify({ directory: folders.clientA }) }), 404);
      await check(`A ${label} stop`, proxy("klient-a", `${session}/interrupt`, { method: "POST", body: "{}" }), 404);
      await check(`A ${label} podchat`, get("/workspace/klient-a/opencode/session", { method: "POST", body: JSON.stringify({ parentID: session, title: "x" }) }).then((r) => r.status), 404);
    }
    await check("B nečíta A", proxy("klient-b", own), 404);
    await check("B nečíta prípad A", proxy("klient-b", matter), 404);

    // Presun chatu A: v rámci klienta áno, ku klientovi B, do vnoreného klienta ani von nie.
    for (const [label, directory] of [["B", folders.clientB], ["prípad B", folders.matterB], ["vnorený", folders.nested], ["mimo", folders.outside]] as const)
      await check(`presun A do ${label}`, proxy("klient-a", `${own}/move`, { method: "POST", body: JSON.stringify({ directory }) }), 403);
    await check("presun A bez priečinka", proxy("klient-a", `${own}/move`, { method: "POST", body: JSON.stringify({}) }), 403);
    // Nový chat v cudzom priečinku.
    for (const [label, directory] of [["B", folders.clientB], ["vnorený", folders.nested]] as const)
      await check(`nový chat A v ${label}`, get("/workspace/klient-a/opencode/session", { method: "POST", body: JSON.stringify({ title: "x", location: { directory } }) }).then((r) => r.status), 403);
    if (engine.fake) {
      await check("presun A v rámci klienta", proxy("klient-a", `${own}/move`, { method: "POST", body: JSON.stringify({ directory: folders.matterA }) }), 204);
      expect(engine.fake.sessions.get(own)?.directory).toBe(folders.matterA);
      // AI hranice vypnuté (predvolené v alfe): prompt do cudzieho chatu odmietne kontrola vlastníctva.
      const prompt = (session: string) => proxy("klient-a", `${session}/prompt`, { method: "POST", body: JSON.stringify({ text: "x" }) });
      await check("prompt B", prompt(foreign), 404);
      await check("prompt vnorený", prompt(nested), 404);
      // AI hranice zapnuté: model dispatch odmietne typovo (403 so značkou) ešte pred enginom.
      const restore = await enforceAiBoundaries(config);
      cleanups.push(restore);
      expect(await get(`/workspace/klient-a/opencode/session/${foreign}/prompt`, { method: "POST", body: JSON.stringify({ text: "x" }) }))
        .toMatchObject({ status: 403, body: { code: "ai_transfer_denied", details: { source: AI_BOUNDARIES_DENIAL_SOURCE } } });
      // Proxy si pýta len metadáta cudzieho chatu; obsah ani príkaz do enginu nejde.
      for (const session of [foreign, foreignMatter, nested, nestedMatter, outside]) expect(engine.fake.touched(session)).toEqual([]);
      expect(engine.fake.prompts).toEqual([]);
      expect(engine.fake.sessions.get(foreign)?.directory).toBe(folders.clientB);
    }
    expect(observed).toEqual(expected);
    // Chat B ostal nedotknutý a jeho klient ho číta.
    expect(await proxy("klient-b", foreign)).toBe(200);
  }, 60_000);
}

for (const [name, bin] of engines) {
  test(`${name}: klient A cez proxy nesiaha na súbory, terminály ani udalosti cudzích priečinkov`, async () => {
    const folders = await office();
    const engine = await start(bin, folders);
    const { get, base } = await serve(folders, engine);
    const a = "/workspace/klient-a/opencode";
    const fsList = (directory: string, key = "location[directory]") => get(`${a}/api/fs/list?${new URLSearchParams({ [key]: directory })}`).then((r) => r.status);
    expect((await get(`${a}/api/fs/list`)).status).toBe(200);
    expect(await fsList(folders.matterA)).toBe(200);
    for (const directory of [folders.clientB, folders.outside]) expect(await fsList(directory)).toBe(403);
    // Priečinok vnoreného klienta leží v koreni A, ale nepatrí mu.
    expect(await fsList(folders.nested)).toBe(404);
    expect((await get(`${a}/api/fs/list?${new URLSearchParams({ path: folders.nested })}`)).status).toBe(403);
    expect((await get(`${a}/api/fs/list?${new URLSearchParams({ path: "Vnorený klient/Spis" })}`)).status).toBe(403);
    expect((await get(`${a}/api/fs/read/${encodeURIComponent(join(folders.nested, "x.md"))}`)).status).toBe(403);
    expect((await get(`${a}/api/fs/read/${encodeURIComponent(join(folders.clientB, "x.md"))}`)).status).toBe(403);
    // MCP sa spúšťa po lokáciách: proxy A nesiahne na MCP lokácie klienta B ani vnoreného klienta.
    expect((await get(`${a}/api/mcp`)).status).toBe(200);
    for (const directory of [folders.clientB, folders.nested]) {
      expect((await get(`${a}/api/mcp?${new URLSearchParams({ "location[directory]": directory })}`)).status).toBeGreaterThanOrEqual(403);
      expect((await get(`${a}/api/experimental/mcp/fixture/connect?${new URLSearchParams({ "location[directory]": directory })}`, { method: "POST", body: "{}" })).status).toBeGreaterThanOrEqual(403);
    }
    // Terminály, ladenie, RPC a globálna história ostávajú mimo proxy.
    for (const [method, path] of [["GET", "/api/pty"], ["POST", "/api/pty"], ["GET", "/api/experimental/persistent-pty/x"], ["GET", "/api/debug/location"], ["POST", "/api/rpc/x/y"], ["GET", "/experimental/session"]] as const)
      expect({ method, path, status: (await get(`${a}${path}`, { method, ...(method === "POST" ? { body: "{}" } : {}) })).status }).toEqual({ method, path, status: 403 });

    // Udalosti: proxy pustí udalosti zaregistrovaných klientov (jeden prúd appky, ako upstream), nikdy
    // nezaregistrovaného priečinka ani interného chatu.
    if (engine.fake) {
      const abort = new AbortController();
      cleanups.push(() => abort.abort());
      const response = await fetch(`${base}${a}/api/event`, { headers: { authorization: "Bearer client" }, signal: abort.signal });
      expect(response.status).toBe(200);
      const reader = response.body!.getReader();
      const decoder = new TextDecoder();
      let text = decoder.decode((await reader.read()).value);
      engine.fake.create({ id: "ses_mimo_udalost", title: "Mimo nové", directory: folders.outside });
      engine.fake.create({ id: "ses_interny", title: "Interný", directory: folders.clientA, metadata: { legalworkInternal: "legalmemory" } });
      engine.fake.create({ id: "ses_a_udalost", title: "A nové", directory: folders.clientA });
      const deadline = setTimeout(() => abort.abort(), 5_000);
      try { while (!text.includes("ses_a_udalost")) { const chunk = await reader.read(); if (chunk.done) break; text += decoder.decode(chunk.value); } }
      catch { /* uplynul čas */ } finally { clearTimeout(deadline); abort.abort(); }
      expect(text).toContain("ses_a_udalost");
      expect(text).not.toContain("ses_mimo_udalost");
      expect(text).not.toContain("ses_interny");
    }
  }, 60_000);
}

for (const [name, bin] of engines) {
  test(`${name}: chat prípadu klienta A prijme a doručí správu cez front; chaty klienta B a vnoreného klienta nie`, async () => {
    const folders = await office();
    const engine = await start(bin, folders);
    const { get, config, base } = await serve(folders, engine);
    const id = engine.ids;
    const own = id["A koreň"], matter = id["A vec"], foreign = id["B tajné"], foreignMatter = id["B spis tajný"], nested = id["Vnorený tajné"];
    const queue = (session: string, body?: unknown) => get(`/workspace/klient-a/sessions/${session}/queue`, body ? { method: "POST", body: JSON.stringify(body) } : {});
    const sandbox = (session: string) => get(`/workspace/klient-a/sandbox/session/${session}`);
    const cwd = z.object({ cwd: z.string() }).passthrough();
    const enqueue = (text: string) => ({ type: "enqueue", id: crypto.randomUUID(), draft: { mode: "prompt", text, parts: [], attachments: [], editor: { mentions: {}, pasteParts: [] } },
      execution: { kind: "prompt", model: { providerID: "test", modelID: "test" }, parts: [{ type: "text", text }] } });

    // Chat prípadu (podpriečinok klienta) aj chat klienta: front sa číta a dá sa ovládať (N-17).
    for (const session of [matter, own]) {
      expect({ session, status: (await queue(session)).status }).toEqual({ session, status: 200 });
      expect({ session, status: (await queue(session, { type: "pause", paused: true })).status }).toEqual({ session, status: 200 });
      expect({ session, status: (await queue(session, { type: "pause", paused: false })).status }).toEqual({ session, status: 200 });
    }
    // Nastavenia vykonávania chatu prípadu: shell začína v priečinku prípadu, chat klienta v koreni klienta.
    const matterSandbox = await sandbox(matter);
    expect(matterSandbox.status).toBe(200);
    expect(cwd.parse(matterSandbox.body).cwd).toBe(folders.matterA);
    expect(cwd.parse((await sandbox(own)).body).cwd).toBe(folders.clientA);

    // Cudzí klient (súrodenec `Klient-A` ku `Klient_A`), jeho prípad a vnorený klient ostávajú odmietnutí.
    for (const session of [foreign, foreignMatter, nested]) {
      expect({ session, status: (await queue(session)).status }).toEqual({ session, status: 404 });
      expect({ session, status: (await queue(session, { type: "pause", paused: true })).status }).toEqual({ session, status: 404 });
      expect({ session, status: (await queue(session, enqueue("cudzí"))).status }).toEqual({ session, status: 404 });
      expect({ session, status: (await sandbox(session)).status }).toEqual({ session, status: 403 });
    }

    if (engine.fake) {
      // Prvá správa v chate prípadu odíde do enginu a front sa vyprázdni.
      const first = enqueue("Prvá správa v prípade");
      expect((await queue(matter, first)).status).toBe(200);
      const state = z.object({ entries: z.array(z.unknown()), completedIds: z.array(z.string()) }).passthrough();
      for (let attempt = 0; attempt < 200 && !state.parse((await queue(matter)).body).completedIds.includes(first.id); attempt++) await Bun.sleep(10);
      expect(state.parse((await queue(matter)).body)).toMatchObject({ entries: [], completedIds: [first.id] });
      // Engine v2 spustí chat v jeho uloženom priečinku: prípad klienta A.
      expect(engine.fake.prompts.map((prompt) => [prompt.sessionID, prompt.directory])).toEqual([[matter, folders.matterA]]);
      // Overený pôvod chatu prípadu (grant z frontu) je priečinok prípadu: nástroj s priečinkom prípadu prejde,
      // s koreňom klienta nie. Bez toho by každý LAWOSS nástroj v chate prípadu padol (wiki_agent_directory_mismatch).
      const token = await ensureWikiAgentToken(config);
      const tool = async (directory: string) => {
        const response = await fetch(`${base}/workspaces`, { headers: { "x-legalwork-wiki-agent-token": token, "x-legalwork-wiki-agent-session": matter, "x-legalwork-wiki-agent-directory": encodeURIComponent(directory) } });
        return { status: response.status, body: await response.json().catch(() => null) };
      };
      const granted = await tool(folders.matterA);
      expect(granted.status).toBe(200);
      expect(z.object({ items: z.array(z.object({ id: z.string() }).passthrough()) }).passthrough().parse(granted.body).items.map((item) => item.id)).toEqual(["klient-a"]);
      expect(await tool(folders.clientA)).toMatchObject({ status: 403, body: { code: "wiki_agent_directory_mismatch" } });
      // Chat klienta doručuje ďalej.
      const second = enqueue("Správa v chate klienta");
      expect((await queue(own, second)).status).toBe(200);
      for (let attempt = 0; attempt < 200 && !state.parse((await queue(own)).body).completedIds.includes(second.id); attempt++) await Bun.sleep(10);
      expect(engine.fake.prompts.map((prompt) => prompt.sessionID)).toEqual([matter, own]);

      // AI hranice zapnuté: správa do chatu prípadu dostane typové odmietnutie AI hraníc, nie 404, a do enginu nejde.
      const restore = await enforceAiBoundaries(config);
      cleanups.push(restore);
      expect(await queue(matter, enqueue("s hranicami"))).toMatchObject({ status: 403, body: { code: "ai_transfer_denied", details: { source: AI_BOUNDARIES_DENIAL_SOURCE } } });
      expect((await queue(foreignMatter, enqueue("s hranicami"))).status).toBe(404);
      expect(engine.fake.prompts).toHaveLength(2);
      for (const session of [foreign, foreignMatter, nested]) expect(engine.fake.touched(session)).toEqual([]);

      // Mazanie chatu prípadu cez server prejde (predtým 404 pre presnú zhodu priečinka).
      expect((await get(`/workspace/klient-a/sessions/${matter}`, { method: "DELETE" })).status).toBeLessThan(300);
      expect(engine.fake.sessions.has(matter)).toBe(false);
      expect(engine.fake.sessions.has(foreign)).toBe(true);
    }
  }, 60_000);
}

for (const [name, bin] of engines) {
  test(`${name}: samostatne registrovaný spis klienta A ostáva klientovi A, vnorený klient s vlastnou kartou nie (#264, #295)`, async () => {
    const folders = await office();
    // Karty klienta (OKF): klient A a vnorený klient majú každý svoju; spis A kartu nemá, patrí ku karte A.
    await writeFile(join(folders.clientA, "klient.md"), "# Klient A\n");
    await writeFile(join(folders.nested, "klient.md"), "# Vnorený klient\n");
    const engine = await start(bin, folders);
    const { get } = await serve(folders, engine, { "spis-a": folders.matterA });
    const id = engine.ids;
    const status = async (workspace: string, session: string) => (await get(`/workspace/${workspace}/opencode/session/${session}`)).status;
    expect(await status("klient-a", id["A vec"])).toBe(200);
    expect((await get(`/workspace/klient-a/sessions/${id["A vec"]}/messages`)).status).toBe(200);
    const items = z.object({ items: z.array(z.object({ id: z.string() }).passthrough()) }).parse((await get("/workspace/klient-a/sessions")).body).items.map((item) => item.id).sort();
    expect(items).toEqual([id["A koreň"], id["A vec"]].sort());
    // Spis číta svoj chat, nie chat koreňa klienta; vnorený klient s kartou ostáva oddelený.
    expect(await status("spis-a", id["A vec"])).toBe(200);
    expect(await status("spis-a", id["A koreň"])).toBe(404);
    for (const session of [id["Vnorený tajné"], id["Vnorený spis tajný"]]) expect(await status("klient-a", session)).toBe(404);
    expect(await status("vnoreny", id["Vnorený tajné"])).toBe(200);
  }, 60_000);
}
