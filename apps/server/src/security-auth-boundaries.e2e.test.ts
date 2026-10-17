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

async function fixture(readOnly = false, onApproval?: ServerConfig["requestHostApproval"], onRoot?: (root: string) => void) {
  const root = await mkdtemp(join(tmpdir(), "lawoss-auth-boundary-"));
  onRoot?.(root);
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
  const owner = await new TokenService(config).create("owner");
  const server = await startServer(config);
  cleanup.push(() => server.stop());
  const base = `http://127.0.0.1:${server.port}`;
  return { root, workspace, base, calls, viewer: { authorization: `Bearer ${viewer.token}` }, collaborator: { authorization: `Bearer ${config.token}` }, owner: { authorization: `Bearer ${owner.token}` } };
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
  const { observeSyntheticSkillPromotion } = await import("./lawoss/test-support/windows-skill-locks.js");
  let observation: ReturnType<typeof observeSyntheticSkillPromotion> | undefined;
  try {
  const f = await fixture(false, async () => "allow", root => { observation = observeSyntheticSkillPromotion(root); });
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
  } finally { observation?.restore(); }
}, 10000); // A failed single rename may add the bounded 2.5s read-only Windows probe.

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

test("viewer needs collaborator scope for audit, folder grants, memory context, hub detail, cloud plugins and import preview", async () => {
  const f = await fixture();
  const routes: Array<[string, string]> = [
    ["GET", "audit"], ["GET", "authorized-folders"], ["GET", "lawoss/memory/context"], ["GET", "lawoss/memory/grants"], ["GET", "lawoss/memory"],
    ["GET", "hub/synthetic-item"], ["GET", "cloud-plugins"], ["POST", "import/preview"],
  ];
  const call = (prefix: string, method: string, route: string, headers: Record<string, string>) => fetch(`${f.base}${prefix}/workspace/ws_1/${route}`, {
    method, headers: { ...headers, "Content-Type": "application/json" }, ...(method === "POST" ? { body: JSON.stringify({ opencode: { model: "synthetic/model" } }) } : {}),
  });
  const requiredScope = async (response: Response) => {
    const body: { error?: { details?: { required?: string } }; details?: { required?: string } } = await response.json();
    return body.error?.details?.required ?? body.details?.required;
  };
  for (const prefix of ["", "/w/ws_1"]) {
    for (const [method, route] of routes) {
      const denied = await call(prefix, method, route, f.viewer);
      expect(denied.status).toBe(403);
      expect(await requiredScope(denied)).toBe("collaborator");
      for (const trusted of [f.collaborator, f.owner]) {
        const allowed = await call(prefix, method, route, trusted);
        // The fixture has no signed-in hub team; the hub itself refuses, the scope gate passes.
        if (route.startsWith("hub/")) expect(await requiredScope(allowed)).toBeUndefined();
        else expect(allowed.status).toBe(200);
      }
    }
  }
  const preview = await call("", "POST", "import/preview", f.collaborator);
  const planned: { fingerprint: string; changes: Array<{ action: string }> } = await preview.json();
  expect(planned.fingerprint).toMatch(/^[a-f0-9]{64}$/);
  expect(planned.changes.length).toBeGreaterThan(0);
});

test("viewer cannot read or find protected configuration through project contents and content search", async () => {
  const f = await fixture();
  await writeFile(join(f.workspace, "credentials.json"), JSON.stringify({ token: "credential-secret-sentinel" }));
  await writeFile(join(f.workspace, "memo.md"), "Ordinary memo for the matter.");
  await symlink(join(f.workspace, "opencode.json"), join(f.workspace, "innocent.json"));
  const contents = async (headers: Record<string, string>) => {
    const response = await fetch(`${f.base}/workspace/ws_1/project/contents?kind=files&limit=50`, { headers });
    expect(response.status).toBe(200);
    const body: { sections: Array<{ items: Array<{ id: string }>; unavailable?: boolean }> } = await response.json();
    expect(body.sections[0].unavailable).toBeUndefined();
    return body.sections[0].items.map(item => item.id);
  };
  const listed = await contents(f.viewer);
  expect(listed).toContain("memo.md");
  for (const name of ["opencode.json", "credentials.json", "innocent.json"]) expect(listed).not.toContain(name);
  // Upstream lists neither links nor dot entries; innocent.json stays readable by its id.
  for (const trusted of [f.collaborator, f.owner]) expect(await contents(trusted)).toEqual(expect.arrayContaining(["memo.md", "opencode.json", "credentials.json"]));
  const read = (id: string, headers: Record<string, string>) => fetch(`${f.base}/workspace/ws_1/project/content?${new URLSearchParams({ kind: "files", id })}`, { headers });
  for (const id of ["opencode.json", "credentials.json", "innocent.json"]) {
    const denied = await read(id, f.viewer);
    expect(denied.status).toBe(403);
    expect(await denied.text()).not.toMatch(/secret-sentinel/);
  }
  expect((await read("memo.md", f.viewer)).status).toBe(200);
  for (const trusted of [f.collaborator, f.owner]) {
    const allowed = await read("opencode.json", trusted);
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain("provider-secret-sentinel");
  }
  // A collaborator's search prepares opencode.json first, so a viewer would hit the shared cache.
  const search = async (query: string, headers: Record<string, string>) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const response = await fetch(`${f.base}/workspace/ws_1/search/files?${new URLSearchParams({ q: query })}`, { headers });
      expect(response.status).toBe(200);
      const body: { items: Array<{ path: string; excerpt: string }>; preparing: number } = await response.json();
      if (body.preparing === 0) return body.items;
      await Bun.sleep(100);
    }
    throw new Error("Search preparation did not settle.");
  };
  for (const trusted of [f.collaborator, f.owner]) {
    expect((await search("provider-secret-sentinel", trusted)).map(item => item.path)).toContain("opencode.json");
  }
  for (const query of ["provider-secret-sentinel", "credential-secret-sentinel", "opencode", "credentials", "innocent"]) {
    const items = await search(query, f.viewer);
    expect(items).toEqual([]);
  }
  expect((await search("Ordinary memo", f.viewer)).map(item => item.path)).toEqual(["memo.md"]);
});

test("viewer cannot list or read prepared documents of protected configuration", async () => {
  const f = await fixture();
  await writeFile(join(f.workspace, "credentials.json"), JSON.stringify({ token: "credential-secret-sentinel" }));
  await writeFile(join(f.workspace, "memo.txt"), "Ordinary prepared memo");
  await symlink(join(f.workspace, "credentials.json"), join(f.workspace, "report.txt"));
  const endpoint = `${f.base}/workspace/ws_1/lawoss/documents`;
  const prepared = await fetch(`${endpoint}/prepare`, { method: "POST", headers: { ...f.collaborator, "Content-Type": "application/json" }, body: JSON.stringify({ paths: ["credentials.json", "memo.txt", "report.txt"] }) });
  expect(prepared.status).toBe(200);
  type Listed = { documents: Array<{ id: string; path: string; status: string }> };
  const list = async (headers: Record<string, string>) => {
    for (let attempt = 0; attempt < 150; attempt++) {
      const body: Listed = await (await fetch(endpoint, { headers })).json();
      if (body.documents.every(document => !["uploaded", "preparing"].includes(document.status))) return body.documents;
      await Bun.sleep(100);
    }
    throw new Error("Document preparation did not settle.");
  };
  const all = await list(f.collaborator);
  expect(all.map(document => document.path).sort()).toEqual(["credentials.json", "memo.txt", "report.txt"]);
  expect((await list(f.viewer)).map(document => document.path)).toEqual(["memo.txt"]);
  for (const document of all) {
    const response = await fetch(`${endpoint}/${document.id}/read`, { headers: f.viewer });
    if (document.path === "memo.txt") { expect(response.status).toBe(200); continue; }
    expect(response.status).toBe(403);
    expect(await response.text()).not.toContain("credential-secret-sentinel");
  }
  const secret = all.find(document => document.path === "credentials.json");
  for (const trusted of [f.collaborator, f.owner]) {
    const allowed = await fetch(`${endpoint}/${secret?.id}/read`, { headers: trusted });
    expect(allowed.status).toBe(200);
    expect(await allowed.text()).toContain("credential-secret-sentinel");
  }
});
