import { afterEach, expect, test } from "bun:test";
import type { HostApprovalRequest } from "@legalwork/types/desktop-ipc";
import type { PendingPermission } from "../src/app/types";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { resolveWorkspaceEndpoint } from "../src/app/lib/workspace-endpoint";
import { hostApprovalScope, refreshHostApprovals } from "../src/react-app/shell/host-approval-feed";
import type { RouteWorkspace } from "../src/react-app/shell/route-workspaces";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { permissionKey, replyToPermission } from "../src/react-app/domains/session/sync/interaction-state";
import { createClient } from "../src/app/lib/opencode";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
const cache = getReactQueryClient();
const stops: Array<() => void> = [];
afterEach(() => { stops.splice(0).forEach(stop => stop()); cache.clear(); });
function host(name: string) {
  let failed = false;
  let items: HostApprovalRequest[] = [{ id: name, workspaceId: "same-id", sessionID: "same-chat", action: "sandbox.webfetch", paths: [], summary: name, createdAt: 1, actor: { type: "host" } }];
  const calls: Array<{ path: string; token: string | null; body: unknown }> = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const path = new URL(request.url).pathname, token = request.headers.get("X-LegalWork-Host-Token");
    calls.push({ path, token, body: request.method === "POST" ? await request.json() : null });
    if (token !== name || failed) return new Response(null, { status: 403 });
    if (request.method === "POST") { items = []; return Response.json({ ok: true, allowed: true }); }
    return Response.json({ items });
  } });
  stops.push(() => server.stop(true));
  const workspace: RouteWorkspace = { id: `rem_${name}`, name, displayNameResolved: name, path: "", preset: "starter", workspaceType: "remote", baseUrl: server.url.origin, legalworkToken: "viewer", legalworkHostToken: name, legalworkWorkspaceId: "same-id" };
  return { workspace, calls, expire: () => { items = []; }, fail: () => { failed = true; }, scope: hostApprovalScope(server.url.origin, "same-id") };
}
const pending = (scope: string) => cache.getQueryData<PendingPermission[]>(permissionKey(scope, "same-chat")) ?? [];

test("a local reconciliation removes expired approvals and their waiting state", async () => {
  const fixture = host("local");
  const client = createLegalworkServerClient({ baseUrl: fixture.workspace.baseUrl!, token: "client", hostToken: "local" });
  const workspace: RouteWorkspace = { ...fixture.workspace, id: "same-id", workspaceType: "local" };
  await refreshHostApprovals(client, [workspace], () => true);
  expect(pending(fixture.scope)).toHaveLength(1);
  expect(useSessionActivityStore.getState().getStatus("same-id", "same-chat")).toBe("waiting");
  fixture.expire();
  await refreshHostApprovals(client, [workspace], () => true);
  expect(pending(fixture.scope)).toEqual([]);
  expect(useSessionActivityStore.getState().getStatus("same-id", "same-chat")).toBe("idle");
});

test("remote hosts receive their own credentials and independent approval snapshots", async () => {
  const first = host("first"), second = host("second");
  const local = createLegalworkServerClient({ baseUrl: "http://127.0.0.1:1", token: "local-client", hostToken: "local-secret" });
  await refreshHostApprovals(local, [first.workspace, second.workspace], () => true);
  expect(pending(first.scope).map(item => item.id)).toEqual(["host:first"]);
  expect(pending(second.scope).map(item => item.id)).toEqual(["host:second"]);
  expect(first.calls[0].token).toBe("first"); expect(second.calls[0].token).toBe("second");
  const endpoint = resolveWorkspaceEndpoint(first.workspace, { localClient: local, baseUrl: local.baseUrl, token: local.token })!;
  await replyToPermission(createClient(endpoint.opencodeBaseUrl), pending(first.scope)[0], "once", "", endpoint.client);
  expect(first.calls[1]).toEqual({ path: "/approvals/first", token: "first", body: { reply: "allow", workspaceId: "same-id", sessionID: "same-chat" } });
  second.fail();
  await refreshHostApprovals(local, [first.workspace, second.workspace], () => true);
  expect(pending(first.scope)).toEqual([]);
  expect(pending(second.scope).map(item => item.id)).toEqual(["host:second"]);
});

test("a remote viewer never inherits local approval authority and stale feeds cannot seed state", async () => {
  const remote = host("owner");
  const local = createLegalworkServerClient({ baseUrl: "http://127.0.0.1:1", token: "local-client", hostToken: "local-secret" });
  const viewer = { ...remote.workspace, legalworkHostToken: null };
  expect(resolveWorkspaceEndpoint(viewer, { localClient: local, baseUrl: local.baseUrl, token: local.token })?.client.canApprove).toBe(false);
  await refreshHostApprovals(local, [viewer], () => true);
  expect(remote.calls).toEqual([]);
  await refreshHostApprovals(null, [remote.workspace], () => false);
  expect(pending(remote.scope)).toEqual([]);
});
