import { afterEach, test, expect, spyOn } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import * as fs from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Database } from "bun:sqlite";
import type { ServerConfig } from "../types.js";
import { WikiStore } from "./store.js";
import { ViewRepository } from "../views/repository.js";
import { captureWikiViews } from "./view-snapshots.js";
import type { ViewInput, ViewRecord } from "@legalwork/types/views";
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for (const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "wiki-view-history-"));
  cleanup.push(() => rm(root, { recursive: true, force: true }));
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "test", hostToken: "host", configPath: join(root, "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: 0, tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const store = new WikiStore(config); cleanup.push(() => store.close());
  const wiki = await store.create({ name: "History", template: "blank" });
  const views = new ViewRepository({ kind: "wiki", id: wiki.id }, { list: async () => (await store.files(wiki.id)).map(file => file.path), read: path => store.readAsset(wiki.id, path), write: async (path, bytes, revision) => { await store.writeAsset(wiki.id, path, bytes, revision); } });
  return { root, store, wiki, views, config };
}
test("historical embeds preserve both layout and query data across edits and restart", async () => {
  const { store, wiki, views, config } = await fixture();
  const page = await store.write(wiki.id, "Client.md", "---\ntype: client\namount: 10\n---\n# Client", "");
  const view = await views.create({ version: 1, title: "Totals", mode: "dashboard", catalog: "legalwork-1", program: 'root = Text("Original")', queries: { clients: { pageType: "client", fields: ["title", "amount"] } } });
  const content = `# Dashboard\n\n\`\`\`legalwork-view\n${view.id}\n\`\`\``;
  const document = await store.write(wiki.id, "Dashboard.md", content, "");
  const history = (await store.history(wiki.id, "Dashboard.md"))[0];
  await store.write(wiki.id, "Client.md", "---\ntype: client\namount: 99\n---\n# Client", page.revision);
  // Strip storage fields for the actual update, like the API does.
  const { id, owner, revision, updatedAt, ...input } = view;
  await views.update(id, { ...input, program: 'root = Text("Updated")' }, revision);
  await store.write(wiki.id, "Dashboard.md", `${content}\n\nNew text`, document.revision);
  await store.close();
  const reopened = new WikiStore(config); cleanup.push(() => reopened.close());
  const historic = await reopened.revision(wiki.id, "Dashboard.md", history.id);
  const snapshot = historic.viewSnapshots?.[`legalwork-view://wiki/${wiki.id}/${view.id}`];
  expect(snapshot?.program).toBe('root = Text("Original")');
  expect(snapshot?.datasets?.clients.rows[0].amount).toBe(10);
  expect(snapshot?.queries).toEqual({});
});
test("legacy revisions without a captured snapshot remain unavailable", async () => {
  const { root, store, wiki } = await fixture();
  await store.write(wiki.id, "Legacy.md", "# Legacy", "");
  const revision = (await store.history(wiki.id, "Legacy.md"))[0];
  const db = new Database(join(root, "wiki-state.sqlite"));
  db.query("DELETE FROM wiki_history_views WHERE historyId=?").run(revision.id); db.close();
  expect((await store.revision(wiki.id, "Legacy.md", revision.id)).viewSnapshots).toBeUndefined();
});

test("autosaving an embed reuses indexed pages and reads only externally changed sources", async () => {
  const { store, wiki, views } = await fixture();
  await store.write(wiki.id, "Client.md", "---\ntype: client\namount: 10\n---\n# Client", "");
  const view = await views.create({ version: 1, title: "Totals", mode: "dashboard", catalog: "legalwork-1", program: 'root = Text("Totals")', queries: { clients: { pageType: "client", fields: ["amount"] } } });
  const content = `# Dashboard\n\n\`\`\`legalwork-view\n${view.id}\n\`\`\``;
  const first = await store.write(wiki.id, "Dashboard.md", content, "");
  const reads = spyOn(fs, "open");
  try {
    const second = await store.write(wiki.id, "Dashboard.md", `${content}\nSecond`, first.revision);
    expect(reads.mock.calls.filter(([path]) => path === join(wiki.root, "Client.md"))).toHaveLength(0);
    reads.mockClear();
    await writeFile(join(wiki.root, "Client.md"), "---\ntype: client\namount: 99\n---\n# Client");
    await store.write(wiki.id, "Dashboard.md", `${content}\nThird`, second.revision);
    expect(reads.mock.calls.filter(([path]) => path === join(wiki.root, "Client.md"))).toHaveLength(1);
  } finally { reads.mockRestore(); }
  const revision = (await store.history(wiki.id, "Dashboard.md"))[0];
  const saved = await store.revision(wiki.id, "Dashboard.md", revision.id);
  expect(saved.viewSnapshots?.[`legalwork-view://wiki/${wiki.id}/${view.id}`].datasets?.clients.rows[0].amount).toBe(99);
});

test("a batch import captures every changed source regardless of filename ordering", async () => {
  const { store, wiki, views } = await fixture();
  const view = await views.create({ version: 1, title: "Totals", mode: "dashboard", catalog: "legalwork-1", program: 'root = Text("Totals")', queries: { clients: { pageType: "client", fields: ["amount"] } } });
  const content = `# Dashboard\n\n\`\`\`legalwork-view\n${view.id}\n\`\`\``;
  await writeFile(join(wiki.root, "A-Dashboard.md"), content);
  await writeFile(join(wiki.root, "Z-Client.md"), "---\ntype: client\namount: 17\n---\n# Client");
  const original = (await store.history(wiki.id, "A-Dashboard.md"))[0];
  await writeFile(join(wiki.root, "A-Dashboard.md"), `${content}\nChanged`);
  await writeFile(join(wiki.root, "Z-Client.md"), "---\ntype: client\namount: 98\n---\n# Client");
  const latest = (await store.history(wiki.id, "A-Dashboard.md"))[0];
  const key = `legalwork-view://wiki/${wiki.id}/${view.id}`;
  expect((await store.revision(wiki.id, "A-Dashboard.md", original.id)).viewSnapshots?.[key].datasets?.clients.rows[0].amount).toBe(17);
  expect((await store.revision(wiki.id, "A-Dashboard.md", latest.id)).viewSnapshots?.[key].datasets?.clients.rows[0].amount).toBe(98);
});

test("a query of the edited page captures its new properties and a corrupt payload leaves the page readable", async () => {
  const { root, store, wiki, views } = await fixture();
  const view = await views.create({ version: 1, title: "Self", mode: "dashboard", catalog: "legalwork-1", program: 'root = Text("Self")', queries: { self: { pageType: "client", fields: ["amount"] } } });
  const content = (amount: number) => `---\ntype: client\namount: ${amount}\n---\n# Dashboard\n\n\`\`\`legalwork-view\n${view.id}\n\`\`\``;
  const first = await store.write(wiki.id, "Dashboard.md", content(10), "");
  await store.write(wiki.id, "Dashboard.md", content(20), first.revision);
  const latest = (await store.history(wiki.id, "Dashboard.md"))[0];
  const saved = await store.revision(wiki.id, "Dashboard.md", latest.id);
  expect(saved.viewSnapshots?.[`legalwork-view://wiki/${wiki.id}/${view.id}`].datasets?.self.rows[0].amount).toBe(20);
  const db = new Database(join(root, "wiki-state.sqlite"));
  try { db.query("UPDATE wiki_view_snapshots SET content='broken' WHERE id=(SELECT snapshot FROM wiki_history_view_links WHERE historyId=?)").run(latest.id); }
  finally { db.close(); }
  expect(await store.revision(wiki.id, "Dashboard.md", latest.id)).toMatchObject({ content: content(20), viewSnapshots: {} });
});

test("unchanged snapshots share one payload while each revision keeps its query metadata", async () => {
  const { root, store, wiki, views } = await fixture();
  const client = await store.write(wiki.id, "Client.md", "---\ntype: client\namount: 10\n---\n# Client", "");
  const view = await views.create({ version: 1, title: "Totals", mode: "dashboard", catalog: "legalwork-1", program: 'root = Text("Totals")', queries: { clients: { pageType: "client", fields: ["amount"] } } });
  const content = `# Dashboard\n\n\`\`\`legalwork-view\n${view.id}\n\`\`\``;
  let page = await store.write(wiki.id, "Dashboard.md", content, "");
  for (let index = 1; index <= 4; index++) page = await store.write(wiki.id, "Dashboard.md", `${content}\n${index}`, page.revision);
  const history = await store.history(wiki.id, "Dashboard.md"), key = `legalwork-view://wiki/${wiki.id}/${view.id}`;
  const newest = (await store.revision(wiki.id, "Dashboard.md", history[0].id)).viewSnapshots?.[key].datasets?.clients;
  const oldest = (await store.revision(wiki.id, "Dashboard.md", history[4].id)).viewSnapshots?.[key].datasets?.clients;
  expect(newest?.rows).toEqual(oldest?.rows);
  expect(newest?.sources).toEqual(oldest?.sources);
  expect(newest?.asOf).toBeGreaterThan(oldest?.asOf ?? Infinity);
  expect(newest?.revision).not.toBe(oldest?.revision);
  const db = new Database(join(root, "wiki-state.sqlite"));
  try {
    expect(db.query("SELECT count(*) AS count FROM wiki_view_snapshots").get()).toEqual({ count: 1 });
    await store.write(wiki.id, "Client.md", "---\ntype: client\namount: 20\n---\n# Client", client.revision);
    await store.write(wiki.id, "Dashboard.md", `${content}\n5`, page.revision);
    expect(db.query("SELECT count(*) AS count FROM wiki_view_snapshots").get()).toEqual({ count: 2 });
    expect((await store.revision(wiki.id, "Dashboard.md", history[0].id)).viewSnapshots?.[key].datasets?.clients).toEqual(newest);
  } finally { db.close(); }
});

test("old inline snapshots still load and corrupt embeds do not hide the historical page", async () => {
  const { root, store, wiki } = await fixture();
  await store.write(wiki.id, "Legacy.md", "# Historical page", "");
  const revision = (await store.history(wiki.id, "Legacy.md"))[0];
  const valid = { version: 1, title: "Preserved", mode: "report", catalog: "legalwork-1", program: 'root = Text("Preserved")', queries: {} } satisfies ViewInput;
  const db = new Database(join(root, "wiki-state.sqlite"));
  try {
    db.query("UPDATE wiki_history_views SET content=? WHERE historyId=?").run(JSON.stringify({ good: { ...valid, savedFrom: { sessionId: "local-session" } }, bad: { version: -1 } }), revision.id);
    expect((await store.revision(wiki.id, "Legacy.md", revision.id)).viewSnapshots).toEqual({ good: valid });
    db.query("UPDATE wiki_history_views SET content=? WHERE historyId=?").run("{broken", revision.id);
    expect(await store.revision(wiki.id, "Legacy.md", revision.id)).toMatchObject({ content: "# Historical page", viewSnapshots: {} });
    const current = await store.read(wiki.id, "Legacy.md");
    expect((await store.restore(wiki.id, "Legacy.md", revision.id, current.revision)).content).toBe("# Historical page");
  } finally { db.close(); }
});

test("line counts are recorded once and old revisions are backfilled across restart", async () => {
  const { root, store, wiki, config } = await fixture();
  const original = await store.write(wiki.id, "Counts.md", "first\nsecond\n", "");
  const changed = await store.write(wiki.id, "Counts.md", "first\nthird\nfourth\n", original.revision);
  await store.remove(wiki.id, "Counts.md", changed.revision);
  const db = new Database(join(root, "wiki-state.sqlite"));
  try {
    expect(db.query("SELECT c.added,c.removed FROM wiki_history h JOIN wiki_history_changes c ON c.historyId=h.id WHERE h.path='Counts.md' ORDER BY h.rowid").all())
      .toEqual([{ added: 2, removed: 0 }, { added: 2, removed: 1 }, { added: 0, removed: 3 }]);
    db.query("DELETE FROM wiki_history_changes").run();
  } finally { db.close(); }
  await store.close();
  const reopened = new WikiStore(config); cleanup.push(() => reopened.close());
  const history = await reopened.history(wiki.id, "Counts.md");
  expect(history.map(item => item.changes)).toEqual([{ added: 0, removed: 3 }, { added: 2, removed: 1 }, { added: 2, removed: 0 }]);
  await reopened.restore(wiki.id, "Counts.md", history[2].id, "");
  expect((await reopened.history(wiki.id, "Counts.md"))[0]).toMatchObject({ action: "restore", changes: { added: 2, removed: 0 } });
  const checked = new Database(join(root, "wiki-state.sqlite"));
  try { expect(checked.query("SELECT count(*) AS count FROM wiki_history_changes WHERE historyId IN (SELECT id FROM wiki_history WHERE path='Counts.md')").get()).toEqual({ count: 4 }); }
  finally { checked.close(); }
});

function memoryViews(records: ViewRecord[]) {
  const bytes = new Map(records.map(({ owner, revision, ...input }) => [`${input.id}.view.json`, Buffer.from(JSON.stringify(input))]));
  return { list: async () => [...bytes.keys()], read: async (path: string) => { const value = bytes.get(path); if (!value) throw new Error("Missing"); return value; }, write: async () => { throw new Error("Read only"); } };
}
function report(owner: ViewRecord["owner"], size: number): ViewRecord {
  return { id: randomUUID(), owner, revision: "r", updatedAt: 1, version: 1, title: "Report", mode: "report", catalog: "legalwork-1", program: 'root = Text("Report")', queries: {}, datasets: { data: { rows: [{ value: "x".repeat(size) }], total: 1, revision: "r", asOf: 1, truncated: false } } };
}
test("an embed that exceeds the byte budget does not discard later small embeds", async () => {
  const owner = { kind: "wiki", id: randomUUID() } satisfies ViewRecord["owner"];
  const records = [...Array.from({ length: 5 }, () => report(owner, 1_900_000)), report(owner, 1)];
  const content = records.map(view => `legalwork-view://wiki/${owner.id}/${view.id}`).join("\n");
  const snapshots = await captureWikiViews(content, owner, memoryViews(records), async () => []);
  expect(Object.keys(snapshots)).toHaveLength(5);
  expect(snapshots[`legalwork-view://wiki/${owner.id}/${records[4].id}`]).toBeUndefined();
  expect(snapshots[`legalwork-view://wiki/${owner.id}/${records[5].id}`]?.title).toBe("Report");
});
test("the twenty-embed cap applies to local references without copying foreign data", async () => {
  const owner = { kind: "wiki", id: randomUUID() } satisfies ViewRecord["owner"];
  const foreign = report({ kind: "workspace", id: "private" }, 1);
  const records = Array.from({ length: 21 }, () => report(owner, 1));
  const content = [`legalwork-view://workspace/private/${foreign.id}`, ...records.map(view => `legalwork-view://wiki/${owner.id}/${view.id}`)].join("\n");
  const snapshots = await captureWikiViews(content, owner, memoryViews([...records, foreign]), async () => []);
  expect(Object.keys(snapshots)).toHaveLength(20);
  expect(snapshots[`legalwork-view://workspace/private/${foreign.id}`]).toBeUndefined();
  expect(snapshots[`legalwork-view://wiki/${owner.id}/${records[19].id}`]?.title).toBe("Report");
  expect(snapshots[`legalwork-view://wiki/${owner.id}/${records[20].id}`]).toBeUndefined();
});
