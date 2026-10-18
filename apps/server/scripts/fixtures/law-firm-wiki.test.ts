import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join, posix } from "node:path";
import { tmpdir } from "node:os";
import type { ViewInput, ViewRecord } from "@legalwork/types/views";
import type { ServerConfig } from "../../src/types";
import { WikiStore } from "../../src/wiki/store";
import { queryWikiPages } from "../../src/wiki/data-query";
import { ViewRepository, workspaceViewFiles } from "../../src/views/repository";
import { buildLawFirmDemo, buildDemoViews, demoViewReference, indexLawFirmDemo, seedDemoFiles, seedDemoViews, DEMO_QUERIES } from "./law-firm-wiki";

const roots: string[] = [], stores: WikiStore[] = [];
afterEach(async () => { for (const store of stores.splice(0)) await store.close(); for (const root of roots.splice(0)) await rm(root, { recursive: true, force: true }); });
test("synthetic fixture is deterministic, coherent and has the exact entity counts", () => {
  const fixture = buildLawFirmDemo(), pages = indexLawFirmDemo(fixture.files);
  expect(fixture).toEqual(buildLawFirmDemo());
  expect(fixture.files).toHaveLength(217);
  expect(new Set(pages.map(page => page.properties.id)).size).toBe(217);
  expect(Object.fromEntries(["client", "matter", "process", "template"].map(type => [type, pages.filter(page => page.type === type).length]))).toEqual({ client: 50, matter: 150, process: 12, template: 4 });
  for (const client of pages.filter(page => page.type === "client")) {
    const matters = pages.filter(page => page.properties.client_id === client.properties.id);
    expect(matters).toHaveLength(3);
    expect(matters.reduce((sum, page) => sum + Number(page.properties.fees_eur), 0)).toBe(client.properties.fees_eur);
    expect(matters.reduce((sum, page) => sum + Number(page.properties.budget_eur), 0)).toBe(client.properties.budget_eur);
  }
  const attachments = new Set(fixture.attachments.map(item => item.path));
  for (const page of pages.filter(page => page.type === "template")) {
    expect(typeof page.properties.document).toBe("string");
    expect(attachments.has(posix.join(posix.dirname(page.path), String(page.properties.document)))).toBe(true);
    expect(fixture.files.find(file => file.path === page.path)?.content).toContain(`](${page.properties.document})`);
  }
  expect(pages.every(page => page.properties.synthetic === true)).toBe(true);
});
test("real indexed-field queries have stable totals and full-data aggregates", () => {
  const pages = indexLawFirmDemo(), query = (name: keyof typeof DEMO_QUERIES) => queryWikiPages(pages, DEMO_QUERIES[name]);
  expect(Object.fromEntries(Object.entries(DEMO_QUERIES).filter(([name]) => ["clients", "matters", "open", "overdue", "upcoming", "overBudget", "processes", "templates", "reviewDue"].includes(name)).map(([name, definition]) => [name, queryWikiPages(pages, definition).total]))).toEqual({ clients: 50, matters: 150, open: 110, overdue: 31, upcoming: 47, overBudget: 15, processes: 12, templates: 4, reviewDue: 3 });
  expect(query("money").rows).toEqual([{ budget: 5_775_000, fees: 3_938_750 }]);
  expect(query("stage").rows.map(row => row.clients)).toEqual([10, 10, 10, 10, 10]);
  expect(query("partners").rows.map(row => row.open_matters)).toEqual([22, 22, 22, 22, 22]);
  expect(query("client21Matters").rows.map(row => row.path)).toEqual(["Matters/M061.md", "Matters/M062.md", "Matters/M063.md"]);
  expect(query("client21").rows[0]["properties.fees_eur"]).toBe(73_800);
  expect(query("matters").truncated).toBe(false);
});
test("seed is create-only, views round-trip through real repositories, source links resolve", async () => {
  const root = await mkdtemp(join(tmpdir(), "legalwork-law-firm-demo-")); roots.push(root);
  const contentRoot = join(root, "wiki"), fixture = buildLawFirmDemo();
  const target = {
    read: async (path: string) => readFile(join(contentRoot, path), "utf8").catch(error => { if (error.code === "ENOENT") return null; throw error; }),
    create: async (path: string, content: string) => { await mkdir(dirname(join(contentRoot, path)), { recursive: true }); await writeFile(join(contentRoot, path), content, { flag: "wx" }); },
  };
  expect((await seedDemoFiles(target, fixture.files)).created).toHaveLength(217);
  await writeFile(join(contentRoot, "Clients/C001.md"), (await target.read("Clients/C001.md")) + "\nA preserved human note.\n");
  const second = await seedDemoFiles(target, fixture.files);
  expect(second.created).toHaveLength(0); expect(second.preserved).toEqual(["Clients/C001.md"]); expect(second.unchanged).toHaveLength(216);
  const config: ServerConfig = { host: "127.0.0.1", port: 0, token: "test", hostToken: "test-host", configPath: join(root, "config", "server.json"), approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const store = new WikiStore(config); stores.push(store);
  const wiki = await store.create({ name: "Synthetic law firm test", root: contentRoot, attach: true });
  const views = buildDemoViews(await store.indexedPages(wiki.id), wiki.id);
  const wikiRepo = new ViewRepository({ kind: "wiki", id: wiki.id }, { list: async () => (await store.files(wiki.id)).map(file => file.path), read: path => store.readAsset(wiki.id, path), write: async (path, bytes, revision) => { await store.writeAsset(wiki.id, path, bytes, revision); } });
  const projectOwner = { kind: "workspace", id: "demo-project" } satisfies ViewRecord["owner"];
  await mkdir(join(root, "project"));
  const projectRepo = new ViewRepository(projectOwner, workspaceViewFiles(join(root, "project")));
  const wikiTarget = { owner: { kind: "wiki", id: wiki.id } satisfies ViewRecord["owner"], list: () => wikiRepo.list(), read: (id: string) => wikiRepo.read(id), create: (input: ViewInput) => wikiRepo.create(input) };
  const projectTarget = { owner: projectOwner, list: () => projectRepo.list(), read: (id: string) => projectRepo.read(id), create: (input: ViewInput) => projectRepo.create(input) };
  const savedWiki = await seedDemoViews(wikiTarget, views.filter(view => view.scope === "wiki"));
  const savedProject = await seedDemoViews(projectTarget, views.filter(view => view.scope === "project"));
  expect(savedWiki).toHaveLength(3); expect(savedProject).toHaveLength(1);
  for (const { view, saved } of savedWiki) { expect(await wikiRepo.read(saved.id)).toEqual(saved); await seedDemoFiles(target, [demoViewReference(view, saved)]); }
  const report = savedProject[0].saved;
  expect(report.queries).toEqual({}); expect(report.datasets?.matters.sourceOwner).toEqual({ kind: "wiki", id: wiki.id });
  expect(report.datasets?.matters.sources?.map(source => source.path)).toEqual(["Matters/M061.md", "Matters/M062.md", "Matters/M063.md"]);
  const before = report.datasets;
  await store.write(wiki.id, "Matters/M061.md", (await store.read(wiki.id, "Matters/M061.md")).content.replace("fees_eur: 13950", "fees_eur: 14000"), (await store.read(wiki.id, "Matters/M061.md")).revision);
  expect((await projectRepo.read(report.id)).datasets).toEqual(before);
  const repeated = await seedDemoViews(projectTarget, buildDemoViews(await store.indexedPages(wiki.id), wiki.id).filter(view => view.scope === "project"));
  expect(repeated[0].created).toBe(false); expect(repeated[0].saved).toEqual(report);
  expect((await store.snapshot(wiki.id)).pages.flatMap(page => page.links).filter(link => !link.resolved)).toEqual([]);
});
