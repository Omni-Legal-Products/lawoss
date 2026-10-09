import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyOnboarding, parseOnboardingRequest, planOnboarding } from "../src/onboarding/onboarding.ts";

const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory(prefix: string) { const path = await realpath(await mkdtemp(join(tmpdir(), prefix))); paths.push(path); return path; }
async function options() { return { journalDirectory: await directory("okf-journal-"), externalProfileDirectory: await directory("okf-external-") }; }
const practice = (root: string, extra: Record<string, unknown> = {}) => ({ action: "practice", root, title: "Syntetická prax", jurisdiction: "sk", language: "sk", lawyerName: "Syntetický advokát", clientPattern: "*", scope: "client", ...extra });

test("prax dostane Office a AGENTS.md, klienti ostanú bez zmeny", async () => {
  const root = await directory("okf-practice-");
  await mkdir(join(root, "Alfa s. r. o.", "2024-01 Zmluva"), { recursive: true });
  await writeFile(join(root, "Alfa s. r. o.", "2024-01 Zmluva", "zmluva.docx"), "x");
  const preview = await planOnboarding(parseOnboardingRequest(practice(root)));
  expect(preview).toMatchObject({ action: "practice", mode: "new", target: root });
  if (preview.mode !== "new") throw new Error("Expected create preview.");
  expect(preview.plan.operations.map(operation => operation.path)).toEqual(["Office", "Office/okf.config", "Office/memory", "Office/memory/.keep", "AGENTS.md", "CLAUDE.md"]);
  await applyOnboarding(preview, await options());
  const config = await readFile(join(root, "Office/okf.config"), "utf8");
  expect(config).toContain('client_path: "*"');
  expect(config).toContain("workspace_scope: client");
  const agents = await readFile(join(root, "AGENTS.md"), "utf8");
  expect(agents).toContain("`*`");
  expect(agents).toContain("jedným klientom");
  expect(await readFile(join(root, "CLAUDE.md"), "utf8")).toBe(agents);
  expect(await readdir(join(root, "Alfa s. r. o.", "2024-01 Zmluva"))).toEqual(["zmluva.docx"]);
  expect((await readdir(root)).sort()).toEqual(["AGENTS.md", "Alfa s. r. o.", "CLAUDE.md", "Office"]);
});

test("rozsah celej praxe a české texty", async () => {
  const root = await directory("okf-practice-cz-");
  const preview = await planOnboarding(parseOnboardingRequest(practice(root, { jurisdiction: "cz", language: "cs", clientPattern: "*/*", scope: "practice" })));
  await applyOnboarding(preview, await options());
  expect(await readFile(join(root, "Office/okf.config"), "utf8")).toContain("workspace_scope: practice");
  const agents = await readFile(join(root, "AGENTS.md"), "utf8");
  expect(agents).toContain("`*/*`");
  expect(agents).toContain("celou praxí");
});

test("existujúci AGENTS.md alebo CLAUDE.md v koreni praxe sa neprepíše ani nezdvojí", async () => {
  for (const existing of ["AGENTS.md", "CLAUDE.md"]) {
    const root = await directory("okf-practice-own-");
    await writeFile(join(root, existing), "vlastné pravidlá");
    const preview = await planOnboarding(parseOnboardingRequest(practice(root)));
    if (preview.mode !== "new") throw new Error("Expected create preview.");
    expect(preview.plan.operations.map(operation => operation.path)).not.toContain("AGENTS.md");
    expect(preview.plan.operations.map(operation => operation.path)).not.toContain("CLAUDE.md");
    await applyOnboarding(preview, await options());
    expect(await readFile(join(root, existing), "utf8")).toBe("vlastné pravidlá");
  }
});

test("prax, ktorá už kanceláriu má, sa odmietne", async () => {
  const root = await directory("okf-practice-office-");
  await mkdir(join(root, "Office"));
  await expect(planOnboarding(parseOnboardingRequest(practice(root)))).rejects.toThrow(/kanceláriu/);
});

test("vzor klientov musí byť relatívny a končiť hviezdičkou", () => {
  for (const clientPattern of ["/abs/*", "../*", "Klienti", "a/*/b", "*/*/*/*/*", "C:\\x\\*"]) expect(() => parseOnboardingRequest(practice("/x", { clientPattern }))).toThrow();
  for (const clientPattern of ["*", "*/*", "Klienti/*", "AK/*/*"]) expect(() => parseOnboardingRequest(practice("/x", { clientPattern }))).not.toThrow();
  expect(() => parseOnboardingRequest(practice("/x", { scope: "office" }))).toThrow();
});

test("začať nanovo: kancelária zapíše aj AGENTS.md a CLAUDE.md praxe", async () => {
  const parent = await directory("okf-new-practice-");
  const preview = await planOnboarding(parseOnboardingRequest({ action: "office", parent, title: "Office", jurisdiction: "sk", language: "sk", lawyerName: "M" }));
  await applyOnboarding(preview, await options());
  expect((await readdir(parent)).sort()).toEqual(["AGENTS.md", "CLAUDE.md", "Klienti", "Office"]);
  expect(await readFile(join(parent, "AGENTS.md"), "utf8")).toContain("`Klienti/*`");
});
