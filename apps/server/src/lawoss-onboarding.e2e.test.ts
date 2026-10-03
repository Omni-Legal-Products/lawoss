import { afterEach, expect, test } from "bun:test";
import { createHash } from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, readdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveServerConfig } from "./config.js";
import { readRuntimeOpencodeConfig, runtimeExternalDirectory } from "./runtime-opencode-config-store.js";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

const roots: string[] = [], stops: (() => void | Promise<void>)[] = [];
const originalData = process.env.LEGALWORK_DATA_DIR, originalTokens = process.env.LEGALWORK_TOKEN_STORE;
afterEach(async () => {
  for (const stop of stops.splice(0)) await stop();
  for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true });
  if (originalData === undefined) delete process.env.LEGALWORK_DATA_DIR; else process.env.LEGALWORK_DATA_DIR = originalData;
  if (originalTokens === undefined) delete process.env.LEGALWORK_TOKEN_STORE; else process.env.LEGALWORK_TOKEN_STORE = originalTokens;
});
async function fixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-onboarding-api-"))); roots.push(base);
  const parent = join(base, "practice"), data = join(base, "data"); await mkdir(parent); await mkdir(data);
  process.env.LEGALWORK_DATA_DIR = data; process.env.LEGALWORK_TOKEN_STORE = join(data, "tokens.json");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(data, "server.json"), token: "synthetic-client", hostToken: "synthetic-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  let server = await startServer(config); stops.push(() => server.stop());
  const headers = { "X-LegalWork-Host-Token": "synthetic-host", "Content-Type": "application/json" };
  const call = (path: string, body?: unknown, auth = headers) => fetch(`http://127.0.0.1:${server.port}/lawoss/onboarding/${path}`, { headers: auth, ...(body === undefined ? {} : { method: "POST", body: JSON.stringify(body) }) });
  const success = async (path: string, body?: unknown) => { const response = await call(path, body), result = await response.json(); expect({ status: response.status, error: result.error }).toEqual({ status: 200, error: undefined }); return result; };
  const apply = async (request: unknown) => { const preview = await success("plan", request); return success("apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true }); };
  return {
    base, parent, config, call, success, apply,
    restart: async () => { await server.stop(); server = await startServer(config); },
    restartFromDisk: async () => {
      await server.stop();
      const restored = await resolveServerConfig({ configPath: config.configPath, workspaces: [], token: "synthetic-client", hostToken: "synthetic-host" });
      Object.assign(config, restored);
      server = await startServer(config);
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
