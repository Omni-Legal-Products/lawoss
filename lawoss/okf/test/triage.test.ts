import { createHash } from "node:crypto";
import { appendFile, copyFile, link, mkdir, mkdtemp, readFile, readdir, realpath, rename, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";
import { inspectOnboardingRoot } from "../src/onboarding/classify.ts";
import { applyOnboarding, parseOnboardingRequest, planOnboarding } from "../src/onboarding/onboarding.ts";
import { runTriage } from "../src/triage/cli.ts";
import {
  applyTriagePlan, buildTriagePlan, ClassificationError, classifyByRules, CLASSIFICATION_SCHEMA, findCaseNumber, listTriageRuns,
  parseClassification, parseTriagePlan, prepareTriage, scanTriage, TrialCloneError, undoTriage, verifyTrialClone, type TriagePlan,
} from "../src/triage/index.ts";
import { TRIAGE_FIXTURE, writeTriageFixture } from "./fixtures/triage-client.ts";

const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory(prefix: string): Promise<string> { const path = await realpath(await mkdtemp(join(tmpdir(), prefix))); paths.push(path); return path; }

type Clone = { source: string; root: string; journal: string; parent: string };
/** Skutočný skúšobný klon cez onboarding, rovnako ako ho vytvára appka. */
async function trialClone(files: Readonly<Record<string, string>> = TRIAGE_FIXTURE, language: "sk" | "cs" | "en" = "sk"): Promise<Clone> {
  const base = await directory("okf-triage-");
  const source = join(base, "Vymysleny klient"), parent = join(base, "klony"), journal = join(base, "journal"), external = join(base, "external");
  for (const dir of [source, parent, journal, external]) await mkdir(dir);
  await writeTriageFixture(source, files);
  const preview = await planOnboarding(parseOnboardingRequest({ action: "existing", root: source, mode: "trial_clone", cloneParent: parent, title: "Vymyslený klient", clientType: "po", language, jurisdiction: language === "cs" ? "cz" : "sk", date: "2026-10-05", confirmUnknownClient: true }));
  const result = await applyOnboarding(preview, { journalDirectory: journal, externalProfileDirectory: external });
  return { source, root: result.root, journal, parent };
}
/** Strom klona bez záznamov roztriedenia: po vrátení musí byť presne pôvodný. */
async function treeHash(root: string): Promise<string> {
  const inspection = await inspectOnboardingRoot(root);
  if (!inspection.complete) throw new Error(`incomplete ${JSON.stringify(inspection.issues)}`);
  return createHash("sha256").update(JSON.stringify(inspection.entries.filter(entry => entry.path !== ".lawoss" && !entry.path.startsWith(".lawoss/")))).digest("hex");
}
const NOW = new Date("2026-10-05T10:00:00Z");
async function rulesPlan(clone: Clone, keepInInbox: string[] = []) {
  return prepareTriage(clone.root, { trialJournalDirectory: clone.journal, keepInInbox, now: NOW });
}
const move = (plan: TriagePlan, from: string) => plan.moves.find(item => item.from === from);

describe("pravidlá", () => {
  test("prípona, kľúčové slová SK/CZ, koncepty a pôvodné priečinky", () => {
    const rule = (path: string) => { const name = path.split("/").pop()!; const dot = name.lastIndexOf("."); return classifyByRules({ path, name, ext: dot > 0 ? name.slice(dot + 1) : "" }); };
    expect(rule("x.eml")).toMatchObject({ role: "correspondence", rule: "email_file", confidence: "high" });
    expect(rule("Re_ponuka.MSG")).toMatchObject({ role: "correspondence" });
    expect(rule("Smlouva o dílo.pdf")).toMatchObject({ role: "client_documents", rule: "contract" });
    expect(rule("Plná moc.pdf")).toMatchObject({ role: "client_documents", rule: "power_of_attorney" });
    expect(rule("Usnesení soudu.pdf")).toMatchObject({ role: "important_mail", rule: "court_decision" });
    expect(rule("Žaloba.pdf")).toMatchObject({ role: "outputs", rule: "filing_final" });
    expect(rule("Žaloba.docx")).toMatchObject({ role: "drafts", rule: "filing_draft" });
    expect(rule("Zmluva_v3.docx")).toMatchObject({ role: "drafts", rule: "draft_marker", confidence: "high" });
    expect(rule("Návrh zmluvy.docx")).toMatchObject({ role: "drafts", rule: "draft_marker" });
    expect(rule("Faktúra 12.pdf")).toMatchObject({ role: "client_documents", rule: "invoice" });
    expect(rule("Pošta/odpoveď.pdf")).toMatchObject({ role: "correspondence", rule: "folder_hint" });
    expect(rule("prevod.pdf")).toMatchObject({ role: null, rule: "unknown" });
    expect(rule("IMG_1.jpg")).toMatchObject({ role: null, confidence: "low" });
  });
  test("spisová značka z názvu súboru aj priečinka", () => {
    expect(findCaseNumber("Rozsudok 8C_123_2023")).toEqual({ key: "8C-123-2023", display: "8C 123/2023" });
    expect(findCaseNumber("43 INS 8294-2021")?.display).toBe("43INS 8294/2021");
    expect(findCaseNumber("15 C 77/2024")?.key).toBe("15C-77-2024");
    expect(findCaseNumber("zmluva_2023_05_12")).toBeUndefined();
    expect(findCaseNumber("Faktura 12 Jan 2023")).toBeUndefined();
  });
});

describe("skúšobný klon", () => {
  test("odmietne originál, priečinok bez značky aj značku skopírovanú do originálu", async () => {
    const clone = await trialClone();
    await expect(scanTriage(clone.source)).rejects.toBeInstanceOf(TrialCloneError);
    await expect(verifyTrialClone(clone.source, clone.journal)).rejects.toBeInstanceOf(TrialCloneError);
    await copyFile(join(clone.root, ".lawoss-trial.json"), join(clone.source, ".lawoss-trial.json"));
    // Značka sama ukazuje na zdroj = sám seba; s journalom appky sa odmietne v každom prípade.
    await expect(verifyTrialClone(clone.source, clone.journal)).rejects.toBeInstanceOf(TrialCloneError);
    const copy = join(clone.parent, "kopia");
    await mkdir(copy);
    await copyFile(join(clone.root, ".lawoss-trial.json"), join(copy, ".lawoss-trial.json"));
    await expect(verifyTrialClone(copy, clone.journal)).rejects.toThrow("nezodpovedá");
    expect((await verifyTrialClone(clone.root, clone.journal)).journalVerified).toBe(true);
    await expect(prepareTriage(clone.source)).rejects.toBeInstanceOf(TrialCloneError);
  });
  test("apply aj undo odmietnu plán nasmerovaný na originál", async () => {
    const clone = await trialClone();
    const { plan } = await rulesPlan(clone);
    const forged = { ...plan, root: clone.source };
    await expect(applyTriagePlan(forged)).rejects.toThrow();
    await expect(undoTriage(clone.source, plan.runId)).rejects.toBeInstanceOf(TrialCloneError);
  });
});

describe("plán a zápis", () => {
  test("pravidlá, nová vec zo spisovej značky, konflikt mien, zápis a presné vrátenie", async () => {
    const clone = await trialClone();
    const original = await treeHash(clone.root);
    const sourceBefore = await treeHash(clone.source);
    const { inventory, plan } = await rulesPlan(clone);
    expect(inventory.documents.length).toBe(35);
    expect(move(plan, "odpoved_klienta_2024-03-02.eml")?.to).toBe("05_Komunikacia/odpoved_klienta_2024-03-02.eml");
    expect(move(plan, "IMG_2041.jpg")?.to).toBe("00_Na_zatriedenie/IMG_2041.jpg");
    expect(move(plan, "Zmluva_o_dielo_v2.docx")?.to).toBe("03_Drafty/Zmluva_o_dielo_v2.docx");
    expect(plan.matters).toHaveLength(1);
    expect(plan.matters[0]).toMatchObject({ folder: "Spisy/2026-10 Konanie 8C 123-2023", caseNumber: "8C 123/2023", source: "rules", dateSource: "today", documents: 2 });
    expect(move(plan, "Rozsudok 8C_123_2023.pdf")?.to).toBe("Spisy/2026-10 Konanie 8C 123-2023/05_Komunikacia/Dolezita_posta/Rozsudok 8C_123_2023.pdf");
    const attachments = plan.moves.filter(item => item.from.endsWith("/priloha.pdf") && item.to.startsWith("05_Komunikacia/"));
    expect(attachments.map(item => item.to).sort()).toEqual(["05_Komunikacia/priloha (2).pdf", "05_Komunikacia/priloha.pdf"]);
    expect(attachments.some(item => item.renamed)).toBe(true);

    const result = await applyTriagePlan(plan, { trialJournalDirectory: clone.journal });
    expect(result).toMatchObject({ status: "applied", moved: 35 });
    expect(await readFile(join(clone.root, "05_Komunikacia/priloha (2).pdf"), "utf8")).toContain("synthetic attachment");
    const card = await readFile(join(clone.root, "Spisy/2026-10 Konanie 8C 123-2023/matter.md"), "utf8");
    expect(card).toContain('spisova_znacka: "8C 123/2023"');
    expect(card).toContain("kind: contentious");
    expect(card).toContain('klient: "Vymyslený klient"');
    // Originál ostal nedotknutý.
    expect(await treeHash(clone.source)).toBe(sourceBefore);
    expect((await applyTriagePlan(plan, { trialJournalDirectory: clone.journal })).status).toBe("already_applied");
    expect((await listTriageRuns(clone.root))[0]).toMatchObject({ runId: plan.runId, state: "applied" });

    expect(await undoTriage(clone.root, plan.runId, { trialJournalDirectory: clone.journal })).toMatchObject({ status: "undone", restored: 35 });
    expect(await treeHash(clone.root)).toBe(original);
    expect((await undoTriage(clone.root, plan.runId)).status).toBe("already_undone");
    await expect(applyTriagePlan(plan)).rejects.toThrow("vrátený");
  });

  test("ponechať na zatriedenie mení plán aj odtlačok", async () => {
    const clone = await trialClone();
    const { inventory, plan } = await rulesPlan(clone);
    const id = move(plan, "Plnomocenstvo.pdf")!.id;
    const kept = buildTriagePlan(inventory, { keepInInbox: [id], today: "2026-10-05", runId: plan.runId, createdAt: plan.createdAt });
    expect(move(kept, "Plnomocenstvo.pdf")).toMatchObject({ to: "00_Na_zatriedenie/Plnomocenstvo.pdf", source: "user" });
    expect(kept.fingerprint).not.toBe(plan.fingerprint);
  });

  test("už zaradené dokumenty ostanú, priečinok na zatriedenie sa triedi", async () => {
    const clone = await trialClone({ "01_Podklady/zmluva.pdf": "a", "00_Na_zatriedenie/Faktura 9.pdf": "b", "00_Na_zatriedenie/IMG.jpg": "e", "memory/x.md": "c", "Stary/klient.md": "d" });
    const { inventory, plan } = await rulesPlan(clone);
    expect(inventory.documents.map(item => item.path)).toEqual(["00_Na_zatriedenie/Faktura 9.pdf", "00_Na_zatriedenie/IMG.jpg"]);
    expect(plan.stays).toEqual([expect.objectContaining({ path: "00_Na_zatriedenie/IMG.jpg", why: "unclear" })]);
    expect(inventory.skipped).toEqual(expect.arrayContaining([{ path: "01_Podklady/zmluva.pdf", reason: "already_sorted" }, { path: "memory/x.md", reason: "memory" }, { path: "Stary/klient.md", reason: "system_name" }]));
    expect(move(plan, "00_Na_zatriedenie/Faktura 9.pdf")?.to).toBe("01_Podklady/Faktura 9.pdf");
  });

  test("existujúci súbor v cieli sa nikdy neprepíše", async () => {
    const clone = await trialClone({ "Plnomocenstvo.pdf": "new", "01_Podklady/Plnomocenstvo.pdf": "old" });
    const { plan } = await rulesPlan(clone);
    expect(move(plan, "Plnomocenstvo.pdf")?.to).toBe("01_Podklady/Plnomocenstvo (2).pdf");
    await applyTriagePlan(plan);
    expect(await readFile(join(clone.root, "01_Podklady/Plnomocenstvo.pdf"), "utf8")).toBe("old");
    expect(await readFile(join(clone.root, "01_Podklady/Plnomocenstvo (2).pdf"), "utf8")).toBe("new");
  });

  test("zmena klona po náhľade zastaví zápis bez jediného presunu", async () => {
    const clone = await trialClone();
    const { plan } = await rulesPlan(clone);
    const before = await treeHash(clone.root);
    await writeFile(join(clone.root, "Plnomocenstvo.pdf"), "zmenené");
    const changed = await treeHash(clone.root);
    await expect(applyTriagePlan(plan)).rejects.toThrow("zmenil");
    expect(await treeHash(clone.root)).toBe(changed);
    expect(changed).not.toBe(before);
  });
});

describe("bezpečnosť plánu", () => {
  test("path traversal, absolútna cesta, skrytý cieľ a zmenený plán sa odmietnu", async () => {
    const clone = await trialClone();
    const { plan } = await rulesPlan(clone);
    const tamper = (change: (copy: TriagePlan) => void) => { const copy = structuredClone(plan); change(copy); return copy; };
    expect(() => parseTriagePlan(tamper(copy => { copy.moves[0]!.to = "../uniknuty.pdf"; }))).toThrow("bezpečná");
    expect(() => parseTriagePlan(tamper(copy => { copy.moves[0]!.to = "/tmp/x.pdf"; }))).toThrow("bezpečná");
    expect(() => parseTriagePlan(tamper(copy => { copy.moves[0]!.to = ".lawoss/x.pdf"; }))).toThrow("bezpečná");
    expect(() => parseTriagePlan(tamper(copy => { copy.moves[0]!.to = "01_Podklady/x.pdf"; }))).toThrow("odtlačok");
    expect(() => parseTriagePlan(tamper(copy => { copy.create.push({ path: "../x", kind: "directory" }); }))).toThrow();
    expect(() => parseTriagePlan({ ...plan, schema: "x" })).toThrow();
  });

  test("symbolický odkaz v klone zastaví inventár; odkaz na mieste cieľového priečinka zastaví zápis", async () => {
    const clone = await trialClone();
    const outside = await directory("okf-triage-outside-");
    await symlink(outside, join(clone.root, "von"));
    await expect(scanTriage(clone.root, { trialJournalDirectory: clone.journal })).rejects.toThrow("symbolický odkaz");
    await rm(join(clone.root, "von"));
    const { plan } = await rulesPlan(clone);
    // Útočník po náhľade nahradí cieľový priečinok odkazom von z klona.
    await rename(join(clone.root, "05_Komunikacia"), join(outside, "presunute"));
    await symlink(outside, join(clone.root, "05_Komunikacia"));
    await expect(applyTriagePlan(plan)).rejects.toThrow();
    expect(await readdir(outside)).toEqual(["presunute"]);
  });
});

describe("prerušenie a obnova", () => {
  test("prerušený zápis sa dokončí tým istým plánom a potom sa presne vráti", async () => {
    const clone = await trialClone();
    const original = await treeHash(clone.root);
    const { plan } = await rulesPlan(clone);
    // Simulácia pádu: plán zapísaný, prvé operácie hotové, prvý presun spravil odkaz, ale nestihol odstrániť zdroj.
    const runDir = join(clone.root, ".lawoss/triage/runs", plan.runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "plan.json"), JSON.stringify(plan));
    const events = join(runDir, "events.jsonl");
    for (const operation of plan.create.slice(0, 3)) {
      if (operation.kind === "directory") await mkdir(join(clone.root, operation.path)); else await writeFile(join(clone.root, operation.path), operation.content ?? "");
      await appendFile(events, `${JSON.stringify({ t: "intent", path: operation.path })}\n${JSON.stringify({ t: "created", path: operation.path })}\n`);
    }
    const first = plan.moves.find(item => !item.matter)!;
    await link(join(clone.root, first.from), join(clone.root, first.to));
    await appendFile(events, `${JSON.stringify({ t: "move_intent", id: first.id })}\n{"t":"mov`);
    expect((await listTriageRuns(clone.root))[0]?.state).toBe("interrupted");
    expect((await applyTriagePlan(plan)).status).toBe("applied");
    expect(await readFile(join(clone.root, first.to), "utf8")).toBe(TRIAGE_FIXTURE[first.from]!);
    await expect(readFile(join(clone.root, first.from))).rejects.toThrow();
    // Pád počas vracania: jeden dokument už späť ako odkaz, cieľ ešte neodstránený.
    const second = plan.moves[1]!;
    await link(join(clone.root, second.to), join(clone.root, second.from));
    await appendFile(events, `${JSON.stringify({ t: "undo_started" })}\n${JSON.stringify({ t: "restore_intent", id: second.id })}\n`);
    expect((await undoTriage(clone.root, plan.runId)).status).toBe("undone");
    expect(await treeHash(clone.root)).toBe(original);
  });

  test("prerušený zápis sa dá aj rovno vrátiť", async () => {
    const clone = await trialClone();
    const original = await treeHash(clone.root);
    const { plan } = await rulesPlan(clone);
    const runDir = join(clone.root, ".lawoss/triage/runs", plan.runId);
    await mkdir(runDir, { recursive: true });
    await writeFile(join(runDir, "plan.json"), JSON.stringify(plan));
    const first = plan.create[0]!;
    await mkdir(join(clone.root, first.path));
    await appendFile(join(runDir, "events.jsonl"), `${JSON.stringify({ t: "intent", path: first.path })}\n`);
    expect((await undoTriage(clone.root, plan.runId)).status).toBe("undone");
    expect(await treeHash(clone.root)).toBe(original);
  });

  test("vrátenie odmietne zmenený dokument alebo cudzí súbor v novej veci a nič nezmení", async () => {
    const clone = await trialClone();
    const { plan } = await rulesPlan(clone);
    await applyTriagePlan(plan);
    const target = move(plan, "Plnomocenstvo.pdf")!.to;
    await writeFile(join(clone.root, target), "upravené advokátom");
    const changed = await treeHash(clone.root);
    await expect(undoTriage(clone.root, plan.runId)).rejects.toThrow(target);
    expect(await treeHash(clone.root)).toBe(changed);
    await writeFile(join(clone.root, target), TRIAGE_FIXTURE["Plnomocenstvo.pdf"]!);
    await writeFile(join(clone.root, plan.matters[0]!.folder, "nova-poznamka.md"), "cudzí súbor");
    await expect(undoTriage(clone.root, plan.runId)).rejects.toThrow("nova-poznamka.md");
  });
});

describe("klasifikácia modelom", () => {
  async function prepared() {
    const clone = await trialClone();
    const { inventory } = await rulesPlan(clone);
    const id = (path: string) => inventory.documents.find(item => item.path === path)!.id;
    return { clone, inventory, id };
  }
  test("platná klasifikácia zakladá vec, spresní rolu a nejasné pošle na zatriedenie", async () => {
    const { clone, inventory, id } = await prepared();
    const classification = parseClassification({
      schema: CLASSIFICATION_SCHEMA, treeDigest: inventory.treeDigest,
      matters: [{ key: "najom", title: "Spor o nájomné s Fiktívna s. r. o", date: "2024-02-01", kind: "contentious", area: "Nájom", caseNumber: "12C 45/2024", counterparty: "Fiktívna s. r. o.", court: "Okresný súd Vymyslené Mesto" }],
      documents: [
        { id: id("scan0001.pdf"), role: "client_documents", matter: "najom", confidence: "high", reason: "Nájomná zmluva, podpísaná kópia.", truncated: true },
        { id: id("IMG_2041.jpg"), role: "client_documents", confidence: "low", reason: "Fotografia, nie je jasné čoho." },
        { id: id("Plnomocenstvo.pdf"), role: "client_documents", matter: "najom", confidence: "medium", reason: "Plnomocenstvo pre konanie o nájomnom." },
      ],
    }, inventory);
    const plan = buildTriagePlan(inventory, { classification, today: "2026-10-05", runId: "triage-20261005-100000-abcdef", createdAt: NOW.toISOString() });
    expect(plan.classification).toMatchObject({ used: true, documents: 3 });
    expect(plan.matters.find(item => item.key === "najom")).toMatchObject({ folder: "Spisy/2024-02 Spor o nájomné s Fiktívna s. r. o", dateSource: "model", documents: 2 });
    expect(move(plan, "scan0001.pdf")).toMatchObject({ to: "Spisy/2024-02 Spor o nájomné s Fiktívna s. r. o/01_Podklady/scan0001.pdf", source: "model", truncated: true });
    expect(move(plan, "IMG_2041.jpg")).toMatchObject({ to: "00_Na_zatriedenie/IMG_2041.jpg", source: "model", confidence: "low" });
    expect(move(plan, "Faktura 2024-017.pdf")?.source).toBe("rules");
    await applyTriagePlan(plan, { trialJournalDirectory: clone.journal });
    const card = await readFile(join(clone.root, "Spisy/2024-02 Spor o nájomné s Fiktívna s. r. o/matter.md"), "utf8");
    expect(card).toContain('protistrana: "Fiktívna s. r. o."');
    expect(card).toContain('sud: "Okresný súd Vymyslené Mesto"');
    expect(card).toContain('area: "Nájom"');
  });
  test("neplatný výstup modelu sa odmietne celý", async () => {
    const { inventory, id } = await prepared();
    const base = { schema: CLASSIFICATION_SCHEMA, treeDigest: inventory.treeDigest, matters: [], documents: [] as unknown[] };
    const bad = (value: unknown) => expect(() => parseClassification(value, inventory)).toThrow(ClassificationError);
    bad("nie je json objekt");
    bad({ ...base, treeDigest: "0".repeat(64) });
    bad({ ...base, documents: [{ id: "d0000000000000000", role: "drafts", confidence: "high", reason: "x" }] });
    bad({ ...base, documents: [{ id: id("IMG_2041.jpg"), role: "trash", confidence: "high", reason: "x" }] });
    bad({ ...base, documents: [{ id: id("IMG_2041.jpg"), role: "drafts", confidence: "high", reason: "x", path: "../../etc/passwd" }] });
    bad({ ...base, documents: [{ id: id("IMG_2041.jpg"), role: "drafts", confidence: "sure", reason: "x" }] });
    bad({ ...base, documents: [{ id: id("IMG_2041.jpg"), role: "drafts", confidence: "high", reason: "x".repeat(301) }] });
    bad({ ...base, documents: [{ id: id("IMG_2041.jpg"), role: "drafts", matter: "neznama", confidence: "high", reason: "x" }] });
    bad({ ...base, matters: [{ key: "a", title: "../../von", kind: "contentious" }] });
    bad({ ...base, matters: [{ key: "a", title: "Vec/podvec", kind: "contentious" }] });
    bad({ ...base, matters: [{ key: "existing-x", title: "Vec", kind: "contentious" }] });
    bad({ ...base, matters: [{ key: "a", title: "Vec", kind: "contentious", date: "2024-02-30" }] });
    bad({ ...base, matters: Array.from({ length: 51 }, (_, index) => ({ key: `k${index}`, title: `Vec ${index}`, kind: "contentious" })) });
    bad({ ...base, extra: true });
  });
  test("úvodzovky a nové riadky z modelu sa do karty nedostanú", async () => {
    const { inventory, id } = await prepared();
    const classification = parseClassification({ schema: CLASSIFICATION_SCHEMA, treeDigest: inventory.treeDigest, matters: [{ key: "a", title: "Vec", kind: "non_contentious", counterparty: "X\"\nstatus: zmazany" }], documents: [{ id: id("IMG_2041.jpg"), role: "client_documents", matter: "a", confidence: "high", reason: "r" }] }, inventory);
    expect(classification.matters[0]!.counterparty).toBe("X status: zmazany");
    const plan = buildTriagePlan(inventory, { classification, today: "2026-10-05", runId: "triage-20261005-100000-abcdef", createdAt: NOW.toISOString() });
    const card = plan.create.find(operation => operation.path.endsWith("/matter.md"))!.content!;
    expect(card.split("\n").filter(line => line.startsWith("status:"))).toHaveLength(1);
  });
});

describe("profily a limity", () => {
  test("český a anglický klient majú svoje pracovné priečinky", async () => {
    const cs = await trialClone({ "Smlouva.pdf": "a", "IMG.jpg": "b", "Usneseni 15C_77_2024.pdf": "c", "Rozsudek 15C_77_2024.pdf": "d" }, "cs");
    const csPlan = (await rulesPlan(cs)).plan;
    expect(move(csPlan, "Smlouva.pdf")?.to).toBe("01_Podklady/Smlouva.pdf");
    expect(move(csPlan, "IMG.jpg")?.to).toBe("00_K_zarazeni/IMG.jpg");
    expect(csPlan.matters[0]).toMatchObject({ title: "Řízení 15C 77-2024", jurisdiction: "cz" });
    expect(move(csPlan, "Rozsudek 15C_77_2024.pdf")?.to).toBe("Spisy/2026-10 Řízení 15C 77-2024/05_Komunikace/Dulezita_posta/Rozsudek 15C_77_2024.pdf");
    const en = await trialClone({ "Agreement.pdf": "a", "x.bin": "b" }, "en");
    const enPlan = (await rulesPlan(en)).plan;
    expect(move(enPlan, "Agreement.pdf")?.to).toBe("01_Client_documents/Agreement.pdf");
    expect(move(enPlan, "x.bin")?.to).toBe("00_Inbox/x.bin");
  });
  test("profil bez priečinka na zatriedenie nechá nejasné dokumenty na mieste", async () => {
    const clone = await trialClone({ "IMG.jpg": "a", "Zmluva.pdf": "b" });
    const profile = await readFile(join(clone.root, "PRACOVNY-PROFIL.md"), "utf8");
    await writeFile(join(clone.root, "PRACOVNY-PROFIL.md"), profile.replace(/folder_roles: .*/, 'folder_roles: {"client_documents":"01_Podklady"}'));
    const { plan } = await rulesPlan(clone);
    expect(plan.stays).toEqual([expect.objectContaining({ path: "IMG.jpg", why: "no_inbox" })]);
    expect(move(plan, "Zmluva.pdf")?.to).toBe("01_Podklady/Zmluva.pdf");
  });
  test("limity čítania sa prejavia ako odmietnutie, nie čiastočný plán", async () => {
    const clone = await trialClone();
    await expect(scanTriage(clone.root, { limits: { maxEntries: 10 } })).rejects.toThrow("entry_limit");
  });
});

describe("CLI", () => {
  test("plan → apply --confirm → undo --confirm; bez --confirm nič nezapíše", async () => {
    const clone = await trialClone({ "Plnomocenstvo.pdf": "a", "x.eml": "b" });
    const original = await treeHash(clone.root);
    const lines: string[] = [];
    const out = (line: string) => lines.push(line);
    expect(await runTriage(["plan", clone.root, "--trial-journal", clone.journal], out)).toBe(0);
    const { planFile, plan } = JSON.parse(lines.pop()!) as { planFile: string; plan: TriagePlan };
    expect(plan.moves).toHaveLength(2);
    expect(await runTriage(["apply", clone.root, "--plan", planFile], out)).toBe(1);
    expect(lines.pop()).toContain("--confirm");
    expect(await treeHash(clone.root)).toBe(original);
    expect(await runTriage(["apply", clone.source, "--plan", planFile, "--confirm"], out)).toBe(1);
    expect(await runTriage(["apply", clone.root, "--plan", planFile, "--confirm"], out)).toBe(0);
    expect(await runTriage(["status", clone.root], out)).toBe(0);
    expect(JSON.parse(lines.pop()!).runs[0].state).toBe("applied");
    expect(await runTriage(["undo", clone.root, "--run", plan.runId, "--confirm"], out)).toBe(0);
    expect(await treeHash(clone.root)).toBe(original);
    expect(await runTriage(["status", clone.source], out)).toBe(1);
  });
});
