// N-A7-1 (test A10, 28. 10. 2026): premenovaná prax sa prepojí na tých istých klientov, nepridá ich druhýkrát.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rename, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory } from "../runtime-opencode-config-store.js";
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
  return { base, config, post, onboarding, ok, apply };
}

/** Prax „3-neusporiadana-prax“ s pridanými C002 a C017; C022 v nej je, ale pridaný nebol. */
async function practiceFixture() {
  const f = await fixture();
  const practice = join(f.base, "Prax", "3-neusporiadana-prax");
  const names = ["C002 SYN Hron Technológie, a. s.", "C017 SYN Zuzana Šimková", "C022 SYN Michal Ľupták servis"];
  for (const name of names) { await mkdir(join(practice, name), { recursive: true }); await writeFile(join(practice, name, "poznamka.txt"), "syntetický podklad\n"); }
  await f.apply({ action: "practice", root: practice, title: "3-neusporiadana-prax", lawyerName: identity.lawyerName, jurisdiction: "sk", language: "sk", clientPattern: "*", scope: "client" });
  await f.ok(await f.onboarding("profile", { ...identity, officeRoot: practice }));
  const c002 = (await f.apply(convert(join(practice, names[0]!), names[0]!))).workspace;
  const c017 = (await f.apply(convert(join(practice, names[1]!), names[1]!))).workspace;
  const renamed = join(f.base, "Prax", "3-neusporiadana-prax-PREMENOVANA");
  return { ...f, practice, renamed, names, c002, c017 };
}

test("premenovaná prax: náhľad spozná pridaných klientov, prepojenie zachová id a C022 nepridá", async () => {
  const f = await practiceFixture();
  const grantsBefore = Object.keys(runtimeExternalDirectory(await readRuntimeOpencodeConfig(f.config, f.c002.id)));
  expect(grantsBefore).toContain(`${join(f.practice, "Office")}/*`);
  await rename(f.practice, f.renamed);

  const preview = await f.ok(await f.onboarding("moved-folder", { workspaceId: f.c002.id, folderPath: f.renamed }));
  expect(preview).toMatchObject({ kind: "practice", previousRoot: f.practice, folderPath: f.renamed, notFound: [] });
  expect(preview.matches.map((match: { workspaceId: string; folderPath: string }) => [match.workspaceId, match.folderPath]).sort()).toEqual([
    [f.c002.id, join(f.renamed, f.names[0]!)], [f.c017.id, join(f.renamed, f.names[1]!)],
  ].sort());
  // Náhľad nič nezapisuje.
  expect(f.config.workspaces.map(workspace => workspace.path).sort()).toEqual([f.c002.path, f.c017.path].sort());

  for (const match of preview.matches) await f.ok(await f.post(`/workspace/${match.workspaceId}/reconnect`, { folderPath: match.folderPath, expectedPath: match.expectedPath }));
  const finished = await f.ok(await f.onboarding("moved-practice", { previousRoot: preview.previousRoot, folderPath: preview.folderPath }));
  expect(finished.profile.officeRoot).toBe(f.renamed);

  // Dvaja klienti s pôvodnými id na novom mieste; žiadny duplikát ani C022.
  expect(f.config.workspaces.map(workspace => [workspace.id, workspace.path]).sort()).toEqual([
    [f.c002.id, join(f.renamed, f.names[0]!)], [f.c017.id, join(f.renamed, f.names[1]!)],
  ].sort());
  // Povolenie pamäte kancelárie mieri na nový koreň; stará cesta už povolená nie je.
  const grants = Object.keys(runtimeExternalDirectory(await readRuntimeOpencodeConfig(f.config, f.c002.id)));
  expect(grants).toContain(`${join(f.renamed, "Office")}/*`);
  expect(grants.some(grant => grant.startsWith(`${f.practice}/`))).toBe(false);
});

test("„Pridať klienta“ neprijme klienta, ktorého priečinok sa len presunul; nového klienta praxe áno", async () => {
  const f = await practiceFixture();
  await rename(f.practice, f.renamed);
  const refused = await f.onboarding("plan", convert(join(f.renamed, f.names[0]!), f.names[0]!));
  expect(refused.status).toBe(409);
  expect(await refused.json()).toMatchObject({ code: "onboarding_client_moved", details: { workspaceId: f.c002.id } });
  expect(f.config.workspaces).toHaveLength(2);
  // C022 nebol nikdy pridaný: advokát ho môže pridať vedome, nič ho neblokuje.
  expect((await f.onboarding("plan", convert(join(f.renamed, f.names[2]!), f.names[2]!))).status).toBe(200);
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

test("jeden presunutý klient mimo praxe: spozná ho podľa karty, cudzieho klienta nie", async () => {
  const f = await fixture();
  const original = join(f.base, "Klienti", "C005 SYN Alfa"); await mkdir(original, { recursive: true });
  await writeFile(join(original, "client.md"), card("SYN Alfa, s. r. o."));
  const alfa = (await f.apply(convert(original, "C005 SYN Alfa"))).workspace;
  const moved = join(f.base, "Archív", "C005 SYN Alfa"); await mkdir(join(f.base, "Archív"));
  await rename(original, moved);
  const stranger = join(f.base, "Archív", "C006 SYN Beta"); await mkdir(stranger);
  await writeFile(join(stranger, "client.md"), card("SYN Beta, a. s."));
  const preview = await f.ok(await f.onboarding("moved-folder", { workspaceId: alfa.id, folderPath: moved }));
  expect(preview).toMatchObject({ kind: "client", matches: [{ workspaceId: alfa.id, expectedPath: original, folderPath: moved }], notFound: [] });
  const other = await f.ok(await f.onboarding("moved-folder", { workspaceId: alfa.id, folderPath: stranger }));
  expect(other).toMatchObject({ kind: "client", matches: [], notFound: [{ workspaceId: alfa.id }] });
});
