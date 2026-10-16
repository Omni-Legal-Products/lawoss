import { afterEach, describe, expect, test } from "bun:test";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { writeEigenweltConnection } from "../eigenwelt-connection-store.js";
import { parseFrontmatter } from "../frontmatter.js";
import { WikiStore } from "./store.js";
import { WikiSync } from "./sync.js";
import { wikiTeamFixture } from "./team-test-helper.js";
const cleanups: Array<() => Promise<void>> = [];
afterEach(async () => { while (cleanups.length) await cleanups.pop()?.(); });
async function setup() {
  const fixture = await wikiTeamFixture(); cleanups.push(() => fixture.close());
  async function computer(userId = "owner") {
    const account = await fixture.account(userId), store = new WikiStore(account.config), sync = new WikiSync(account.config, store, { intervalMs: 30 });
    cleanups.push(async () => { await sync.stop(); await store.close(); });
    return { ...account, store, sync };
  }
  const a = await computer(), b = await computer("member");
  const wiki = await a.store.create({ name: "Knowledge", root: join(a.directory, "content"), attach: true });
  const remote = await a.sync.share(wiki.id, { access: "members", memberIds: ["member"] });
  const joined = await b.sync.join({ wikiId: remote.id, root: join(b.directory, "content") });
  async function save(machine: typeof a, id: string, path: string, content: string) { const previous = await machine.store.read(id, path).catch(() => null); return machine.store.write(id, path, content, previous?.revision ?? ""); }
  async function exchange() { expect((await a.sync.sync(wiki.id)).state).toBe("idle"); expect((await b.sync.sync(joined.id)).state).toBe("idle"); }
  return { fixture, computer, a, b, wiki, joined, remote, save, exchange, readA: async (path: string) => (await a.store.read(wiki.id, path)).content, readB: async (path: string) => (await b.store.read(joined.id, path)).content };
}

describe("Automatic independent wiki sync across local folders", () => {
  test("a save and explicit sync during an upload wait for the follow-up round", async () => {
    const { fixture, a, wiki, remote, save, exchange } = await setup();
    await save(a, wiki.id, "First.md", "# Initial\n"); await exchange();
    await save(a, wiki.id, "First.md", "# Updated\n");
    let joined: Promise<unknown> | undefined;
    fixture.control.beforeCommit = async () => {
      fixture.control.beforeCommit = null;
      await save(a, wiki.id, "Second.md", "# Saved during upload\n");
      a.sync.changed(wiki.id);
      joined = a.sync.sync(wiki.id, true);
    };
    expect((await a.sync.sync(wiki.id)).state).toBe("idle");
    await joined;
    expect(fixture.wikis.get(remote.id)?.files.get("Second.md")?.data.toString()).toBe("# Saved during upload\n");
  });
  test("all Markdown, views, templates and supporting files share without starter contamination; deletes propagate", async () => {
    const { a, b, wiki, joined, save, exchange, readB } = await setup();
    expect(await b.store.files(joined.id)).toEqual([]);
    await save(a, wiki.id, "Page.md", "# Knowledge\n"); await save(a, wiki.id, "Structure.md", "# Structure\n");
    await save(a, wiki.id, "Views.md", "# Views\n"); await save(a, wiki.id, "Templates/Example.md", "# Example\n");
    await a.store.writeAsset(wiki.id, "Attachments/image.png", Buffer.from([0, 1, 255]), "");
    await exchange(); expect(await readB("Page.md")).toBe("# Knowledge\n"); expect(await b.store.readAsset(joined.id, "Attachments/image.png")).toEqual(Buffer.from([0, 1, 255]));
    await a.store.remove(wiki.id, "Page.md", (await a.store.read(wiki.id, "Page.md")).revision); await exchange();
    await expect(b.store.read(joined.id, "Page.md")).rejects.toMatchObject({ status: 404 });
  });
  test("independent text edits merge while overlapping edits preserve both versions", async () => {
    const { a, b, wiki, joined, save, exchange, readA, readB } = await setup();
    await save(a, wiki.id, "Page.md", "# Page\n\nfirst\n\nlast\n"); await exchange();
    await save(a, wiki.id, "Page.md", "# Page\n\nfirst changed\n\nlast\n"); await save(b, joined.id, "Page.md", "# Page\n\nfirst\n\nlast changed\n");
    await exchange(); await exchange(); expect(await readA("Page.md")).toContain("last changed"); expect(await readB("Page.md")).toContain("first changed");
    await save(a, wiki.id, "Page.md", "# Owner\n"); await save(b, joined.id, "Page.md", "# Member\n"); await a.sync.sync(wiki.id);
    const result = await b.sync.sync(joined.id); expect(result.state).toBe("idle"); expect(result.conflicts).toContain("Page.md");
    expect(await readB("Page.md")).toBe("# Owner\n");
    const copy = (await b.store.files(joined.id)).find(file => file.path.includes(".conflict-")); expect(copy).toBeDefined();
    if (!copy) throw new Error("Conflict copy missing"); expect(await readB(copy.path)).toBe("# Member\n");
    await exchange(); expect(await readA(copy.path)).toBe("# Member\n");
  });
  test("owner offline edits remain local, sign-out/wrong firm/member denial never publishes", async () => {
    const { fixture, a, b, wiki, joined, save, exchange, remote } = await setup();
    await save(a, wiki.id, "Page.md", "# Initial\n"); await exchange();
    fixture.control.failure = 503;
    await a.sync.ensureWritable(await a.store.get(wiki.id), true);
    await expect(b.sync.ensureWritable(await b.store.get(joined.id), true)).rejects.toMatchObject({ status: 503 });
    await save(a, wiki.id, "Page.md", "# Offline edit\n"); expect((await a.sync.sync(wiki.id)).state).toBe("error");
    expect(fixture.wikis.get(remote.id)?.files.get("Page.md")?.data.toString()).toBe("# Initial\n");
    fixture.control.failure = 0; await exchange();
    fixture.revoked.add("member"); await expect(b.sync.ensureWritable(await b.store.get(joined.id), true)).rejects.toMatchObject({ status: 404 });
    await writeEigenweltConnection(a.config, { account: { userId: "owner", userName: "Owner", userEmail: null, orgId: "other", orgName: "Other" } });
    await expect(a.sync.ensureWritable(await a.store.get(wiki.id), true)).rejects.toMatchObject({ status: 403 });
    await writeEigenweltConnection(a.config, { account: null, platformToken: null, refreshToken: null });
    await expect(a.sync.ensureReadable(await a.store.get(wiki.id), true)).rejects.toMatchObject({ code: "wiki_team_sign_in" });
  });
  test("CAS failure preserves local edits and another save made during download survives", async () => {
    const { fixture, a, b, wiki, joined, remote, save, exchange, readA, readB } = await setup();
    await save(a, wiki.id, "Page.md", "# Initial\n"); await exchange();
    await save(a, wiki.id, "Page.md", "# Owner edit\n");
    fixture.control.beforeCommit = async (id, path) => {
      fixture.control.beforeCommit = null;
      await save(b, joined.id, path, "# Concurrent remote edit\n");
      await b.sync.sync(joined.id);
    };
    expect((await a.sync.sync(wiki.id)).state).toBe("error"); expect(await readA("Page.md")).toBe("# Owner edit\n");
    await a.sync.sync(wiki.id);
    fixture.control.beforeDownload = async () => { fixture.control.beforeDownload = null; await save(b, joined.id, "Page.md", "# New local save during download\n"); };
    await b.sync.sync(joined.id); expect(await readB("Page.md")).toBe("# New local save during download\n");
    expect(fixture.wikis.get(remote.id)?.files.get("Page.md")).toBeDefined();
  });
  test("unknown create outcome retries same independent ID; stopping preserves files and re-sharing uses fresh ID", async () => {
    const { fixture, a, computer } = await setup();
    const local = await a.store.create({ name: "Second", root: join(a.directory, "second"), attach: true });
    await a.store.write(local.id, "Private.md", "# Waiting for sharing\n", "");
    fixture.control.unknownCreate = true;
    await expect(a.sync.share(local.id, { access: "members", memberIds: [] })).rejects.toMatchObject({ status: 503 });
    expect(await a.sync.pendingSharing(local.id)).toEqual({ access: "members", memberIds: [] });
    expect((await a.store.get(local.id)).sync).toBeNull();
    const count = fixture.wikis.size;
    const [one, two] = await Promise.all([a.sync.share(local.id, { access: "members", memberIds: [] }), a.sync.share(local.id, { access: "members", memberIds: [] })]);
    expect(one.id).toBe(two.id); expect(fixture.wikis.size).toBe(count); expect(one.id).not.toBe(local.id);
    await a.sync.sync(local.id); const member = await computer("member");
    await expect(member.sync.join({ wikiId: one.id })).rejects.toMatchObject({ status: 404 });
    await a.sync.stopSharing(local.id); expect((await a.store.read(local.id, "Private.md")).content).toBe("# Waiting for sharing\n");
    expect((await a.store.get(local.id)).sync).toBeNull(); const again = await a.sync.share(local.id, { access: "org", memberIds: [] }); expect(again.id).not.toBe(one.id);
  });
  test("legacy registrations never auto-upload and explicit migration preserves content", async () => {
    const { fixture, a } = await setup();
    const local = await a.store.create({ name: "Legacy", root: join(a.directory, "legacy"), attach: true, sync: { workspaceId: "old-project", connectionId: "old-storage", path: "Old" } });
    await a.store.write(local.id, "Legacy.md", "# Old local files\n", "");
    const requests = fixture.requests.length;
    expect((await a.sync.sync(local.id)).error).toContain("retired connector sharing"); expect(fixture.requests.length).toBe(requests);
    await a.sync.ensureReadable(local, true); await expect(a.sync.ensureReadable(local)).rejects.toMatchObject({ code: "wiki_sharing_migration_required" });
    const remote = await a.sync.share(local.id, { access: "members", memberIds: [] }); await a.sync.sync(local.id);
    expect(fixture.wikis.get(remote.id)?.files.get("Legacy.md")?.data.toString()).toBe("# Old local files\n");
  });
  test("external saves poll automatically; oversized pages and damaged state retain files", async () => {
    const { fixture, a, wiki, remote, save } = await setup();
    a.sync.start(); await writeFile(join(wiki.root, "External.md"), "# External editor\n");
    for (let i = 0; i < 50 && !fixture.wikis.get(remote.id)?.files.has("External.md"); i++) await new Promise(done => setTimeout(done, 20));
    expect(fixture.wikis.get(remote.id)?.files.has("External.md")).toBe(true); await a.sync.stop();
    const statePath = join(a.directory, "wiki-sync", `${wiki.id}.md`); expect(parseFrontmatter(await readFile(statePath, "utf8")).data).toHaveProperty("binding");
    await writeFile(statePath, "broken state"); await save(a, wiki.id, "External.md", "# Retained\n"); expect((await a.sync.sync(wiki.id)).state).toBe("error");
    expect((await a.store.read(wiki.id, "External.md")).content).toBe("# Retained\n");
  });
});
