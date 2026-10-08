import { afterEach, expect, test } from "bun:test";
import { lstat, mkdir, mkdtemp, readFile, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";
import { resolveWorkspaceFilePath } from "./lawoss/filesystem-boundary.js";
import { listPortableFiles, writePortableFiles } from "./portable-files.js";
import { buildWorkspaceImportPreview } from "./workspace-import-preview.js";
import { upsertCommand } from "./commands.js";
import { upsertSkill } from "./skills.js";
import { deleteSkillResource, listSkillResources, readSkillResource, upsertSkillResource } from "./skill-resources.js";

const originalEnv = { LEGALWORK_TOKEN_STORE: process.env.LEGALWORK_TOKEN_STORE, LEGALWORK_RUNTIME_DB: process.env.LEGALWORK_RUNTIME_DB, LEGALWORK_DATA_DIR: process.env.LEGALWORK_DATA_DIR };
const cleanup: Array<() => Promise<unknown> | unknown> = [];
afterEach(async () => {
  try { for (const fn of cleanup.splice(0).reverse()) await fn(); }
  finally { for (const [key, value] of Object.entries(originalEnv)) { if (value === undefined) delete process.env[key]; else process.env[key] = value; } }
});
const headers = { Authorization: "Bearer boundary-client", "Content-Type": "application/json" };
const hostHeaders = { "X-LegalWork-Host-Token": "boundary-host", "Content-Type": "application/json" };

async function fixture(alias = false, manual = false) {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-security-files-")));
  cleanup.push(() => rm(base, { recursive: true, force: true }));
  process.env.LEGALWORK_TOKEN_STORE = join(base, "tokens.json");
  process.env.LEGALWORK_RUNTIME_DB = join(base, "runtime.db");
  process.env.LEGALWORK_DATA_DIR = join(base, "data");
  const root = join(base, "workspace"), outside = join(base, "outside");
  await mkdir(root); await mkdir(outside);
  await mkdir(join(root, "notes"));
  await writeFile(join(root, "notes", "ordinary.md"), "ordinary document");
  await writeFile(join(outside, "secret.md"), "synthetic outside sentinel");
  await symlink(outside, join(root, "escape"), "dir");
  await symlink(join(root, "notes"), join(root, "inside"), "dir");
  let workspace = root;
  if (alias) { workspace = join(base, "root-alias"); await symlink(root, workspace, "dir"); }
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "boundary-client", hostToken: "boundary-host", configPath: join(base, "server.json"),
    approval: { mode: manual ? "manual" : "auto", timeoutMs: 5000 }, corsOrigins: [],
    workspaces: [{ id: "test", name: "Test", path: workspace, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [workspace], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const server = await startServer(config);
  cleanup.push(() => server.stop());
  const origin = `http://127.0.0.1:${server.port}`;
  const request = (path: string, body?: unknown, customHeaders: Record<string, string> = headers) => fetch(`${origin}${path}`, {
    method: body === undefined ? "GET" : "POST", headers: customHeaders,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const file = (method: string, path: string) => request(`/workspace/test/files/${method}?${new URLSearchParams({ path })}`);
  const session = async (customHeaders: Record<string, string> = headers) => {
    const response = await request("/workspace/test/files/sessions", {}, customHeaders);
    expect(response.status).toBe(200);
    const body: { session: { id: string } } = await response.json();
    return `/files/sessions/${body.session.id}`;
  };
  return { base, root, outside, workspace, origin, request, file, session };
}

test("file APIs reject outside file/directory links and missing descendants; ordinary and inside links still work", async () => {
  const f = await fixture(true);
  await symlink(join(f.outside, "secret.md"), join(f.root, "secret-alias.md"));
  await symlink(join(f.outside, "missing.md"), join(f.root, "dangling.md"));
  for (const path of ["escape/secret.md", "secret-alias.md", "dangling.md"]) {
    for (const method of ["raw", "content", "stat"]) expect((await f.file(method, path)).status).toBe(400);
  }
  expect((await f.file("list", "escape")).status).toBe(400);
  const listing: { entries: { name: string }[] } = await (await f.file("list", "")).json();
  expect(listing.entries.some(entry => entry.name === "escape")).toBe(false);
  expect((await f.file("content", "inside/ordinary.md")).status).toBe(200);
  const write = await f.request("/workspace/test/files/content", { path: "inside/new.md", content: "safe" });
  expect(write.status).toBe(200);
  expect(await readFile(join(f.root, "notes", "new.md"), "utf8")).toBe("safe");
  for (const route of ["content", "raw"]) {
    const response = await f.request(`/workspace/test/files/${route}`, { path: "escape/new/deep.md", content: "no", dataBase64: "bm8=" });
    expect(response.status).toBe(400);
  }
  expect(await readFile(join(f.outside, "secret.md"), "utf8")).toBe("synthetic outside sentinel");
  expect(await lstat(join(f.outside, "new")).catch(() => null)).toBeNull();
});

test("batch APIs and rename/delete/mkdir reject descendants of outside links", async () => {
  const f = await fixture();
  const session = await f.session();
  const reads: { items: { ok: boolean }[] } = await (await f.request(`${session}/read-batch`, { paths: ["escape/secret.md", "notes/ordinary.md"] })).json();
  expect(reads.items.map(item => item.ok)).toEqual([false, true]);
  const writes: { items: { ok: boolean }[] } = await (await f.request(`${session}/write-batch`, { writes: [{ path: "escape/secret.md", contentBase64: "eA==" }] })).json();
  expect(writes.items[0]?.ok).toBe(false);
  for (const op of [{ type: "delete", path: "escape/secret.md" }, { type: "mkdir", path: "escape/new" }, { type: "rename", from: "notes/ordinary.md", to: "escape/moved.md" }]) {
    expect((await f.request(`${session}/ops`, { operations: [op] })).status).toBe(400);
  }
  await symlink(join(f.root, "notes", "ordinary.md"), join(f.root, "inside-leaf.md"));
  expect((await f.request(`${session}/ops`, { operations: [{ type: "delete", path: "inside-leaf.md" }] })).status).toBe(200);
  expect(await readFile(join(f.root, "notes", "ordinary.md"), "utf8")).toBe("ordinary document");
  expect(await lstat(join(f.root, "inside-leaf.md")).catch(() => null)).toBeNull();
  await symlink(join(f.root, "notes", "ordinary.md"), join(f.root, "inside-leaf.md"));
  const renamed: { items: { ok: boolean }[] } = await (await f.request(`${session}/ops`, { operations: [{ type: "rename", from: "inside-leaf.md", to: "renamed-leaf.md" }] })).json();
  expect(renamed.items[0]?.ok).toBe(true);
  expect((await lstat(join(f.root, "renamed-leaf.md"))).isSymbolicLink()).toBe(true);
  await writeFile(join(f.root, "replacement.md"), "replacement document");
  const replaced: { items: { ok: boolean }[] } = await (await f.request(`${session}/ops`, { operations: [{ type: "rename", from: "replacement.md", to: "renamed-leaf.md" }] })).json();
  expect(replaced.items[0]?.ok).toBe(true);
  expect((await lstat(join(f.root, "renamed-leaf.md"))).isSymbolicLink()).toBe(false);
  expect(await readFile(join(f.root, "renamed-leaf.md"), "utf8")).toBe("replacement document");
  expect(await readFile(join(f.root, "notes", "ordinary.md"), "utf8")).toBe("ordinary document");
});

test("inbox/outbox roots and download aliases cannot escape the workspace", async () => {
  const f = await fixture();
  await mkdir(join(f.root, ".opencode", "legalwork"), { recursive: true });
  for (const name of ["inbox", "outbox"]) await symlink(f.outside, join(f.root, ".opencode", "legalwork", name), "dir");
  const id = Buffer.from("secret.md").toString("base64url");
  for (const route of ["inbox", `inbox/${id}`, "artifacts", `artifacts/${id}`]) expect((await f.request(`/workspace/test/${route}`)).status).toBe(400);
  const form = new FormData(); form.set("file", new File(["forbidden"], "write.md"));
  expect((await fetch(`${f.origin}/workspace/test/inbox`, { method: "POST", headers: { Authorization: headers.Authorization }, body: form })).status).toBe(400);
  expect(await lstat(join(f.outside, "write.md")).catch(() => null)).toBeNull();
});

test("viewer cannot recover configuration through raw/content/stat, session or artifact aliases", async () => {
  const f = await fixture();
  await mkdir(join(f.root, ".opencode", "legalwork", "outbox"), { recursive: true });
  await writeFile(join(f.root, "opencode.json"), JSON.stringify({ provider: { secret: "synthetic-key" } }));
  await symlink(join(f.root, "opencode.json"), join(f.root, "innocent.json"));
  await symlink(join(f.root, "opencode.json"), join(f.root, ".opencode", "legalwork", "outbox", "secret.json"));
  const issued = await f.request("/tokens", { scope: "viewer", label: "security test" }, hostHeaders);
  expect(issued.status).toBe(201);
  const token: { token: string } = await issued.json();
  const viewer = { ...headers, Authorization: `Bearer ${token.token}` };
  for (const path of ["opencode.json", "innocent.json"]) {
    for (const method of ["raw", "content", "stat"]) expect((await f.request(`/workspace/test/files/${method}?path=${path}`, undefined, viewer)).status).toBe(403);
  }
  const session = await f.session(viewer);
  const response = await f.request(`${session}/read-batch`, { paths: ["innocent.json", "notes/ordinary.md"] }, viewer);
  const batch: { items: { ok: boolean }[] } = await response.json();
  expect(batch.items.map(item => item.ok)).toEqual([false, true]);
  const id = Buffer.from("secret.json").toString("base64url");
  expect((await f.request(`/workspace/test/artifacts/${id}`, undefined, viewer)).status).toBe(403);
  const resolved: { items: unknown[] } = await (await f.request("/workspace/test/artifacts/resolve", { targets: [{ value: "innocent.json" }] }, viewer)).json();
  expect(resolved.items).toEqual([]);
  expect((await f.file("content", "opencode.json")).status).toBe(200);
  // Protect the physical target when app metadata/config are themselves aliases.
  await rename(join(f.root, ".opencode"), join(f.root, "app-meta"));
  await symlink(join(f.root, "app-meta"), join(f.root, ".opencode"), "dir");
  await writeFile(join(f.root, "app-meta", "settings.json"), "synthetic credential");
  await symlink(join(f.root, "app-meta", "settings.json"), join(f.root, "report.json"));
  expect((await f.request("/workspace/test/files/raw?path=report.json", undefined, viewer)).status).toBe(403);
  await rename(join(f.root, "opencode.json"), join(f.root, "settings-copy.json"));
  await symlink(join(f.root, "settings-copy.json"), join(f.root, "opencode.json"));
  expect((await f.request("/workspace/test/files/raw?path=settings-copy.json", undefined, viewer)).status).toBe(403);
  for (const name of [".npmrc", ".netrc", "auth.json", "credentials.json", ".env.production"]) {
    const target = `report-${name.replaceAll(".", "-")}.txt`;
    await writeFile(join(f.root, target), "synthetic credential");
    await symlink(join(f.root, target), join(f.root, name));
    expect((await f.request(`/workspace/test/files/raw?path=${target}`, undefined, viewer)).status).toBe(403);
  }
});

test("portable files, config import previews and project skill/command writes reject linked metadata roots", async () => {
  const f = await fixture();
  await symlink(f.outside, join(f.root, ".opencode"), "dir");
  const files = [{ path: ".opencode/tools/unsafe.ts", content: "no" }];
  await expect(listPortableFiles(f.root)).rejects.toMatchObject({ code: "invalid_path" });
  await expect(writePortableFiles(f.root, files)).rejects.toMatchObject({ code: "invalid_path" });
  for (const payload of [{ files }, { opencode: {} }, { legalwork: {} }, { skills: [{ name: "test", content: "test" }] }, { commands: [{ name: "test", template: "test" }] }]) {
    await expect(buildWorkspaceImportPreview(f.root, payload)).rejects.toMatchObject({ code: "invalid_path" });
  }
  await expect(upsertCommand(f.root, { name: "test", template: "no" })).rejects.toMatchObject({ code: "invalid_path" });
  await expect(upsertSkill(f.root, { name: "test", description: "synthetic test", content: "no" })).rejects.toMatchObject({ code: "invalid_path" });
  expect(await lstat(join(f.outside, "tools")).catch(() => null)).toBeNull();
});

test("skill resources cannot read or overwrite files through directory, leaf or SKILL.md links", async () => {
  const f = await fixture();
  const skill = join(f.root, ".opencode", "skills", "test");
  await mkdir(skill, { recursive: true });
  await writeFile(join(skill, "SKILL.md"), "---\nname: test\ndescription: Synthetic test\n---\nInstructions.\n");
  await symlink(f.outside, join(skill, "resources"), "dir");
  await expect(listSkillResources(f.root, "test")).rejects.toMatchObject({ code: "invalid_path" });
  await expect(readSkillResource(f.root, "test", "secret.md")).rejects.toMatchObject({ code: "invalid_path" });
  await expect(upsertSkillResource(f.root, "test", { name: "secret.md", content: "bad" })).rejects.toMatchObject({ code: "invalid_path" });
  await expect(deleteSkillResource(f.root, "test", "secret.md")).rejects.toMatchObject({ code: "invalid_path" });
  await rm(join(skill, "resources")); await mkdir(join(skill, "resources"));
  await symlink(join(f.outside, "secret.md"), join(skill, "resources", "secret.md"));
  await expect(readSkillResource(f.root, "test", "secret.md")).rejects.toMatchObject({ code: "invalid_path" });
  await expect(upsertSkillResource(f.root, "test", { name: "secret.md", content: "bad" })).rejects.toMatchObject({ code: "invalid_path" });
  await expect(deleteSkillResource(f.root, "test", "secret.md")).rejects.toMatchObject({ code: "invalid_path" });
  await rm(join(skill, "SKILL.md")); await symlink(join(f.outside, "secret.md"), join(skill, "SKILL.md"));
  await expect(upsertSkillResource(f.root, "test", { name: "ordinary.md", content: "bad" })).rejects.toMatchObject({ code: "invalid_path" });
  expect(await readFile(join(f.outside, "secret.md"), "utf8")).toBe("synthetic outside sentinel");
  expect(await lstat(join(skill, "resources", "ordinary.md")).catch(() => null)).toBeNull();
});

test("a link replaced while waiting for approval is checked again before writing", async () => {
  const f = await fixture(false, true);
  const pending = f.request("/workspace/test/files/content", { path: "inside/new.md", content: "denied" });
  let id: string | undefined;
  for (let i = 0; i < 100; i++) {
    const response: { items: { id: string }[] } = await (await f.request("/approvals", undefined, hostHeaders)).json();
    id = response.items[0]?.id;
    if (id) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(id).toBeDefined();
  await rm(join(f.root, "inside")); await symlink(f.outside, join(f.root, "inside"), "dir");
  expect((await f.request(`/approvals/${id}`, { reply: "allow" }, hostHeaders)).status).toBe(200);
  expect((await pending).status).toBe(400);
  expect(await lstat(join(f.outside, "new.md")).catch(() => null)).toBeNull();
});

for (const type of ["mkdir", "delete", "rename"] as const) {
  test(`${type} cannot move an approved operation to a different in-workspace target`, async () => {
    const f = await fixture(false, true);
    await mkdir(join(f.root, "other-notes"));
    await writeFile(join(f.root, "other-notes", "ordinary.md"), "other document");
    const session = await f.session();
    const operation = type === "mkdir" ? { type, path: "inside/new" }
      : type === "delete" ? { type, path: "inside/ordinary.md" }
      : { type, from: "inside/ordinary.md", to: "inside/moved.md" };
    const pending = f.request(`${session}/ops`, { operations: [operation] });
    let id: string | undefined;
    for (let i = 0; i < 100; i++) {
      const approvals: { items: { id: string }[] } = await (await f.request("/approvals", undefined, hostHeaders)).json();
      id = approvals.items[0]?.id;
      if (id) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(id).toBeDefined();
    await rm(join(f.root, "inside"));
    await symlink(join(f.root, "other-notes"), join(f.root, "inside"), "dir");
    expect((await f.request(`/approvals/${id}`, { reply: "allow" }, hostHeaders)).status).toBe(200);
    const response: { items: { ok: boolean; message: string }[] } = await (await pending).json();
    expect(response.items[0]?.ok).toBe(false);
    expect(response.items[0]?.message).toContain("changed");
    expect(await readFile(join(f.root, "notes", "ordinary.md"), "utf8")).toBe("ordinary document");
    expect(await readFile(join(f.root, "other-notes", "ordinary.md"), "utf8")).toBe("other document");
    expect(await lstat(join(f.root, "other-notes", "new")).catch(() => null)).toBeNull();
    expect(await lstat(join(f.root, "other-notes", "moved.md")).catch(() => null)).toBeNull();
  });
}

test("canonical boundary rejects traversal and dangling ancestors but accepts a missing in-root child", async () => {
  const f = await fixture(true);
  await expect(resolveWorkspaceFilePath(f.workspace, "../outside/secret.md")).rejects.toMatchObject({ code: "invalid_path" });
  await symlink(join(f.outside, "missing"), join(f.root, "dangling"), "dir");
  await expect(resolveWorkspaceFilePath(f.workspace, "dangling/deep/file.md")).rejects.toMatchObject({ code: "invalid_path" });
  expect(await resolveWorkspaceFilePath(f.workspace, "new/deep/file.md")).toBe(join(f.root, "new/deep/file.md"));
});

for (const variant of ["delete", "rename-source", "rename-destination"] as const) {
  test(`${variant} keeps the approved leaf operation bound when its canonical target is unchanged`, async () => {
    const f = await fixture(false, true);
    await mkdir(join(f.root, "other-notes"));
    await writeFile(join(f.root, "other-notes", "ordinary.md"), "protected target");
    await writeFile(join(f.root, "source.md"), "source document");
    await rm(join(f.root, "notes", "ordinary.md"));
    await symlink(join(f.root, "other-notes", "ordinary.md"), join(f.root, "notes", "ordinary.md"));
    const session = await f.session();
    const operation = variant === "delete" ? { type: "delete", path: "inside/ordinary.md" }
      : variant === "rename-source" ? { type: "rename", from: "inside/ordinary.md", to: "renamed.md" }
      : { type: "rename", from: "source.md", to: "inside/ordinary.md" };
    const pending = f.request(`${session}/ops`, { operations: [operation] });
    let id: string | undefined;
    for (let i = 0; i < 100; i++) {
      const approvals: { items: { id: string }[] } = await (await f.request("/approvals", undefined, hostHeaders)).json();
      id = approvals.items[0]?.id;
      if (id) break;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    expect(id).toBeDefined();
    const canonicalBefore = await realpath(join(f.root, "inside", "ordinary.md"));
    await rm(join(f.root, "inside"));
    await symlink(join(f.root, "other-notes"), join(f.root, "inside"), "dir");
    expect(await realpath(join(f.root, "inside", "ordinary.md"))).toBe(canonicalBefore);
    expect((await f.request(`/approvals/${id}`, { reply: "allow" }, hostHeaders)).status).toBe(200);
    const response: { items: { ok: boolean; message: string }[] } = await (await pending).json();
    expect(response.items[0]?.ok).toBe(false);
    expect(response.items[0]?.message).toContain("changed");
    expect((await lstat(join(f.root, "notes", "ordinary.md"))).isSymbolicLink()).toBe(true);
    expect(await readFile(join(f.root, "other-notes", "ordinary.md"), "utf8")).toBe("protected target");
    expect(await readFile(join(f.root, "source.md"), "utf8")).toBe("source document");
    expect(await lstat(join(f.root, "renamed.md")).catch(() => null)).toBeNull();
  });
}

test("import fingerprint binds the canonical target even when two destinations have identical contents", async () => {
  const f = await fixture(false, true);
  await mkdir(join(f.root, ".opencode"));
  for (const name of ["tools-a", "tools-b"]) {
    await mkdir(join(f.root, name));
    await writeFile(join(f.root, name, "test.ts"), "original");
  }
  const alias = join(f.root, ".opencode", "tools");
  await symlink(join(f.root, "tools-a"), alias, "dir");
  const payload = { files: [{ path: ".opencode/tools/test.ts", content: "changed" }] };
  const previewResponse = await f.request("/workspace/test/import/preview", payload);
  expect(previewResponse.status).toBe(200);
  const preview: { fingerprint: string; changes: Record<string, unknown>[] } = await previewResponse.json();
  expect(preview.changes[0]).not.toHaveProperty("canonicalPath");
  const pending = f.request("/workspace/test/import", { ...payload, previewFingerprint: preview.fingerprint });
  let id: string | undefined;
  for (let i = 0; i < 100; i++) {
    const approvals: { items: { id: string }[] } = await (await f.request("/approvals", undefined, hostHeaders)).json();
    id = approvals.items[0]?.id;
    if (id) break;
    await new Promise(resolve => setTimeout(resolve, 10));
  }
  expect(id).toBeDefined();
  await rm(alias); await symlink(join(f.root, "tools-b"), alias, "dir");
  expect((await f.request(`/approvals/${id}`, { reply: "allow" }, hostHeaders)).status).toBe(200);
  const applied = await pending;
  expect(applied.status).toBe(409);
  expect(await applied.json()).toMatchObject({ code: "workspace_import_preview_stale" });
  for (const name of ["tools-a", "tools-b"]) expect(await readFile(join(f.root, name, "test.ts"), "utf8")).toBe("original");
});
