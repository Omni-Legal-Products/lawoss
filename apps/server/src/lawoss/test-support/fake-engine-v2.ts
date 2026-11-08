import { createHash } from "node:crypto";
import { mkdir } from "node:fs/promises";
import { join, relative } from "node:path";

/**
 * LAWOSS: falošný engine v2 (OpenCode 2.1.4) pre e2e testy izolácie klientov.
 *
 * Vyberá chaty ako `SessionStore.list` v 2.1.4 (`packages/core/src/session/store.ts`): `directory`
 * presne, `project` presne, `subpath` presne (len s `project`), `parentID`, `archived`, `search`;
 * bez filtra vráti všetky chaty enginu. Kurzor nesie vlastné filtre a ostatné parametre ignoruje
 * (`Session.list`). Projekt priečinka bez gitu je hash jeho cesty (`Project.resolve`), `gitRoots`
 * nahradí projekt koreňom repozitára. Čítanie a riadenie chatu podľa ID priečinok nekontroluje,
 * ako skutočný engine. Údaje sú syntetické.
 */
export type FakeSession = {
  id: string;
  title: string;
  directory: string;
  parentID?: string;
  created: number;
  updated: number;
  archived?: number;
  metadata?: Record<string, unknown>;
};
export type FakeRequest = { method: string; path: string; search: URLSearchParams; headers: Headers; body?: unknown };
type ListFilter = { directory?: string; project?: string; subpath?: string; parentID?: string | null; archived?: boolean; search?: string };
type Cursor = ListFilter & { anchor: { id: string; time: number; direction: "next" | "previous" } };

const encodeCursor = (cursor: Cursor) => Buffer.from(JSON.stringify(cursor)).toString("base64url");
const decodeCursor = (value: string): Cursor => JSON.parse(Buffer.from(value, "base64url").toString("utf8"));

export function fakeEngineV2(input: {
  sessions?: FakeSession[];
  gitRoots?: string[];
  /** Expected `Authorization` header; other requests get 401. */
  authorization?: string;
  /** Replaces the native move answer (unsupported engine, interrupted rollback); `undefined` moves normally. */
  onMove?: (sessionID: string, directory: string) => Response | undefined | Promise<Response | undefined>;
} = {}) {
  const sessions = new Map<string, FakeSession>((input.sessions ?? []).map((session) => [session.id, { ...session }]));
  const requests: FakeRequest[] = [];
  const prompts: { sessionID: string; directory: string; id?: string; text?: string }[] = [];
  const subscribers = new Set<ReadableStreamDefaultController<Uint8Array>>();
  const gitRoots = input.gitRoots ?? [];
  let clock = 1000;
  const project = (directory: string) => {
    const git = gitRoots.find((root) => directory === root || directory.startsWith(`${root}/`));
    const root = git ?? directory;
    return { id: `prj_${createHash("sha256").update(`directory:${root}`).digest("hex").slice(0, 16)}`, directory: root };
  };
  const info = (session: FakeSession) => {
    const owner = project(session.directory);
    return {
      id: session.id, projectID: owner.id, title: session.title, ...(session.parentID ? { parentID: session.parentID } : {}),
      subpath: relative(owner.directory, session.directory).replaceAll("\\", "/"), location: { directory: session.directory },
      cost: 0, tokens: { input: 0, output: 0, reasoning: 0, cache: { read: 0, write: 0 } },
      time: { created: session.created, updated: session.updated, ...(session.archived ? { archived: session.archived } : {}) },
      ...(session.metadata ? { metadata: session.metadata } : {}),
    };
  };
  const emit = (event: unknown) => {
    for (const subscriber of subscribers) subscriber.enqueue(new TextEncoder().encode(`data: ${JSON.stringify(event)}\n\n`));
  };
  const create = (session: Omit<FakeSession, "created" | "updated"> & Partial<Pick<FakeSession, "created" | "updated">>) => {
    const value = { created: ++clock, updated: ++clock, ...session };
    sessions.set(value.id, value);
    emit({ type: "session.created", data: info(value), location: { directory: value.directory } });
    return value;
  };
  const list = (search: URLSearchParams) => {
    const cursorValue = search.get("cursor");
    const limit = Number(search.get("limit") ?? 50);
    const parentID = search.get("parentID");
    const archived = search.get("archived");
    const filter: Cursor | ListFilter = cursorValue ? decodeCursor(cursorValue) : {
      ...(search.get("directory") ? { directory: search.get("directory") ?? undefined } : {}),
      ...(search.get("project") ? { project: search.get("project") ?? undefined } : {}),
      ...(search.has("subpath") ? { subpath: search.get("subpath") ?? "" } : {}),
      ...(parentID !== null ? { parentID: parentID === "null" ? null : parentID } : {}),
      ...(archived !== null ? { archived: archived === "true" } : {}),
      ...(search.get("search") ? { search: search.get("search") ?? undefined } : {}),
    };
    const anchor = "anchor" in filter ? filter.anchor : undefined;
    const rows = [...sessions.values()].map((session) => ({ session, view: info(session) })).filter(({ session, view }) =>
      (filter.directory === undefined || session.directory === filter.directory)
      && (filter.project === undefined || view.projectID === filter.project)
      && (filter.project === undefined || filter.subpath === undefined || view.subpath === filter.subpath)
      && (filter.parentID === undefined || (filter.parentID === null ? !session.parentID : session.parentID === filter.parentID))
      && (filter.archived === undefined || (filter.archived ? !!session.archived : !session.archived))
      && (filter.search === undefined || session.title.includes(filter.search))
      && (!anchor || session.updated < anchor.time || (session.updated === anchor.time && session.id < anchor.id)))
      .sort((left, right) => right.session.updated - left.session.updated || (right.session.id < left.session.id ? -1 : 1))
      .slice(0, limit);
    const { anchor: _anchor, ...filters } = { anchor: undefined, ...filter };
    const last = rows.at(-1)?.session;
    return { data: rows.map(({ view }) => view), cursor: last ? { next: encodeCursor({ ...filters, anchor: { id: last.id, time: last.updated, direction: "next" } }) } : {} };
  };
  const notFound = () => Response.json({ name: "SessionNotFoundError", data: { message: "Session not found" } }, { status: 404 });
  const server = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    const url = new URL(request.url);
    const path = url.pathname;
    const raw = request.method === "GET" || request.method === "HEAD" ? "" : await request.text();
    const body: unknown = raw ? JSON.parse(raw) : undefined;
    requests.push({ method: request.method, path, search: url.searchParams, headers: request.headers, ...(body === undefined ? {} : { body }) });
    if (input.authorization !== undefined && request.headers.get("authorization") !== input.authorization) return new Response("Unauthorized", { status: 401 });
    const location = url.searchParams.get("location[directory]") ?? "";
    if (path === "/api/info") return Response.json({ version: "2.1.4", pid: process.pid });
    if (path === "/api/experimental/migration/v1") return Response.json({ status: "completed", progress: { completed: 0, total: 0 } });
    if (path === "/api/event") {
      let own: ReadableStreamDefaultController<Uint8Array> | undefined;
      return new Response(new ReadableStream<Uint8Array>({
        start(controller) { own = controller; subscribers.add(controller); controller.enqueue(new TextEncoder().encode(`data: ${JSON.stringify({ type: "server.connected", data: {} })}\n\n`)); },
        cancel() { if (own) subscribers.delete(own); },
      }), { headers: { "content-type": "text/event-stream" } });
    }
    if (path === "/api/location") return Response.json({ data: { directory: location, project: { ...project(location), canonical: project(location).directory } } });
    if (path === "/api/fs/list") return Response.json({ location: { directory: location }, data: [] });
    if (path === "/api/session" && request.method === "GET") return Response.json(list(url.searchParams));
    if (path === "/api/session" && request.method === "POST") {
      const value = typeof body === "object" && body !== null ? body : {};
      const parent = "parentID" in value && typeof value.parentID === "string" ? sessions.get(value.parentID) : undefined;
      const directory = parent?.directory ?? ("location" in value && typeof value.location === "object" && value.location !== null && "directory" in value.location && typeof value.location.directory === "string" ? value.location.directory : location);
      const title = "title" in value && typeof value.title === "string" ? value.title : "Nový chat";
      return Response.json({ data: info(create({ id: `ses_new_${sessions.size}`, title, directory, ...(parent ? { parentID: parent.id } : {}) })) });
    }
    if (path === "/api/session/active") return Response.json({ data: {} });
    const match = /^\/api\/session\/([^/]+)(\/.*)?$/.exec(path);
    if (match) {
      const session = sessions.get(match[1] ?? "");
      if (!session) return notFound();
      const action = match[2] ?? "";
      if (!action && request.method === "GET") return Response.json({ data: info(session) });
      if (!action && request.method === "PATCH") {
        if (typeof body === "object" && body !== null && "archived" in body) session.archived = body.archived === true ? ++clock : undefined;
        return new Response(null, { status: 204 });
      }
      if (!action && request.method === "DELETE") { sessions.delete(session.id); return new Response(null, { status: 204 }); }
      if (action === "/move" && typeof body === "object" && body !== null && "directory" in body && typeof body.directory === "string") {
        const replaced = await input.onMove?.(session.id, body.directory);
        if (replaced) return replaced;
        session.directory = body.directory; session.updated = ++clock;
        return new Response(null, { status: 204 });
      }
      if (action === "/message" && request.method === "GET") return Response.json({ data: [{ id: `msg_${session.id}`, type: "user", text: `${session.title}: obsah`, time: { created: session.created } }], cursor: {} });
      if (action.startsWith("/message/")) return Response.json({ data: { id: action.slice("/message/".length), type: "user", text: "", time: { created: session.created } } });
      if (action === "/inbox") return Response.json({ data: [] });
      if (action === "/prompt" && request.method === "POST") {
        const value = typeof body === "object" && body !== null ? body : {};
        const id = "id" in value && typeof value.id === "string" ? value.id : `msg_${++clock}`;
        const text = "text" in value && typeof value.text === "string" ? value.text : undefined;
        prompts.push({ sessionID: session.id, directory: session.directory, id, ...(text === undefined ? {} : { text }) });
        return Response.json({ data: { id, type: "user", text: text ?? "", time: { created: ++clock } } });
      }
      if (action === "/agent" || action === "/model") return new Response(null, { status: 204 });
      // Synthetic stand-in for a tool run: it reports the folder the chat runs in.
      if (action === "/shell" && request.method === "POST") return Response.json({ data: { directory: session.directory } });
      if (action === "/interrupt") return Response.json({ interrupted: false });
      return Response.json({ data: [] });
    }
    if (path === "/api/plugin") return Response.json({ data: [] });
    if (path === "/api/config") return Response.json([]);
    if (path.startsWith("/api/")) return Response.json({ data: [] });
    return Response.json({ healthy: true });
  } });
  return {
    url: `http://127.0.0.1:${server.port}`,
    sessions, requests, prompts, create, emit, info,
    project,
    stop: () => server.stop(true),
    /** Requests that reached the engine for this chat beyond its metadata read (`GET /api/session/:id`). */
    moves: () => requests.filter((request) => request.method === "POST" && request.path.endsWith("/move")).map((request) => ({ sessionID: request.path.split("/")[3] ?? "", body: request.body })),
    touched: (sessionID: string) => requests.filter((request) => request.path.startsWith(`/api/session/${sessionID}/`)).map((request) => `${request.method} ${request.path}`),
  };
}
export type FakeEngineV2 = ReturnType<typeof fakeEngineV2>;

/**
 * Skutočný engine v2 (`LEGALWORK_TEST_OPENCODE_BIN`) v izolovanom HOME/XDG pod `home`, s heslom
 * ako spravovaný engine (`OPENCODE_PASSWORD`, používateľ `opencode`). Bez modelu a bez sťahovania.
 */
export async function startRealEngineV2(bin: string, home: string, cleanups: (() => Promise<unknown> | unknown)[]) {
  for (const folder of ["home", "config", "data", "cache", "state", "opencode-config"]) await mkdir(join(home, folder), { recursive: true });
  // Voľný port: krátko otvorený a zatvorený poslucháč (engine dostane pevný `--port`).
  const probe = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: () => new Response() });
  const port = probe.port; probe.stop(true);
  const password = crypto.randomUUID();
  const child = Bun.spawn([bin, "serve", "--hostname", "127.0.0.1", "--port", String(port)], { cwd: home, stdout: "ignore", stderr: "ignore", env: {
    PATH: process.env.PATH ?? "", HOME: join(home, "home"), XDG_CONFIG_HOME: join(home, "config"), XDG_DATA_HOME: join(home, "data"), XDG_CACHE_HOME: join(home, "cache"), XDG_STATE_HOME: join(home, "state"),
    OPENCODE_CONFIG_DIR: join(home, "opencode-config"), OPENCODE_DB: join(home, "engine.db"), OPENCODE_DISABLE_MODELS_FETCH: "1", OPENCODE_DISABLE_CLAUDE_CODE: "1", OPENCODE_DISABLE_AUTOUPDATE: "1",
    OPENCODE_CONFIG_CONTENT: JSON.stringify({ update: "disable", warming: false }), OPENCODE_PASSWORD: password,
  } });
  cleanups.push(async () => { child.kill(); await child.exited; });
  const engine = { url: `http://127.0.0.1:${port}`, username: "opencode", password };
  const authorization = `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}`;
  for (const deadline = Date.now() + 30_000; ; await Bun.sleep(100)) {
    if (Date.now() > deadline) throw new Error("engine did not start");
    if (await fetch(`${engine.url}/api/info`, { headers: { authorization } }).then((response) => response.ok, () => false)) break;
  }
  return engine;
}
