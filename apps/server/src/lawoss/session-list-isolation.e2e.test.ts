import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, parse, relative } from "node:path";
import { z } from "zod";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";

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

/** Engine na skúšku: výber riadkov ako `listByProject` v 1.18.29; zapamätá si dotazy. */
function fakeEngine(folders: Office) {
  const rows: Row[] = titles.map(([title, key]) => ({ title, directory: folders[key], path: relativePath(folders.worktree, folders[key]) }));
  const queries: URLSearchParams[] = [];
  const project = { id: "global", worktree: folders.worktree };
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    const url = new URL(request.url);
    if (url.pathname === "/project/current") return Response.json(project);
    if (url.pathname !== "/session") return Response.json({});
    queries.push(url.searchParams);
    const header = request.headers.get("x-opencode-directory");
    const directory = url.searchParams.get("directory") && header ? decodeURIComponent(header) : undefined;
    const scope = url.searchParams.get("scope"), path = url.searchParams.get("path");
    const selected = rows.filter((row) => {
      if (path !== null) return !path || row.path === path || like(row.path, `${path}/%`);
      return scope === "project" || !directory || row.directory === directory;
    });
    return Response.json(selected.map((row, index) => ({ id: `ses_${index}`, title: row.title, directory: row.directory, path: row.path, time: { created: 1, updated: 100 - index } })));
  } });
  cleanups.push(() => engine.stop(true));
  return { url: `http://127.0.0.1:${engine.port}`, queries, project };
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
  for (const [title, key] of titles) {
    const response = await fetch(`${url}/session`, { method: "POST", headers: { "x-opencode-directory": encodeURIComponent(folders[key]), "content-type": "application/json" }, body: JSON.stringify({ title }) });
    expect(response.status).toBe(200);
  }
  return { url, queries: undefined, project: undefined };
}

async function serve(folders: Office, engineUrl: string) {
  const workspace = (id: string, path: string) => ({ id, name: id, preset: "starter", path, workspaceType: "local" as const, baseUrl: engineUrl });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(folders.base, "server.json"), token: "client", hostToken: "host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [workspace("klient-a", folders.clientA), workspace("klient-b", folders.clientB)],
    authorizedRoots: [folders.clientA, folders.clientB], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const previous = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE };
  process.env.LEGALWORK_DATA_DIR = join(folders.base, "data"); process.env.LEGALWORK_TOKEN_STORE = join(folders.base, "tokens.json");
  cleanups.push(() => {
    for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: previous.data, LEGALWORK_TOKEN_STORE: previous.tokens }))
      if (value === undefined) delete process.env[key]; else process.env[key] = value;
  });
  const server = await startServer(config);
  cleanups.push(() => server.stop());
  return async (query: Record<string, string>) => {
    const response = await fetch(`http://127.0.0.1:${server.port}/workspace/klient-a/opencode/session?${new URLSearchParams(query)}`, { headers: { authorization: "Bearer client" } });
    const body: unknown = await response.json();
    const listed = response.ok ? z.array(sessionSchema).parse(body).map((session) => session.title).sort() : [];
    return { status: response.status, listed };
  };
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
