import { describe, expect, test } from "bun:test";
import type { WikiTeamOverview, WikiVault } from "@legalwork/types/wiki";
import { createLegalworkServerClient, LegalworkServerError } from "../src/app/lib/legalwork-server";
import { joinedTeamWikiIds, wikiSharingError, wikiSharingInput, wikiSharingValid } from "../src/react-app/domains/wiki/wiki-sharing";
import { t } from "../src/i18n";

const team: WikiTeamOverview = {
  orgId: "firm", userId: "owner", orgName: "Example firm", items: [],
  members: [
    { userId: "owner", name: "Owner", email: null, role: "owner" },
    { userId: "colleague", name: "Colleague", email: null, role: "member" },
  ],
};
const local: WikiVault = {
  id: "local", name: "Knowledge", root: "/wiki", workspaceId: "wiki-workspace",
  allowInProjects: false, sync: null, writable: true, pageCount: 1, totalBytes: 10,
  syncStatus: { state: "local", lastSyncedAt: null, error: null, conflicts: [] },
};

describe("independent wiki sharing", () => {
  test("uses firm membership and preserves selected recipients for retry", () => {
    const requested = { access: "members", memberIds: ["colleague"] } satisfies NonNullable<WikiVault["pendingSharing"]>;
    expect(wikiSharingInput(requested)).toEqual(requested);
    expect(wikiSharingValid(requested, team)).toBe(true);
    expect(wikiSharingValid(requested, undefined)).toBe(false);
    expect(wikiSharingValid({ access: "members", memberIds: [] }, team)).toBe(false);
    expect(wikiSharingValid({ access: "members", memberIds: ["owner", "outside-firm"] }, team)).toBe(false);
    expect(wikiSharingValid({ access: "org", memberIds: [] }, team)).toBe(true);
  });

  test("recognizes existing team copies without confusing legacy storage bindings", () => {
    const teamCopy = { ...local, id: "copy", sync: { kind: "team", wikiId: "shared", orgId: "firm" } } satisfies WikiVault;
    const legacy = { ...local, id: "legacy", sync: { workspaceId: "project", connectionId: "drive", path: "Wikis/shared" } } satisfies WikiVault;
    expect([...joinedTeamWikiIds([local, teamCopy, legacy])]).toEqual(["shared"]);
  });

  test("explains unavailable cloud support and disconnected firm accounts", () => {
    expect(wikiSharingError(new LegalworkServerError(404, "not_found", "Unknown route"))).toBe(t("wiki.sharing_update_required"));
    expect(wikiSharingError(new LegalworkServerError(409, "not_connected", "No account"))).toBe(t("wiki.sharing_sign_in"));
    expect(wikiSharingError(new Error("Network interrupted"))).toBe("Network interrupted");
  });

  test("client sharing is global and retains a locally created wiki after cloud failure", async () => {
    const requests: { method: string; path: string; body: unknown; host: string | null }[] = [];
    const requested = { access: "members", memberIds: ["colleague"] } satisfies NonNullable<WikiVault["pendingSharing"]>;
    const server = Bun.serve({ port: 0, async fetch(request) {
      const url = new URL(request.url);
      requests.push({ method: request.method, path: url.pathname, body: request.method === "GET" || request.method === "DELETE" ? null : await request.json(), host: request.headers.get("x-legalwork-host-token") });
      if (url.pathname === "/wikis/team") return Response.json(team);
      if (url.pathname === "/wikis") return Response.json({ wiki: { ...local, pendingSharing: requested }, sharingError: "Connection lost during sharing" }, { status: 201 });
      return Response.json({ wiki: local });
    } });
    try {
      const client = createLegalworkServerClient({ baseUrl: server.url.origin, token: "client", hostToken: "host" });
      await client.wikiTeam();
      const created = await client.createWiki({ name: "Knowledge", sharing: requested });
      expect(created.wiki.sync).toBeNull();
      expect(created.wiki.pendingSharing).toEqual(requested);
      expect(created.sharingError).toBe("Connection lost during sharing");
      await client.joinWiki({ wikiId: "shared" });
      await client.shareWiki("local", requested);
      await client.updateWikiSharing("local", { access: "org", memberIds: [] });
      await client.stopWikiSharing("local");
      expect(requests.map(({ method, path }) => `${method} ${path}`)).toEqual([
        "GET /wikis/team", "POST /wikis", "POST /wikis/join", "POST /wikis/local/share", "PATCH /wikis/local/share", "DELETE /wikis/local/share",
      ]);
      expect(requests.every((request) => request.host === "host")).toBe(true);
      expect(requests[3].body).toEqual(requested);
      expect(requests[2].body).toEqual({ wikiId: "shared" });
    } finally { server.stop(true); }
  });
});
