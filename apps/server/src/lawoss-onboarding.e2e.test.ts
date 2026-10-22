import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveServerConfig } from "./config.js";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory, runtimeStorageDir } from "./runtime-opencode-config-store.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { createOnboardingFirstFailureTiming, type OnboardingFirstFailureTiming } from "./test-support/onboarding-first-failure-timing.js";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";

const timings: OnboardingFirstFailureTiming[] = [];
const roots: string[] = [], stops: (() => void | Promise<void>)[] = [];
const originalData = process.env.LEGALWORK_DATA_DIR, originalTokens = process.env.LEGALWORK_TOKEN_STORE;
afterEach(async () => {
  // Freeze before stop can abort pending HTTP or cleanup removes its files.
  for (const timing of timings.splice(0)) timing.freeze();
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0)) await removeTestDir(root);
  if (originalData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = originalData;
  if (originalTokens === undefined) delete process.env.LEGALWORK_TOKEN_STORE; else process.env.LEGALWORK_TOKEN_STORE = originalTokens;
});
async function fixture(onboardingApplyCheckpoint?: (checkpoint: string) => void) {
  const timing = createOnboardingFirstFailureTiming({ env: process.env, now: () => performance.now(), write: frame => { process.stderr.write(frame); } });
  timings.push(timing);
  const runtimeOptions = { onboardingApplyCheckpoint: timing.checkpoint || onboardingApplyCheckpoint
    ? (checkpoint: import("./lawoss/onboarding.js").OnboardingApplyCheckpoint) => { timing.checkpoint?.(checkpoint); onboardingApplyCheckpoint?.(checkpoint); }
    : undefined };
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-onboarding-api-"))); roots.push(base);
  const parent = join(base, "practice"), data = join(base, "data"); await mkdir(parent); await mkdir(data);
  process.env.LEGALWORK_DATA_DIR = data; process.env.LEGALWORK_TOKEN_STORE = join(data, "tokens.json");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(data, "server.json"), token: "synthetic-client", hostToken: "synthetic-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  let server = await startServer(config, runtimeOptions); stops.push(() => server.stop());
  const headers = { "X-LegalWork-Host-Token": "synthetic-host", "Content-Type": "application/json" };
  const call = (path: string, body?: unknown, auth: Record<string, string> = headers) => fetch(`http://127.0.0.1:${server.port}/lawoss/onboarding/${path}`, { headers: auth, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
  const success = async (path: string, body?: unknown, action?: unknown) => {
    const endpoint = path === "plan" || path === "apply" ? path : null;
    if (endpoint) timing.request(endpoint, "enter", action);
    try {
      const response = await call(path, body), result = await response.json();
      expect({ status: response.status, error: result.error }).toEqual({ status: 200, error: undefined });
      if (endpoint) timing.request(endpoint, "done");
      return result;
    } catch (error) { if (endpoint) timing.request(endpoint, "failed"); throw error; }
  };
  const apply = async (request: unknown) => {
    const action = typeof request === "object" && request !== null && "action" in request ? request.action : undefined;
    const preview = await success("plan", request, action);
    return success("apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true });
  };
  return {
    base, parent, config, call, success, apply,
    restart: async () => { await server.stop(); server = await startServer(config, runtimeOptions); },
    restartFromDisk: async () => {
      await server.stop();
      const restored = await resolveServerConfig({ configPath: config.configPath, workspaces: [], token: "synthetic-client", hostToken: "synthetic-host" });
      Object.assign(config, restored);
      server = await startServer(config, runtimeOptions);
    },
  };
}
const common = { language: "sk", jurisdiction: "sk", date: "2026-10-03", clientType: "po" };

test("onboarding is host-only, rejects unconfirmed writes and persists identity", async () => {
  const f = await fixture();
  expect((await f.call("status", undefined, {} as { "X-LegalWork-Host-Token": string; "Content-Type": string })).status).toBe(401);
  expect((await fetch(`http://127.0.0.1:${(new URL((await f.call("status")).url)).port}/lawoss/onboarding/status`, { headers: { Authorization: "Bearer synthetic-client" } })).status).toBe(401);
  await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "de", step: "office" });
  await f.restartFromDisk();
  expect((await f.success("status")).profile).toMatchObject({ lawyerName: "Synthetic lawyer", language: "de", step: "office" });
  const preview = await f.success("plan", { action: "client", parent: f.parent, name: "Test", title: "Synthetic", ...common });
  expect(await readdir(f.parent)).toEqual([]);
  expect((await f.call("apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: false })).status).toBe(400);
  expect((await f.call("apply", { id: preview.id, fingerprint: "a".repeat(64), confirm: true })).status).toBe(409);
  expect(await readdir(f.parent)).toEqual([]);
});

test("practice applies configuration without registering its clients as workspaces", async () => {
  const f = await fixture(), root = join(f.base, "praxe"), client = join(root, "Klient A");
  await mkdir(client, { recursive: true }); await writeFile(join(client, "original.txt"), "Original bytes\n");
  const before = await readFile(join(client, "original.txt"), "utf8");
  const result = await f.apply({ action: "practice", root, title: "Syntetická prax", jurisdiction: "sk", language: "sk", lawyerName: "Syntetický advokát", clientPattern: "*", scope: "client" });
  expect(result.result).toBe("applied");
  expect(result.workspace).toBeUndefined(); expect(f.config.workspaces).toHaveLength(0);
  expect((await lstat(join(root, "Office", "okf.config"))).isFile()).toBe(true);
  expect(await readFile(join(client, "original.txt"), "utf8")).toBe(before);
});

test("office memory of a practice is readable by the host only (N1)", async () => {
  const f = await fixture(), root = join(f.base, "praxe");
  await mkdir(join(root, "Klient A"), { recursive: true });
  expect((await f.call("office-memory")).status).toBe(409);
  await f.apply({ action: "practice", root, title: "Syntetická prax", jurisdiction: "sk", language: "sk", lawyerName: "Syntetický advokát", clientPattern: "*", scope: "client" });
  await f.success("profile", { lawyerName: "Syntetický advokát", jurisdiction: "sk", language: "sk", officeRoot: root });
  await mkdir(join(root, "Office", "memory"), { recursive: true });
  await writeFile(join(root, "Office", "memory", "T-001-poistka.md"), "syntetická úloha kancelárie\n");
  const read = await f.success(`office-memory?expectedPracticeRoot=${encodeURIComponent(root)}`);
  expect(read).toMatchObject({ directory: "Office", files: [{ path: "Office/memory/T-001-poistka.md", content: "syntetická úloha kancelárie\n" }], truncated: false });
  expect((await f.call(`office-memory?expectedPracticeRoot=${encodeURIComponent(join(f.base, "other"))}`)).status).toBe(409);
  expect((await f.call(`office-memory?expectedPracticeRoot=${encodeURIComponent(root)}`, undefined, {})).status).toBe(401);
  // Token, ktorý dostáva engine (OpenCode), hostiteľské čítanie nepustí.
  expect((await f.call("office-memory", undefined, { Authorization: "Bearer synthetic-client" })).status).toBe(401);
});

test("office stays configuration, client remains workspace for subject and both matter kinds", async () => {
  const f = await fixture();
  const office = await f.apply({ action: "office", parent: f.parent, title: "Synthetic office", lawyerName: "Synthetic lawyer", language: "sk", jurisdiction: "sk" });
  expect(office.workspace).toBeUndefined(); expect(f.config.workspaces).toHaveLength(0);
  const client = await f.apply({ action: "client", parent: f.parent, name: "Test", title: "Synthetic client", ...common });
  const subject = await f.apply({ action: "subject", clientRoot: client.root, name: "Division", title: "Synthetic division" });
  expect(subject.clientRoot).toBe(client.root); expect(subject.workspace.id).toBe(client.workspace.id);
  for (const kind of ["contentious", "non_contentious"]) {
    const matter = await f.apply({ action: "matter", clientRoot: client.root, parent: subject.root, title: kind, date: common.date, kind, area: "IP", jurisdiction: "sk", language: "sk", subject: "Division" });
    expect(matter.workspace.id).toBe(client.workspace.id);
    expect(await readFile(join(matter.matterRoot, "matter.md"), "utf8")).toContain(`kind: ${kind}`);
    expect(await readFile(join(matter.matterRoot, "AGENTS.md"), "utf8")).toBe(await readFile(join(matter.matterRoot, "CLAUDE.md"), "utf8"));
  }
  expect(f.config.workspaces).toHaveLength(1);
});

test("persisted preview applies once after restart and stale preview never writes", async () => {
  const f = await fixture();
  const preview = await f.success("plan", { action: "client", parent: f.parent, name: "Test", title: "Synthetic", ...common });
  const confirmation = { id: preview.id, fingerprint: preview.fingerprint, confirm: true };
  await f.restartFromDisk();
  const first = await f.success("apply", confirmation); expect(first.result).toBe("applied");
  const repeated = await f.success("apply", confirmation); expect(repeated.result).toBe("already_applied"); expect(repeated.workspace.id).toBe(first.workspace.id);
  const stale = await f.success("plan", { action: "client", parent: f.parent, name: "Stale", title: "Synthetic", ...common });
  await writeFile(join(f.parent, "new-data.bin"), Buffer.from([255, 0]));
  expect((await f.call("apply", { id: stale.id, fingerprint: stale.fingerprint, confirm: true })).status).toBe(400);
  expect(await readdir(f.parent)).not.toContain("Stale");
});

test("map preview and apply preserve original bytes and register outside metadata", async () => {
  const f = await fixture(), root = join(f.parent, "mapped"); await mkdir(root);
  await writeFile(join(root, "MEMORY.md"), "SYNTHETIC-CLIENT-ID original memory");
  await writeFile(join(root, "original.bin"), Buffer.from([0, 255, 0, 12]));
  const result = await f.apply({ action: "existing", root, mode: "map", memoryPath: "MEMORY.md", identityAnchor: "SYNTHETIC-CLIENT-ID" });
  expect(result.appFiles).toBe("outside"); expect(f.config.workspaces[0]?.appFiles).toBe("outside");
  await f.restartFromDisk();
  expect((await readdir(root)).sort()).toEqual(["MEMORY.md", "original.bin"]);
  expect(await readFile(join(root, "original.bin"))).toEqual(Buffer.from([0, 255, 0, 12]));
});

test("office runtime grant is exact, ticket-confirmed, and stays scoped to its client", async () => {
  const f = await fixture();
  const office = await f.apply({ action: "office", parent: f.parent, title: "Synthetic office", lawyerName: "Synthetic lawyer", language: "sk", jurisdiction: "sk" });
  await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", officeRoot: office.root });
  const preview = await f.success("plan", { action: "client", parent: f.parent, name: "First", title: "First client", ...common });
  // Sync reads Office/okf.config for client-path and authorization checks, so
  // the explicit grant is the Office directory, never its parent vault.
  expect(preview.preview.officeMemoryRoot).toBe(office.root);
  const first = await f.success("apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true });
  const firstGrants = runtimeExternalDirectory(await readRuntimeOpencodeConfig(f.config, first.workspace.id));
  expect(firstGrants).toEqual({ [`${office.root}/*`]: "allow" });
  expect(firstGrants[`${f.parent}/*`]).toBeUndefined();

  const second = await f.apply({ action: "client", parent: f.parent, name: "Second", title: "Second client", ...common });
  const secondGrants = runtimeExternalDirectory(await readRuntimeOpencodeConfig(f.config, second.workspace.id));
  expect(secondGrants).toEqual({ [`${office.root}/*`]: "allow" });
  expect(secondGrants[`${first.root}/*`]).toBeUndefined();
});

test("malformed persisted ticket is rejected before it can create a client", async () => {
  const f = await fixture();
  const preview = await f.success("plan", { action: "client", parent: f.parent, name: "Malformed", title: "Malformed", ...common });
  await writeFile(join(f.base, "data", "lawoss-onboarding", `${preview.id}.json`), JSON.stringify({ version: 1, id: preview.id }));
  const response = await f.call("apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true });
  expect(response.status).toBe(400);
  expect(await readdir(f.parent)).toEqual([]);
  expect((await readdir(join(f.base, "data", "lawoss-onboarding"))).some(name => name.endsWith(".result.json"))).toBe(false);
});

test("changing client clears persisted subject, matter, and trial scope", async () => {
  const f = await fixture();
  const first = await f.apply({ action: "client", parent: f.parent, name: "First", title: "First", ...common });
  const subject = await f.apply({ action: "subject", clientRoot: first.root, name: "Subject", title: "Subject" });
  const matter = await f.apply({ action: "matter", clientRoot: first.root, parent: subject.root, title: "Matter", date: common.date, kind: "contentious", area: "IP", jurisdiction: "sk", language: "sk", subject: "Subject" });
  const selected = await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", clientRoot: first.root, subjectRoot: subject.root, matterRoot: matter.matterRoot, trial: true });
  expect(selected.trial).toBe(false);
  const subjectLink = join(f.parent, "subject-link");
  await symlink(subject.root, subjectLink);
  expect((await f.call("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", clientRoot: first.root, subjectRoot: subjectLink })).status).toBe(400);
  await rm(subjectLink);
  const cleared = await f.success("profile", { subjectRoot: null });
  expect(cleared).toMatchObject({ clientRoot: first.root });
  expect(cleared.subjectRoot).toBeUndefined();
  expect(cleared.matterRoot).toBeUndefined();
  await f.restartFromDisk();
  const persisted = await f.success("status");
  expect(persisted.profile).toMatchObject({ clientRoot: first.root });
  expect(persisted.profile.subjectRoot).toBeUndefined();
  expect(persisted.profile.matterRoot).toBeUndefined();
  const second = await f.apply({ action: "client", parent: f.parent, name: "Second", title: "Second", ...common });
  const profile = await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", clientRoot: second.root });
  expect(profile).toMatchObject({ clientRoot: second.root, trial: false });
  expect(profile.subjectRoot).toBeUndefined();
  expect(profile.matterRoot).toBeUndefined();
});

test("completed tickets cannot enter recovery", async () => {
  const f = await fixture();
  const preview = await f.success("plan", { action: "client", parent: f.parent, name: "Complete", title: "Complete", ...common });
  await f.success("apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true });
  const response = await f.call("recover", { id: preview.id, fingerprint: preview.fingerprint, confirm: true, action: "rollback" });
  expect(response.status).toBe(409);
  expect(await response.json()).toMatchObject({ code: "onboarding_completed" });
});

test("finish recovery completes the durable plan, then ordinary apply registers its client", async () => {
  const f = await fixture();
  const response = await f.success("plan", { action: "client", parent: f.parent, name: "Recovered", title: "Recovered", ...common });
  const ticket = JSON.parse(await readFile(join(f.base, "data", "lawoss-onboarding", `${response.id}.json`), "utf8"));
  const plan = ticket.preview.plan as { root: string; operations: Array<{ path: string; kind: "file" | "directory"; content?: string }> };
  const baseline = await f.success("classify", { root: plan.root });
  const initial = plan.operations[0];
  expect(initial).toMatchObject({ kind: "directory" });
  await mkdir(join(plan.root, initial.path));
  const initialState = await lstat(join(plan.root, initial.path), { bigint: true });
  const identity = createHash("sha256").update(JSON.stringify(plan)).digest("hex");
  const journal = join(f.base, "data", "lawoss-onboarding", "journal");
  await mkdir(journal, { recursive: true });
  await writeFile(join(journal, `${identity}.json`), JSON.stringify({ version: 1, identity, plan, baseline: baseline.entries }));
  await writeFile(join(journal, `${identity}.events.jsonl`), [
    JSON.stringify({ type: "intent", path: initial.path, kind: initial.kind }),
    JSON.stringify({ type: "created", path: initial.path, kind: initial.kind, digest: "directory", identity: `${initialState.dev}:${initialState.ino}` }),
  ].join("\n") + "\n");
  const confirmation = { id: response.id, fingerprint: response.fingerprint, confirm: true };
  const recovered = await f.success("recover", { ...confirmation, action: "finish" });
  expect(recovered.status).toBe("applied");
  expect(f.config.workspaces).toHaveLength(0);
  const applied = await f.success("apply", confirmation);
  expect(applied.result).toBe("already_applied");
  expect(applied.root).toContain("Recovered");
  expect(f.config.workspaces).toHaveLength(1);
});

test("OKF choice is optional, acknowledged when enabled, and older profiles still load", async () => {
  const f = await fixture();
  const storage = runtimeStorageDir(f.config);
  await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", step: "ai" });
  const legacy = JSON.parse(await readFile(join(storage, "lawoss-onboarding", "profile.json"), "utf8"));
  expect(legacy.okf).toBeUndefined();
  await f.restartFromDisk();
  expect((await f.success("status")).profile).toMatchObject({ lawyerName: "Synthetic lawyer", step: "ai" });
  expect((await f.call("profile", { okf: { enabled: true } })).status).toBe(400);
  expect((await f.call("profile", { okf: { enabled: true, acknowledgedAt: "yesterday", noticeVersion: "2026-10-04-alfa-1" } })).status).toBe(400);
  expect((await f.call("profile", { okf: { enabled: false, acknowledgedAt: "2026-10-04T10:00:00.000Z" } })).status).toBe(400);
  expect((await f.call("profile", { okf: { enabled: true, acknowledgedAt: "2026-10-04T10:00:00.000Z", noticeVersion: "2026-10-04-alfa-1", extra: 1 } })).status).toBe(400);
  const enabled = await f.success("profile", { okf: { enabled: true, acknowledgedAt: "2026-10-04T10:00:00.000Z", noticeVersion: "2026-10-04-alfa-1" }, step: "okf" });
  expect(enabled).toMatchObject({ step: "okf", okf: { enabled: true, noticeVersion: "2026-10-04-alfa-1" } });
  const disabled = await f.success("profile", { okf: { enabled: false } });
  expect(disabled.okf).toEqual({ enabled: false });
  await f.restartFromDisk();
  expect((await f.success("status")).profile).toMatchObject({ lawyerName: "Synthetic lawyer", okf: { enabled: false } });
});

test("profil prijme skutočného klienta so symlinkom; classify problém naďalej hlási", async () => {
  const f = await fixture();
  const created = await f.apply({ action: "client", parent: f.parent, name: "Klient", title: "Klient", ...common });
  const clientRoot = created.clientRoot as string;
  await mkdir(join(clientRoot, "Podklady"));
  await symlink(join(clientRoot, "Podklady"), join(clientRoot, "odkaz"));
  await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", clientRoot });
  expect((await f.success("classify", { root: clientRoot })).complete).toBe(false);
});

test("profil prijme kanceláriu v koreni veľkej praxe bez prechádzania klientov", async () => {
  const f = await fixture(), root = join(f.base, "praxe");
  await mkdir(join(root, "Klient A"), { recursive: true });
  await symlink(join(root, "Klient A"), join(root, "odkaz-na-klienta"));
  await f.apply({ action: "practice", root, title: "Syntetická prax", jurisdiction: "sk", language: "sk", lawyerName: "Synthetic lawyer", clientPattern: "*", scope: "client" });
  await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", officeRoot: root });
});

test("nové kroky folder a found sa uložia; starý krok packs sa načíta", async () => {
  const f = await fixture();
  await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", step: "packs" });
  expect((await f.success("status")).profile.step).toBe("packs");
  await f.success("profile", { step: "folder" });
  await f.success("profile", { step: "found" });
  expect((await f.success("status")).profile.step).toBe("found");
});

test("vybraný priečinok kroku Toto som našiel sa uloží na obnovu, overí pri zápise a zmaže (M1)", async () => {
  const f = await fixture(), found = join(f.base, "3-neusporiadana-prax"), gone = join(f.base, "zmizne");
  await mkdir(join(found, "C002 Hron"), { recursive: true }); await mkdir(gone);
  await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", step: "found", foundRoot: found });
  await f.restartFromDisk();
  expect((await f.success("status")).profile).toMatchObject({ step: "found", foundRoot: found });
  // Bez kontroly úrovne: obyčajný priečinok (nie klient ani kancelária) sa uložiť dá; nič sa doň nezapíše.
  expect(await readdir(found)).toEqual(["C002 Hron"]);
  // Výslovný zápis chýbajúceho alebo relatívneho priečinka sa odmietne.
  const missing = await f.call("profile", { foundRoot: join(f.base, "neexistuje") });
  expect(missing.status).toBe(400);
  expect(await missing.json()).toMatchObject({ code: "folder_missing", details: { key: "foundRoot", name: "neexistuje" } });
  expect((await f.call("profile", { foundRoot: "relatívna/cesta" })).status).toBe(400);
  // Uložený priečinok, ktorý zmizol, inú zmenu profilu neblokuje.
  await f.success("profile", { foundRoot: gone });
  await rm(gone, { recursive: true });
  await f.success("profile", { step: "folder" });
  expect((await f.success("status")).profile).toMatchObject({ step: "folder", foundRoot: gone });
  const cleared = await f.success("profile", { foundRoot: null });
  expect(cleared.foundRoot).toBeUndefined();
  expect((await f.success("status")).profile.foundRoot).toBeUndefined();
});

test("profil naďalej odmietne priečinok, ktorý nie je klient", async () => {
  const f = await fixture(), plain = join(f.base, "obyčajný");
  await mkdir(plain);
  expect((await f.call("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", clientRoot: plain })).status).toBe(400);
});

test("hotová kancelária bez okf.config: návrh praxe, doplnenie kancelárie a uloženie do profilu (N-14)", async () => {
  const f = await fixture(), root = join(f.base, "4-usporiadana-kancelaria");
  await mkdir(join(root, "Office", "memory"), { recursive: true });
  await writeFile(join(root, "Office", "AGENTS.md"), "# Kancelária\n");
  await writeFile(join(root, "Office", "memory", "RULE.md"), "pravidlo\n");
  for (const client of ["C001-syn-alfa-s-r-o", "C002-syn-beta-a-s"]) {
    await mkdir(join(root, "Klienti", client), { recursive: true });
    await writeFile(join(root, "Klienti", client, "client.md"), `---\ntype: klient\ntitle: "${client}"\n---\n`);
  }
  const suggestion = await f.success("suggest", { root });
  expect(suggestion).toMatchObject({ level: "practice", marked: false, signals: ["office_without_config"], clientPattern: "Klienti/*" });
  expect(suggestion.clients).toHaveLength(2);
  // Pred doplnením kancelária nie je, profil ju odmietne.
  expect((await f.call("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", officeRoot: root })).status).toBe(400);
  const preview = await f.success("plan", { action: "practice", root, title: "Prax", jurisdiction: "sk", language: "sk", lawyerName: "Syntetický advokát", clientPattern: "Klienti/*", scope: "client" });
  expect(preview.preview.operations).toEqual(["Office/okf.config", "AGENTS.md", "CLAUDE.md"]);
  await f.success("apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true });
  expect(await readFile(join(root, "Office", "AGENTS.md"), "utf8")).toBe("# Kancelária\n");
  await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", officeRoot: root });
  for (const client of ["C001-syn-alfa-s-r-o", "C002-syn-beta-a-s"]) {
    const result = await f.apply({ action: "existing", root: join(root, "Klienti", client), mode: "convert", title: client, confirmUnknownClient: true, ...common });
    expect(result.result).toBe("applied");
  }
  expect(f.config.workspaces).toHaveLength(2);
});

test("suggest navrhne prax z mien priečinkov a nič nezapíše", async () => {
  const f = await fixture(), root = join(f.base, "kancelaria");
  for (const name of ["Alfa s. r. o.", "Beta a. s.", "Gama s.r.o.", "Delta k. s.", "Novák Ján/2024-03 Kúpna zmluva"]) await mkdir(join(root, name), { recursive: true });
  const suggestion = await f.success("suggest", { root });
  expect(suggestion).toMatchObject({ level: "practice", marked: false, clientPattern: "*" });
  expect(suggestion.clients).toHaveLength(5);
  expect((await readdir(root)).sort()).toEqual(["Alfa s. r. o.", "Beta a. s.", "Delta k. s.", "Gama s.r.o.", "Novák Ján"]);
  expect((await f.call("suggest", { root: "relatívna/cesta" })).status).toBe(400);
  expect((await f.call("suggest", { root }, {} as { "X-LegalWork-Host-Token": string; "Content-Type": string })).status).toBe(401);
});

test("office-memory accepts the same canonical profile root with trailing separators only", async () => {
  const f = await fixture(), root = join(f.base,"trailing-practice"), other = join(f.base,"other-practice");
  for (const directory of [root,other]) {
    await mkdir(join(directory,"Office","memory"),{ recursive: true });
    await writeFile(join(directory,"Office","okf.config"),"version: 1\n");
    await writeFile(join(directory,"Office","memory","T-001.md"),directory === root ? "selected" : "foreign");
  }
  const profile = await f.success("profile",{ lawyerName: "Synthetic", jurisdiction: "sk", language: "sk", officeRoot: `${root}/` });
  const endpoint = (expected: string) => `office-memory?expectedPracticeRoot=${encodeURIComponent(expected)}`;
  const response = await f.call(endpoint(profile.officeRoot));
  expect(response.status).toBe(200);
  expect(await response.json()).toMatchObject({ practiceRoot: root, files: [{ content: "selected" }] });
  expect((await f.call(endpoint(root))).status).toBe(200);
  expect((await f.call(endpoint(other))).status).toBe(409);
  expect((await f.call(endpoint(join(f.base,"missing")))).status).toBe(409);
});

test("značka dokončenia nastavenia (#96) sa uloží, prežije reštart a ďalší krok ju neprepíše", async () => {
  const f = await fixture();
  await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", step: "found" });
  expect((await f.call("profile", { completedAt: "včera" })).status).toBe(400);
  expect(await f.success("profile", { completedAt: "2026-10-18T10:00:00.000Z" })).toMatchObject({ step: "found", completedAt: "2026-10-18T10:00:00.000Z" });
  await f.success("profile", { step: "matter" });
  await f.restartFromDisk();
  expect((await f.success("status")).profile).toMatchObject({ step: "matter", completedAt: "2026-10-18T10:00:00.000Z" });
});

test("zmazaný priečinok kancelárie neblokuje výber klienta; vybraný chýbajúci priečinok má vlastný kód (test 19. 10. 2026)", async () => {
  const f = await fixture(), office = join(f.base, "kancelaria");
  await mkdir(office);
  await f.apply({ action: "office", parent: office, title: "LAWOSS", jurisdiction: "sk", language: "sk", lawyerName: "Synthetic lawyer" });
  await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", officeRoot: office });
  const created = await f.apply({ action: "client", parent: f.parent, name: "Klient", title: "Klient", ...common });
  await rm(office, { recursive: true, force: true });
  // Uložená kancelária, ktorá zmizla, nesmie zablokovať každú ďalšiu zmenu profilu (opakované 400 pri „Nový prípad“).
  expect(await f.success("profile", { clientRoot: created.clientRoot, step: "matter" })).toMatchObject({ clientRoot: created.clientRoot, step: "matter" });
  const missing = await f.call("profile", { officeRoot: office });
  expect(missing.status).toBe(400);
  expect(await missing.json()).toMatchObject({ code: "folder_missing", details: { key: "officeRoot", name: "kancelaria" } });
  const link = join(f.base, "odkaz-na-klienta");
  await symlink(created.clientRoot, link);
  const junction = await f.call("profile", { clientRoot: link });
  expect(junction.status).toBe(400);
  expect((await junction.json()).code).toBe("invalid_path");
});

test("public onboarding apply reports closed durability and registration checkpoints without changing its result", async () => {
  const checkpoints: string[] = [];
  const f = await fixture(checkpoint => { checkpoints.push(checkpoint); });
  const client = await f.apply({ action: "client", parent: f.parent, name: "Observed", title: "Observed", ...common });
  expect(client.result).toBe("applied");
  expect(f.config.workspaces[0]?.path).toBe(client.root);
  expect(await readFile(join(client.root, "AGENTS.md"), "utf8")).toBe(await readFile(join(client.root, "CLAUDE.md"), "utf8"));
  expect(checkpoints).toEqual([
    "ticket-enter", "ticket-done", "directories-enter", "directories-done", "execute-enter", "execute-done",
    "receipt-enter", "receipt-done", "register-enter", "register-done", "watchers-enter", "watchers-done",
  ]);
});


test("throwing embedding observers cannot alter actual onboarding durability or matter results", async () => {
  const f = await fixture(() => { throw new Error("private observer failure"); });
  const client = await f.apply({ action: "client", parent: f.parent, name: "Inert", title: "Inert", ...common });
  const matter = await f.apply({ action: "matter", clientRoot: client.root, parent: client.root, title: "Matter", date: common.date, kind: "contentious", area: "IP", jurisdiction: "sk", language: "sk" });
  expect(matter.result).toBe("applied"); expect(matter.workspace.id).toBe(client.workspace.id);
  expect(await readFile(join(matter.matterRoot, "matter.md"), "utf8")).toContain("kind: contentious");
  expect(await readFile(join(matter.matterRoot, "AGENTS.md"), "utf8")).toBe(await readFile(join(matter.matterRoot, "CLAUDE.md"), "utf8"));
});
