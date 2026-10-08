import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideCardLevel, inspectCardLevel, inspectOnboardingRoot } from "../src/onboarding/classify.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(files: Record<string, string> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "okf-card-level-")));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), content); }
  return root;
}
const card = (type: string) => `---\ntype: ${type}\ntitle: Synthetic\n---\n`;

test("rozhodnutie o úrovni je spoločné pre plytkú aj plnú inšpekciu", () => {
  expect(decideCardLevel([{ path: "client.md", text: card("client") }], false, false)).toEqual({ level: "client" });
  expect(decideCardLevel([{ path: "spis.md", text: card("spis") }], false, false)).toEqual({ level: "matter" });
  expect(decideCardLevel([], true, false)).toEqual({ level: "office" });
  expect(decideCardLevel([], false, false)).toEqual({ level: "unknown" });
  expect(decideCardLevel([{ path: "client.md", text: card("client") }, { path: "klient.md", text: card("client") }], false, false)).toEqual({ level: "conflict", issue: "conflicting_identity" });
  expect(decideCardLevel([{ path: "client.md", text: card("client") }], true, false)).toEqual({ level: "conflict", issue: "conflicting_identity" });
  expect(decideCardLevel([], true, true)).toEqual({ level: "conflict", issue: "conflicting_identity" });
  expect(decideCardLevel([{ path: "client.md", text: card("matter") }], false, false)).toEqual({ level: "conflict", issue: "invalid_card_type" });
  expect(decideCardLevel([{ path: "client.md", text: undefined }], false, false)).toEqual({ level: "conflict", issue: "invalid_card_type" });
});

test("plytká kontrola rozpozná klienta, vec a kanceláriu z kariet v koreni", async () => {
  expect(await inspectCardLevel(await fixture({ "client.md": card("client"), "Zmluvy/a.pdf": "x" }))).toMatchObject({ level: "client", issues: [] });
  expect(await inspectCardLevel(await fixture({ "spis.md": card("spis") }))).toMatchObject({ level: "matter" });
  expect(await inspectCardLevel(await fixture({ "Office/okf.config": "version: 1\n", "Klienti/A/client.md": card("client") }))).toMatchObject({ level: "office" });
  const practice = await fixture({ "Office/okf.config": "version: 1\n" });
  expect(await inspectCardLevel(join(practice, "Office"))).toMatchObject({ level: "office" });
  expect(await inspectCardLevel(await fixture({ "notes.md": "x" }))).toMatchObject({ level: "unknown" });
});

test("klient so symlinkom: plná inšpekcia je neúplná, plytká kontrola ho uzná", async () => {
  const root = await fixture({ "client.md": card("client"), "Podklady/a.pdf": "x" });
  await symlink(join(root, "Podklady"), join(root, "odkaz"));
  expect((await inspectOnboardingRoot(root)).complete).toBe(false);
  expect(await inspectCardLevel(root)).toMatchObject({ level: "client", issues: [] });
});

test("konflikty a neplatná cesta", async () => {
  expect(await inspectCardLevel(await fixture({ "client.md": card("client"), "klient.md": card("client") }))).toMatchObject({ level: "conflict", issues: [{ path: "", code: "conflicting_identity" }] });
  expect(await inspectCardLevel(await fixture({ "client.md": card("client"), "Office/okf.config": "version: 1\n" }))).toMatchObject({ level: "conflict" });
  expect(await inspectCardLevel(await fixture({ "Office/okf.config": "version: 1\n", "_kancelaria/okf.config": "version: 1\n" }))).toMatchObject({ level: "conflict" });
  expect(await inspectCardLevel("relative/path")).toMatchObject({ level: "unknown", issues: [{ path: "", code: "canonical_directory_required" }] });
});

test("príliš veľká karta sa nečíta a je neplatná", async () => {
  const root = await fixture({ "client.md": `${card("client")}${"x".repeat(70 * 1024)}` });
  expect(await inspectCardLevel(root)).toMatchObject({ level: "conflict", issues: [{ path: "", code: "invalid_card_type" }] });
});
