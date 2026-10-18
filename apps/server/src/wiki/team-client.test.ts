import { afterEach, describe, expect, test } from "bun:test";
import type { WikiTeamSyncSettings } from "@legalwork/types/wiki";
import { randomUUID } from "node:crypto";
import { writeEigenweltConnection } from "../eigenwelt-connection-store.js";
import { WikiTeamClient, WIKI_CHUNK_BYTES } from "./team-client.js";
import { wikiTeamFixture } from "./team-test-helper.js";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });
async function setup() {
  const fixture = await wikiTeamFixture(); cleanups.push(() => fixture.close());
  const owner = await fixture.account(), member = await fixture.account("member");
  const client = new WikiTeamClient(owner.config), memberClient = new WikiTeamClient(member.config);
  return { fixture, owner, member, client, memberClient };
}

describe("Independent team wiki client", () => {
  test("account discovery requires explicit capability and creates without a project or connector", async () => {
    const { fixture, client } = await setup();
    fixture.control.capability = false;
    await expect(client.overview()).rejects.toMatchObject({ code: "wiki_server_update_required" });
    expect(fixture.wikis.size).toBe(0);
    fixture.control.capability = true;
    expect(await client.overview()).toMatchObject({ orgId: "firm", userId: "owner", members: [{ userId: "owner" }, { userId: "member" }] });
    const id = randomUUID(), record = await client.create(id, "Knowledge", { access: "members", memberIds: ["member"] }, "firm");
    expect(record).toMatchObject({ id, role: "owner", access: "members" });
    expect(fixture.requests.every(item => !item.path.startsWith("/api/projects") && !item.path.includes("storage-connections"))).toBe(true);
  });
  test("chunk transfers have no account credentials and commit exact file CAS", async () => {
    const { fixture, client } = await setup();
    const id = randomUUID(); await client.create(id, "Knowledge", { access: "org", memberIds: [] }, "firm");
    const binding: WikiTeamSyncSettings = { kind: "team", wikiId: id, orgId: "firm" };
    const bytes = Buffer.alloc(WIKI_CHUNK_BYTES + 5, 7);
    const file = await client.write(binding, "Attachments/scan.bin", bytes, null);
    expect(await client.read(binding, file)).toEqual(bytes);
    expect(fixture.requests.filter(item => item.path.startsWith("/signed/")).every(item => item.authorization === null)).toBe(true);
    await expect(client.write(binding, file.path, Buffer.from("newer"), null)).rejects.toMatchObject({ status: 409 });
    await expect(client.delete(binding, file.path, "old hash")).rejects.toMatchObject({ status: 409 });
    await client.delete(binding, file.path, file.sha256);
    expect(await client.files(binding)).toEqual([]);
    const empty = await client.write(binding, "Empty.md", Buffer.alloc(0), null);
    expect(await client.read(binding, empty)).toEqual(Buffer.alloc(0));
  });
  test("downloaded chunks must match declared size and SHA; malformed paths fail", async () => {
    const { fixture, client } = await setup();
    const id = randomUUID(); await client.create(id, "Knowledge", { access: "org", memberIds: [] }, "firm");
    const binding: WikiTeamSyncSettings = { kind: "team", wikiId: id, orgId: "firm" };
    const file = await client.write(binding, "Page.md", Buffer.from("# Content\n"), null);
    fixture.control.corruptDownload = true;
    await expect(client.read(binding, file)).rejects.toMatchObject({ code: "wiki_object_invalid" });
    fixture.control.malformedFiles = true;
    await expect(client.files(binding)).rejects.toMatchObject({ code: "wiki_team_bad_response" });
  });
  test("members can edit files but only the owner can change sharing or tombstone", async () => {
    const { fixture, client, memberClient } = await setup();
    const id = randomUUID(); await client.create(id, "Knowledge", { access: "members", memberIds: ["member"] }, "firm");
    const binding: WikiTeamSyncSettings = { kind: "team", wikiId: id, orgId: "firm" };
    expect(await memberClient.record(binding)).toMatchObject({ role: "member" });
    await memberClient.write(binding, "Member.md", Buffer.from("# Member knowledge\n"), null);
    await expect(memberClient.update(binding, { access: "org", memberIds: [] })).rejects.toMatchObject({ code: "wiki_team_owner_required" });
    await expect(memberClient.remove(binding)).rejects.toMatchObject({ status: 403 });
    await client.rename(binding, "New name"); expect((await client.overview()).items[0]?.name).toBe("New name");
    fixture.control.unknownDelete = true;
    await expect(client.remove(binding)).rejects.toMatchObject({ status: 503 });
    await client.remove(binding);
    expect(fixture.wikis.get(id)?.deleted).toBe(true);
    await expect(client.create(id, "Retry tombstone", { access: "org", memberIds: [] }, "firm")).rejects.toMatchObject({ status: 409 });
  });
  test("sign-out, different firms and revocation invalidate cached authorization", async () => {
    const { fixture, owner, client, memberClient } = await setup();
    const id = randomUUID(); await client.create(id, "Knowledge", { access: "org", memberIds: [] }, "firm");
    const binding: WikiTeamSyncSettings = { kind: "team", wikiId: id, orgId: "firm" };
    await memberClient.record(binding); fixture.revoked.add("member");
    await expect(memberClient.record(binding)).rejects.toMatchObject({ status: 404 });
    expect(await memberClient.cached(binding)).toBeNull();
    await writeEigenweltConnection(owner.config, { account: { userId: "owner", userName: "Owner", userEmail: null, orgId: "other", orgName: "Other" } });
    await expect(client.record(binding)).rejects.toMatchObject({ code: "wiki_team_wrong_firm" });
    await writeEigenweltConnection(owner.config, { account: null, platformToken: null, refreshToken: null });
    await expect(client.cached(binding)).rejects.toMatchObject({ code: "wiki_team_sign_in" });
  });
  test("OAuth display URL never redirects account credentials and repeated cursors fail", async () => {
    const { fixture, owner, client } = await setup();
    // Trusted platform URL is configuration; stored display metadata is never a request target.
    await writeEigenweltConnection(owner.config, { platformURL: fixture.origin });
    fixture.control.repeatedCursor = true;
    await expect(client.overview()).rejects.toMatchObject({ code: "wiki_team_bad_response" });
    expect(fixture.requests.filter(item => item.path === "/api/wikis").length).toBeGreaterThan(0);
  });
});
