// LAWOSS: izolovaný domov enginu a jednorazový import prihlásení. Len syntetické dočasné priečinky.
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { chmod, mkdir, mkdtemp, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  ENGINE_DATA_IMPORT_MARKER,
  importPreviousEngineData,
  isolatedEngineXdgEnv,
  prepareIsolatedEngineHome,
  previousEngineDataDirectory,
} from "./engine-home.js";

const roots: string[] = [];
afterEach(async () => { while (roots.length) await rm(roots.pop() ?? "", { recursive: true, force: true }); });

async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "lawoss-engine-home-"));
  roots.push(root);
  const source = path.join(root, "global-data", "opencode");
  const engineHome = path.join(root, "storage", "engine-home");
  await mkdir(source, { recursive: true });
  await mkdir(engineHome, { recursive: true });
  return { root, source, engineHome, dataHome: path.join(engineHome, "data") };
}

const sha = async (file: string) => createHash("sha256").update(await readFile(file)).digest("hex");
const syntheticAuth = JSON.stringify({ synthetic: { type: "api", key: "synthetic-not-a-secret" } });
const syntheticMcpAuth = JSON.stringify({ synthetic: { serverUrl: "http://127.0.0.1:9/mcp", tokens: { accessToken: "synthetic" } } });

describe("isolatedEngineXdgEnv", () => {
  test("dáta a cache enginu ležia pod engine-home (presná mapa)", () => {
    const home = path.resolve("/synthetic/storage/engine-home");
    expect(isolatedEngineXdgEnv(home, {})).toEqual({ XDG_DATA_HOME: path.join(home, "data"), XDG_CACHE_HOME: path.join(home, "cache") });
  });

  test("výslovné LEGALWORK_ENGINE_DATA_HOME samostatného servera má prednosť pre dáta", () => {
    const home = path.resolve("/synthetic/engine-home");
    const explicit = path.resolve("/synthetic/explicit-data");
    expect(isolatedEngineXdgEnv(home, { LEGALWORK_ENGINE_DATA_HOME: ` ${explicit} ` })).toEqual({ XDG_DATA_HOME: explicit, XDG_CACHE_HOME: path.join(home, "cache") });
  });

  test("model ciest Windows (path.win32, nie beh na Windows)", () => {
    expect(isolatedEngineXdgEnv("C:\\Users\\synthetic\\AppData\\Roaming\\legalwork\\engine-home", {}, "win32")).toEqual({
      XDG_DATA_HOME: "C:\\Users\\synthetic\\AppData\\Roaming\\legalwork\\engine-home\\data",
      XDG_CACHE_HOME: "C:\\Users\\synthetic\\AppData\\Roaming\\legalwork\\engine-home\\cache",
    });
  });
});

describe("previousEngineDataDirectory", () => {
  test("zdedené XDG_DATA_HOME servera (vývoj, testovacie profily)", () => {
    const xdg = path.resolve("/synthetic/profile/xdg/data");
    expect(previousEngineDataDirectory({ XDG_DATA_HOME: xdg }, "darwin", "/unused")).toBe(path.posix.join(xdg, "opencode"));
  });

  test("bez XDG ide o ~/.local/share/opencode podľa HOME, resp. USERPROFILE na Windows", () => {
    expect(previousEngineDataDirectory({ HOME: "/home/synthetic" }, "linux", "/unused")).toBe("/home/synthetic/.local/share/opencode");
    expect(previousEngineDataDirectory({}, "darwin", "/Users/synthetic")).toBe("/Users/synthetic/.local/share/opencode");
    expect(previousEngineDataDirectory({ USERPROFILE: "C:\\Users\\synthetic", HOME: "/ignored" }, "win32", "C:\\unused")).toBe("C:\\Users\\synthetic\\.local\\share\\opencode");
  });
});

describe("importPreviousEngineData", () => {
  test("skopíruje auth.json a mcp-auth.json bajt po bajte, originály ostanú nezmenené", async () => {
    const { source, engineHome, dataHome } = await fixture();
    await writeFile(path.join(source, "auth.json"), syntheticAuth, { mode: 0o600 });
    await writeFile(path.join(source, "mcp-auth.json"), syntheticMcpAuth, { mode: 0o600 });
    await writeFile(path.join(source, "opencode.db"), "synthetic-db");
    await mkdir(path.join(source, "snapshot"), { recursive: true });
    const before = { auth: await sha(path.join(source, "auth.json")), mcp: await sha(path.join(source, "mcp-auth.json")), mtime: (await stat(path.join(source, "auth.json"))).mtimeMs };

    const result = await importPreviousEngineData({ engineHome, dataHome, sourceDirectory: source, now: () => new Date("2026-11-10T00:00:00Z") });

    expect(result).toEqual({ status: "done", source, files: { "auth.json": "copied", "mcp-auth.json": "copied" } });
    const destination = path.join(dataHome, "opencode");
    expect(await sha(path.join(destination, "auth.json"))).toBe(before.auth);
    expect(await sha(path.join(destination, "mcp-auth.json"))).toBe(before.mcp);
    expect(await sha(path.join(source, "auth.json"))).toBe(before.auth);
    expect((await stat(path.join(source, "auth.json"))).mtimeMs).toBe(before.mtime);
    expect((await readdir(destination)).sort()).toEqual(["auth.json", "mcp-auth.json"]);
    if (process.platform !== "win32") expect((await stat(path.join(destination, "auth.json"))).mode & 0o777).toBe(0o600);
    const marker = JSON.parse(await readFile(path.join(engineHome, ENGINE_DATA_IMPORT_MARKER), "utf8"));
    expect(marker).toEqual({ version: 1, importedAt: "2026-11-10T00:00:00.000Z", source, files: { "auth.json": "copied", "mcp-auth.json": "copied" } });
    expect(JSON.stringify(marker)).not.toContain("synthetic-not-a-secret");
  });

  test("beží len raz: po značke sa zmena originálu už neprenesie", async () => {
    const { source, engineHome, dataHome } = await fixture();
    await writeFile(path.join(source, "auth.json"), syntheticAuth);
    await importPreviousEngineData({ engineHome, dataHome, sourceDirectory: source });
    const imported = await sha(path.join(dataHome, "opencode", "auth.json"));
    await writeFile(path.join(source, "auth.json"), JSON.stringify({ changed: true }));
    await writeFile(path.join(source, "mcp-auth.json"), syntheticMcpAuth);

    expect(await importPreviousEngineData({ engineHome, dataHome, sourceDirectory: source })).toEqual({ status: "already-imported" });
    expect(await sha(path.join(dataHome, "opencode", "auth.json"))).toBe(imported);
    expect(existsSync(path.join(dataHome, "opencode", "mcp-auth.json"))).toBe(false);
  });

  test("existujúci cieľ sa neprepíše", async () => {
    const { source, engineHome, dataHome } = await fixture();
    await writeFile(path.join(source, "auth.json"), syntheticAuth);
    await mkdir(path.join(dataHome, "opencode"), { recursive: true });
    await writeFile(path.join(dataHome, "opencode", "auth.json"), "isolated-newer");

    const result = await importPreviousEngineData({ engineHome, dataHome, sourceDirectory: source });

    expect(result).toEqual({ status: "done", source, files: { "auth.json": "kept", "mcp-auth.json": "missing" } });
    expect(await readFile(path.join(dataHome, "opencode", "auth.json"), "utf8")).toBe("isolated-newer");
  });

  test("bez zdroja zapíše značku a nič neskopíruje", async () => {
    const { root, engineHome, dataHome } = await fixture();
    const result = await importPreviousEngineData({ engineHome, dataHome, sourceDirectory: path.join(root, "nothing", "opencode") });
    expect(result.status).toBe("done");
    expect(existsSync(path.join(engineHome, ENGINE_DATA_IMPORT_MARKER))).toBe(true);
    expect(await readdir(path.join(dataHome, "opencode"))).toEqual([]);
  });

  test("po páde uprostred: dočasné súbory sa odstránia, hotová kópia ostane, import sa dokončí", async () => {
    const { source, engineHome, dataHome } = await fixture();
    await writeFile(path.join(source, "auth.json"), syntheticAuth);
    await writeFile(path.join(source, "mcp-auth.json"), syntheticMcpAuth);
    const destination = path.join(dataHome, "opencode");
    await mkdir(destination, { recursive: true });
    await writeFile(path.join(destination, "auth.json"), syntheticAuth);
    await writeFile(path.join(destination, "mcp-auth.json.lawoss-import-0000.tmp"), "partial");

    const result = await importPreviousEngineData({ engineHome, dataHome, sourceDirectory: source });

    expect(result).toEqual({ status: "done", source, files: { "auth.json": "kept", "mcp-auth.json": "copied" } });
    expect((await readdir(destination)).sort()).toEqual(["auth.json", "mcp-auth.json"]);
    expect(await sha(path.join(destination, "mcp-auth.json"))).toBe(await sha(path.join(source, "mcp-auth.json")));
  });

  test.skipIf(process.platform === "win32" || process.getuid?.() === 0)("chyba kopírovania zastaví štart a značku nezapíše", async () => {
    const { source, engineHome, dataHome } = await fixture();
    const auth = path.join(source, "auth.json");
    await writeFile(auth, syntheticAuth);
    await chmod(auth, 0o000);
    try {
      await expect(importPreviousEngineData({ engineHome, dataHome, sourceDirectory: source })).rejects.toThrow("auth.json");
      expect(existsSync(path.join(engineHome, ENGINE_DATA_IMPORT_MARKER))).toBe(false);
      expect(await readdir(path.join(dataHome, "opencode"))).toEqual([]);
    } finally { await chmod(auth, 0o600); }
    expect(await readFile(auth, "utf8")).toBe(syntheticAuth);
  });

  test("rovnaký zdroj a cieľ (výslovné LEGALWORK_ENGINE_DATA_HOME) nič nekopíruje", async () => {
    const { engineHome, dataHome } = await fixture();
    expect(await importPreviousEngineData({ engineHome, dataHome, sourceDirectory: path.join(dataHome, "opencode") })).toEqual({ status: "same-directory" });
    expect(existsSync(path.join(engineHome, ENGINE_DATA_IMPORT_MARKER))).toBe(true);
  });
});

describe("prepareIsolatedEngineHome", () => {
  test("výslovné LEGALWORK_ENGINE_DATA_HOME nič neimportuje z globálneho profilu", async () => {
    const { root, engineHome } = await fixture();
    const previousXdg = path.join(root, "profile-xdg-data");
    const explicit = path.join(root, "explicit-data");
    await mkdir(path.join(previousXdg, "opencode"), { recursive: true });
    await writeFile(path.join(previousXdg, "opencode", "auth.json"), syntheticAuth);

    const env = await prepareIsolatedEngineHome(engineHome, { XDG_DATA_HOME: previousXdg, LEGALWORK_ENGINE_DATA_HOME: explicit });

    expect(env).toEqual({ XDG_DATA_HOME: explicit, XDG_CACHE_HOME: path.join(engineHome, "cache") });
    expect(existsSync(explicit)).toBe(false);
    expect(existsSync(path.join(engineHome, ENGINE_DATA_IMPORT_MARKER))).toBe(false);
  });

  test("vráti presné prostredie enginu a importuje z doterajšieho XDG_DATA_HOME servera", async () => {
    const { root, engineHome } = await fixture();
    const previousXdg = path.join(root, "profile-xdg-data");
    await mkdir(path.join(previousXdg, "opencode"), { recursive: true });
    await writeFile(path.join(previousXdg, "opencode", "auth.json"), syntheticAuth);

    const env = await prepareIsolatedEngineHome(engineHome, { XDG_DATA_HOME: previousXdg, HOME: path.join(root, "home") });

    expect(env).toEqual({ XDG_DATA_HOME: path.join(engineHome, "data"), XDG_CACHE_HOME: path.join(engineHome, "cache") });
    expect(await sha(path.join(engineHome, "data", "opencode", "auth.json"))).toBe(await sha(path.join(previousXdg, "opencode", "auth.json")));
    expect(existsSync(path.join(engineHome, "cache"))).toBe(true);
    expect(existsSync(path.join(root, "home"))).toBe(false);
  });
});
