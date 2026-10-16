import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer, assertOpencodeProxyAllowed } from "./server.js";
import { TokenService } from "./tokens.js";
import type { ServerConfig } from "./types.js";
import { removeTestDir } from "./lawoss/test-support/remove-test-dir.js";

const cleanup: Array<() => unknown | Promise<unknown>> = [];
afterEach(async () => { while (cleanup.length) await cleanup.pop()?.(); });

async function fixture(readOnly = false, onApproval?: ServerConfig["requestHostApproval"]) {
  const root = await mkdtemp(join(tmpdir(), "lawoss-auth-boundary-"));
  // Windows: server drží runtime.sqlite otvorenú aj po stop(), rm skončí EBUSY.
  cleanup.push(() => removeTestDir(root));
  const isolated = { LEGALWORK_TOKEN_STORE: join(root, "tokens.json"), LEGALWORK_RUNTIME_DB: join(root, "runtime.sqlite") };
  const previous = Object.fromEntries(Object.keys(isolated).map((key) => [key, process.env[key]]));
  Object.assign(process.env, isolated);
  cleanup.push(() => {
    for (const key of Object.keys(isolated)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  });
  const calls: string[] = [];
  const engine = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch: (request) => {
    calls.push(`${request.method} ${new URL(request.url).pathname}`);
    return Response.json({ ok: true });
  } });
  cleanup.push(() => engine.stop(true));
  const workspace = join(root, "workspace");
  await mkdir(join(workspace, ".opencode"), { recursive: true });
  await writeFile(join(workspace, "opencode.json"), JSON.stringify({ provider: { test: { options: { apiKey: "provider-secret-sentinel" } } } }));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "collaborator-test-token", hostToken: "host-test-token", configPath: join(root, "server.json"),
    approval: { mode: onApproval ? "manual" : "auto", timeoutMs: 1000 }, requestHostApproval: onApproval, corsOrigins: ["*"], authorizedRoots: [workspace], readOnly,
    workspaces: [{ id: "ws_1", name: "Synthetic workspace", path: workspace, workspaceType: "local", preset: "starter", baseUrl: `http://127.0.0.1:${engine.port}`, opencodeUsername: "engine-user-sentinel", opencodePassword: "engine-password-sentinel", legalworkToken: "remote-token-sentinel" }],
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "json", logRequests: false,
  };
  const viewer = await new TokenService(config).create("viewer");
  const server = await startServer(config);
  cleanup.push(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  return { root, workspace, base, calls, viewer: { authorization: `Bearer ${viewer.token}` }, collaborator: { authorization: `Bearer ${config.token}` } };
}

test("workspace and mounted status projections do not leak engine credentials or escalate viewer access", async () => {
  const f = await fixture();
  for (const path of ["/status", "/workspaces", "/w/ws_1/status", "/w/ws_1/workspaces"]) {
    const response = await fetch(f.base + path, { headers: f.viewer });
    expect(response.status).toBe(200);
    const body = await response.text();
    expect(body).toContain("Synthetic workspace");
    for (const value of ["engine-user-sentinel", "engine-password-sentinel", "remote-token-sentinel"]) expect(body).not.toContain(value);
    const collaborator = await fetch(f.base + path, { headers: f.collaborator });
    const trustedBody = await collaborator.text();
    expect(trustedBody).toContain("remote-token-sentinel");
    expect(trustedBody).not.toContain("engine-password-sentinel");
  }
});

test("viewer cannot retrieve configuration through direct, mounted, export, metadata or engine aliases", async () => {
  const f = await fixture();
  for (const route of ["config", "runtime-config", "opencode-config", "opencode-config?scope=global", "mcp", "export", "export?sensitive=include", "skills", "commands"]) {
    for (const prefix of ["", "/w/ws_1"]) {
      const response = await fetch(`${f.base}${prefix}/workspace/ws_1/${route}`, { headers: f.viewer });
      expect(response.status).toBe(403);
      expect(await response.text()).not.toContain("provider-secret-sentinel");
    }
  }
  for (const mount of ["/opencode", "/w/ws_1/opencode", "/workspace/ws_1/opencode"]) {
    for (const path of ["/config", "/global/config", "/provider", "/file/content?path=opencode.json", "/find/text?pattern=secret", "/%63onfig", "/session%2f..%2fconfig"]) {
      const response = await fetch(f.base + mount + path, { headers: f.viewer });
      expect(response.status).toBe(403);
    }
  }
  expect(f.calls).toEqual([]);
  const normal = await fetch(`${f.base}/workspace/ws_1/opencode-config`, { headers: f.collaborator });
  expect(normal.status).toBe(200);
  expect(await normal.text()).toContain("provider-secret-sentinel");
  const session = await fetch(`${f.base}/opencode/session/synthetic_session/message`, { headers: f.viewer });
  expect(session.status).toBe(200);
  expect(f.calls).toEqual(["GET /session/synthetic_session/message"]);
});

test("skill detail and plugin configuration require collaborator access at every mount", async () => {
  const f = await fixture();
  const skill = join(f.workspace, ".opencode", "skills", "synthetic");
  await mkdir(skill, { recursive: true });
  const content = "---\nname: synthetic\ndescription: Synthetic test\n---\nskill-secret-sentinel\n";
  await writeFile(join(skill, "SKILL.md"), content);
  for (const prefix of ["", "/w/ws_1"]) {
    for (const route of ["skills/synthetic", "skills/synthetic?includeGlobal=true", "plugins", "plugins?includeGlobal=true"]) {
      const denied = await fetch(`${f.base}${prefix}/workspace/ws_1/${route}`, { headers: f.viewer });
      expect(denied.status).toBe(403);
      expect(await denied.text()).not.toContain("skill-secret-sentinel");
    }
    const allowed = await fetch(`${f.base}${prefix}/workspace/ws_1/skills/synthetic`, { headers: f.collaborator });
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain("skill-secret-sentinel");
    expect((await fetch(`${f.base}${prefix}/workspace/ws_1/plugins`, { headers: f.collaborator })).status).toBe(200);
  }
});

test("read-only mode blocks proxy mutations for collaborators at every mount but preserves reads", async () => {
  const f = await fixture(true);
  for (const mount of ["/opencode", "/w/ws_1/opencode", "/workspace/ws_1/opencode"]) {
    for (const method of ["POST", "DELETE", "PATCH"]) {
      const response = await fetch(`${f.base}${mount}/session/synthetic_session`, { headers: f.collaborator, method });
      expect(response.status).toBe(403);
    }
    expect((await fetch(`${f.base}${mount}/session/synthetic_session`, { headers: f.collaborator })).status).toBe(200);
  }
  expect(f.calls).toEqual(Array(3).fill("GET /session/synthetic_session"));
  expect(() => assertOpencodeProxyAllowed({ type: "remote", scope: "collaborator" }, "POST", "/permission/request/reply", false)).not.toThrow();
  expect(() => assertOpencodeProxyAllowed({ type: "remote", scope: "owner" }, "POST", "/permission/request/reply", true)).toThrow();
});


test("project configuration APIs cannot follow a link to an outside credential file", async () => {
  const f = await fixture();
  const endpoint = `${f.base}/workspace/ws_1/opencode-config`;
  expect((await fetch(endpoint, { headers: f.collaborator })).status).toBe(200);
  const outside = join(f.root, "outside-config.json");
  const sentinel = JSON.stringify({ provider: { sentinel: "outside-secret" } });
  await writeFile(outside, sentinel);
  await rm(join(f.workspace, "opencode.json"));
  await symlink(outside, join(f.workspace, "opencode.json"));
  for (const route of ["opencode-config", "runtime-config"]) {
    const response = await fetch(`${f.base}/workspace/ws_1/${route}`, { headers: f.collaborator });
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain("outside-secret");
  }
  const write = await fetch(endpoint, { method: "POST", headers: { ...f.collaborator, "Content-Type": "application/json" }, body: JSON.stringify({ scope: "project", content: "{}" }) });
  expect(write.status).toBe(400);
  expect(await readFile(outside, "utf8")).toBe(sentinel);
});

test("project configuration writes reject a different canonical target after approval", async () => {
  let link = "", replacement = "";
  const f = await fixture(false, async () => {
    await rm(link);
    await symlink(replacement, link);
    return "allow";
  });
  const endpoint = `${f.base}/workspace/ws_1/opencode-config`;
  expect((await fetch(endpoint, { headers: f.collaborator })).status).toBe(200);
  link = join(f.workspace, "opencode.json");
  const original = join(f.workspace, "approved.json");
  replacement = join(f.workspace, "unapproved.json");
  await writeFile(original, "{}"); await writeFile(replacement, "{}");
  await rm(link); await symlink(original, link);
  const response = await fetch(endpoint, { method: "POST", headers: { ...f.collaborator, "Content-Type": "application/json" }, body: JSON.stringify({ scope: "project", content: '{"model":"new-model"}' }) });
  expect(response.status).toBe(409);
  expect(await readFile(original, "utf8")).toBe("{}");
  expect(await readFile(replacement, "utf8")).toBe("{}");
});

for (const kind of ["commands", "skills"] as const) {
  test(`${kind} upsert rejects a different in-workspace target after approval`, async () => {
    let link = "", replacement = "";
    const f = await fixture(false, async () => {
      await rm(link);
      await symlink(replacement, link, "dir");
      return "allow";
    });
    const first = join(f.workspace, "first-tools");
    replacement = join(f.workspace, "other-tools");
    await mkdir(first); await mkdir(replacement);
    link = join(f.workspace, ".opencode", kind);
    await symlink(first, link, "dir");
    const payload = kind === "commands" ? { name: "synthetic", template: "Synthetic command" }
      : { name: "synthetic", description: "Synthetic skill", content: "Synthetic skill body" };
    const response = await fetch(`${f.base}/workspace/ws_1/${kind}`, {
      method: "POST", headers: { ...f.collaborator, "Content-Type": "application/json" }, body: JSON.stringify(payload),
    });
    expect(response.status).toBe(409);
    const suffix = kind === "commands" ? "synthetic.md" : "synthetic/SKILL.md";
    expect(await readFile(join(first, suffix), "utf8").catch(() => null)).toBeNull();
    expect(await readFile(join(replacement, suffix), "utf8").catch(() => null)).toBeNull();
  });
}

for (const kind of ["commands", "skills"] as const) {
  test(`${kind} delete rejects a different in-workspace target after approval`, async () => {
    let link = "", replacement = "";
    const f = await fixture(false, async () => {
      await rm(link); await symlink(replacement, link, "dir"); return "allow";
    });
    const first = join(f.workspace, "first-tools"); replacement = join(f.workspace, "other-tools");
    const suffix = kind === "commands" ? "synthetic.md" : "synthetic/SKILL.md";
    const content = kind === "commands" ? "---\nname: synthetic\n---\noriginal command\n"
      : "---\nname: synthetic\ndescription: Synthetic skill\n---\noriginal skill\n";
    for (const dir of [first, replacement]) {
      await mkdir(kind === "commands" ? dir : join(dir, "synthetic"), { recursive: true });
      await writeFile(join(dir, suffix), content);
    }
    link = join(f.workspace, ".opencode", kind); await symlink(first, link, "dir");
    const response = await fetch(`${f.base}/workspace/ws_1/${kind}/synthetic`, { method: "DELETE", headers: f.collaborator });
    expect(response.status).toBe(409);
    expect(await readFile(join(first, suffix), "utf8")).toBe(content);
    expect(await readFile(join(replacement, suffix), "utf8")).toBe(content);
  });
}

for (const method of ["POST", "DELETE", "PROMOTE"] as const) {
  test(`skill resource ${method} binds both the attachment and SKILL.md during approval`, async () => {
    let link = "", replacement = "";
    const f = await fixture(false, async () => {
      await rm(link); await symlink(replacement, link, "dir"); return "allow";
    });
    const first = join(f.workspace, "first-tools"); replacement = join(f.workspace, "other-tools");
    const content = "---\nname: synthetic\ndescription: Synthetic skill\n---\noriginal skill\n";
    for (const dir of [first, replacement]) {
      await mkdir(join(dir, "synthetic", "resources"), { recursive: true });
      await writeFile(join(dir, "synthetic", "SKILL.md"), content);
      await writeFile(join(dir, "synthetic", "resources", "sample.md"), "original attachment");
    }
    link = join(f.workspace, ".opencode", "skills"); await symlink(first, link, "dir");
    const route = method === "PROMOTE" ? "/workspace/ws_1/skills/synthetic/promote-workflow"
      : "/workspace/ws_1/skills/synthetic/resources" + (method === "DELETE" ? "/sample.md" : "");
    const response = await fetch(f.base + route, { method: method === "PROMOTE" ? "POST" : method, headers: { ...f.collaborator, "Content-Type": "application/json" },
      ...(method === "POST" ? { body: JSON.stringify({ name: "sample.md", content: "unapproved update" }) } : {}),
    });
    expect(response.status).toBe(409);
    for (const dir of [first, replacement]) {
      expect(await readFile(join(dir, "synthetic", "SKILL.md"), "utf8")).toBe(content);
      expect(await readFile(join(dir, "synthetic", "resources", "sample.md"), "utf8")).toBe("original attachment");
    }
  });
}

test("approved commands, skills and attachments still support their normal lifecycle", async () => {
  const f = await fixture(false, async () => "allow");
  const call = (route: string, method = "GET", body?: unknown) => fetch(`${f.base}/workspace/ws_1/${route}`, {
    method, headers: { ...f.collaborator, "Content-Type": "application/json" },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  expect((await call("commands", "POST", { name: "synthetic", template: "Synthetic command" })).status).toBe(200);
  expect((await call("commands/synthetic", "DELETE")).status).toBe(200);
  expect((await call("skills", "POST", { name: "synthetic", description: "Synthetic skill", content: "Synthetic body" })).status).toBe(200);
  expect((await call("skills/synthetic")).status).toBe(200);
  expect((await call("skills/synthetic/resources", "POST", { name: "sample.md", content: "Synthetic attachment" })).status).toBe(200);
  const resource = await call("skills/synthetic/resources/sample.md");
  expect(resource.status).toBe(200);
  expect(await resource.text()).toContain("Synthetic attachment");
  expect((await call("skills/synthetic/resources/sample.md", "DELETE")).status).toBe(200);
  expect((await call("skills/synthetic/promote-workflow", "POST")).status).toBe(200);
  expect((await call("skills/workflow-assistant-synthetic", "DELETE")).status).toBe(200);
});

test("resource deletion cannot replace an approved link node with its unchanged canonical target", async () => {
  let link = "", second = "";
  const f = await fixture(false, async () => { await rm(link); await symlink(second, link, "dir"); return "allow"; });
  const skill = join(f.workspace, ".opencode", "skills", "synthetic");
  const first = join(skill, "first"); second = join(skill, "second");
  await mkdir(first, { recursive: true }); await mkdir(second);
  const content = "---\nname: synthetic\ndescription: Synthetic skill\n---\noriginal skill\n";
  await writeFile(join(skill, "SKILL.md"), content);
  await writeFile(join(second, "sample.md"), "original attachment");
  await symlink(join(second, "sample.md"), join(first, "sample.md"));
  link = join(skill, "resources"); await symlink(first, link, "dir");
  const response = await fetch(`${f.base}/workspace/ws_1/skills/synthetic/resources/sample.md`, { method: "DELETE", headers: f.collaborator });
  expect(response.status).toBe(409);
  expect(await readFile(join(second, "sample.md"), "utf8")).toBe("original attachment");
  expect(await readFile(join(first, "sample.md"), "utf8")).toBe("original attachment");
  expect(await readFile(join(skill, "SKILL.md"), "utf8")).toBe(content);
});

test("workflow promotion binds the directory being renamed even when SKILL.md keeps the same target", async () => {
  let link = "", second = "";
  const f = await fixture(false, async () => { await rm(link); await symlink(second, link, "dir"); return "allow"; });
  const first = join(f.workspace, "first-skills"); second = join(f.workspace, "second-skills");
  await mkdir(first); await mkdir(join(second, "synthetic"), { recursive: true });
  const content = "---\nname: synthetic\ndescription: Synthetic skill\n---\noriginal skill\n";
  await writeFile(join(second, "synthetic", "SKILL.md"), content);
  await symlink(join(second, "synthetic"), join(first, "synthetic"), "dir");
  link = join(f.workspace, ".opencode", "skills"); await symlink(first, link, "dir");
  const response = await fetch(`${f.base}/workspace/ws_1/skills/synthetic/promote-workflow`, { method: "POST", headers: f.collaborator });
  expect(response.status).toBe(409);
  expect(await readFile(join(second, "synthetic", "SKILL.md"), "utf8")).toBe(content);
  expect(await readFile(join(first, "synthetic", "SKILL.md"), "utf8")).toBe(content);
});
