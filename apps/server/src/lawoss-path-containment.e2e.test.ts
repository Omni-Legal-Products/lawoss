import { afterEach, expect, test } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path, { basename, join, parse } from "node:path";
import { childPathWithin } from "./lawoss/path-within.js";
import { resolveWithinRoot } from "./paths.js";
import { normalizeWorkspaceRelativePath, startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";

/**
 * Kontrola „leží cesta v priečinku klienta“ v súborových endpointoch, v adresári
 * relácie veci a v povolených koreňoch. Klient „Novak“ nesmie siahnuť do súrodenca
 * „Novak s.r.o“ a koreň končiaci lomkou musí vidieť svojich potomkov — prefix
 * `root + sep` ich odmietal. Koreň súborového systému (`/`, `C:\`) lomkou končí na
 * každom OS, takže to overí aj Linux; na Windows navyše workspace v koreni disku
 * (`X:\`) a zdieľania (`\\localhost\share\`). Údaje sú syntetické.
 */
const previous = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE };
const cleanups: (() => Promise<void> | void)[] = [];
// Bun po 5 s zabije test aj hook spolu s bežiacim `net`/`subst` (overené s bun 1.4.2 na
// synchrónnom execFileSync); Windows prípady a upratanie preto majú vlastný limit.
const COMMAND_TIMEOUT_MS = 30_000;
const WINDOWS_TIMEOUT_MS = 120_000;
afterEach(async () => {
  // Každé upratanie prebehne, aj keď predchádzajúce zlyhá (inak by ostal disk alebo zdieľanie).
  const errors: unknown[] = [];
  for (const cleanup of cleanups.splice(0).reverse()) {
    try { await cleanup(); } catch (error) { errors.push(error); }
  }
  for (const [key, value] of Object.entries({ LEGALWORK_DATA_DIR: previous.data, LEGALWORK_TOKEN_STORE: previous.tokens })) {
    if (value === undefined) delete process.env[key]; else process.env[key] = value;
  }
  if (errors.length) throw new AggregateError(errors, "upratanie testu zlyhalo");
}, WINDOWS_TIMEOUT_MS);

/** Upratanie najviac raz: z `finally` testu aj z afterEach, ktorý po vypršaní testu beží skôr než jeho `finally`. */
function cleanupOnce(cleanup: () => Promise<void> | void): () => Promise<void> {
  let done: Promise<void> | undefined;
  const run = () => (done ??= Promise.resolve().then(cleanup));
  cleanups.push(run);
  return run;
}

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

async function serve(base: string, workspacePath: string, authorizedRoots = [workspacePath]) {
  const engine = fakeEngine();
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(base, "server.json"), token: "client", hostToken: "host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [{ id: "novak", name: "Novak", preset: "starter", path: workspacePath, workspaceType: "local", baseUrl: engine.url }], authorizedRoots, readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config);
  const stop = cleanupOnce(() => server.stop());
  const url = `http://127.0.0.1:${server.port}/workspace/novak`;
  const get = (path: string, query: Record<string, string> = {}) => fetch(`${url}${path}?${new URLSearchParams(query)}`, { headers: auth });
  return { get, engine, stop };
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
  // `..` zastaví už normalizeWorkspaceRelativePath, k resolveSafeChildPath sa nedostane.
  expect((await get("/files/content", { path: `../${basename(input.sibling)}/tajne.md` })).status).toBe(400);
  // Absolútna cesta: na Windows ostane `C:/…` absolútna a zastaví ju až resolveSafeChildPath;
  // na POSIX normalizácia zahodí úvodnú lomku, takže je to neexistujúci súbor vo workspace-i.
  const absolute = await get("/files/content", { path: join(input.sibling, "tajne.md") });
  expect([absolute.status, (await absolute.json()).code]).toEqual(process.platform === "win32" ? [400, "invalid_path"] : [404, "file_not_found"]);
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

test("adresár relácie pod koreňom súborového systému (`/`, `C:\\`) nie je mimo neho", async () => {
  const f = await office();
  const fsRoot = parse(f.novak).root;
  const matter = join(f.novak, ...MATTER.split("/"));
  expect(await resolveWithinRoot(fsRoot, matter)).toBe(matter);
  expect(await resolveWithinRoot(fsRoot, path.relative(fsRoot, matter))).toBe(matter);
});

test("povolený koreň súborového systému (`/`, `C:\\`) pustí workspace pod ním", async () => {
  const f = await office();
  const { get, engine } = await serve(f.base, f.novak, [parse(f.base).root]);
  await expectContained({ get, engine, matterDirectory: join(f.novak, ...MATTER.split("/")), sibling: f.sibling });
});

test("povolený priečinok Novak nepovolí súrodenca Novak s.r.o", async () => {
  const f = await office();
  const { get } = await serve(f.base, f.sibling, [f.novak]);
  const response = await get("/files/list");
  expect(response.status).toBe(403);
  expect((await response.json()).code).toBe("workspace_unauthorized");
});

// Prečo Windows v expectContained čaká 400 a POSIX 404 (simulácia cez path.win32).
test("absolútna cesta k súrodencovi: na Windows ju zastaví až kontrola potomka", () => {
  const windows = normalizeWorkspaceRelativePath("C:\\Klienti\\Novak s.r.o\\tajne.md", { allowSubdirs: true });
  expect(windows).toBe("C:/Klienti/Novak s.r.o/tajne.md");
  for (const root of ["C:\\Klienti\\Novak", "X:\\", "\\\\localhost\\share\\"]) expect(childPathWithin(root, windows, path.win32)).toBeNull();
  const posix = normalizeWorkspaceRelativePath("/Klienti/Novak s.r.o/tajne.md", { allowSubdirs: true });
  expect(childPathWithin("/Klienti/Novak", posix, path.posix)).toBe("/Klienti/Novak/Klienti/Novak s.r.o/tajne.md");
});

function freeDriveLetter() {
  for (const letter of "PQRSTUVWXY") if (!existsSync(`${letter}:\\`)) return letter;
  return null;
}

/**
 * Lokálne sa Windows prípad bez voľného písmena alebo bez správcu len preskočí. Na GitHub
 * Actions (runner je správca) musí prebehnúť, inak by CI ostalo zelené bez kontroly.
 */
function skipOutsideCi(reason: string, error?: unknown): void {
  if (process.env.GITHUB_ACTIONS) throw error ?? new Error(reason);
  console.warn(`preskočené: ${reason}`);
}

/** Workspace v pripojenom koreni; ten sa vo `finally` odpojí až po stope servera (jeho watcher ho drží), aj keď test zlyhá. */
async function expectContainedInMount(f: Awaited<ReturnType<typeof office>>, mount: string, unmount: () => void) {
  const release = cleanupOnce(unmount);
  let stop: (() => Promise<void>) | undefined;
  try {
    const served = await serve(f.base, mount);
    stop = served.stop;
    await expectContained({ get: served.get, engine: served.engine, matterDirectory: `${mount}${MATTER.replaceAll("/", "\\")}`, sibling: f.sibling });
  } finally {
    try { await stop?.(); } finally { await release(); }
  }
}

test.skipIf(process.platform !== "win32")("Windows: workspace v koreni disku (subst X:\\) vidí súbory, súrodenec mimo disku nie", async () => {
  const f = await office();
  const letter = freeDriveLetter();
  if (!letter) return skipOutsideCi("žiadne voľné písmeno disku");
  execFileSync("subst", [`${letter}:`, f.novak], { stdio: "pipe", timeout: COMMAND_TIMEOUT_MS });
  await expectContainedInMount(f, `${letter}:\\`, () => { execFileSync("subst", [`${letter}:`, "/D"], { stdio: "pipe", timeout: COMMAND_TIMEOUT_MS }); });
}, WINDOWS_TIMEOUT_MS);

test.skipIf(process.platform !== "win32")("Windows: workspace v koreni zdieľania (\\\\localhost\\share\\) vidí súbory, súrodenec mimo zdieľania nie", async () => {
  const f = await office();
  const name = `lawoss-g3-${process.pid}`;
  try {
    execFileSync("net", ["share", `${name}=${f.novak}`, "/GRANT:Everyone,FULL"], { stdio: "pipe", timeout: COMMAND_TIMEOUT_MS });
  } catch (error) {
    return skipOutsideCi(`zdieľanie ${name} sa nepodarilo vytvoriť (treba správcu)`, error);
  }
  await expectContainedInMount(f, `\\\\localhost\\${name}\\`, () => { execFileSync("net", ["share", name, "/delete", "/y"], { stdio: "pipe", timeout: COMMAND_TIMEOUT_MS }); });
}, WINDOWS_TIMEOUT_MS);
