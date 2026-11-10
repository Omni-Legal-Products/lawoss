// LAWOSS: pripojené priečinky klienta v skutočnom engine v2 (voliteľné, LEGALWORK_TEST_OPENCODE_BIN = engine 2.1.4,
// zostavené pluginy `pnpm --filter legalwork-server build:plugins`). Dvaja klienti A a B v jednom engine, chat
// v koreni aj v prípade. Overuje poradie háčikov `permission.evaluate`: upstream `legalwork-managed-config`
// (`managed-folder-permissions.ts`, z OPENCODE_CONFIG_CONTENT ako v produkcii) a LAWOSS `lawoss-linked-folders`
// (oba z OPENCODE_CONFIG_CONTENT ako `mandatoryPlugins`, pluginy ako priečinky ako `bundledPluginSpec`). Pred opravou bol
// LAWOSS plugin v súbore OPENCODE_CONFIG, teda pred upstream háčikom, ktorý jeho `allow` zdvihol späť na `ask`
// (`LAWOSS_TEST_LINKED_FIRST=1` ten stav zopakuje a test spadne). Rozhodnutie čítame priamo z `POST /api/session/:id/permission` (natívne
// `Permission.ask`, odpovie `allow` / `ask` / `deny` bez modelu). Údaje sú syntetické.
import { afterEach, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { LINKED_FOLDERS_MAP_FILE, type LinkedFoldersMap } from "./linked-folders-rules.js";
import { startRealEngineV2 } from "./test-support/fake-engine-v2.js";

const binary = process.env.LEGALWORK_TEST_OPENCODE_BIN;
const plugins = join(import.meta.dir, "..", "..", "dist", "opencode-plugins");
const cleanups: (() => Promise<unknown> | unknown)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0).reverse()) await cleanup(); });

const ready = !!binary && existsSync(join(plugins, "lawoss-linked-folders", "index.js")) && existsSync(join(plugins, "legalwork-managed-config", "index.js"));

test.skipIf(!ready)("pripojený priečinok klienta A povolí len chat klienta A (aj prípadu); upstream háčik ho neodvolá a B ho nedostane", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-linked-engine-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const clientA = join(root, "prax", "Klienti", "Tatran"), matterA = join(clientA, "Spisy", "Úhrada");
  const clientB = join(root, "prax", "Klienti", "Hron");
  const linkedA = join(root, "Zdieľané", "Vzory zmlúv"), linkedB = join(root, "Hron podklady"), unlinked = join(root, "Nepripojené");
  for (const folder of [matterA, clientB, linkedA, linkedB, unlinked]) await mkdir(folder, { recursive: true });

  const runtime = join(root, "runtime");
  await mkdir(runtime);
  const map: LinkedFoldersMap = { version: 1, officeRoot: join(root, "prax"), firmManaged: false,
    clients: [{ root: clientA, folders: [linkedA], client: clientA }, { root: clientB, folders: [linkedB], client: clientB }] };
  await writeFile(join(runtime, LINKED_FOLDERS_MAP_FILE), JSON.stringify(map));
  // Pravidlá projektu ako v produkcii: všetko povolené, priečinky mimo klienta sa pýtajú; pripojené priečinky
  // nie sú pravidlá (withoutClientFolderGrantRules), rozhoduje o nich len plugin LAWOSS.
  const permissions = [{ action: "*", resource: "*", effect: "allow" }, { action: "external_directory", resource: "*", effect: "ask" }];
  const workspace = (directory: string) => ({ directory, configuration: { permissions }, providerActivation: {}, projectPermissionApprovals: [] });
  const settingsPath = join(runtime, "runtime-opencode-settings.json");
  await writeFile(settingsPath, JSON.stringify({ version: 2, workspaces: { a: workspace(clientA), b: workspace(clientB) }, sharedConfiguration: {} }));
  const engineConfig = join(runtime, "runtime-opencode-config.json");
  await writeFile(engineConfig, JSON.stringify({ update: "disable", permissions }));
  // Ako `mandatoryPlugins` v legalwork-runtime-config.ts: háčiky bežia v poradí setupu, LAWOSS rozhodnutie ide po upstream.
  const linked = join(plugins, "lawoss-linked-folders"), managed = { package: join(plugins, "legalwork-managed-config"), options: { settingsPath } };
  const order = process.env.LAWOSS_TEST_LINKED_FIRST ? [linked, managed] : [managed, linked];
  const mandatory = JSON.stringify({ plugins: order });

  const engine = await startRealEngineV2(binary ?? "", join(root, "engine"), cleanups, { OPENCODE_CONFIG: engineConfig, OPENCODE_CONFIG_CONTENT: mandatory });
  const headers = { authorization: `Basic ${Buffer.from(`${engine.username}:${engine.password}`).toString("base64")}`, "content-type": "application/json" };
  const at = (path: string, directory?: string) => `${engine.url}${path}${directory ? `?${new URLSearchParams({ "location[directory]": directory })}` : ""}`;
  const session = async (directory: string) => z.object({ data: z.object({ id: z.string() }) }).parse(await (await fetch(at("/api/session"), { method: "POST", headers, body: JSON.stringify({ location: { directory } }) })).json()).data.id;
  const plugin = z.object({ data: z.array(z.object({ id: z.string(), state: z.object({ status: z.string() }).passthrough() }).passthrough()) });
  const decide = async (chat: string, folder: string) => {
    const id = await session(chat);
    // Pluginy lokácie sa načítajú pri prvej požiadavke; počkáme, kým sú oba aktívne.
    for (let attempt = 0; attempt < 100; attempt++) {
      const states = plugin.parse(await (await fetch(at("/api/plugin", chat), { headers })).json()).data;
      if (["lawoss.linked-folders", "legalwork.managed-config"].every((name) => states.some((entry) => entry.id === name && entry.state.status === "active"))) break;
      await Bun.sleep(100);
    }
    const response = await fetch(at(`/api/session/${id}/permission`), { method: "POST", headers,
      body: JSON.stringify({ action: "external_directory", resources: [`${folder}/*`], save: [`${folder}/*`], agent: "build" }) });
    expect(response.status).toBe(200);
    return z.object({ data: z.object({ effect: z.string() }) }).parse(await response.json()).data.effect;
  };

  const observed = {
    "A koreň → pripojený A": await decide(clientA, linkedA),
    "A prípad → pripojený A": await decide(matterA, linkedA),
    "B → pripojený A": await decide(clientB, linkedA),
    "B → pripojený B": await decide(clientB, linkedB),
    "A → pripojený B": await decide(clientA, linkedB),
    "A → nepripojený": await decide(clientA, unlinked),
    "A → klient B": await decide(clientA, clientB),
  };
  expect(observed).toEqual({
    "A koreň → pripojený A": "allow",
    "A prípad → pripojený A": "allow",
    // Pripojený priečinok iného klienta a nepripojený priečinok ostávajú na karte advokáta.
    "B → pripojený A": "ask",
    "B → pripojený B": "allow",
    "A → pripojený B": "ask",
    "A → nepripojený": "ask",
    "A → klient B": "ask",
  });
}, 90_000);
