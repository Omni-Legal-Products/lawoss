// #425: priečinok vložený ručne do `Klienti/` kancelárie sa ponúkne na zavedenie; zavedenie len pridá súbory OKF.
import { afterEach, describe, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { mkdir, mkdtemp, readdir, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";
import { unadoptedClientFolders } from "./unadopted-clients.js";

const roots: string[] = [], stops: (() => void | Promise<void>)[] = [];
const originalData = process.env.LEGALWORK_DATA_DIR, originalTokens = process.env.LEGALWORK_TOKEN_STORE;
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0)) await removeTestDir(root);
  if (originalData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = originalData;
  if (originalTokens === undefined) delete process.env.LEGALWORK_TOKEN_STORE; else process.env.LEGALWORK_TOKEN_STORE = originalTokens;
});

async function tempRoot(): Promise<string> {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-unadopted-"))); roots.push(base);
  return base;
}

/** Strom priečinka ako relatívna cesta → SHA-256 obsahu (priečinky s prázdnym hashom). */
async function tree(root: string): Promise<Record<string, string>> {
  const out: Record<string, string> = {};
  const walk = async (dir: string): Promise<void> => {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const full = join(dir, entry.name), rel = relative(root, full);
      if (entry.isDirectory()) { out[`${rel}/`] = ""; await walk(full); }
      else out[rel] = createHash("sha256").update(await readFile(full)).digest("hex");
    }
  };
  await walk(root);
  return out;
}

describe("unadoptedClientFolders", () => {
  test("bez priečinka Klienti/ je zoznam prázdny", async () => {
    const office = await tempRoot();
    expect(await unadoptedClientFolders(office, [])).toEqual([]);
  });

  test("len priame podpriečinky Klienti/, ktoré nie sú registrované; skryté, súbory a odkazy nie", async () => {
    const office = await tempRoot(), clients = join(office, "Klienti");
    for (const name of ["Novák", "Registrovaný", ".skryty", "Obal"]) await mkdir(join(clients, name), { recursive: true });
    await mkdir(join(clients, "Obal", "Vnorený registrovaný"));
    await mkdir(join(clients, "Novák", "Spisy"));
    await writeFile(join(clients, "subor.pdf"), "x");
    await symlink(join(clients, "Novák"), join(clients, "Odkaz"));
    // Registrovaná cesta cez odkaz sa porovná kanonicky.
    await symlink(join(clients, "Registrovaný"), join(office, "odkaz-registrovany"));
    const found = await unadoptedClientFolders(office, [join(office, "odkaz-registrovany"), join(clients, "Obal", "Vnorený registrovaný")]);
    expect(found).toEqual([{ path: join(clients, "Novák"), name: "Novák" }]);
  });

  test("veľká kancelária: registrovaní klienti nevytlačia neskorý vložený priečinok", async () => {
    const office = await tempRoot(), clients = join(office, "Klienti"), registered: string[] = [];
    for (let index = 0; index < 600; index += 1) { const path = join(clients, `A${String(index).padStart(3, "0")}`); await mkdir(path, { recursive: true }); registered.push(path); }
    await mkdir(join(clients, "Zeta vložený"));
    expect((await unadoptedClientFolders(office, registered)).map(folder => folder.name)).toEqual(["Zeta vložený"]);
  });

  test("vzor client_path z Office/okf.config; priečinok kancelárie nie je klient", async () => {
    const office = await tempRoot();
    await mkdir(join(office, "Office"), { recursive: true });
    await writeFile(join(office, "Office", "okf.config"), 'okf_version: 1\nclient_path: "Mandanti/*"\n');
    await mkdir(join(office, "Mandanti", "Beta"), { recursive: true });
    await mkdir(join(office, "Klienti", "Alfa"), { recursive: true });
    expect((await unadoptedClientFolders(office, [])).map(folder => folder.name)).toEqual(["Beta"]);
    await writeFile(join(office, "Office", "okf.config"), "client_path: ../*\n");
    expect(await unadoptedClientFolders(office, [])).toEqual([]);
  });
});

const common = { language: "sk", jurisdiction: "sk", date: "2026-11-15", clientType: "fo" };

test("route ponúkne vložený priečinok, zavedenie pridá len súbory OKF a priečinok zo zoznamu zmizne", async () => {
  const base = await tempRoot(), office = join(base, "Kancelaria"), data = join(base, "data");
  await mkdir(office); await mkdir(data);
  process.env.LEGALWORK_DATA_DIR = data; process.env.LEGALWORK_TOKEN_STORE = join(data, "tokens.json");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(data, "server.json"), token: "synthetic-client", hostToken: "synthetic-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config); stops.push(() => server.stop());
  const headers = { "X-LegalWork-Host-Token": "synthetic-host", "Content-Type": "application/json" };
  const call = async (path: string, body?: unknown) => {
    const response = await fetch(`http://127.0.0.1:${server.port}/lawoss/onboarding/${path}`, { headers, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
    const json = await response.json();
    expect({ status: response.status, code: json.code }).toEqual({ status: 200, code: undefined });
    return json;
  };
  const apply = async (request: unknown) => { const preview = await call("plan", request); return call("apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true }); };

  // Bez kancelárie v profile nič.
  expect(await call("unadopted-clients")).toEqual({ folders: [] });
  await apply({ action: "office", parent: office, title: "SYN Kancelária", jurisdiction: "sk", language: "sk", lawyerName: "SYN Advokát" });
  await call("profile", { lawyerName: "SYN Advokát", jurisdiction: "sk", language: "sk", officeRoot: office });

  // Advokát vloží priečinok s vlastnými dokumentmi a pokynmi; jeden klient je už zavedený.
  const dropped = join(office, "Klienti", "SYN Novák");
  await mkdir(join(dropped, "Zmluvy"), { recursive: true });
  await writeFile(join(dropped, "Zmluvy", "kupna-zmluva.pdf"), Buffer.from([37, 80, 68, 70, 0, 255]));
  await writeFile(join(dropped, "poznamky.txt"), "syntetická poznámka\n");
  await writeFile(join(dropped, "AGENTS.md"), "# Vlastné pokyny advokáta\n");
  const registered = join(office, "Klienti", "SYN Zavedený");
  await mkdir(registered, { recursive: true });
  await apply({ action: "existing", root: registered, mode: "convert", title: "SYN Zavedený", confirmUnknownClient: true, ...common });

  const listed = await call("unadopted-clients");
  expect(listed).toEqual({ officeRoot: office, folders: [{ path: dropped, name: "SYN Novák" }] });

  // Obrazovka „Toto sme našli“ navrhne pre vložený priečinok klienta (nie prípad ani prax).
  expect((await call("suggest", { root: dropped })).level).toBe("client");
  // Ten istý tok ako „Nie, nechaj ho tak, ako je“ na obrazovke „Toto sme našli“ (found-flow.ts convertRequest).
  const before = await tree(dropped);
  const result = await apply({ action: "existing", root: dropped, mode: "convert", title: "SYN Novák", confirmUnknownClient: true, ...common });
  expect(result.workspace.path).toBe(dropped);
  const after = await tree(dropped);
  // Každý pôvodný súbor a priečinok ostal na mieste s rovnakým obsahom; pribudli len nové položky.
  for (const [path, hash] of Object.entries(before)) expect({ path, hash: after[path] }).toEqual({ path, hash });
  const added = Object.keys(after).filter(path => !(path in before)).sort();
  expect(added.length).toBeGreaterThan(0);
  // Vlastné AGENTS.md sa neprepísalo; CLAUDE.md dostane rovnaký obsah.
  expect(await readFile(join(dropped, "CLAUDE.md"), "utf8")).toBe("# Vlastné pokyny advokáta\n");
  console.log(`#425 zavedenie pridalo: ${added.join(", ")}`);

  expect(await call("unadopted-clients")).toEqual({ officeRoot: office, folders: [] });
});
