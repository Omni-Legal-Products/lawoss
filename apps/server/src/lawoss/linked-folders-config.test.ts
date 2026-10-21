// LAWOSS: pripojené priečinky klienta (MČ 19. 10. 2026) idú cez natívne povolené priečinky
// (`permission.external_directory` riadku klienta). Test na úrovni konfigurácie: čo z natívneho zápisu
// dostane engine, pre ktorého klienta a že iný klient to nevidí.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildLegalworkRuntimeConfigObject, keepLegalworkRuntimeConfigFileFresh, legalworkRuntimeConfigFilePath, writeLegalworkRuntimeConfigFile } from "../legalwork-runtime-config.js";
import { readRuntimeOpencodeConfig, runtimeStorageDir, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { linkableFolders, linkedFoldersMapPath, writeLinkedFoldersMap } from "./linked-folders.js";
import { parseLinkedFoldersMap } from "./linked-folders-rules.js";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";

const CLIENT_TOKEN = "owt_linked_folders_client";
const stops: Array<() => void | Promise<void>> = [];
const roots: string[] = [];
const prior = { data: process.env.LEGALWORK_DATA_DIR, tokens: process.env.LEGALWORK_TOKEN_STORE, db: process.env.LEGALWORK_RUNTIME_DB };

const restore = (key: "LEGALWORK_DATA_DIR" | "LEGALWORK_TOKEN_STORE" | "LEGALWORK_RUNTIME_DB", value: string | undefined) => {
  if (value === undefined) delete process.env[key];
  else process.env[key] = value;
};

beforeEach(async () => {
  const env = await realpath(await mkdtemp(join(tmpdir(), "lawoss-linked-env-")));
  roots.push(env);
  process.env.LEGALWORK_DATA_DIR = join(env, "data");
  process.env.LEGALWORK_TOKEN_STORE = join(env, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(env, "runtime.sqlite");
});

afterEach(async () => {
  try {
    while (stops.length) await stops.pop()?.();
    while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
  } finally {
    restore("LEGALWORK_DATA_DIR", prior.data);
    restore("LEGALWORK_TOKEN_STORE", prior.tokens);
    restore("LEGALWORK_RUNTIME_DB", prior.db);
  }
});

async function practice() {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-linked-")));
  roots.push(root);
  const client = join(root, "prax", "Klienti", "Tatran");
  const other = join(root, "prax", "Klienti", "Hron");
  const linked = join(root, "Zdieľané", "Vzory zmlúv");
  const practiceRoot = join(root, "prax");
  for (const folder of [join(client, "Spisy", "Uhrada"), other, join(linked, "Rok 2026"), join(practiceRoot, "_kancelaria"), join(practiceRoot, "Vzory")]) await mkdir(folder, { recursive: true });
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, configPath: join(root, "server.json"), token: CLIENT_TOKEN, hostToken: "owt_linked_folders_host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [
      { id: "ws_client", name: "Tatran", path: client, preset: "starter", workspaceType: "local" },
      { id: "ws_other", name: "Hron", path: other, preset: "starter", workspaceType: "local" },
    ],
    authorizedRoots: [client, other], readOnly: false, startedAt: Date.now(),
    tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const server = await startServer(config);
  stops.push(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  const patch = (workspaceId: string, externalDirectory: Record<string, unknown>) => fetch(`${base}/workspace/${workspaceId}/config`, {
    method: "PATCH", headers: { authorization: `Bearer ${CLIENT_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ opencode: { permission: { external_directory: externalDirectory } } }),
  });
  const host = (path: string, method: string, body?: unknown) => fetch(`${base}${path}`, {
    method, headers: { "x-legalwork-host-token": "owt_linked_folders_host", "content-type": "application/json" }, body: body === undefined ? undefined : JSON.stringify(body),
  });
  const put = (workspaceId: string, folders: string[]) => fetch(`http://127.0.0.1:${server.port}/workspace/${workspaceId}/authorized-folders`, {
    method: "PUT", headers: { authorization: `Bearer ${CLIENT_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ folders }),
  });
  const writeProfile = async () => {
    await mkdir(join(runtimeStorageDir(config), "lawoss-onboarding"), { recursive: true });
    await writeFile(join(runtimeStorageDir(config), "lawoss-onboarding", "profile.json"), JSON.stringify({ officeRoot: practiceRoot }));
  };
  const readMap = async () => parseLinkedFoldersMap(JSON.parse(await readFile(linkedFoldersMapPath(config), "utf8")));
  return { root, config, client, other, linked, practiceRoot, put, patch, host, writeProfile, readMap };
}

const externalDirectory = (built: Record<string, unknown>): Record<string, unknown> => {
  const permission = built.permission;
  if (!permission || typeof permission !== "object" || Array.isArray(permission)) return {};
  const value = "external_directory" in permission ? permission.external_directory : undefined;
  return value && typeof value === "object" && !Array.isArray(value) ? { ...value } : {};
};

const code = async (response: Response) => ({ status: response.status, code: (await response.json() as { code?: string }).code });

describe("pripojené priečinky klienta: spoločný súbor enginu a mapa pre plugin", () => {
  test("spoločný súbor nenesie priečinky žiadneho klienta (ani spúšťacieho); iné položky ostanú", async () => {
    const { config, linked, put } = await practice();
    await writeRuntimeOpencodeConfig(config, "ws_client", (current) => ({ ...current, permission: { external_directory: { "/denied/*": "deny" } } }));
    expect((await put("ws_client", [linked])).status).toBe(200);
    expect(externalDirectory(await buildLegalworkRuntimeConfigObject(config, "ws_client"))).toEqual({ "/denied/*": "deny" });
    const file: unknown = JSON.parse(await readFile(await writeLegalworkRuntimeConfigFile(config, "ws_client"), "utf8"));
    expect(file && typeof file === "object" && !Array.isArray(file) ? externalDirectory({ ...file }) : {}).toEqual({ "/denied/*": "deny" });
    expect((file && typeof file === "object" && "plugin" in file && Array.isArray(file.plugin) ? file.plugin : []).some((spec: unknown) => typeof spec === "string" && /lawoss-linked-folders\.(?:js|ts)/.test(spec))).toBe(true);
  });

  test("mapa: každý klient so svojím koreňom a pripojenými priečinkami; zápis iného klienta ju obnoví bez prepisu súboru", async () => {
    const { config, client, other, linked, put, readMap } = await practice();
    await writeLegalworkRuntimeConfigFile(config, "ws_client");
    stops.push(keepLegalworkRuntimeConfigFileFresh(config, "ws_client"));
    expect((await put("ws_other", [linked])).status).toBe(200);
    let map = await readMap();
    for (let attempt = 0; attempt < 50 && !map?.clients.some((entry) => entry.folders.length); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      map = await readMap();
    }
    expect(map?.clients).toEqual([{ root: client, folders: [] }, { root: other, folders: [linked] }]);
    expect(map?.firmManaged).toBe(false);
    expect(map?.officeRoot).toBeNull();
  });

  test("odpojenie cez natívny zápis zachová položky, ktoré zoznam neukazuje (napr. odmietnutia)", async () => {
    const { config, linked, put } = await practice();
    await writeRuntimeOpencodeConfig(config, "ws_client", (current) => ({
      ...current, permission: { ...current.permission, external_directory: { "/denied/*": "deny", [`${linked}/*`]: "allow" } },
    }));
    expect((await put("ws_client", [])).status).toBe(200);
    expect((await readRuntimeOpencodeConfig(config, "ws_client")).permission?.external_directory).toEqual({ "/denied/*": "deny" });
  });
});

describe("pripojené priečinky klienta: kontrola natívneho zápisu na serveri", () => {
  test("priečinok iného klienta, jeho podpriečinok aj priečinok, ktorý ho obsahuje, sa odmietne", async () => {
    const { other, put, root } = await practice();
    expect(await code(await put("ws_client", [other]))).toEqual({ status: 409, code: "linked_folder_other_client" });
    expect(await code(await put("ws_client", [join(other, "Spisy")]))).toEqual({ status: 409, code: "linked_folder_other_client" });
    expect(await code(await put("ws_client", [join(root, "prax", "Klienti")]))).toEqual({ status: 409, code: "linked_folder_other_client" });
  });

  test("symbolický odkaz do iného klienta sa vyrieši a odmietne", async () => {
    const { other, put, root } = await practice();
    const shortcut = join(root, "Zdieľané", "Odkaz na Hron");
    await symlink(other, shortcut);
    expect(await code(await put("ws_client", [shortcut]))).toEqual({ status: 409, code: "linked_folder_other_client" });
  });

  test("prax: jej priečinok sa nepripojí, pamäť kancelárie áno; priečinok mimo praxe áno", async () => {
    const { linked, practiceRoot, put, writeProfile, readMap, config } = await practice();
    await writeProfile();
    expect(await code(await put("ws_client", [join(practiceRoot, "Vzory")]))).toEqual({ status: 409, code: "linked_folder_practice" });
    expect(await code(await put("ws_client", [practiceRoot]))).toEqual({ status: 409, code: "linked_folder_other_client" });
    expect((await put("ws_client", [join(practiceRoot, "_kancelaria"), linked])).status).toBe(200);
    await writeLegalworkRuntimeConfigFile(config, "ws_client");
    expect((await readMap())?.officeRoot).toBe(practiceRoot);
  });

  test("už uložené položky sa pri ďalšom zápise neoverujú znova; chýbajúca cesta mimo klientov ostáva ako v upstreame", async () => {
    const { config, other, put, root } = await practice();
    await writeRuntimeOpencodeConfig(config, "ws_client", (current) => ({ ...current, permission: { external_directory: { [`${other}/*`]: "allow" } } }));
    expect((await put("ws_client", [other, join(root, "Neexistuje")])).status).toBe(200);
  });
});

describe("pripojené priečinky klienta: oprava 2", () => {
  test("spoločný súbor: preč ide každé povolenie priečinka (`**`, glob, holý priečinok, `~/…`), ostane holé `*`, odmietnutia a otázky", async () => {
    const { config } = await practice();
    await writeRuntimeOpencodeConfig(config, "ws_client", (current) => ({ ...current, permission: { external_directory: {
      "/a/**": "allow", "/b/*.pdf": "allow", "/c": "allow", "~/d/*": "allow", "/e/*": "allow", "*": "allow", "/f/*": "deny", "/g/*": "ask",
    } } }));
    expect(externalDirectory(await buildLegalworkRuntimeConfigObject(config, "ws_client"))).toEqual({ "*": "allow", "/f/*": "deny", "/g/*": "ask" });
  });

  test("PATCH konfigurácie: povolenie priečinka len ako `<absolútny priečinok>/*` cez tie isté pravidlá; holé `*` smie", async () => {
    const { other, linked, patch } = await practice();
    expect(await code(await patch("ws_client", { [`${other}/*`]: "allow" }))).toEqual({ status: 409, code: "linked_folder_other_client" });
    expect(await code(await patch("ws_client", { [`${linked}/**`]: "allow" }))).toEqual({ status: 400, code: "linked_folder_pattern" });
    expect(await code(await patch("ws_client", { "Zdielane/*": "allow" }))).toEqual({ status: 400, code: "linked_folder_relative" });
    expect((await patch("ws_client", { [`${linked}/*`]: "allow", "/deny/*": "deny" })).status).toBe(200);
    expect((await patch("ws_client", { "*": "allow" })).status).toBe(200);
  });

  test("relatívna cesta a priečinok s dátami aplikácie sa nepripojí", async () => {
    const { config, put } = await practice();
    expect(await code(await put("ws_client", ["Zdielane/Vzory"]))).toEqual({ status: 400, code: "linked_folder_relative" });
    expect(await code(await put("ws_client", [runtimeStorageDir(config)]))).toEqual({ status: 409, code: "linked_folder_app_data" });
    expect(await code(await put("ws_client", [join(runtimeStorageDir(config), "..")]))).toEqual({ status: 409, code: "linked_folder_app_data" });
    await mkdir(join(runtimeStorageDir(config), "bundled-plugins"), { recursive: true });
    expect(await code(await put("ws_client", [join(runtimeStorageDir(config), "bundled-plugins")]))).toEqual({ status: 409, code: "linked_folder_app_data" });
  });

  test("registrácia klienta obnoví mapu hneď (klient B vnútri A nepatrí A až do ďalšieho zápisu)", async () => {
    const { config, client, host, readMap } = await practice();
    await writeLinkedFoldersMap(config);
    const nested = join(client, "Hron pobočka");
    await mkdir(nested);
    const response = await host("/workspaces/local", "POST", { folderPath: nested, name: "Hron pobočka", registerExisting: true });
    expect(response.status, await response.clone().text()).toBeLessThan(300);
    let map = await readMap();
    for (let attempt = 0; attempt < 100 && !map?.clients.some((entry) => entry.root === nested); attempt++) {
      await new Promise((resolve) => setTimeout(resolve, 20));
      map = await readMap();
    }
    expect(map?.clients.map((entry) => entry.root)).toContain(nested);
  });

  test("mapa: súbežné zápisy idú za sebou, posledný obsah vyhrá", async () => {
    const { config, linked, readMap } = await practice();
    const first = writeLinkedFoldersMap(config);
    await writeRuntimeOpencodeConfig(config, "ws_client", (current) => ({ ...current, permission: { external_directory: { [`${linked}/*`]: "allow" } } }));
    const second = writeLinkedFoldersMap(config);
    await Promise.all([first, second]);
    expect((await readMap())?.clients.find((entry) => entry.folders.length)?.folders).toEqual([linked]);
  });

  test("mapa: položka zapísaná mimo kontrol (napr. migráciou) s iným klientom alebo relatívna sa do mapy nedostane", async () => {
    const { config, other, linked, readMap } = await practice();
    await writeRuntimeOpencodeConfig(config, "ws_client", (current) => ({ ...current, permission: { external_directory: {
      [`${other}/*`]: "allow", "relative/*": "allow", [`${linked}/*`]: "allow",
    } } }));
    await writeLinkedFoldersMap(config);
    expect((await readMap())?.clients.find((entry) => entry.folders.length)?.folders).toEqual([linked]);
  });

  test("sandbox: priečinky klienta na zdieľanie prejdú tými istými pravidlami (iný klient, relatívna cesta, dáta aplikácie nie)", async () => {
    const { config, other, linked } = await practice();
    const workspace = config.workspaces.find((entry) => entry.id === "ws_client");
    if (!workspace) throw new Error("fixture");
    expect(await linkableFolders(config, workspace, [other, "relative", runtimeStorageDir(config), linked])).toEqual([linked]);
  });
});
