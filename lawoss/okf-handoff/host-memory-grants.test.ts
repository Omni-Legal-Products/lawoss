import { afterEach, expect, test } from "bun:test";
import { mkdtempSync, mkdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveHostMemoryGrants } from "./host-memory-grants.mjs";
import { LawossOkfHandoff } from "../../apps/server/src/opencode-plugins/lawoss-okf-handoff.ts";
const roots: string[] = [];
const prior = { url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_SERVER_TOKEN, grants: process.env.LAWOSS_MEMORY_ALLOWED_ROOTS };
afterEach(() => {
  roots.splice(0).forEach(root => rmSync(root, { recursive: true, force: true }));
  for (const [key, value] of Object.entries({ LEGALWORK_SERVER_URL: prior.url, LEGALWORK_SERVER_TOKEN: prior.token, LAWOSS_MEMORY_ALLOWED_ROOTS: prior.grants })) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});
function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), "lawoss-host-grants-"))); roots.push(root);
  const child = join(root, "child"), vault = join(root, "vault"); mkdirSync(child); mkdirSync(vault);
  const workspaces = { items: [{ id: "parent", path: root }, { id: "child", path: child }] };
  const grants = { authority: "runtime", workspaceId: "child", workspaceRoot: child, folders: [vault], hiddenCount: 0 };
  const requests: string[] = [];
  const fetcher = async (url: string, init: RequestInit) => { requests.push(url); expect(init.headers).toEqual({ authorization: "Bearer synthetic" }); expect(init.redirect).toBe("error"); return Response.json(url.endsWith("/workspaces") ? workspaces : grants); };
  return { root, child, vault, workspaces, grants, requests, options: { directory: child, serverUrl: "http://localhost:4321", token: "synthetic", fetch: fetcher } };
}
test("uses longest canonical workspace and authenticated runtime-only endpoint", async () => {
  const f = fixture(); expect(await resolveHostMemoryGrants(f.options)).toEqual([f.vault]);
  expect(f.requests).toEqual(["http://localhost:4321/workspaces", "http://localhost:4321/workspace/child/lawoss/memory/grants"]);
});
test("ambiguity, wrong response workspace, untrusted provenance and malformed grants fail closed", async () => {
  const f = fixture();
  f.workspaces.items.push({ id: "alias", path: f.child }); await expect(resolveHostMemoryGrants(f.options)).rejects.toThrow("Host memory permissions unavailable"); f.workspaces.items.pop();
  f.grants.workspaceId = "parent"; await expect(resolveHostMemoryGrants(f.options)).rejects.toThrow(); f.grants.workspaceId = "child";
  f.grants.workspaceRoot = f.root; await expect(resolveHostMemoryGrants(f.options)).rejects.toThrow(); f.grants.workspaceRoot = f.child;
  f.grants.authority = "file"; await expect(resolveHostMemoryGrants(f.options)).rejects.toThrow(); f.grants.authority = "runtime";
  f.grants.folders = ["relative"]; await expect(resolveHostMemoryGrants(f.options)).rejects.toThrow();
});
test("hidden rules deny broad allow, no matching workspace never grants", async () => {
  const f = fixture(); f.grants.hiddenCount = 1; expect(await resolveHostMemoryGrants(f.options)).toEqual([]);
  f.workspaces.items = []; await expect(resolveHostMemoryGrants(f.options)).rejects.toThrow();
});
test("HTTP errors, invalid/oversized JSON, redirects and timeout do not expose server body or token", async () => {
  const f = fixture();
  for (const response of [new Response("secret", { status: 403 }), new Response("{"), new Response("x".repeat(1024 * 1024 + 1)), new Response(null, { status: 302 })]) {
    await expect(resolveHostMemoryGrants({ ...f.options, fetch: async () => response })).rejects.toThrow("Host memory permissions unavailable");
  }
  await expect(resolveHostMemoryGrants({ ...f.options, timeoutMs: 5, fetch: () => new Promise(() => {}) })).rejects.toThrow("Host memory permissions unavailable");
});
test("production entry exports only plugin; missing BOTH native env variables never enables standalone grants", async () => {
  const f = fixture(); mkdirSync(join(f.child, ".lawoss"));
  writeFileSync(join(f.vault, "memory.md"), "SYNTHETIC-ONLY");
  writeFileSync(join(f.child, ".lawoss/memory-profile.json"), JSON.stringify({ version: 1, matterId: "synthetic", roots: [{ id: "vault", path: f.vault }], sources: [{ id: "memory", root: "vault", path: "memory.md", role: "case_memory", required: true, writable: false, anchors: ["SYNTHETIC-ONLY"] }] }));
  process.env.LAWOSS_MEMORY_ALLOWED_ROOTS = JSON.stringify([f.vault]); delete process.env.LEGALWORK_SERVER_URL; delete process.env.LEGALWORK_SERVER_TOKEN;
  const entry = await import("../../apps/server/src/opencode-plugins/lawoss-okf-handoff.ts"); expect(Object.keys(entry)).toEqual(["LawossOkfHandoff"]);
  const hooks = await LawossOkfHandoff({ directory: f.child }); const output = { context: [] as string[] };
  await hooks["experimental.session.compacting"]!({ sessionID: "native" }, output);
  expect(output.context[0]).toContain("FAILED"); expect(output.context[0]).not.toContain("SYNTHETIC-ONLY");
});

test("unrelated remote registration without a local directory does not block local grants", async () => {
  const f = fixture();
  const items = [...f.workspaces.items, { id: "remote", path: "", workspaceType: "remote" }];
  expect(await resolveHostMemoryGrants({ ...f.options, fetch: async (url: string) => Response.json(url.endsWith("/workspaces") ? { items } : f.grants) })).toEqual([f.vault]);
});
