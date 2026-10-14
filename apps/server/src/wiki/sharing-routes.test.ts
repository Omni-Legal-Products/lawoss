import { afterEach, expect, test } from "bun:test";
import { randomUUID } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { WikiTeamRecord } from "@legalwork/types/wiki";
import { ApprovalService } from "../approvals.js";
import { ApiError } from "../errors.js";
import { ReloadEventStore } from "../events.js";
import { TokenService } from "../tokens.js";
import type { ServerConfig, TokenScope } from "../types.js";
import { matchRoute, type Route } from "../routes/registry.js";
import { registerWikiRoutes } from "../routes/wikis.js";
import { WikiStore } from "./store.js";

const cleanup: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of cleanup.splice(0)) await close(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "wiki-sharing-routes-"));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "client", hostToken: "host", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false,
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const store = new WikiStore(config), routes: Route[] = [];
  cleanup.push(async () => { await store.close(); await rm(root, { recursive: true, force: true }); });
  const remote = new Map<string, WikiTeamRecord>();
  let unsupported = false, revoked = false, shareFailed = false;
  const record = (name: string): WikiTeamRecord => ({ id: randomUUID(), name, ownerUserId: "owner", role: "owner", access: "org", memberIds: [], createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
  registerWikiRoutes({ routes, config, store, jsonResponse: (data, status = 200) => Response.json(data, { status }),
    readJsonBodyLimited: async (request) => request.json(), ensureWritable: () => {}, requireApproval: async () => {},
    requireClientScope: (ctx, required) => {
      if (required === "owner" && ctx.actor?.scope !== "owner") throw new ApiError(403, "forbidden", "Owner required.");
    },
    ensureWikiReadable: async (_ctx, wiki) => { if (revoked && wiki.sync) throw new ApiError(403, "revoked", "Access revoked."); },
    team: async () => {
      if (unsupported) throw new ApiError(503, "wiki_server_update_required", "Update the server to share wikis.");
      return { orgId: "firm", userId: "owner", orgName: "Firm", items: [...remote.values()], members: [] };
    },
    sharing: async (id) => remote.get(id) ?? null,
    share: async (id, input) => {
      if (shareFailed) throw new ApiError(503, "wiki_team_unavailable", "Sharing is unavailable. Your wiki is saved locally.");
      const wiki = await store.get(id), shared = { ...record(wiki.name), ...input };
      remote.set(id, shared);
      await store.update(id, { sync: { kind: "team", wikiId: shared.id, orgId: "firm" } });
      return shared;
    },
    updateSharing: async (id, input) => {
      const shared = remote.get(id);
      if (!shared) throw new ApiError(404, "not_shared", "No shared wiki.");
      const updated = { ...shared, ...input }; remote.set(id, updated); return updated;
    },
    stopSharing: async (id) => { remote.delete(id); await store.update(id, { sync: null }); },
    join: async (input) => {
      const shared = [...remote.values()].find((item) => item.id === input.wikiId);
      if (!shared) throw new ApiError(404, "not_found", "Wiki unavailable.");
      return store.create({ name: shared.name, root: input.root, attach: true, sync: { kind: "team", wikiId: shared.id, orgId: "firm" } });
    },
  });
  const request = async (path: string, method = "GET", body?: unknown, scope: TokenScope = "owner") => {
    const route = matchRoute(routes, method, path);
    if (!route) throw new Error("Route missing");
    const url = new URL(path, "http://localhost"), request = new Request(url, { method, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return route.handler({ request, url, params: route.params, config, approvals: new ApprovalService(config.approval), reloadEvents: new ReloadEventStore(), tokens: new TokenService(config), actor: { type: "remote", scope } });
  };
  return { store, remote, record, request, config, unavailable: () => { unsupported = true; }, revoke: () => { revoked = true; }, failShare: () => { shareFailed = true; } };
}

test("creates an independently shared wiki with its own audience and no project", async () => {
  const { store, request, config, remote } = await fixture();
  const response = await request("/wikis", "POST", { name: "Knowledge", sharing: { access: "members", memberIds: ["colleague"] } });
  expect(response.status).toBe(201);
  const [wiki] = await store.list();
  const shared = remote.get(wiki.id);
  if (!shared) throw new Error("Shared wiki missing");
  expect(wiki.sync).toEqual({ kind: "team", wikiId: shared.id, orgId: "firm" });
  expect(config.workspaces.every((workspace) => workspace.preset === "wiki")).toBe(true);
  expect(remote.get(wiki.id)?.memberIds).toEqual(["colleague"]);
  expect(await (await request("/wikis/team")).json()).toMatchObject({ orgId: "firm", items: [{ name: "Knowledge" }] });
  await request(`/wikis/${wiki.id}/share`, "PATCH", { access: "org", memberIds: [] });
  expect(remote.get(wiki.id)?.access).toBe("org");
  await request(`/wikis/${wiki.id}/share`, "DELETE");
  expect((await store.get(wiki.id)).sync).toBeNull();
  expect(await readFile(join(wiki.root, "Structure.md"), "utf8")).toContain("Wiki structure");
});

test("unsupported platform fails before creating or claiming a shared wiki", async () => {
  const { request, store, unavailable } = await fixture(); unavailable();
  await expect(request("/wikis", "POST", { name: "Knowledge", sharing: { access: "org", memberIds: [] } })).rejects.toMatchObject({ code: "wiki_server_update_required" });
  expect(await store.list()).toEqual([]);
});

test("an incomplete sharing request retains the new local wiki and reports the failure", async () => {
  const { request, store, failShare } = await fixture(); failShare();
  const response = await request("/wikis", "POST", { name: "Knowledge", sharing: { access: "members", memberIds: ["colleague"] } });
  expect(response.status).toBe(201);
  expect(await response.json()).toMatchObject({ sharingError: "Sharing is unavailable. Your wiki is saved locally.", wiki: { name: "Knowledge", sync: null, sharing: null } });
  expect(await store.list()).toHaveLength(1);
});

test("joining names a shared wiki ID and seeds no local starter pages", async () => {
  const { request, remote, record, store } = await fixture();
  const shared = record("Team knowledge"); remote.set("remote", shared);
  const response = await request("/wikis/join", "POST", { wikiId: shared.id });
  expect(response.status).toBe(201);
  const [wiki] = await store.list();
  expect(wiki.name).toBe(shared.name);
  expect(await store.files(wiki.id)).toEqual([]);
  expect(wiki.sync).toEqual({ kind: "team", wikiId: shared.id, orgId: "firm" });
});

test("sharing operations require owner credentials and cannot be bypassed through metadata updates", async () => {
  const { request, store } = await fixture();
  const wiki = await store.create({ name: "Personal" });
  await expect(request(`/wikis/${wiki.id}/share`, "POST", { access: "org", memberIds: [] }, "collaborator")).rejects.toMatchObject({ status: 403 });
  await expect(request("/wikis/team", "GET", undefined, "viewer")).rejects.toMatchObject({ status: 403 });
  await expect(request(`/wikis/${wiki.id}`, "PATCH", { sync: { kind: "team", wikiId: randomUUID(), orgId: "firm" } })).rejects.toMatchObject({ status: 400 });
  expect((await store.get(wiki.id)).sync).toBeNull();
});

test("revoked shared wikis can still be removed from this computer without deleting files", async () => {
  const { request, store, revoke } = await fixture();
  const wiki = await store.create({ name: "Local copy", sync: { kind: "team", wikiId: randomUUID(), orgId: "firm" } });
  revoke();
  await expect(request(`/wikis/${wiki.id}`)).rejects.toMatchObject({ status: 403 });
  expect((await request(`/wikis/${wiki.id}`, "DELETE")).status).toBe(200);
  expect(await readFile(join(wiki.root, "Structure.md"), "utf8")).toContain("Wiki structure");
});

test("stopping sharing retries the owner endpoint when the remote read is already tombstoned", async () => {
  const { request, store, revoke } = await fixture();
  const wiki = await store.create({ name: "Owned wiki", sync: { kind: "team", wikiId: randomUUID(), orgId: "firm" } });
  revoke();
  await expect(request(`/wikis/${wiki.id}`)).rejects.toMatchObject({ status: 403 });
  expect((await request(`/wikis/${wiki.id}/share`, "DELETE")).status).toBe(200);
  expect((await store.get(wiki.id)).sync).toBeNull();
});

test("wiki deletion is recoverable and management is owner-only", async () => {
  const { request, store } = await fixture();
  const wiki = await store.create({ name: "Delete and restore" });
  await expect(request(`/wikis/${wiki.id}/archive`, "POST", {}, "collaborator")).rejects.toMatchObject({ status: 403 });
  await expect(request('/wikis/deleted', "GET", undefined, "viewer")).rejects.toMatchObject({ status: 403 });
  await request(`/wikis/${wiki.id}/archive`, "POST", {});
  expect(await (await request('/wikis/deleted')).json()).toMatchObject({ items: [{ wiki: { id: wiki.id } }] });
  expect(await store.list()).toEqual([]);
  await request(`/wikis/${wiki.id}/restore-wiki`, "POST");
  expect((await store.get(wiki.id)).name).toBe(wiki.name);
});

test("deleting an owned shared wiki stops sharing but restoring does not republish it", async () => {
  const { request, store, remote } = await fixture();
  const result = await (await request('/wikis', "POST", { name: "Shared", sharing: { access: "org", memberIds: [] } })).json();
  const id = result.wiki.id;
  await request(`/wikis/${id}/archive`, "POST", {});
  expect(remote.has(id)).toBe(false);
  await request(`/wikis/${id}/restore-wiki`, "POST");
  expect((await store.get(id)).sync).toBeNull();
});

test("members can remove their copy but cannot delete the shared wiki", async () => {
  const { request, store, remote, record } = await fixture();
  const shared: WikiTeamRecord = { ...record("Member wiki"), role: "member" };
  const wiki = await store.create({ name: shared.name, sync: { kind: "team", wikiId: shared.id, orgId: "firm" } });
  remote.set(wiki.id, shared);
  await expect(request(`/wikis/${wiki.id}/archive`, "POST", {})).rejects.toMatchObject({ status: 403 });
  await request(`/wikis/${wiki.id}/archive`, "POST", { removeOnly: true });
  expect(remote.has(wiki.id)).toBe(true);
  await request(`/wikis/${wiki.id}/restore-wiki`, "POST");
  expect((await store.get(wiki.id)).sync).toEqual(wiki.sync);
});
