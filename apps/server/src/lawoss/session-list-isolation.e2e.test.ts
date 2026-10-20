import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse, relative } from "node:path";
import { z } from "zod";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";
import { enforceAiBoundaries } from "./test-support/ai-boundaries.js";
import { AI_BOUNDARIES_DENIAL_SOURCE } from "@legalwork/types/ai-governance";

/**
 * Výpis rozhovorov cez proxy priečinka (`/workspace/:id/opencode/session`) nesmie ukázať
 * rozhovory iného klienta. Engine 1.18.29 vypisuje rozhovory po projektoch a všetky priečinky
 * bez gitu zdieľajú jeden globálny projekt s koreňom `/`. Bez `directory` v dotaze, so
 * `scope=project` alebo s `path` mimo priečinka preto vráti rozhovory všetkých klientov.
 * `path` porovnáva cez SQL LIKE (`_` a `%` sú zástupné znaky, ASCII bez ohľadu na veľkosť),
 * takže klient „Klient_A“ zachytí aj rozhovory súrodenca „Klient-A“.
 *
 * Bez premennej beží engine na skúšku s rovnakým výberom ako 1.18.29 (`listByProject`);
 * `LEGALWORK_TEST_OPENCODE_BIN=<engine 1.18.29>` spustí ten istý test so skutočným enginom
 * v izolovanom HOME/XDG pod dočasným priečinkom. Údaje sú syntetické.
 */
const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const sessionSchema = z.object({ id: z.string(), title: z.string(), directory: z.string() }).passthrough();
type Row = { title: string; directory: string; path: string };

async function office() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-session-list-")));
  cleanups.push(() => removeTestDir(base));
  const clientA = join(base, "prax", "Klient_A"), matterA = join(clientA, "Spisy", "Úhrada");
  const clientB = join(base, "prax", "Klient-A"), matterB = join(clientB, "Spis");
  for (const folder of [matterA, matterB]) await mkdir(folder, { recursive: true });
  return { base, clientA, matterA, clientB, matterB, worktree: parse(base).root };
}
type Office = Awaited<ReturnType<typeof office>>;
const relativePath = (worktree: string, directory: string) => relative(worktree, directory).replaceAll("\\", "/");
const titles = [["A koreň", "clientA"], ["A vec", "matterA"], ["B tajné", "clientB"], ["B spis tajný", "matterB"]] as const;

/** SQLite LIKE: `%` a `_` sú zástupné znaky, ASCII písmená bez ohľadu na veľkosť. */
function like(value: string, pattern: string) {
  const source = [...pattern].map((char) => char === "%" ? ".*" : char === "_" ? "." : char.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("");
  return new RegExp(`^${source}$`, "is").test(value);
}

/**
 * Engine na skúšku: výber riadkov ako `listByProject` v 1.18.29; zapamätá si dotazy.
 * Čítanie podľa ID (`/session/:id/...`) ako v 1.18.29 nekontroluje priečinok ani projekt.
 */
function fakeEngine(folders: Office) {
  const rows: Row[] = titles.map(([title, key]) => ({ title, directory: folders[key], path: relativePath(folders.worktree, folders[key]) }));
  const ids = Object.fromEntries(titles.map(([title], index) => [title, `ses_${index}`]));
  const info = (row: Row) => ({ id: ids[row.title], title: row.title, directory: row.directory, path: row.path, time: { created: 1, updated: 100 - rows.indexOf(row) } });
  const queries: URLSearchParams[] = [];
  const requests: string[] = [];
  const project = { id: "global", worktree: folders.worktree };
  const projectB = { id: "git-b", worktree: folders.clientB, sandboxes: [folders.matterB] };
  // `/event` posiela udalosti svojho priečinka; `/global/event` a v2 `/api/event` všetkých.
  const subscribers = new Set<{ directory: string | null; controller: ReadableStreamDefaultController<Uint8Array> }>();
  const stream = (directory: string | null) => {
    let subscriber: { directory: string | null; controller: ReadableStreamDefaultController<Uint8Array> } | undefined;
    const body = new ReadableStream<Uint8Array>({
      start(controller) { subscriber = { directory, controller }; subscribers.add(subscriber); controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "server.connected" })}\n\n`)); },
      cancel() { if (subscriber) subscribers.delete(subscriber); },
    });
    return new Response(body, { headers: { "content-type": "text/event-stream" } });
  };
  const create = async (directory: string, title: string) => {
    for (const subscriber of subscribers)
      if (subscriber.directory === null || subscriber.directory === directory)
        subscriber.controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ directory, payload: { type: "session.created", properties: { info: { title, directory } } } })}\n\n`));
  };
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    requests.push(`${request.method} ${url.pathname}`);
    const header = decodeURIComponent(request.headers.get("x-opencode-directory") ?? "");
    if (url.pathname === "/project/current") return Response.json(header.startsWith(folders.clientB) ? projectB : project);
    if (url.pathname === "/project") return Response.json([project, projectB]);
    if (url.pathname === "/event") return stream(header);
    if (url.pathname === "/global/event" || url.pathname === "/api/event") return stream(null);
    if (url.pathname === "/api/fs/list") return Response.json({ location: { directory: url.searchParams.get("location[directory]") || header }, data: [] });
    const byId = /^\/session\/([^/]+)(\/.*)?$/.exec(url.pathname);
    const row = byId && rows.find((candidate) => ids[candidate.title] === byId[1]);
    if (byId && byId[1] !== "status") {
      if (!row) return Response.json({ name: "NotFoundError" }, { status: 404 });
      if (!byId[2]) return Response.json(info(row));
      if (byId[2] === "/message") return Response.json([{ info: { id: `msg_${byId[1]}`, sessionID: byId[1], role: "user" }, parts: [{ type: "text", text: `${row.title}: obsah` }] }]);
      return Response.json([]);
    }
    if (url.pathname !== "/session") return Response.json({});
    queries.push(url.searchParams);
    const directory = url.searchParams.get("directory") && header ? header : undefined;
    const scope = url.searchParams.get("scope"), path = url.searchParams.get("path");
    const selected = rows.filter((row) => {
      if (path !== null) return !path || row.path === path || like(row.path, `${path}/%`);
      return scope === "project" || !directory || row.directory === directory;
    });
    return Response.json(selected.map(info));
  } });
  cleanups.push(() => engine.stop(true));
  return { url: `http://127.0.0.1:${engine.port}`, queries, requests, project, ids, create };
}

/** Skutočný engine v izolovanom HOME/XDG; rozhovory založí cez jeho API v priečinkoch klientov. */
async function realEngine(bin: string, folders: Office) {
  const home = join(folders.base, "engine");
  const env: Record<string, string> = {
    PATH: process.env.PATH ?? "", HOME: join(home, "home"), OPENCODE_TEST_HOME: join(home, "home"),
    XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"), XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state"),
    OPENCODE_DB: join(home, "engine.db"), OPENCODE_DISABLE_MODELS_FETCH: "true", OPENCODE_DISABLE_DEFAULT_PLUGINS: "true",
    OPENCODE_DISABLE_CLAUDE_CODE: "true", OPENCODE_CONFIG_CONTENT: JSON.stringify({ autoupdate: false, share: "disabled", plugin: [] }),
  };
  for (const folder of ["home", "config", "data", "cache", "state"]) await mkdir(join(home, folder), { recursive: true });
  const child = Bun.spawn([bin, "serve", "--hostname", "127.0.0.1", "--port", "0"], { cwd: home, env, stdout: "pipe", stderr: "ignore" });
  cleanups.push(async () => { child.kill(); await child.exited; });
  const reader = child.stdout.getReader();
  let output = "";
  const deadline = Date.now() + 30_000;
  while (!/listening on (http:\/\/\S+)/.test(output)) {
    if (Date.now() > deadline) throw new Error("engine did not start");
    const chunk = await reader.read();
    if (chunk.done) throw new Error("engine exited");
    output += new TextDecoder().decode(chunk.value);
  }
  reader.releaseLock();
  const url = /listening on (http:\/\/\S+)/.exec(output)?.[1] ?? "";
  const create = async (directory: string, title: string) => {
    const response = await fetch(`${url}/session`, { method: "POST", headers: { "x-opencode-directory": encodeURIComponent(directory), "content-type": "application/json" }, body: JSON.stringify({ title }) });
    expect(response.status).toBe(200);
    return sessionSchema.parse(await response.json()).id;
  };
  const ids: Record<string, string> = {};
  for (const [title, key] of titles) ids[title] = await create(folders[key], title);
  return { url, queries: undefined, requests: undefined, project: undefined, ids, create };
}

async function serve(folders: Office, engineUrl: string, extra: Record<string, string> = {}) {
  const workspace = (id: string, path: string) => ({ id, name: id, preset: "starter", path, workspaceType: "local" as const, baseUrl: engineUrl });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(folders.base, "server.json"), token: "client", hostToken: "host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [workspace("klient-a", folders.clientA), workspace("klient-b", folders.clientB), ...Object.entries(extra).map(([id, path]) => workspace(id, path))],
    authorizedRoots: [folders.clientA, folders.clientB, ...Object.values(extra)], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
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
  /** Otvorí SSE cez proxy, po prvej udalosti spustí `trigger` a číta, kým nepríde `until` (najviac 5 s). */
  const sse = async (path: string, trigger: () => Promise<unknown>, until: string) => {
    const abort = new AbortController();
    cleanups.push(() => abort.abort());
    const response = await fetch(`http://127.0.0.1:${server.port}${path}`, { headers: { authorization: "Bearer client" }, signal: abort.signal });
    if (response.status !== 200 || !response.body) { abort.abort(); return { status: response.status, text: "" }; }
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let text = decoder.decode((await reader.read()).value);
    await trigger();
    const deadline = setTimeout(() => abort.abort(), 5_000);
    try {
      while (!text.includes(until)) {
        const chunk = await reader.read();
        if (chunk.done) break;
        text += decoder.decode(chunk.value);
      }
    } catch { /* uplynul čas */ } finally { clearTimeout(deadline); abort.abort(); }
    return { status: response.status, text };
  };
  const list = async (query: Record<string, string>) => {
    const { status, body } = await get(`/workspace/klient-a/opencode/session?${new URLSearchParams(query)}`);
    const listed = status === 200 ? z.array(sessionSchema).parse(body).map((session) => session.title).sort() : [];
    return { status, listed };
  };
  return Object.assign(list, { get, sse, config });
}

const engines = [["engine na skúšku (výber 1.18.29)", undefined], ...(binary ? [["skutočný engine", binary] as const] : [])] as const;

for (const [name, bin] of engines) {
  test(`${name}: klient A cez proxy nevypíše rozhovory klienta B`, async () => {
    const folders = await office();
    const engine = bin ? await realEngine(bin, folders) : fakeEngine(folders);
    const list = await serve(folders, engine.url);
    const rel = (directory: string) => relativePath(folders.worktree, directory);

    // Bez `directory`, so `scope=project` alebo s cudzou či prázdnou `path` engine vráti všetkých.
    expect(await list({})).toEqual({ status: 200, listed: ["A koreň"] });
    const foreign: Record<string, string>[] = [{ scope: "project" }, { directory: folders.clientA, scope: "project" }, { path: rel(folders.clientB) }, { path: rel(folders.matterB) }, { path: "" }, { path: rel(join(folders.base, "prax")) }];
    for (const query of foreign)
      expect({ query, ...(await list(query)) }).toEqual({ query, status: 400, listed: [] });
    // `_` aj veľkosť písmen by v LIKE zachytili súrodenca; overuje sa doslovná cesta po segmentoch.
    // Windows `node:path` porovnáva bez ohľadu na veľkosť písmen, preto tam malé písmená prejdú na filter.
    const lowercase = process.platform === "win32" ? [] : [rel(folders.clientA).toLowerCase()];
    for (const path of [rel(folders.clientA).replace("Klient_A", "Klient-_"), ...lowercase, `${rel(folders.clientA)}/../Klient-A`, `${rel(folders.clientA)}/`, `/${rel(folders.clientA)}`])
      expect({ path, ...(await list({ path })) }).toEqual({ path, status: 400, listed: [] });
    expect((await list({ directory: folders.clientB })).status).toBe(400);
    // Zoznam v2 `/api/session` engine 1.18.29 nefiltruje podľa priečinka.
    expect((await list.get("/workspace/klient-a/opencode/api/session")).status).toBe(403);

    // Strom v bočnom paneli: klient s vecami, vec sama; `Klient_A/%` v LIKE zachytí aj `Klient-A/Spis`.
    expect(await list({ directory: folders.clientA, path: rel(folders.clientA), roots: "true", limit: "5" })).toEqual({ status: 200, listed: ["A koreň", "A vec"] });
    expect(await list({ directory: folders.matterA, path: rel(folders.matterA), roots: "true", limit: "5" })).toEqual({ status: 200, listed: ["A vec"] });
    expect(await list({ directory: folders.matterA, path: rel(folders.matterA).normalize("NFD") })).toMatchObject({ status: 200 });
    expect(await list({ directory: folders.matterA })).toEqual({ status: 200, listed: ["A vec"] });

    // Priečinok klienta je sám koreň git projektu: `path=""` (celý projekt) je jeho podstrom,
    // engine vráti všetky riadky a cudzie odfiltruje proxy.
    if (engine.project) {
      Object.assign(engine.project, { id: "git", worktree: folders.clientA });
      expect(await list({ directory: folders.clientA, path: "" })).toEqual({ status: 200, listed: ["A koreň", "A vec"] });
    }

    if (engine.queries) for (const query of engine.queries) {
      expect(query.has("scope")).toBe(false);
      expect(query.get("directory")).toBeTruthy();
    }
  }, 60_000);
}

for (const [name, bin] of engines) {
  test(`${name}: klient A cez proxy neprečíta rozhovor klienta B podľa ID`, async () => {
    const folders = await office();
    const engine = bin ? await realEngine(bin, folders) : fakeEngine(folders);
    // Ten istý priečinok zapísaný cez odkaz (symlink, na Windows junction) a na macOS v NFD.
    const alias = join(folders.base, "odkaz-A");
    await symlink(folders.clientA, alias, "junction");
    const nfd: Record<string, string> = process.platform === "darwin" ? { "vec-a-nfd": folders.matterA.normalize("NFD") } : {};
    const { get, config } = await serve(folders, engine.url, { "klient-a-odkaz": alias, ...nfd });
    const id = engine.ids;
    const own = id["A koreň"]!, foreign = id["B tajné"]!, foreignMatter = id["B spis tajný"]!;
    const proxy = async (workspace: string, path: string, init?: RequestInit) => {
      const { status, body } = await get(`/workspace/${workspace}/opencode/session/${path}`, init);
      return { path, status, title: status === 200 && !path.includes("/") ? sessionSchema.parse(body).title : undefined };
    };

    // Vlastné rozhovory priečinka a jeho vecí sa čítajú ďalej, aj cez odkaz na ten istý priečinok.
    expect(await proxy("klient-a", own)).toEqual({ path: own, status: 200, title: "A koreň" });
    expect(await proxy("klient-a", id["A vec"]!)).toEqual({ path: id["A vec"]!, status: 200, title: "A vec" });
    expect((await proxy("klient-a", `${own}/message`)).status).toBe(200);
    expect(await proxy("klient-a-odkaz", own)).toEqual({ path: own, status: 200, title: "A koreň" });
    if (nfd["vec-a-nfd"]) expect(await proxy("vec-a-nfd", id["A vec"]!)).toEqual({ path: id["A vec"]!, status: 200, title: "A vec" });

    // Engine 1.18.29 vráti rozhovor podľa ID bez ohľadu na priečinok; proxy klienta A nie.
    for (const session of [foreign, foreignMatter])
      for (const suffix of ["", "/message", "/todo", "/children", "/diff"])
        expect(await proxy("klient-a", `${session}${suffix}`)).toEqual({ path: `${session}${suffix}`, status: 404, title: undefined });
    expect((await proxy("klient-b", own)).status).toBe(404);
    // Engine 1.18.29 číta rozhovor podľa ID aj cez v2 `/api/session/:id`.
    expect((await get(`/workspace/klient-a/opencode/api/session/${foreign}`)).status).toBe(404);
    expect((await get(`/workspace/klient-a/opencode/api/session/${foreign}/message`)).status).toBe(404);
    expect((await get(`/workspace/klient-a/opencode/api/session/${own}`)).status).toBe(200);
    // Priečinok veci nevidí rozhovor nadradeného priečinka klienta.
    if (nfd["vec-a-nfd"]) expect((await proxy("vec-a-nfd", own)).status).toBe(404);
    expect((await get(`/workspace/klient-a/sessions/${foreign}`)).status).toBe(404);
    expect((await get(`/workspace/klient-a/sessions/${foreign}/messages`)).status).toBe(404);
    expect((await get(`/workspace/klient-a/sessions/${foreign}`, { method: "DELETE" })).status).toBe(404);
    expect((await get(`/workspace/klient-a/sessions/${own}`)).status).toBe(200);
    if (engine.requests) {
      const prompt = () => get(`/workspace/klient-a/opencode/session/${foreign}/prompt_async`, { method: "POST", body: JSON.stringify({ parts: [{ type: "text", text: "x" }] }) });
      // AI hranice vypnuté (predvolené v alfe): prompt prejde AI strážou, cudzí rozhovor odmietne kontrola vlastníctva (#190).
      expect((await prompt()).status).toBe(404);
      // AI hranice zapnuté: model dispatch odmietne typovo (403 so značkou) ešte pred kontrolou vlastníctva a enginom.
      const restore = await enforceAiBoundaries(config);
      cleanups.push(restore);
      expect(await prompt()).toMatchObject({ status: 403, body: { code: "ai_transfer_denied", details: { source: AI_BOUNDARIES_DENIAL_SOURCE } } });
      // Vlastníctvo cudzieho rozhovoru overí aj ne-modelový príkaz.
      expect((await proxy("klient-a", `${foreign}/abort`, { method: "POST", body: "{}" })).status).toBe(404);
      // Proxy si pýta len metadáta rozhovoru; obsah ani príkaz cudzieho rozhovoru do enginu nejde.
      expect(engine.requests.filter((request) => request.includes(`/session/${foreign}/`))).toEqual([]);
    }
    // Rozhovor B ostal nedotknutý a jeho priečinok ho číta.
    expect(await proxy("klient-b", foreign)).toEqual({ path: foreign, status: 200, title: "B tajné" });
  }, 60_000);
}

for (const [name, bin] of engines) {
  test(`${name}: klient A cez proxy nevidí klienta B cez prepínače, udalosti ani projekty`, async () => {
    const folders = await office();
    // Klient B má vlastný git projekt: engine ho vedie v globálnom zozname projektov.
    const git = (...args: string[]) => Bun.spawnSync(["git", "-C", folders.clientB, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args]);
    expect(git("init", "-q").exitCode).toBe(0);
    expect(git("commit", "-q", "--allow-empty", "-m", "start").exitCode).toBe(0);
    const engine = bin ? await realEngine(bin, folders) : fakeEngine(folders);
    const { get, sse } = await serve(folders, engine.url);
    const a = "/workspace/klient-a/opencode";
    const projectB = z.object({ id: z.string(), worktree: z.string() }).parse(await (await fetch(`${engine.url}/project/current`, { headers: { "x-opencode-directory": encodeURIComponent(folders.clientB) } })).json());
    expect(projectB.worktree).toBe(folders.clientB);
    // Všetky pozorovania sa porovnajú naraz, aby červený beh ukázal každý únik.
    const observed: Record<string, unknown> = {}, expected: Record<string, unknown> = {};
    const check = (key: string, actual: unknown, wanted: unknown) => { observed[key] = actual; expected[key] = wanted; };

    // 1. Prepínače priečinka: v2 `location[...]`, `?workspace=` a hlavička `x-opencode-workspace`
    //    by engine presmerovali do iného priečinka. `directory` proxy rieši vnútri koreňa.
    const location = z.object({ location: z.object({ directory: z.string() }) });
    const where = async (path: string, init?: RequestInit) => {
      const { status, body } = await get(path, init);
      return { status, directory: status === 200 ? location.parse(body).location.directory : undefined };
    };
    check("vlastný /api/fs/list", await where(`${a}/api/fs/list`), { status: 200, directory: folders.clientA });
    check("location[directory]=B", await where(`${a}/api/fs/list?${new URLSearchParams({ "location[directory]": folders.clientB })}`), { status: 400, directory: undefined });
    check("location[workspace]", (await get(`${a}/api/fs/list?${new URLSearchParams({ "location[workspace]": "wrk_cudzi" })}`)).status, 400);
    check("?workspace= v2", (await get(`${a}/api/fs/list?workspace=wrk_cudzi`)).status, 400);
    check("?workspace= v1", (await get(`${a}/session?workspace=wrk_cudzi`)).status, 400);
    check("x-opencode-workspace", (await get(`${a}/api/fs/list`, { headers: { "x-opencode-workspace": "wrk_cudzi" } })).status, 400);

    // 2. Udalosti: `/event` (používa appka) posiela len udalosti priečinka; `/global/event`
    //    a v2 `/api/event` posielajú udalosti všetkých priečinkov vrátane obsahu.
    const folderEvents = await sse(`${a}/event`, async () => { await engine.create(folders.clientB, "B nové tajné"); await engine.create(folders.clientA, "A nové"); }, "A nové");
    check("/event", { status: folderEvents.status, own: folderEvents.text.includes("A nové"), foreign: folderEvents.text.includes("B nové tajné") }, { status: 200, own: true, foreign: false });
    for (const path of ["/global/event", "/api/event"]) {
      const events = await sse(`${a}${path}`, () => engine.create(folders.clientB, `B tajné ${path}`), `B tajné ${path}`);
      check(path, { status: events.status, foreign: events.text.includes(`B tajné ${path}`) }, { status: 403, foreign: false });
    }

    // 3. Projekty: zoznam len s projektom priečinka; cudzie priečinky projektu ani úprava cudzieho projektu nie.
    const projects = await get(`${a}/project`);
    const listed = projects.status === 200 ? z.array(z.object({ id: z.string(), worktree: z.string() }).passthrough()).parse(projects.body) : [];
    check("/project", { status: projects.status, foreign: listed.filter((project) => project.id === projectB.id || project.worktree.startsWith(folders.clientB)).length, own: listed.length }, { status: 200, foreign: 0, own: 1 });
    check("/project/B/directories", (await get(`${a}/project/${projectB.id}/directories`)).status, 403);
    check("PATCH /project/B", (await get(`${a}/project/${projectB.id}`, { method: "PATCH", body: JSON.stringify({ name: "prepísané" }) })).status, 403);

    // 4. Celá história udalostí, presuny rozhovorov, pracovné priestory, terminály: appka ich nepoužíva.
    for (const [method, path] of [
      ["POST", "/sync/history"], ["POST", "/sync/replay"], ["POST", "/sync/steal"], ["POST", "/sync/start"],
      ["POST", "/experimental/control-plane/move-session"], ["GET", "/experimental/workspace"], ["GET", "/experimental/workspace/adapters"],
      ["GET", `/experimental/session/${engine.ids["B tajné"]}/background`], ["GET", `/experimental/project/${projectB.id}/copy`],
      ["GET", "/pty"], ["GET", "/api/pty"],
      // Zakódované písmená a zdvojené lomky vedú na tie isté trasy.
      ["POST", "/%73ync/history"], ["POST", "//sync/history"], ["GET", "/glob%61l/event"], ["GET", "/project/x%2F..%2F..%2Fpty"],
    ] as const)
      check(`${method} ${path}`, (await get(`${a}${path}`, { method, ...(method === "POST" ? { body: "{}" } : {}) })).status, 403);

    // Priečinok klienta A funguje ďalej.
    check("/project/current", (await get(`${a}/project/current`)).status, 200);
    check("vlastný rozhovor", (await get(`${a}/session/${engine.ids["A koreň"]}`)).status, 200);
    expect(observed).toEqual(expected);
  }, 60_000);
}
