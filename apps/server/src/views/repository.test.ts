import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { ViewInput } from "@legalwork/types/views";
import { ViewRepository, workspaceViewFiles } from "./repository.js";

let root: string;
beforeEach(async () => { root = await mkdtemp(join(tmpdir(), "legalwork-views-")); });
afterEach(async () => { await rm(root, { recursive: true, force: true }); });
const input: ViewInput = { version: 1, title: "Client review", mode: "report", catalog: "legalwork-1", program: 'root = Text("Review complete")', queries: {},
  datasets: { clients: { rows: [{ title: "Client", amount: 0, approved: false }], total: 1, revision: "source-1", asOf: 100, truncated: false } } };
const repository = () => new ViewRepository({ kind: "workspace", id: "test-project" }, workspaceViewFiles(root));

describe("saved view records", () => {
  test("new dashboards and reports use their own folders while legacy report paths remain editable", async () => {
    const repo = new ViewRepository({ kind: "wiki", id: "test-wiki" }, workspaceViewFiles(root));
    const dashboard = await repo.create({ ...input, mode: "dashboard", datasets: undefined });
    const report = await repo.create(input);
    expect((await repo.list()).items.find(item => item.id === dashboard.id)?.path).toBe(`Views/${dashboard.id}.view.json`);
    expect((await repo.list()).items.find(item => item.id === report.id)?.path).toBe(`Reports/${report.id}.view.json`);
    await rename(join(root, "Reports", `${report.id}.view.json`), join(root, "Views", `${report.id}.view.json`));
    await repo.update(report.id, { ...input, title: "Legacy report" }, report.revision);
    expect(await repo.location(report.id)).toBe(`Views/${report.id}.view.json`);
    expect((await repo.list()).items.find(item => item.id === report.id)?.path).toBe(`Views/${report.id}.view.json`);
  });
  test("frozen report and identity survive reopen and file rename", async () => {
    const saved = await repository().create(input);
    expect(await repository().read(saved.id)).toEqual(saved);
    await rename(join(root, "Reports", `${saved.id}.view.json`), join(root, "Renamed.view.json"));
    expect((await repository().list()).items[0].path).toBe("Renamed.view.json");
    const next = await repository().update(saved.id, { ...input, title: "Renamed report" }, saved.revision);
    expect(next.id).toBe(saved.id);
    expect(next.datasets).toEqual(input.datasets);
    expect(JSON.parse(await readFile(join(root, "Renamed.view.json"), "utf8")).title).toBe("Renamed report");
  });
  test("stale revision cannot replace a saved report", async () => {
    const repo = repository(), saved = await repo.create(input);
    await repo.update(saved.id, { ...input, title: "First edit" }, saved.revision);
    await expect(repo.update(saved.id, { ...input, title: "Stale edit" }, saved.revision)).rejects.toMatchObject({ status: 409 });
    expect((await repo.read(saved.id)).title).toBe("First edit");
  });
  test("duplicate IDs and sync conflict copies remain visible as conflicts", async () => {
    const repo = repository(), saved = await repo.create(input);
    const unrelated = await repo.create({ ...input, title: "Unrelated report" });
    const bytes = await readFile(join(root, "Reports", `${saved.id}.view.json`));
    await writeFile(join(root, "Reports", `${saved.id}.view.conflict-0123456789ab.json`), bytes);
    await expect(repo.read(saved.id)).rejects.toMatchObject({ code: "view_revision_conflict" });
    expect(await readFile(join(root, "Reports", `${saved.id}.view.json`))).toEqual(bytes);
    expect((await repo.list()).issues[0].code).toBe("view_revision_conflict");
    expect((await repo.read(unrelated.id)).title).toBe("Unrelated report");
  });
  test("external malformed records are validated on read", async () => {
    await writeFile(join(root, "Broken.view.json"), '{"id":"invalid"}');
    expect((await repository().list()).issues[0].code).toBe("view_invalid_record");
  });
  test("project dashboards persist arbitrary source datasets and refresh with a revision-checked update", async () => {
    const repo = repository();
    const saved = await repo.create({ ...input, mode: "dashboard" });
    expect(await repo.location(saved.id)).toBe(`Views/${saved.id}.view.json`);
    expect((await repo.read(saved.id)).datasets).toEqual(input.datasets);
    const datasets = { invoices: { rows: [{ file: "invoice.csv", total: 250 }], total: 1, asOf: 200, revision: "csv-2", truncated: false } };
    const updated = await repo.update(saved.id, { ...input, mode: "dashboard", datasets }, saved.revision);
    expect(updated.datasets).toEqual(datasets);
    expect((await repo.read(saved.id)).revision).not.toBe(saved.revision);
    await expect(repo.update(saved.id, input, saved.revision)).rejects.toMatchObject({ status: 409 });
  });
  test("a workspace report cannot make a live wiki query", async () => {
    await expect(repository().create({ ...input, queries: { data: { fields: ["title"] } } })).rejects.toMatchObject({ code: "workspace_view_requires_datasets" });
  });
  test("symlinked destination cannot write outside the workspace", async () => {
    const elsewhere = await mkdtemp(join(tmpdir(), "legalwork-outside-"));
    try {
      await symlink(elsewhere, join(root, "Reports"));
      await expect(repository().create(input)).rejects.toMatchObject({ status: 403 });
    } finally { await rm(elsewhere, { recursive: true, force: true }); }
  });
  test("simultaneous edits permit only one winner", async () => {
    const saved = await repository().create(input);
    const outcomes = await Promise.allSettled([
      repository().update(saved.id, { ...input, title: "A" }, saved.revision),
      repository().update(saved.id, { ...input, title: "B" }, saved.revision),
    ]);
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1);
    expect(outcomes.filter(item => item.status === "rejected")).toHaveLength(1);
  });
});
