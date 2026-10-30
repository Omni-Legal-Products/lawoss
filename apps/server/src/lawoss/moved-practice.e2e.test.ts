// N-A7-1 (test A10, 28. 10. 2026): premenovaná prax sa prepojí na tých istých klientov, nepridá ich druhýkrát.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory, writeRuntimeOpencodeConfig } from "../runtime-opencode-config-store.js";
import { startServer } from "../server.js";
import type { ServerConfig } from "../types.js";
import { removeTestDir } from "./test-support/remove-test-dir.js";

const roots: string[] = [], stops: (() => void | Promise<void>)[] = [];
const originalData = process.env.LEGALWORK_DATA_DIR, originalTokens = process.env.LEGALWORK_TOKEN_STORE;
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0)) await removeTestDir(root);
  if (originalData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = originalData;
  if (originalTokens === undefined) delete process.env.LEGALWORK_TOKEN_STORE; else process.env.LEGALWORK_TOKEN_STORE = originalTokens;
});

const common = { language: "sk", jurisdiction: "sk", date: "2026-10-28", clientType: "po" };
const identity = { lawyerName: "JUDr. Jana SYN Testovacia", jurisdiction: "sk", language: "sk" };
const card = (title: string) => `---\ntype: klient\ntitle: "${title}"\n---\n`;
const convert = (root: string, title: string) => ({ action: "existing", root, mode: "convert", title, confirmUnknownClient: true, ...common });

async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-moved-practice-"))); roots.push(base);
  const data = join(base, "data"); await mkdir(data);
  process.env.LEGALWORK_DATA_DIR = data; process.env.LEGALWORK_TOKEN_STORE = join(data, "tokens.json");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(data, "server.json"), token: "synthetic-client", hostToken: "synthetic-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config); stops.push(() => server.stop());
  const headers = { "X-LegalWork-Host-Token": "synthetic-host", "Content-Type": "application/json" };
  const post = (path: string, body: unknown) => fetch(`http://127.0.0.1:${server.port}${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const onboarding = (path: string, body: unknown) => post(`/lawoss/onboarding/${path}`, body);
  const ok = async (response: Response) => { const json = await response.json(); expect({ status: response.status, code: json.code }).toEqual({ status: 200, code: undefined }); return json; };
  const apply = async (request: unknown) => {
    const preview = await ok(await onboarding("plan", request));
    return ok(await onboarding("apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true }));
  };
  const status = async () => ok(await fetch(`http://127.0.0.1:${server.port}/lawoss/onboarding/status`, { headers }));
  return { base, config, post, onboarding, ok, apply, status };
}

/** Značka, ktorú appka zapíše do klienta pri prvom otvorení (`.opencode/legalwork.json`). */
const writeMarker = async (folder: string, root: string) => { await mkdir(join(folder, ".opencode"), { recursive: true }); await writeFile(join(folder, ".opencode", "legalwork.json"), JSON.stringify({ version: 1, workspace: { name: "x", createdAt: 1, preset: "starter" }, authorizedRoots: [root], reload: null })); };
const grantsOf = async (config: ServerConfig, id: string) => Object.keys(runtimeExternalDirectory(await readRuntimeOpencodeConfig(config, id)));

/** Prax „3-neusporiadana-prax“ s pridanými C002 a C017 (C002 už otvorený, so značkou); C022 v nej je, ale pridaný nebol. */
async function practiceFixture() {
  const f = await fixture();
  const practice = join(f.base, "Prax", "3-neusporiadana-prax");
  const names = ["C002 SYN Hron Technológie, a. s.", "C017 SYN Zuzana Šimková", "C022 SYN Michal Ľupták servis"];
  for (const name of names) { await mkdir(join(practice, name), { recursive: true }); await writeFile(join(practice, name, "poznamka.txt"), "syntetický podklad\n"); }
  await f.apply({ action: "practice", root: practice, title: "3-neusporiadana-prax", lawyerName: identity.lawyerName, jurisdiction: "sk", language: "sk", clientPattern: "*", scope: "client" });
  await f.ok(await f.onboarding("profile", { ...identity, officeRoot: practice }));
  const c002 = (await f.apply(convert(join(practice, names[0]!), names[0]!))).workspace;
  const c017 = (await f.apply(convert(join(practice, names[1]!), names[1]!))).workspace;
  await writeMarker(join(practice, names[0]!), join(practice, names[0]!));
  const renamed = join(f.base, "Prax", "3-neusporiadana-prax-PREMENOVANA");
  return { ...f, practice, renamed, names, c002, c017 };
}

test("premenovaná prax: náhľad spozná pridaných klientov, prepojenie zachová id a C022 nepridá", async () => {
  const f = await practiceFixture();
  expect(await grantsOf(f.config, f.c002.id)).toContain(`${join(f.practice, "Office")}/*`);
  await rename(f.practice, f.renamed);

  const preview = await f.ok(await f.onboarding("moved-folder", { workspaceId: f.c002.id, folderPath: f.renamed }));
  expect(preview).toMatchObject({ kind: "practice", previousRoot: f.practice, folderPath: f.renamed, notFound: [] });
  // C002 nesie značku s pôvodnou cestou, C017 sa zhoduje len menom (relatívnou cestou): appka to povie.
  expect(preview.matches.map((match: { workspaceId: string; folderPath: string; evidence: string }) => [match.workspaceId, match.folderPath, match.evidence]).sort()).toEqual([
    [f.c002.id, join(f.renamed, f.names[0]!), "marker"], [f.c017.id, join(f.renamed, f.names[1]!), "name"],
  ].sort());
  // Náhľad nič nezapisuje.
  expect(f.config.workspaces.map(workspace => workspace.path).sort()).toEqual([f.c002.path, f.c017.path].sort());

  for (const match of preview.matches) {
    await f.ok(await f.post(`/workspace/${match.workspaceId}/reconnect`, { folderPath: match.folderPath, expectedPath: match.expectedPath }));
    await f.ok(await f.onboarding("reconnected", { workspaceId: match.workspaceId }));
  }
  // Povolenie pamäte kancelárie sa presunulo už pri prepojení, ešte pred dokončením presunu praxe.
  expect(await grantsOf(f.config, f.c002.id)).toEqual([`${join(f.renamed, "Office")}/*`]);
  const finished = await f.ok(await f.onboarding("moved-practice", { previousRoot: preview.previousRoot, folderPath: preview.folderPath }));
  expect(finished.profile.officeRoot).toBe(f.renamed);

  // Dvaja klienti s pôvodnými id na novom mieste; žiadny duplikát ani C022.
  expect(f.config.workspaces.map(workspace => [workspace.id, workspace.path]).sort()).toEqual([
    [f.c002.id, join(f.renamed, f.names[0]!)], [f.c017.id, join(f.renamed, f.names[1]!)],
  ].sort());
  for (const id of [f.c002.id, f.c017.id]) {
    const grants = await grantsOf(f.config, id);
    expect(grants).toContain(`${join(f.renamed, "Office")}/*`);
    expect(grants.some(grant => grant.startsWith(`${f.practice}/`))).toBe(false);
  }
  expect((await f.status()).practiceMove).toBeUndefined();
});

test("zlyhané dokončenie presunu praxe: povolenia už sú presunuté a appka ponúkne dokončenie znova", async () => {
  const f = await practiceFixture();
  await rename(f.practice, f.renamed);
  const preview = await f.ok(await f.onboarding("moved-folder", { workspaceId: f.c002.id, folderPath: f.renamed }));
  for (const match of preview.matches) {
    await f.ok(await f.post(`/workspace/${match.workspaceId}/reconnect`, { folderPath: match.folderPath, expectedPath: match.expectedPath }));
    await f.ok(await f.onboarding("reconnected", { workspaceId: match.workspaceId }));
  }
  // Dokončenie zlyhá (iná prax v požiadavke): profil ostane na starej ceste.
  expect((await f.onboarding("moved-practice", { previousRoot: join(f.base, "iná"), folderPath: f.renamed })).status).toBe(409);
  const pending = await f.status();
  expect(pending.profile.officeRoot).toBe(f.practice);
  // Žiadny klient si nenechá povolenie do starej praxe.
  for (const id of [f.c002.id, f.c017.id]) expect((await grantsOf(f.config, id)).some(grant => grant.startsWith(`${f.practice}/`))).toBe(false);
  // „Dokončiť presun praxe“: stav ho ponúkne a krok sa dá zopakovať (aj druhýkrát bez chyby).
  expect(pending.practiceMove).toEqual({ previousRoot: f.practice, folderPath: f.renamed });
  await f.ok(await f.onboarding("moved-practice", pending.practiceMove));
  await f.ok(await f.onboarding("moved-practice", pending.practiceMove));
  expect((await f.status()).profile.officeRoot).toBe(f.renamed);
  expect((await f.status()).practiceMove).toBeUndefined();
});

test("presun praxe odoberie povolenie do starej praxe aj priestorom mimo nej", async () => {
  const f = await practiceFixture();
  const outside = join(f.base, "Iný klient"); await mkdir(outside);
  await writeFile(join(outside, "client.md"), card("SYN Iný"));
  const other = (await f.apply(convert(outside, "Iný klient"))).workspace;
  await writeRuntimeOpencodeConfig(f.config, other.id, current => ({ ...current, permission: { external_directory: { [`${join(f.practice, "Office")}/*`]: "allow", [`${outside}/Prilohy/*`]: "allow" } } }));
  await rename(f.practice, f.renamed);
  const preview = await f.ok(await f.onboarding("moved-folder", { workspaceId: f.c002.id, folderPath: f.renamed }));
  for (const match of preview.matches) await f.ok(await f.post(`/workspace/${match.workspaceId}/reconnect`, { folderPath: match.folderPath, expectedPath: match.expectedPath }));
  await f.ok(await f.onboarding("moved-practice", { previousRoot: preview.previousRoot, folderPath: preview.folderPath }));
  expect(await grantsOf(f.config, other.id)).toEqual([`${outside}/Prilohy/*`]);
});

test("„Pridať klienta“ sa pri možno presunutom klientovi opýta; „Pridať ako nového“ ho pridá", async () => {
  const f = await practiceFixture();
  await rename(f.practice, f.renamed);
  const c002 = join(f.renamed, f.names[0]!);
  const asked = await f.onboarding("plan", convert(c002, f.names[0]!));
  expect(asked.status).toBe(409);
  expect(await asked.json()).toMatchObject({ code: "onboarding_client_moved", details: { workspaceId: f.c002.id, expectedPath: f.c002.path, evidence: "marker", folderPath: c002 } });
  expect(f.config.workspaces).toHaveLength(2);
  // C022 nebol nikdy pridaný: nič sa nepýta.
  expect((await f.onboarding("plan", convert(join(f.renamed, f.names[2]!), f.names[2]!))).status).toBe(200);
  // Advokát povie, že ide o nového klienta: pridá sa (stav A10 s dvoma C002).
  const added = await f.apply({ ...convert(c002, f.names[0]!), confirmNewClient: true });
  expect(added.workspace.id).not.toBe(f.c002.id);
  // Nový prípad u už zaregistrovaného klienta sa nepýta, aj keď existuje starý klient s rovnakým menom.
  const matter = await f.onboarding("plan", { action: "matter", clientRoot: c002, parent: c002, title: "Nájom", date: common.date, kind: "contentious", area: "IP", jurisdiction: "sk", language: "sk" });
  expect({ status: matter.status, code: (await matter.json()).code }).toEqual({ status: 200, code: undefined });
});

test("náhľad nič neprepojí pri inom priečinku, pri existujúcom pôvodnom priečinku ani pri premenovanom klientovi", async () => {
  const f = await practiceFixture();
  expect((await (await f.onboarding("moved-folder", { workspaceId: f.c002.id, folderPath: f.base })).json()).code).toBe("project_folder_available");
  await rename(f.practice, f.renamed);
  const other = join(f.base, "Iny"); await mkdir(other);
  const wrong = await f.onboarding("moved-folder", { workspaceId: f.c002.id, folderPath: other });
  expect(wrong.status).toBe(409);
  expect((await wrong.json()).code).toBe("moved_folder_not_practice");
  // Klient premenovaný spolu s praxou sa nehádže: ostane nedostupný a appka ho vymenuje.
  await rename(join(f.renamed, f.names[1]!), join(f.renamed, "C017 iný názov"));
  const partial = await f.ok(await f.onboarding("moved-folder", { workspaceId: f.c002.id, folderPath: f.renamed }));
  expect(partial.matches.map((match: { workspaceId: string }) => match.workspaceId)).toEqual([f.c002.id]);
  expect(partial.notFound).toEqual([{ workspaceId: f.c017.id, name: expect.any(String) }]);
  // Zmenená prax v profile medzičasom: dokončenie odmietne.
  expect((await f.onboarding("moved-practice", { previousRoot: join(f.base, "iná"), folderPath: f.renamed })).status).toBe(409);
});

test("jeden presunutý klient: značka alebo meno, cudzí klient a priečinok v inom klientovi nie", async () => {
  const f = await fixture();
  const original = join(f.base, "Klienti", "C005 SYN Ján Novák"); await mkdir(original, { recursive: true });
  await writeFile(join(original, "client.md"), card("SYN Ján Novák"));
  const novak = (await f.apply(convert(original, "C005 SYN Ján Novák"))).workspace;
  await writeMarker(original, original);
  const archive = join(f.base, "Archív"); await mkdir(archive);
  const moved = join(archive, "C005 SYN Ján Novák (presunutý)");
  await rename(original, moved);
  // Iný názov priečinka, ale značka s pôvodnou cestou: ten istý klient.
  expect(await f.ok(await f.onboarding("moved-folder", { workspaceId: novak.id, folderPath: moved }))).toMatchObject({ kind: "client", matches: [{ workspaceId: novak.id, expectedPath: original, folderPath: moved, evidence: "marker" }], notFound: [] });
  // Iný Ján Novák s rovnakým menom a vlastnou značkou: zhoda len podľa mena, appka to povie.
  const namesake = join(archive, "C005 SYN Ján Novák"); await mkdir(namesake);
  await writeFile(join(namesake, "client.md"), card("SYN Ján Novák"));
  await writeMarker(namesake, join(f.base, "Iná kancelária", "C005 SYN Ján Novák"));
  expect(await f.ok(await f.onboarding("moved-folder", { workspaceId: novak.id, folderPath: namesake }))).toMatchObject({ matches: [{ workspaceId: novak.id, evidence: "name" }] });
  // Cudzí klient bez zhody: nič.
  const stranger = join(archive, "C006 SYN Beta"); await mkdir(stranger);
  await writeFile(join(stranger, "client.md"), card("SYN Beta, a. s."));
  expect(await f.ok(await f.onboarding("moved-folder", { workspaceId: novak.id, folderPath: stranger }))).toMatchObject({ kind: "client", matches: [], notFound: [{ workspaceId: novak.id }] });
  // Priečinok vnútri iného zaregistrovaného klienta (N-A3-1) sa neprepojí.
  const beta = (await f.apply(convert(stranger, "C006 SYN Beta"))).workspace;
  const nested = join(stranger, "C005 SYN Ján Novák"); await mkdir(nested);
  await writeFile(join(nested, "client.md"), card("SYN Ján Novák"));
  const refused = await f.onboarding("moved-folder", { workspaceId: novak.id, folderPath: nested });
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "onboarding_client_nested", details: { workspaceId: beta.id } });
});
