import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join } from "node:path";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";

/**
 * Kontrola „leží cesta v priečinku klienta“ v súborových endpointoch a v adresári
 * relácie veci. Klient „Novak“ nesmie siahnuť do súrodenca „Novak s.r.o“ a na Windows
 * musí workspace v koreni disku (`X:\`) aj zdieľania (`\\localhost\share\`) vidieť
 * svoje súbory — prefix `root + sep` ich pri koreni končiacom lomkou odmietal.
 * Údaje sú syntetické.
 */
const previous = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE };
const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: previous.data, LEGALWORK_TOKEN_STORE: previous.tokens })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
});

const MATTER = "Spisy/2026-03 Zmluva";
const auth = { authorization: "Bearer client" };

async function office() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-containment-")));
  cleanups.push(() => removeTestDir(base));
  const novak = join(base, "Klienti", "Novak"), sibling = join(base, "Klienti", "Novak s.r.o");
  await mkdir(join(novak, ...MATTER.split("/")), { recursive: true });
  await writeFile(join(novak, ...MATTER.split("/"), "zmluva.md"), "Syntetická zmluva\n");
  await mkdir(sibling, { recursive: true });
  await writeFile(join(sibling, "tajne.md"), "Iný klient\n");
  process.env.LEGALWORK_DATA_DIR = join(base, "data"); process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  return { base, novak, sibling };
}

/** Engine na skúšku: zapamätá si, s akým adresárom relácie ho server zavolal. */
function fakeEngine() {
  const directories: string[] = [];
  const engine = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const directory = new URL(request.url).searchParams.get("directory");
      if (directory) directories.push(directory);
      return Response.json([]);
    },
  });
  cleanups.push(() => engine.stop(true));
  return { url: `http://127.0.0.1:${engine.port}`, directories };
}

async function serve(base: string, workspacePath: string) {
  const engine = fakeEngine();
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "server.json"), token: "client", hostToken: "host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "novak", name: "Novak", preset: "starter", path: workspacePath, workspaceType: "local", baseUrl: engine.url }], authorizedRoots: [workspacePath], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config);
  cleanups.push(async () => { await server.stop(); });
  const url = `http://127.0.0.1:${server.port}/workspace/novak`;
  const get = (path: string, query: Record<string, string> = {}) => fetch(`${url}${path}?${new URLSearchParams(query)}`, { headers: auth });
  return { get, engine };
}

/** Zoznam, čítanie súboru a relácia vo veci vnútri klienta; súrodenec s rovnakým začiatkom názvu je mimo. */
async function expectContained(input: { get: Awaited<ReturnType<typeof serve>>["get"]; engine: ReturnType<typeof fakeEngine>; matterDirectory: string; sibling: string }) {
  const { get, engine } = input;
  const root = await get("/files/list");
  expect(root.status).toBe(200);
  expect((await root.json()).entries).toEqual(expect.arrayContaining([expect.objectContaining({ name: "Spisy", kind: "dir" })]));
  const matter = await get("/files/list", { path: MATTER });
  expect(matter.status).toBe(200);
  expect((await matter.json()).entries).toEqual([expect.objectContaining({ name: "zmluva.md", path: `${MATTER}/zmluva.md`, kind: "file" })]);
  const content = await get("/files/content", { path: `${MATTER}/zmluva.md` });
  expect(content.status).toBe(200);
  expect((await content.json()).content).toBe("Syntetická zmluva\n");
  expect((await get("/files/stat", { path: `${MATTER}/zmluva.md` })).status).toBe(200);
  expect((await get("/reviews")).status).toBe(200);

  // Relácia vo veci: adresár vnútri klienta prejde k enginu po realpath.
  const session = await get("/opencode/session", { directory: input.matterDirectory });
  expect(session.status).toBe(200);
  expect(engine.directories.at(-1)).toBe(await realpath(input.matterDirectory));

  // Súrodenec „Novak s.r.o“: ani súbor, ani relácia; k enginu sa nedostane.
  const seen = engine.directories.length;
  expect((await get("/files/content", { path: `../${basename(input.sibling)}/tajne.md` })).status).toBe(400);
  for (const directory of [input.sibling, join(input.sibling, "tajne.md")]) {
    const escaped = await get("/opencode/session", { directory });
    expect(escaped.status).toBe(400);
    expect((await escaped.json()).code).toBe("path_escape");
  }
  expect(engine.directories.length).toBe(seen);
}

test("klient Novak vidí svoje súbory a reláciu vo veci, súrodenca Novak s.r.o nie", async () => {
  const f = await office();
  const { get, engine } = await serve(f.base, f.novak);
  await expectContained({ get, engine, matterDirectory: join(f.novak, ...MATTER.split("/")), sibling: f.sibling });
  const relative = await get("/opencode/session", { directory: "../Novak s.r.o" });
  expect(relative.status).toBe(400);
  expect((await relative.json()).code).toBe("path_escape");
});

function freeDriveLetter() {
  for (const letter of "PQRSTUVWXY") if (!existsSync(`${letter}:\\`)) return letter;
  return null;
}

test.skipIf(process.platform !== "win32")("Windows: workspace v koreni disku (subst X:\\) vidí súbory, súrodenec mimo disku nie", async () => {
  const f = await office();
  const letter = freeDriveLetter();
  if (!letter) return console.warn("preskočené: žiadne voľné písmeno disku");
  execFileSync("subst", [`${letter}:`, f.novak]);
  cleanups.push(() => { execFileSync("subst", [`${letter}:`, "/D"]); });
  const drive = `${letter}:\\`;
  const { get, engine } = await serve(f.base, drive);
  await expectContained({ get, engine, matterDirectory: `${drive}${MATTER.replaceAll("/", "\\")}`, sibling: f.sibling });
});

test.skipIf(process.platform !== "win32")("Windows: workspace v koreni zdieľania (\\\\localhost\\share\\) vidí súbory, súrodenec mimo zdieľania nie", async () => {
  const f = await office();
  const name = `lawoss-g3-${process.pid}`;
  try {
    execFileSync("net", ["share", `${name}=${f.novak}`, "/GRANT:Everyone,FULL"], { stdio: "ignore", timeout: 30_000 });
  } catch {
    return console.warn(`preskočené: zdieľanie ${name} sa nepodarilo vytvoriť (treba správcu)`);
  }
  cleanups.push(() => { execFileSync("net", ["share", name, "/delete", "/y"], { stdio: "ignore", timeout: 30_000 }); });
  const share = `\\\\localhost\\${name}\\`;
  const { get, engine } = await serve(f.base, share);
  await expectContained({ get, engine, matterDirectory: `${share}${MATTER.replaceAll("/", "\\")}`, sibling: f.sibling });
});
