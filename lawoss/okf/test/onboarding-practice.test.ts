import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { applyOnboarding, parseOnboardingRequest, planOnboarding } from "../src/onboarding/onboarding.ts";
import { suggestOnboardingLevel } from "../src/onboarding/suggest.ts";
import { inspectCardLevel } from "../src/onboarding/classify.ts";
import { INSIDE_OFFICE_MESSAGE_PREFIX, OFFICE_EXISTS_MESSAGE } from "../src/onboarding/messages.ts";

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
  await expect(planOnboarding(parseOnboardingRequest(practice(root)))).rejects.toThrow(OFFICE_EXISTS_MESSAGE);
});

/** Tvar dátovej sady v1 (`02_OKF_kancelaria`, pieskovisko 4-usporiadana-kancelaria): Office bez okf.config. */
async function legacyOffice(memory = true): Promise<string> {
  const root = await directory("okf-practice-legacy-");
  await mkdir(join(root, "Office", ...(memory ? ["memory"] : [])), { recursive: true });
  await writeFile(join(root, "Office", "AGENTS.md"), "# Kancelária\n");
  await writeFile(join(root, "Office", "CLAUDE.md"), "# Kancelária\n");
  if (memory) await writeFile(join(root, "Office", "memory", "RULE-SYN-01.md"), "pravidlo\n");
  for (const client of ["C001-syn-alfa-s-r-o", "C002-syn-beta-a-s"]) {
    await mkdir(join(root, "Klienti", client, "Spisy", "M001-spor"), { recursive: true });
    await writeFile(join(root, "Klienti", client, "client.md"), `---\ntype: klient\ntitle: "${client}"\nclient_type: po\n---\n`);
    await writeFile(join(root, "Klienti", client, "Spisy", "M001-spor", "matter.md"), "---\ntype: spis\ntitle: Spor\n---\n");
  }
  return root;
}
const snapshot = async (root: string, paths: string[]) => Object.fromEntries(await Promise.all(paths.map(async path => [path, await readFile(join(root, path), "utf8")])));

test("kancelária bez okf.config sa doplní: len okf.config a pokyny praxe, existujúce súbory ostanú (N-14)", async () => {
  const root = await legacyOffice();
  const kept = ["Office/AGENTS.md", "Office/CLAUDE.md", "Office/memory/RULE-SYN-01.md", "Klienti/C001-syn-alfa-s-r-o/client.md"];
  const before = await snapshot(root, kept);
  expect(await inspectCardLevel(root)).toMatchObject({ level: "unknown" });
  const preview = await planOnboarding(parseOnboardingRequest(practice(root, { clientPattern: "Klienti/*" })));
  if (preview.mode !== "new") throw new Error("Expected create preview.");
  expect(preview.plan.operations.map(operation => operation.path)).toEqual(["Office/okf.config", "AGENTS.md", "CLAUDE.md"]);
  await applyOnboarding(preview, await options());
  expect(await snapshot(root, kept)).toEqual(before);
  expect(await readFile(join(root, "Office/okf.config"), "utf8")).toContain('client_path: "Klienti/*"');
  // Po doplnení je priečinok autoritatívne kanceláriou (profil `officeRoot` ho prijme).
  expect(await inspectCardLevel(root)).toMatchObject({ level: "office" });
  expect(await suggestOnboardingLevel(root)).toMatchObject({ level: "practice", marked: true, signals: ["office_config"] });
  // Hotoví klienti OKF sa len doplnia, nič sa neprepíše.
  for (const client of ["C001-syn-alfa-s-r-o", "C002-syn-beta-a-s"]) {
    const clientRoot = join(root, "Klienti", client);
    const card = await readFile(join(clientRoot, "client.md"), "utf8");
    const convert = await planOnboarding(parseOnboardingRequest({ action: "existing", root: clientRoot, mode: "convert", title: client, clientType: "po", language: "sk", jurisdiction: "sk", date: "2026-10-22", confirmUnknownClient: true }));
    await applyOnboarding(convert, await options());
    expect(await readFile(join(clientRoot, "client.md"), "utf8")).toBe(card);
  }
});

test("kancelária bez okf.config a bez memory dostane aj memory; holý Office alebo Office bez kariet klientov sa odmietne", async () => {
  const root = await legacyOffice(false);
  const preview = await planOnboarding(parseOnboardingRequest(practice(root, { clientPattern: "Klienti/*" })));
  if (preview.mode !== "new") throw new Error("Expected create preview.");
  expect(preview.plan.operations.map(operation => operation.path)).toEqual(["Office/okf.config", "Office/memory", "Office/memory/.keep", "AGENTS.md", "CLAUDE.md"]);
  const noCards = await directory("okf-practice-legacy-nocards-");
  await mkdir(join(noCards, "Office"), { recursive: true });
  await writeFile(join(noCards, "Office", "AGENTS.md"), "x");
  await mkdir(join(noCards, "Klienti", "A"), { recursive: true });
  await expect(planOnboarding(parseOnboardingRequest(practice(noCards, { clientPattern: "Klienti/*" })))).rejects.toThrow(OFFICE_EXISTS_MESSAGE);
  expect(await readdir(join(noCards, "Office"))).toEqual(["AGENTS.md"]);
});

test("priečinok vnútri existujúcej kancelárie sa ako prax odmietne a nič sa nezapíše", async () => {
  for (const office of ["Office", "_kancelaria"]) {
    const root = await directory("okf-practice-nested-");
    await mkdir(join(root, office));
    await writeFile(join(root, office, "okf.config"), 'version: 1\nclient_path: "Klienti/*"\n');
    const clients = join(root, "Klienti");
    for (const name of ["Alfa s. r. o.", "Beta a. s.", "Gama s.r.o.", "Delta k. s.", "Epsilon v. o. s."]) await mkdir(join(clients, name, "2024-01 Zmluva"), { recursive: true });
    for (const target of [clients, join(clients, "Alfa s. r. o.")]) {
      await expect(planOnboarding(parseOnboardingRequest(practice(target)))).rejects.toThrow(INSIDE_OFFICE_MESSAGE_PREFIX);
      expect((await suggestOnboardingLevel(target)).level).not.toBe("practice");
    }
    expect((await readdir(clients)).sort()).toEqual(["Alfa s. r. o.", "Beta a. s.", "Delta k. s.", "Epsilon v. o. s.", "Gama s.r.o."]);
  }
});

test("priečinok Office bez okf.config v predkovi kanceláriou nie je", async () => {
  const root = await directory("okf-practice-not-office-");
  await mkdir(join(root, "Office"));
  const practiceRoot = join(root, "Prax");
  await mkdir(practiceRoot);
  await expect(planOnboarding(parseOnboardingRequest(practice(practiceRoot)))).resolves.toBeDefined();
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
