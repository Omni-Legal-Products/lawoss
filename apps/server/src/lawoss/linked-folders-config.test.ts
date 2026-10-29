// LAWOSS: pripojené priečinky klienta (MČ 19. 10. 2026) idú cez natívne povolené priečinky
// (`permission.external_directory` riadku klienta). Test na úrovni konfigurácie: čo z natívneho zápisu
// dostane engine, pre ktorého klienta a že iný klient to nevidí.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { buildLegalworkRuntimeConfigObject, keepLegalworkRuntimeConfigFileFresh, legalworkRuntimeConfigFilePath, writeLegalworkRuntimeConfigFile } from "../legalwork-runtime-config.js";
import { readRuntimeOpencodeConfig, runtimeStorageDir, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { clientCardFolder, documentLinkedFolders, linkableFolders, linkedFoldersMapPath, writeLinkedFoldersMap } from "./linked-folders.js";
import { externalDirectoryOtherClient, parseLinkedFoldersMap } from "./linked-folders-rules.js";
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
    host: "127.0.0.1", port: 0, configPath: join(root, "server", "server.json"), token: CLIENT_TOKEN, hostToken: "owt_linked_folders_host",
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
    expect(map?.clients).toEqual([{ root: client, folders: [], client: null }, { root: other, folders: [linked], client: null }]);
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

describe("pripojené priečinky klienta: alfa2 A3 (N-16, N-20)", () => {
  const putConfirmed = (config: ServerConfig, workspaceId: string, folders: string[], confirmed: string[]) => fetch(`http://127.0.0.1:${config.port}/workspace/${workspaceId}/authorized-folders`, {
    method: "PUT", headers: { authorization: `Bearer ${CLIENT_TOKEN}`, "content-type": "application/json" }, body: JSON.stringify({ folders, lawossConfirmedPracticeLike: confirmed }),
  });
  /** Ako `3-neusporiadana-prax`: klienti s kódom a vecami s kódom, bez značiek OKF (syntetické mená). */
  const practiceLike = async (root: string) => {
    const folder = join(root, "Neusporiadaná prax");
    for (const [client, matters] of [["C902 SYN Alfa servis", ["M910 Reklamácia", "M911 Nájom skladu"]], ["C903 SYN Beta, a. s.", ["M920 Dodávky", "M921 Spor o dielo"]], ["C904 SYN Gama", ["M930 Dedičstvo", "M931 Mzdy"]]] as const) {
      for (const matter of matters) await mkdir(join(folder, client, matter), { recursive: true });
    }
    return folder;
  };

  test("N-20: userData s interným domovským priestorom je dáta aplikácie, nie iný klient; domov nie je klient v mape", async () => {
    const { root, config, put, readMap } = await practice();
    const userData = join(root, "LAWOSS-test-profil", "userdata");
    const home = join(userData, "lawoss-domov");
    await mkdir(home, { recursive: true });
    await writeFile(join(userData, "legalwork-workspaces.json"), "{}");
    config.workspaces.push({ id: "ws_home", name: "LAWOSS", path: home, preset: "starter", workspaceType: "local" });
    expect(await code(await put("ws_client", [userData]))).toEqual({ status: 409, code: "linked_folder_app_data" });
    expect(await code(await put("ws_client", [home]))).toEqual({ status: 409, code: "linked_folder_app_data" });
    expect(await code(await put("ws_client", [join(root, "LAWOSS-test-profil")]))).toEqual({ status: 409, code: "linked_folder_app_data" });
    await writeLinkedFoldersMap(config);
    expect((await readMap())?.clients.map((entry) => entry.root)).not.toContain(home);
  });

  test("I1: userData desktopu aj priečinok konfigurácie servera sú dáta aplikácie aj na starom profile bez domovského priestoru", async () => {
    const { root, config, put } = await practice();
    const userData = join(root, "Library", "LAWOSS");
    await mkdir(join(userData, "lawoss-onboarding"), { recursive: true });
    await mkdir(join(root, "server"), { recursive: true });
    const previous = process.env.LAWOSS_USER_DATA;
    process.env.LAWOSS_USER_DATA = userData;
    try {
      expect(await code(await put("ws_client", [userData]))).toEqual({ status: 409, code: "linked_folder_app_data" });
      expect(await code(await put("ws_client", [join(userData, "lawoss-onboarding")]))).toEqual({ status: 409, code: "linked_folder_app_data" });
      expect(await code(await put("ws_client", [join(root, "Library")]))).toEqual({ status: 409, code: "linked_folder_app_data" });
      expect(await code(await put("ws_client", [join(root, "server")]))).toEqual({ status: 409, code: "linked_folder_app_data" });
      // Domovský priestor v userData je dáta aplikácie aj bez legalwork-workspaces.json vedľa neho.
      const home = join(userData, "lawoss-domov");
      await mkdir(home);
      config.workspaces.push({ id: "ws_home", name: "LAWOSS", path: home, preset: "starter", workspaceType: "local" });
      expect(await code(await put("ws_client", [userData]))).toEqual({ status: 409, code: "linked_folder_app_data" });
    } finally {
      if (previous === undefined) delete process.env.LAWOSS_USER_DATA; else process.env.LAWOSS_USER_DATA = previous;
    }
  });

  test("N-20: priečinok s menom lawoss-domov bez súboru appky ostáva ako predtým (iný klient), nie dáta aplikácie", async () => {
    const { root, config, put } = await practice();
    const fake = join(root, "Dokumenty", "lawoss-domov");
    await mkdir(fake, { recursive: true });
    config.workspaces.push({ id: "ws_fake", name: "Domov", path: fake, preset: "starter", workspaceType: "local" });
    expect(await code(await put("ws_client", [join(root, "Dokumenty")]))).toEqual({ status: 409, code: "linked_folder_other_client" });
  });

  test("N-16: značky OKF kancelárie alebo klienta odmietnu priečinok vždy (aj bez profilu praxe)", async () => {
    const { root, put } = await practice();
    const office = join(root, "Iná kancelária");
    await mkdir(join(office, "Office"), { recursive: true });
    await writeFile(join(office, "Office", "okf.config"), "office: Iná\n");
    await mkdir(join(office, "Klienti", "C777", "Spisy"), { recursive: true });
    await writeFile(join(office, "Klienti", "C777", "client.md"), "# C777\n");
    expect(await code(await put("ws_client", [office]))).toEqual({ status: 409, code: "linked_folder_practice" });
    // V kancelárii (predok s okf.config): prax.
    expect(await code(await put("ws_client", [join(office, "Klienti")]))).toEqual({ status: 409, code: "linked_folder_practice" });
    // Bez okf.config (ako syntetická 4-usporiadana-kancelaria): obsahuje kartu klienta do hĺbky 2, teda iného klienta.
    const unmarked = join(root, "Kancelária bez okf.config");
    await mkdir(join(unmarked, "Office"), { recursive: true });
    await mkdir(join(unmarked, "Klienti", "C778"), { recursive: true });
    await writeFile(join(unmarked, "Klienti", "C778", "client.md"), "# C778\n");
    expect(await code(await put("ws_client", [unmarked]))).toEqual({ status: 409, code: "linked_folder_other_client" });
    expect(await code(await put("ws_client", [join(office, "Klienti", "C777")]))).toEqual({ status: 409, code: "linked_folder_other_client" });
    expect(await code(await put("ws_client", [join(office, "Klienti", "C777", "Spisy")]))).toEqual({ status: 409, code: "linked_folder_other_client" });
    const loose = join(root, "Voľný klient");
    await mkdir(loose, { recursive: true });
    await writeFile(join(loose, "klient.md"), "# Voľný\n");
    expect(await code(await put("ws_client", [loose]))).toEqual({ status: 409, code: "linked_folder_other_client" });
  });

  test("N-16: priečinok, ktorý vyzerá ako prax, potrebuje potvrdenie toho istého priečinka; potvrdenie neobíde značky OKF", async () => {
    const { root, config, put } = await practice();
    const folder = await practiceLike(root);
    const refused = await put("ws_client", [folder]);
    expect(refused.status).toBe(409);
    expect(await refused.json()).toMatchObject({ code: "linked_folder_practice_like", details: { folder, clients: ["C902 SYN Alfa servis", "C903 SYN Beta, a. s.", "C904 SYN Gama"] } });
    expect(await code(await putConfirmed(config, "ws_client", [folder], [join(root, "iný")]))).toEqual({ status: 409, code: "linked_folder_practice_like" });
    expect((await putConfirmed(config, "ws_client", [folder], [folder])).status).toBe(200);
    const marked = join(root, "Prax so značkou");
    await mkdir(join(marked, "C1", "M1"), { recursive: true });
    await writeFile(join(marked, "C1", "client.md"), "# C1\n");
    expect(await code(await putConfirmed(config, "ws_client", [folder, marked], [marked]))).toEqual({ status: 409, code: "linked_folder_other_client" });
  });

  test("N-16 bez falošných poplachov: protistrany s právnou formou, roky, podklady, jeden klient s vecami, vlastný podpriečinok", async () => {
    const { root, client, put } = await practice();
    const parties = join(root, "Protistrany");
    for (const name of ["Alfa s. r. o.", "Beta a. s."]) { await mkdir(join(parties, name), { recursive: true }); await writeFile(join(parties, name, "zmluva.pdf"), "x"); }
    const years = join(root, "Zmluvy");
    for (const name of ["2023", "2024"]) await mkdir(join(years, name, "Faktúry"), { recursive: true });
    const sources = join(root, "Podklady");
    for (const name of ["Faktúry", "Korešpondencia"]) await mkdir(join(sources, name, "2024"), { recursive: true });
    const single = join(root, "Jeden klient");
    for (const matter of ["M001 Spor", "M002 Nájom"]) await mkdir(join(single, "C100 Delta", matter), { recursive: true });
    expect((await put("ws_client", [parties, years, sources, single])).status).toBe(200);
    expect((await put("ws_client", [join(client, "Spisy")])).status).toBe(200);
  });

  test("pamäť kancelárie s okf.config ostáva pripojiteľná pre klienta praxe", async () => {
    const { practiceRoot, put, writeProfile } = await practice();
    await writeProfile();
    await writeFile(join(practiceRoot, "_kancelaria", "okf.config"), "office: Prax\n");
    expect((await put("ws_client", [join(practiceRoot, "_kancelaria")])).status).toBe(200);
    expect(await code(await put("ws_client", [join(practiceRoot, "_kancelaria"), join(practiceRoot, "Vzory")]))).toEqual({ status: 409, code: "linked_folder_practice" });
  });

  test("pamäť kancelárie s okf.config aj bez profilu praxe; ostatné priečinky praxe sa odmietnu podľa okf.config", async () => {
    const { practiceRoot, put } = await practice();
    await writeFile(join(practiceRoot, "_kancelaria", "okf.config"), "office: Prax\n");
    expect((await put("ws_client", [join(practiceRoot, "_kancelaria")])).status).toBe(200);
    expect(await code(await put("ws_client", [join(practiceRoot, "_kancelaria"), join(practiceRoot, "Vzory")]))).toEqual({ status: 409, code: "linked_folder_practice" });
  });

  test("príprava dokumentov: pripojené priečinky len vlastného klienta, nie iného ani pri firme", async () => {
    const { config, linked, put } = await practice();
    expect((await put("ws_client", [linked])).status).toBe(200);
    const [own, other] = ["ws_client", "ws_other"].map((id) => config.workspaces.find((entry) => entry.id === id));
    if (!own || !other) throw new Error("fixture");
    expect(await documentLinkedFolders(config, own)).toEqual([linked]);
    expect(await documentLinkedFolders(config, other)).toEqual([]);
  });
});

// N-A7-14 (review #295): klient v mape je priečinok s kartou klienta; registrovaný spis patrí svojmu klientovi.
describe("klient v mape podľa karty klienta", () => {
  test("registrované spisy toho istého klienta sú ten istý klient; iný klient s kartou je iný; bez karty nevie sa", async () => {
    const { config, client, other, practiceRoot, writeProfile, readMap } = await practice();
    await writeProfile();
    const matter = join(client, "Spisy", "Uhrada"), sibling = join(client, "Spisy", "Najom"), bare = join(practiceRoot, "Klienti", "Bez karty");
    for (const folder of [sibling, bare]) await mkdir(folder, { recursive: true });
    await writeFile(join(client, "client.md"), "---\ntitle: SYN Tatran\n---\n");
    await writeFile(join(other, "klient.md"), "---\ntitle: SYN Hron\n---\n");
    await writeFile(join(bare, "KLIENT.MD"), "karta s iným menom sa neráta (ako prehľad v appke)");
    config.workspaces.push(
      { id: "ws_matter", name: "Úhrada", path: matter, preset: "starter", workspaceType: "local" },
      { id: "ws_sibling", name: "Nájom", path: sibling, preset: "starter", workspaceType: "local" },
      { id: "ws_bare", name: "Bez karty", path: bare, preset: "starter", workspaceType: "local" },
      { id: "ws_practice", name: "Prax", path: practiceRoot, preset: "starter", workspaceType: "local" },
    );
    await writeLinkedFoldersMap(config);
    const map = await readMap();
    if (!map) throw new Error("map");
    const clientOf = (root: string) => map.clients.find((entry) => entry.root === root)?.client;
    expect([clientOf(client), clientOf(matter), clientOf(sibling), clientOf(other), clientOf(bare), clientOf(practiceRoot)]).toEqual([client, client, client, other, null, null]);
    expect(externalDirectoryOtherClient(map, matter, [sibling])).toBe(false);
    expect(externalDirectoryOtherClient(map, sibling, [matter, client])).toBe(false);
    expect(externalDirectoryOtherClient(map, matter, [other])).toBe(true);
    expect(externalDirectoryOtherClient(map, bare, [other])).toBe(false);
    // Nad koreňom praxe sa karta nehľadá (ani keď by tam bola).
    await writeFile(join(practiceRoot, "client.md"), "---\ntitle: Prax\n---\n");
    expect(await clientCardFolder(bare, practiceRoot)).toBeNull();
    expect(await clientCardFolder(join(matter, "Podklady"), practiceRoot)).toBe(client);
  });
});
