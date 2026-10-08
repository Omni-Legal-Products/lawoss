import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectOnboardingRoot } from "./lawoss/onboarding-runtime.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";

const roots: string[] = [], stops: (() => void | Promise<void>)[] = [];
const originalData = process.env.LEGALWORK_DATA_DIR, originalTokens = process.env.LEGALWORK_TOKEN_STORE;
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0)) await removeTestDir(root);
  if (originalData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = originalData;
  if (originalTokens === undefined) delete process.env.LEGALWORK_TOKEN_STORE; else process.env.LEGALWORK_TOKEN_STORE = originalTokens;
});

/** Syntetický klient (vymyslené mená) a jeho skúšobný klon cez skutočný onboarding API. */
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-triage-api-"))); roots.push(base);
  const source = join(base, "Vymysleny klient"), clones = join(base, "klony"), data = join(base, "data");
  for (const dir of [source, clones, data]) await mkdir(dir);
  for (const [path, content] of Object.entries({ "odpoved.eml": "x", "Plnomocenstvo.pdf": "y", "Rozsudok 8C_1_2024.pdf": "z", "Zaloba 8C_1_2024.pdf": "w", "IMG_1.jpg": "v" })) await writeFile(join(source, path), content);
  process.env.LEGALWORK_DATA_DIR = data; process.env.LEGALWORK_TOKEN_STORE = join(data, "tokens.json");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(data, "server.json"), token: "synthetic-client", hostToken: "synthetic-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config); stops.push(() => server.stop());
  const headers = { "X-LegalWork-Host-Token": "synthetic-host", "Content-Type": "application/json" };
  const call = (path: string, body: unknown, auth: Record<string, string> = headers) => fetch(`http://127.0.0.1:${server.port}/lawoss/${path}`, { method: "POST", headers: auth, body: JSON.stringify(body) });
  const success = async (path: string, body: unknown) => { const response = await call(path, body), result = await response.json(); expect({ status: response.status, error: result.error, message: result.message }).toEqual({ status: 200, error: undefined, message: undefined }); return result; };
  const preview = await success("onboarding/plan", { action: "existing", root: source, mode: "trial_clone", cloneParent: clones, title: "Vymyslený klient", clientType: "po", language: "sk", jurisdiction: "sk", date: "2026-10-05", confirmUnknownClient: true });
  const clone = await success("onboarding/apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true });
  return { source, clone: clone.root as string, call, success };
}
async function tree(root: string): Promise<string> {
  const inspection = await inspectOnboardingRoot(root);
  return createHash("sha256").update(JSON.stringify((inspection as unknown as { entries: { path: string }[] }).entries.filter(entry => !entry.path.startsWith(".lawoss")))).digest("hex");
}

test("triedenie je len pre hosta, len v klone a len po potvrdení odtlačku", async () => {
  const f = await fixture();
  expect((await f.call("triage/status", { root: f.clone }, { Authorization: "Bearer synthetic-client", "Content-Type": "application/json" })).status).toBe(401);
  expect(await f.success("triage/status", { root: f.source })).toMatchObject({ trial: false, runs: [] });
  expect((await f.call("triage/plan", { root: f.source })).status).toBe(403);
  expect(await f.success("triage/status", { root: f.clone })).toMatchObject({ trial: true, runs: [] });
  const original = await tree(f.clone), sourceBefore = await tree(f.source);

  const preview = await f.success("triage/plan", { root: f.clone });
  expect(preview.documents).toBe(5);
  expect(preview.matters).toEqual([expect.objectContaining({ caseNumber: "8C 1/2024", documents: 2 })]);
  expect(preview.moves.find((move: { from: string }) => move.from === "odpoved.eml").to).toBe("05_Komunikacia/odpoved.eml");
  expect(preview.moves[0].sha256).toBeUndefined();
  expect((await f.call("triage/plan", { root: f.clone, useModel: true })).status).toBe(409);

  const id = preview.moves.find((move: { from: string }) => move.from === "Plnomocenstvo.pdf").id;
  const kept = await f.success("triage/replan", { id: preview.id, keepInInbox: [id] });
  expect(kept.moves.find((move: { from: string }) => move.from === "Plnomocenstvo.pdf")).toMatchObject({ to: "00_Na_zatriedenie/Plnomocenstvo.pdf", source: "user" });
  expect((await f.call("triage/apply", { id: kept.id, fingerprint: preview.fingerprint, confirm: true })).status).toBe(409);
  expect((await f.call("triage/apply", { id: kept.id, fingerprint: kept.fingerprint, confirm: false })).status).toBe(400);
  expect(await tree(f.clone)).toBe(original);

  expect(await f.success("triage/apply", { id: kept.id, fingerprint: kept.fingerprint, confirm: true })).toMatchObject({ status: "applied", moved: 5 });
  expect(await readFile(join(f.clone, "00_Na_zatriedenie/Plnomocenstvo.pdf"), "utf8")).toBe("y");
  expect((await readdir(join(f.clone, "Spisy"))).filter(name => !name.startsWith("."))).toEqual(["2026-10 Konanie 8C 1-2024".replace("2026-10", new Date().toISOString().slice(0, 7))]);
  expect(await tree(f.source)).toBe(sourceBefore);
  expect((await f.success("triage/status", { root: f.clone })).runs[0]).toMatchObject({ runId: kept.runId, state: "applied" });

  expect((await f.call("triage/undo", { root: f.source, runId: kept.runId, confirm: true })).status).toBe(403);
  expect(await f.success("triage/undo", { root: f.clone, runId: kept.runId, confirm: true })).toMatchObject({ status: "undone", restored: 5 });
  expect(await tree(f.clone)).toBe(original);
});

/** Skutočný klient po „Nie, len pridaj OKF súbory“ (convert) a jeho registrácii, ako v novom onboardingu. */
async function convertedFixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-triage-in-place-"))); roots.push(base);
  const client = join(base, "Vymysleny klient"), data = join(base, "data");
  for (const dir of [client, data]) await mkdir(dir);
  for (const [path, content] of Object.entries({ "odpoved.eml": "x", "Plnomocenstvo.pdf": "y", "Rozsudok 8C_1_2024.pdf": "z", "Zaloba 8C_1_2024.pdf": "w" })) await writeFile(join(client, path), content);
  process.env.LEGALWORK_DATA_DIR = data; process.env.LEGALWORK_TOKEN_STORE = join(data, "tokens.json");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(data, "server.json"), token: "synthetic-client", hostToken: "synthetic-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config); stops.push(() => server.stop());
  const headers = { "X-LegalWork-Host-Token": "synthetic-host", "Content-Type": "application/json" };
  const call = (path: string, body: unknown) => fetch(`http://127.0.0.1:${server.port}/lawoss/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const success = async (path: string, body: unknown) => { const response = await call(path, body), result = await response.json(); expect({ status: response.status, error: result.error, message: result.message }).toEqual({ status: 200, error: undefined, message: undefined }); return result; };
  const preview = await success("onboarding/plan", { action: "existing", root: client, mode: "convert", title: "Vymyslený klient", clientType: "po", language: "sk", jurisdiction: "sk", date: "2026-10-08", confirmUnknownClient: true });
  await success("onboarding/apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true });
  // Registrácia existujúceho priečinka tou istou cestou ako appka (`POST /workspaces/local`).
  const register = (folderPath: string, extra: Record<string, unknown> = {}) => fetch(`http://127.0.0.1:${server.port}/workspaces/local`, { method: "POST", headers, body: JSON.stringify({ folderPath, name: "Vymyslený priečinok", preset: "starter", registerExisting: true, ...extra }) });
  return { base, client, call, success, register };
}

test("usporiadanie na mieste: len zaregistrovaný klient, len po grant, vrátenie hlási ponechané", async () => {
  const f = await convertedFixture();
  expect(await f.success("triage/status", { root: f.client })).toMatchObject({ trial: false });
  expect((await f.call("triage/plan", { root: f.client })).status).toBe(403);
  expect((await f.call("triage/grant", { root: f.client, confirm: false })).status).toBe(400);
  const stranger = join(f.base, "cudzí"); await mkdir(stranger);
  expect((await f.call("triage/grant", { root: stranger, confirm: true })).status).toBe(403);
  expect(await f.success("triage/grant", { root: f.client, confirm: true })).toEqual({ granted: true, root: f.client });
  expect(await f.success("triage/status", { root: f.client })).toMatchObject({ trial: true, mode: "in_place", runs: [] });
  const preview = await f.success("triage/plan", { root: f.client });
  expect(preview.moves.length).toBeGreaterThan(1);
  const applied = await f.success("triage/apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true });
  const changed = preview.moves[0].to as string;
  await writeFile(join(f.client, changed), "advokát to medzitým upravil");
  const undone = await f.success("triage/undo", { root: f.client, runId: applied.runId, confirm: true });
  expect(undone.kept).toContain(changed);
  expect(undone.restored).toBe(preview.moves.length - 1);
});

const exists = (path: string) => lstat(path).then(() => true, () => false);

test("stav pri ceste k súboru alebo neexistujúcemu priečinku vráti trial: false, nie chybu", async () => {
  const f = await convertedFixture();
  const file = join(f.base, "dokument.pdf"); await writeFile(file, "x");
  expect(await f.success("triage/status", { root: file })).toMatchObject({ trial: false, runs: [] });
  expect(await f.success("triage/status", { root: join(f.base, "neexistuje") })).toMatchObject({ trial: false, runs: [] });
});

test("súhlas na mieste odmietne zaregistrovaný priečinok bez karty klienta aj klienta so súbormi appky mimo", async () => {
  const f = await convertedFixture();
  const plain = join(f.base, "Obycajny priecinok"); await mkdir(plain);
  await writeFile(join(plain, "zmluva.pdf"), "z");
  expect((await f.register(plain)).status).toBe(201);
  const refused = await f.call("triage/grant", { root: plain, confirm: true });
  expect(refused.status).toBeGreaterThanOrEqual(400);
  expect(refused.status).toBeLessThan(500);
  expect(await exists(join(plain, ".lawoss"))).toBe(false);

  const outside = join(f.base, "Klient mimo"); await mkdir(outside);
  await writeFile(join(outside, "client.md"), "---\ntype: client\n---\n");
  expect((await f.register(outside, { appFiles: "outside" })).status).toBe(201);
  const forbidden = await f.call("triage/grant", { root: outside, confirm: true });
  expect({ status: forbidden.status, code: (await forbidden.json()).code }).toEqual({ status: 403, code: "not_registered_client" });
  expect(await exists(join(outside, ".lawoss"))).toBe(false);
});
