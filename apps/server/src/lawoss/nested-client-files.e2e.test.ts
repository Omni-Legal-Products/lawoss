// LAWOSS #264: súborové trasy upstream `/workspace/:id/files/*` klienta P nesiahajú do priečinka klienta N zaregistrovaného
// vnútri P (oba s kartou = oddelení klienti): zoznam a katalóg ho vynechajú, čítanie, zápis, kópia, import a presun
// odmietnu 403 `nested_client_folder`. Vnorený priečinok bez karty pod kartou P je spis toho istého klienta a ostáva
// prístupný. Klient N vlastný priečinok číta ďalej. Údaje sú syntetické.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";

const previous = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE, db: process.env.LEGALWORK_RUNTIME_DB };
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: previous.data, LEGALWORK_TOKEN_STORE: previous.tokens, LEGALWORK_RUNTIME_DB: previous.db })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

const auth = { authorization: "Bearer client", "content-type": "application/json" };
const NESTED = "Dcéra s.r.o.";

async function serve(nestedCard: boolean) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-nested-files-")));
  cleanups.push(() => removeTestDir(base));
  const parent = join(base, "Klienti", "Tatran"), nested = join(parent, NESTED);
  await mkdir(join(nested, "Zmluvy"), { recursive: true });
  await mkdir(join(parent, "Spisy"), { recursive: true });
  await writeFile(join(parent, "client.md"), "# SYN Tatran\n");
  if (nestedCard) await writeFile(join(nested, "client.md"), "# SYN Dcéra\n");
  await writeFile(join(nested, "Zmluvy", "zmluva.md"), "Syntetická zmluva vnoreného klienta\n");
  await writeFile(join(parent, "Spisy", "podanie.md"), "Syntetické podanie\n");
  process.env.LEGALWORK_DATA_DIR = join(base, "data"); process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(base, "private", "runtime.sqlite");
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => new URL(request.url).pathname === "/api/info" ? Response.json({ version: "2.1.4", pid: process.pid }) : Response.json({ data: [], cursor: {} }) });
  cleanups.push(() => engine.stop(true));
  const url = `http://127.0.0.1:${engine.port}`;
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "server.json"), token: "client", hostToken: "host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [{ id: "p", name: "Tatran", preset: "starter", path: parent, workspaceType: "local", baseUrl: url }, { id: "n", name: "Dcéra", preset: "starter", path: nested, workspaceType: "local", baseUrl: url }],
    authorizedRoots: [parent, nested], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config);
  cleanups.push(() => server.stop());
  const at = (workspace: string, path: string, query: Record<string, string> = {}) => `http://127.0.0.1:${server.port}${workspace ? `/workspace/${workspace}` : ""}${path}?${new URLSearchParams(query)}`;
  const get = (workspace: string, path: string, query: Record<string, string> = {}) => fetch(at(workspace, path, query), { headers: auth });
  const post = (workspace: string, path: string, body: unknown) => fetch(at(workspace, path), { method: "POST", headers: auth, body: JSON.stringify(body) });
  return { parent, nested, get, post };
}

const status = async (response: Response) => [response.status, (await response.json()).code];

test("klient P: priečinok vnoreného iného klienta N vypadne zo zoznamu a katalógu, čítanie a zápis odmietnu", async () => {
  const { parent, nested, get, post } = await serve(true);
  const list = await (await get("p", "/files/list")).json();
  expect(list.entries.map((entry: { name: string }) => entry.name)).not.toContain(NESTED);
  expect(list.entries.map((entry: { name: string }) => entry.name)).toContain("Spisy");
  const refused = [403, "nested_client_folder"];
  expect(await status(await get("p", "/files/list", { path: NESTED }))).toEqual(refused);
  expect(await status(await get("p", "/files/list", { path: `${NESTED}/Zmluvy` }))).toEqual(refused);
  expect(await status(await get("p", "/files/content", { path: `${NESTED}/Zmluvy/zmluva.md` }))).toEqual(refused);
  expect(await status(await get("p", "/files/stat", { path: `${NESTED}/Zmluvy/zmluva.md` }))).toEqual(refused);
  expect(await status(await get("p", "/files/raw", { path: `${NESTED}/Zmluvy/zmluva.md` }))).toEqual(refused);
  expect(await status(await post("p", "/files/content", { path: `${NESTED}/nove.md`, content: "x" }))).toEqual(refused);
  expect(await status(await post("p", "/files/copy", { path: `${NESTED}/Zmluvy/zmluva.md`, targetPath: "kopia.md" }))).toEqual(refused);
  expect(await status(await post("p", "/files/copy", { path: "Spisy/podanie.md", targetPath: `${NESTED}/podanie.md` }))).toEqual(refused);
  expect(await status(await post("p", "/files/import", { path: `${NESTED}/import.md`, dataBase64: Buffer.from("x").toString("base64") }))).toEqual(refused);
  expect(existsSync(join(nested, "nove.md")) || existsSync(join(parent, "kopia.md")) || existsSync(join(nested, "podanie.md")) || existsSync(join(nested, "import.md"))).toBe(false);

  // Súborová relácia: katalóg bez N, čítanie a zápis v dávke odmietnuté po položkách, presun do N odmietnutý celý.
  const session = (await (await post("p", "/files/sessions", { write: true })).json()).session.id;
  const catalog = await (await get("", `/files/sessions/${session}/catalog/snapshot`)).json();
  const paths: string[] = catalog.items.map((item: { path: string }) => item.path);
  expect(paths).toContain("Spisy/podanie.md");
  expect(paths.some((path) => path.startsWith(NESTED))).toBe(false);
  const reads = await (await post("", `/files/sessions/${session}/read-batch`, { paths: [`${NESTED}/Zmluvy/zmluva.md`, "Spisy/podanie.md"] })).json();
  expect(reads.items.map((item: { ok: boolean; code?: string }) => [item.ok, item.code])).toEqual([[false, "nested_client_folder"], [true, undefined]]);
  const writes = await (await post("", `/files/sessions/${session}/write-batch`, { writes: [{ path: `${NESTED}/zapis.md`, contentBase64: Buffer.from("x").toString("base64") }] })).json();
  expect(writes.items.map((item: { ok: boolean; code?: string }) => [item.ok, item.code])).toEqual([[false, "nested_client_folder"]]);
  expect(await status(await post("", `/files/sessions/${session}/ops`, { operations: [{ type: "rename", from: "Spisy/podanie.md", to: `${NESTED}/podanie.md` }] }))).toEqual(refused);
  expect(await readFile(join(parent, "Spisy", "podanie.md"), "utf8")).toBe("Syntetické podanie\n");
  expect(existsSync(join(nested, "zapis.md"))).toBe(false);

  // Klient N svoj priečinok číta ďalej.
  const own = await get("n", "/files/content", { path: "Zmluvy/zmluva.md" });
  expect(own.status).toBe(200);
  expect((await own.json()).content).toBe("Syntetická zmluva vnoreného klienta\n");
});

test("vnorený priečinok bez karty pod kartou P je spis toho istého klienta: zoznam, čítanie aj zápis ostávajú", async () => {
  const { nested, get, post } = await serve(false);
  const list = await (await get("p", "/files/list")).json();
  expect(list.entries.map((entry: { name: string }) => entry.name)).toContain(NESTED);
  const content = await get("p", "/files/content", { path: `${NESTED}/Zmluvy/zmluva.md` });
  expect(content.status).toBe(200);
  expect((await post("p", "/files/content", { path: `${NESTED}/nove.md`, content: "Syntetický zápis\n" })).status).toBe(200);
  expect(await readFile(join(nested, "nove.md"), "utf8")).toBe("Syntetický zápis\n");
});

test("registrovaný kontajner praxe nie je klient: jeho zoznam aj čítanie klientov v ňom ostávajú", async () => {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-nested-files-prax-")));
  cleanups.push(() => removeTestDir(base));
  const practice = join(base, "Prax"), client = join(practice, "Klienti", "Tatran");
  await mkdir(client, { recursive: true });
  await writeFile(join(client, "client.md"), "# SYN Tatran\n");
  await writeFile(join(client, "zmluva.md"), "Syntetická zmluva\n");
  process.env.LEGALWORK_DATA_DIR = join(base, "data"); process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(base, "private", "runtime.sqlite");
  // Profil onboardingu s koreňom praxe (ako `officeRoot` v `linked-folders.ts`).
  await mkdir(join(base, "private", "lawoss-onboarding"), { recursive: true });
  await writeFile(join(base, "private", "lawoss-onboarding", "profile.json"), JSON.stringify({ officeRoot: practice }));
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "server.json"), token: "client", hostToken: "host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [],
    workspaces: [{ id: "prax", name: "Prax", preset: "starter", path: practice, workspaceType: "local" }, { id: "t", name: "Tatran", preset: "starter", path: client, workspaceType: "local" }],
    authorizedRoots: [practice, client], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config);
  cleanups.push(() => server.stop());
  const get = (path: string, query: Record<string, string>) => fetch(`http://127.0.0.1:${server.port}/workspace/prax${path}?${new URLSearchParams(query)}`, { headers: auth });
  const list = await (await get("/files/list", { path: "Klienti" })).json();
  expect(list.entries.map((entry: { name: string }) => entry.name)).toEqual(["Tatran"]);
  const content = await get("/files/content", { path: "Klienti/Tatran/zmluva.md" });
  expect(content.status).toBe(200);
  expect((await content.json()).content).toBe("Syntetická zmluva\n");
});
