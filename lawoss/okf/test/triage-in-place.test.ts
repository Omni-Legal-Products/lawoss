import { createHash } from "node:crypto";
import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { chmod, mkdtemp, mkdir, open, readFile, readdir, realpath, rm, symlink, truncate, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectOnboardingRoot } from "../src/onboarding/classify.ts";
import { applyOnboarding, parseOnboardingRequest, planOnboarding } from "../src/onboarding/onboarding.ts";
import { applyTriagePlan, buildTriagePlan, folderHintRole, looksLikeArchiveFolder, MAX_TRIAGE_MATTERS, parseClassification, parseTriagePlan, grantInPlaceReorganize, IN_PLACE_MARKER, prepareTriage, replanTriage, scanTriage, TRIAGE_INSPECTION_LIMITS, TriageConflictError, TriageTooLargeError, TrialCloneError, undoTriage, verifyTriageTarget } from "../src/triage/index.ts";
import { HRON_FIXTURE, HRON_MATTERS, TRIAGE_FIXTURE, writeTriageFixture } from "./fixtures/triage-client.ts";
import { holdWindowsFileLock } from "./windows-file-lock.ts";

setDefaultTimeout(30_000);
const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory(prefix: string) { const path = await realpath(await mkdtemp(join(tmpdir(), prefix))); paths.push(path); return path; }
const NOW = new Date("2026-10-08T10:00:00Z");
/** Hostiteľ, ktorý súhlas s usporiadaním na mieste overil vlastným záznamom (C1); bez toho sa originál odmietne. */
const HOST = { allowInPlace: true } as const;

/** Skutočný klient po „convert“, ako ho urobí appka pri „Nie, len pridaj OKF súbory“. */
async function convertedClient(): Promise<string> {
  const base = await directory("okf-in-place-");
  const root = join(base, "Vymyslený klient");
  await mkdir(root);
  await writeTriageFixture(root, TRIAGE_FIXTURE);
  const preview = await planOnboarding(parseOnboardingRequest({ action: "existing", root, mode: "convert", title: "Vymyslený klient", clientType: "po", language: "sk", jurisdiction: "sk", date: "2026-10-08", confirmUnknownClient: true }));
  await applyOnboarding(preview, { journalDirectory: await directory("okf-journal-"), externalProfileDirectory: await directory("okf-external-") });
  return root;
}
async function documentsHash(root: string): Promise<string> {
  const inspection = await inspectOnboardingRoot(root);
  return createHash("sha256").update(JSON.stringify(inspection.entries.filter(entry => !entry.path.startsWith(".lawoss")))).digest("hex");
}

test("bez súhlasu sa klient mimo skúšobného klona neusporiada", async () => {
  const root = await convertedClient();
  await expect(verifyTriageTarget(root, undefined, HOST)).rejects.toBeInstanceOf(TrialCloneError);
  await expect(prepareTriage(root, { now: NOW, ...HOST })).rejects.toThrow(/súhlas/);
});

test("súhlas vyžaduje kartu klienta a je idempotentný", async () => {
  const plain = await directory("okf-in-place-plain-");
  await expect(grantInPlaceReorganize(plain, NOW)).rejects.toThrow(/klienta/);
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  await grantInPlaceReorganize(root, NOW);
  expect(JSON.parse(await readFile(join(root, IN_PLACE_MARKER), "utf8"))).toEqual({ version: 1, root, grantedAt: NOW.toISOString() });
  expect(await verifyTriageTarget(root, undefined, HOST)).toEqual({ root, mode: "in_place", journalVerified: false });
});

test("súhlas dostane aj klient so symbolickým odkazom a veľkým dokumentom v podpriečinku", async () => {
  const root = await convertedClient(), outside = await directory("okf-in-place-outside-");
  await writeFile(join(outside, "cudzi.txt"), "cudzí súbor");
  await mkdir(join(root, "Archiv"));
  try { await symlink(join(outside, "cudzi.txt"), join(root, "Archiv", "odkaz.txt")); }
  catch (error) { if (!(error && typeof error === "object" && "code" in error && ["EPERM", "EACCES", "ENOSYS"].includes(String(error.code)))) throw error; }
  // Riedky súbor nad limit 1 GB: plná inšpekcia skončí skôr, než sa dostane ku karte klienta.
  const large = await open(join(root, "Archiv", "zaloha.bin"), "w");
  try { await large.truncate(1024 * 1024 * 1024 + 1); } finally { await large.close(); }
  await grantInPlaceReorganize(root, NOW);
  expect(JSON.parse(await readFile(join(root, IN_PLACE_MARKER), "utf8"))).toEqual({ version: 1, root, grantedAt: NOW.toISOString() });
  expect(await readFile(join(outside, "cudzi.txt"), "utf8")).toBe("cudzí súbor");
});

test("súhlas z iného priečinka (skopírovaný marker) neplatí", async () => {
  const root = await convertedClient();
  await mkdir(join(root, ".lawoss"), { recursive: true });
  await writeFile(join(root, IN_PLACE_MARKER), JSON.stringify({ version: 1, root: "/iny/priecinok", grantedAt: NOW.toISOString() }));
  await expect(verifyTriageTarget(root, undefined, HOST)).rejects.toThrow(/súhlas/);
});

test("ručne zapísaná značka bez povolenia hostiteľa neotvorí originál pre náhľad, zápis ani vrátenie", async () => {
  const root = await convertedClient();
  await mkdir(join(root, ".lawoss"), { recursive: true });
  // Značku vie zapísať ktokoľvek s prístupom k priečinku, aj agent; súhlasom nie je.
  await writeFile(join(root, IN_PLACE_MARKER), JSON.stringify({ version: 1, root, grantedAt: "hocičo" }));
  const before = await documentsHash(root);
  await expect(verifyTriageTarget(root)).rejects.toBeInstanceOf(TrialCloneError);
  await expect(scanTriage(root)).rejects.toBeInstanceOf(TrialCloneError);
  await expect(prepareTriage(root, { now: NOW })).rejects.toBeInstanceOf(TrialCloneError);
  // Plán a beh, ktoré pripravil hostiteľ po overení súhlasu, sa bez povolenia nepoužijú.
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(plan.moves.length).toBeGreaterThan(0);
  await expect(applyTriagePlan(plan)).rejects.toBeInstanceOf(TrialCloneError);
  expect(await documentsHash(root)).toBe(before);
  await applyTriagePlan(plan, HOST);
  const applied = await documentsHash(root);
  await expect(undoTriage(root, plan.runId)).rejects.toBeInstanceOf(TrialCloneError);
  expect(await documentsHash(root)).toBe(applied);
});

test("usporiadanie na mieste a jeho úplné vrátenie", async () => {
  const root = await convertedClient();
  const before = await documentsHash(root);
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(plan.moves.length).toBeGreaterThan(0);
  const applied = await applyTriagePlan(plan, HOST);
  expect(applied).toMatchObject({ status: "applied", moved: plan.moves.length });
  expect(await documentsHash(root)).not.toBe(before);
  const undone = await undoTriage(root, plan.runId, HOST);
  expect(undone.status).toBe("undone");
  expect(await documentsHash(root)).toBe(before);
  expect(await readdir(join(root, ".lawoss"))).toContain("reorganize.json");
});

test("priečinok veci bez karty (`2025-01 Spor`) sa nerozpustí, ostatné podpriečinky sa usporiadajú", async () => {
  const root = await convertedClient();
  await mkdir(join(root, "2025-01 Spor"));
  await writeFile(join(root, "2025-01 Spor", "Žaloba.pdf"), "%PDF-1.4 synthetic claim in matter");
  await grantInPlaceReorganize(root, NOW);
  const inventory = await scanTriage(root, HOST);
  expect(inventory.matters).toContainEqual(expect.objectContaining({ path: "2025-01 Spor", implicit: {} }));
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  // Dokument veci sa zaradí v rámci veci, nie na úroveň klienta (test 16. 10. 2026, N2).
  expect(plan.moves.find(move => move.from === "2025-01 Spor/Žaloba.pdf")?.to).toBe("2025-01 Spor/04_Vystupy/Žaloba.pdf");
  expect(plan.create).toContainEqual(expect.objectContaining({ path: "2025-01 Spor/matter.md", kind: "file" }));
  // Archív `Stare` je predvolene odškrtnutý a ostane nedotknutý (rozhodnutie 19. 10. 2026).
  expect(plan.matters.find(matter => matter.folder === "Stare")).toMatchObject({ left: true });
  expect(plan.moves.some(move => move.from === "Stare/priloha.pdf")).toBe(false);
});

/**
 * Syntetický klient z testu 16. 10. 2026 (TEST-OKF-2026-10-16/gen_korpus.py, nálezy N2 a N5):
 * vec so spisovou značkou v názve a vec bez značky aj bez diakritiky, obe bez karty.
 */
const SPOR = "Spor BETA - dielo 18Cb-47-2026";
const KUPA = "Kupa haly Senec";
const ALFA: Readonly<Record<string, string>> = {
  [`${SPOR}/Zmluva o dielo 2025-03-14.pdf`]: "%PDF-1.4 synthetic contract",
  [`${SPOR}/2026-05-12 Zaloba o zaplatenie.docx`]: "synthetic claim draft",
  [`${SPOR}/2026-08-28 Vyjadrenie zalovaneho.pdf`]: "%PDF-1.4 synthetic statement",
  [`${SPOR}/2026-10-06 Uznesenie KS BA - vyzva na repliku.pdf`]: "%PDF-1.4 synthetic resolution",
  [`${SPOR}/poznamky z porady 2026-09-02.txt`]: "synteticke poznamky",
  [`${KUPA}/Kupna zmluva - navrh v3.docx`]: "synthetic purchase draft",
  [`${KUPA}/LV 1234 Senec 2026-10-01.pdf`]: "%PDF-1.4 synthetic title extract",
  [`${KUPA}/2026-10-10 email predavajuci.txt`]: "synteticky email",
};
async function alfaClient(): Promise<string> {
  const base = await directory("okf-in-place-alfa-");
  const root = join(base, "ALFA STAV s.r.o");
  await mkdir(root);
  await writeTriageFixture(root, ALFA);
  const preview = await planOnboarding(parseOnboardingRequest({ action: "existing", root, mode: "convert", title: "ALFA STAV s.r.o.", clientType: "po", language: "sk", jurisdiction: "sk", date: "2026-10-16", confirmUnknownClient: true }));
  await applyOnboarding(preview, { journalDirectory: await directory("okf-journal-"), externalProfileDirectory: await directory("okf-external-") });
  await grantInPlaceReorganize(root, NOW);
  return root;
}
const inFolder = (folder: string) => (path: string) => path.startsWith(`${folder}/`);

test("vec so spisovou značkou v názve ostane vecou: kartu dostane na mieste, dokumenty sa zaradia v nej", async () => {
  const root = await alfaClient();
  const before = await documentsHash(root);
  const { inventory, plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(inventory.documents.filter(document => inFolder(SPOR)(document.path))).toHaveLength(5);
  expect(plan.matters).toContainEqual(expect.objectContaining({ folder: SPOR, source: "folder", kind: "contentious", caseNumber: "18Cb 47/2026", documents: 5 }));
  // Spisová značka z cesty nezaloží druhú vec v Spisy/, ktorá by spor vyprázdnila.
  expect(plan.matters.some(matter => matter.folder.startsWith("Spisy/"))).toBe(false);
  const fromSpor = plan.moves.filter(move => inFolder(SPOR)(move.from));
  expect(fromSpor).toHaveLength(5);
  for (const move of fromSpor) expect(move.to.startsWith(`${SPOR}/`)).toBe(true);
  expect(plan.create.every(operation => !operation.path.startsWith("Spisy/"))).toBe(true);
  expect(plan.create.some(operation => operation.path === SPOR)).toBe(false);

  await applyTriagePlan(plan, HOST);
  const card = await readFile(join(root, SPOR, "matter.md"), "utf8");
  expect(card).toContain("18Cb 47/2026");
  expect(card).toContain("kind: contentious");
  const undone = await undoTriage(root, plan.runId, HOST);
  expect(undone.status).toBe("undone");
  expect(await documentsHash(root)).toBe(before);
});

test("vec bez spisovej značky a bez diakritiky (`Kupa haly Senec`) sa nerozpustí do priečinkov klienta", async () => {
  const root = await alfaClient();
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(plan.matters).toContainEqual(expect.objectContaining({ folder: KUPA, source: "folder", kind: "non_contentious", documents: 3 }));
  const fromKupa = plan.moves.filter(move => inFolder(KUPA)(move.from));
  expect(fromKupa).toHaveLength(3);
  for (const move of fromKupa) expect(move.to.startsWith(`${KUPA}/`)).toBe(true);
  expect(plan.moves.find(move => move.from === `${KUPA}/Kupna zmluva - navrh v3.docx`)?.to).toBe(`${KUPA}/03_Drafty/Kupna zmluva - navrh v3.docx`);
  // Nejasný dokument ide na zatriedenie vo veci, nie do `00_Na_zatriedenie` klienta.
  expect(plan.moves.find(move => move.from === `${KUPA}/2026-10-10 email predavajuci.txt`)?.to).toBe(`${KUPA}/00_Na_zatriedenie/2026-10-10 email predavajuci.txt`);

  await applyTriagePlan(plan, HOST);
  expect(await readFile(join(root, KUPA, "matter.md"), "utf8")).toContain("kind: non_contentious");
  for (const folder of [KUPA, SPOR]) expect((await readdir(join(root, folder))).length).toBeGreaterThan(0);
  // Ďalšie usporiadanie (nový súhlas) vidí obe veci s kartou a nič z nich nepresúva.
  await rm(join(root, IN_PLACE_MARKER));
  await grantInPlaceReorganize(root, NOW);
  const again = await prepareTriage(root, { now: NOW, ...HOST });
  expect(again.plan.moves.filter(move => inFolder(KUPA)(move.from) || inFolder(SPOR)(move.from))).toHaveLength(0);
  expect(again.inventory.matters.some(matter => matter.implicit)).toBe(false);
});

test("vec so značkou bez diakritiky (`Zaloba o zaplaceni 23 C 118-2026`) má čo usporiadať", async () => {
  const base = await directory("okf-in-place-horak-");
  const root = join(base, "Horák s.r.o.");
  const matter = "Zaloba o zaplaceni 23 C 118-2026";
  await mkdir(root);
  await writeTriageFixture(root, { [`${matter}/Zaloba.pdf`]: "%PDF-1.4 synthetic claim", [`${matter}/Platebni rozkaz.pdf`]: "%PDF-1.4 synthetic order" });
  const preview = await planOnboarding(parseOnboardingRequest({ action: "existing", root, mode: "convert", title: "Horák s.r.o.", clientType: "po", language: "cs", jurisdiction: "cz", date: "2026-10-16", confirmUnknownClient: true }));
  await applyOnboarding(preview, { journalDirectory: await directory("okf-journal-"), externalProfileDirectory: await directory("okf-external-") });
  await grantInPlaceReorganize(root, NOW);
  const { inventory, plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(inventory.documents).toHaveLength(2);
  expect(plan.moves).toHaveLength(2);
  for (const move of plan.moves) expect(move.to.startsWith(`${matter}/`)).toBe(true);
  expect(plan.matters).toEqual([expect.objectContaining({ folder: matter, caseNumber: "23C 118/2026", kind: "contentious", jurisdiction: "cz" })]);
});

test("vec bez karty s vlastnými inštrukciami a podpriečinkami: nič existujúce sa neprepíše", async () => {
  const root = await alfaClient();
  await writeFile(join(root, KUPA, "AGENTS.md"), "vlastne instrukcie");
  await mkdir(join(root, KUPA, "03_Drafty"));
  await writeFile(join(root, KUPA, "03_Drafty", "starsi navrh v1.docx"), "synthetic older draft");
  const { inventory, plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(inventory.skipped).toContainEqual({ path: `${KUPA}/03_Drafty/starsi navrh v1.docx`, reason: "already_sorted" });
  const created = plan.create.map(operation => operation.path);
  expect(created).toContain(`${KUPA}/matter.md`);
  for (const path of [`${KUPA}/AGENTS.md`, `${KUPA}/CLAUDE.md`, `${KUPA}/03_Drafty`, `${KUPA}/03_Drafty/.keep`]) expect(created).not.toContain(path);
  expect(plan.moves.find(move => move.from === `${KUPA}/Kupna zmluva - navrh v3.docx`)?.to).toBe(`${KUPA}/03_Drafty/Kupna zmluva - navrh v3.docx`);
  await applyTriagePlan(plan, HOST);
  expect(await readFile(join(root, KUPA, "AGENTS.md"), "utf8")).toBe("vlastne instrukcie");
});

/**
 * Test 19. 10. 2026 (klient „C002 SYN Hron Technológie, a. s.“): podpriečinky `M004 …` až `M006 …` sú veci
 * pomenované kódom veci. Usporiadanie ich rozpustilo do priečinkov klienta a rovnaké mená premenovalo.
 */
test("podpriečinky s dokumentmi pomenované kódom veci (`M004 …`) ostanú prípadmi, nič sa medzi nimi nezmieša", async () => {
  const base = await directory("okf-in-place-hron-");
  const root = join(base, "C002 SYN Hron Technológie, a. s.");
  await mkdir(root);
  await writeTriageFixture(root, HRON_FIXTURE);
  const preview = await planOnboarding(parseOnboardingRequest({ action: "existing", root, mode: "convert", title: "C002 SYN Hron Technológie, a. s.", clientType: "po", language: "sk", jurisdiction: "sk", date: "2026-10-19", confirmUnknownClient: true }));
  await applyOnboarding(preview, { journalDirectory: await directory("okf-journal-"), externalProfileDirectory: await directory("okf-external-") });
  await grantInPlaceReorganize(root, NOW);
  const before = await documentsHash(root);
  const { inventory, plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(inventory.documents).toHaveLength(48);
  expect(plan.matters.map(matter => matter.folder).sort()).toEqual([...HRON_MATTERS]);
  for (const matter of plan.matters) expect(matter).toMatchObject({ source: "folder", documents: 16, kind: "non_contentious" });
  // Každý dokument ostane vo svojej veci; žiadny sa nepresunie na úroveň klienta ani do inej veci.
  for (const move of plan.moves) expect(move.to.split("/")[0]).toBe(move.from.split("/")[0]);
  expect(plan.moves.filter(move => move.renamed)).toEqual([]);
  expect(plan.create.filter(operation => !HRON_MATTERS.some(matter => operation.path.startsWith(`${matter}/`)))).toEqual([]);
  for (const matter of HRON_MATTERS) expect(plan.create).toContainEqual(expect.objectContaining({ path: `${matter}/matter.md`, kind: "file" }));
  expect(plan.moves.find(move => move.from === `${HRON_MATTERS[0]}/01-zmluva.docx`)?.to).toBe(`${HRON_MATTERS[0]}/01_Podklady/01-zmluva.docx`);

  await applyTriagePlan(plan, HOST);
  for (const matter of HRON_MATTERS) expect(await readFile(join(root, matter, "matter.md"), "utf8")).toContain("kind: non_contentious");
  // Ďalšie usporiadanie vidí tri veci s kartou a nič z nich nepresúva.
  await rm(join(root, IN_PLACE_MARKER));
  await grantInPlaceReorganize(root, NOW);
  const again = await prepareTriage(root, { now: NOW, ...HOST });
  expect(again.plan.moves.filter(move => HRON_MATTERS.some(matter => move.from.startsWith(`${matter}/`)))).toHaveLength(0);
  expect((await undoTriage(root, plan.runId, HOST)).status).toBe("undone");
  expect(await documentsHash(root)).toBe(before);
});

test("pracovný je len priečinok, ktorého celý názov je rola (aj s rokom); ostatné podpriečinky sú návrhy prípadov", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const inventory = await scanTriage(root, HOST);
  expect(inventory.matters.map(matter => matter.path)).toEqual(["Fotky", "Stare"]);
  for (const path of ["Emaily/potvrdenie.pdf", "Drafty/memo.docx", "Podania/odpor.pdf", "Korespondencia 2024/priloha.pdf"]) expect(inventory.skipped).toContainEqual({ path, reason: "in_folder" });
  expect(folderHintRole("Korešpondencia")).toBe("correspondence");
  expect(folderHintRole("Podania 2024")).toBe("outputs");
  expect(folderHintRole("Faktúry 2023-03")).toBe("client_documents");
  for (const name of ["Pracovné verzie", "Zmluvy s dodávateľom XY", "Podklady k M004", "Emaily Novák", "2024"]) expect(folderHintRole(name)).toBeUndefined();
});

/** Prípady od recenzenta 19. 10. 2026: žiadny z nich sa nesmie rozpustiť do priečinkov klienta. */
const REVIEW_FOLDERS: Readonly<Record<string, string>> = {
  "Plnomocenstvo.pdf": "%PDF-1.4 synthetic poa",
  "Zmluvy s dodávateľom XY/zmluva.pdf": "%PDF-1.4 synthetic supplier contract",
  "Nová žaloba Kováč/zaloba.pdf": "%PDF-1.4 synthetic claim",
  "Dokumenty k prevodu podielu/navrh zmluvy.docx": "synthetic transfer draft",
  "Podklady k M004/podklad.pdf": "%PDF-1.4 synthetic basis",
  "Pracovné verzie/stanovisko v1.docx": "synthetic opinion draft",
  "Archív/poznamka.txt": "synteticka poznamka",
  "Archív/M001 Spor X/Zmluva.pdf": "%PDF-1.4 synthetic archived contract",
  "Archív/M001 Spor X/Žaloba.pdf": "%PDF-1.4 synthetic archived claim",
  "M004 Vyúčtovanie/01-zmluva.docx": "synthetic lease",
  "M004 Vyúčtovanie/Strana A/zmluva.pdf": "%PDF-1.4 synthetic party A",
  "M004 Vyúčtovanie/Strana B/zmluva.pdf": "%PDF-1.4 synthetic party B",
  "Korešpondencia/list.pdf": "%PDF-1.4 synthetic letter",
  "Podania 2024/odpor.pdf": "%PDF-1.4 synthetic objection",
};
const REVIEW_MATTERS = ["Archív", "Dokumenty k prevodu podielu", "M004 Vyúčtovanie", "Nová žaloba Kováč", "Podklady k M004", "Pracovné verzie", "Zmluvy s dodávateľom XY"];
async function reviewClient(): Promise<string> {
  const base = await directory("okf-in-place-review-");
  const root = join(base, "Revízia s. r. o.");
  await mkdir(root);
  await writeTriageFixture(root, REVIEW_FOLDERS);
  const preview = await planOnboarding(parseOnboardingRequest({ action: "existing", root, mode: "convert", title: "Revízia s. r. o.", clientType: "po", language: "sk", jurisdiction: "sk", date: "2026-10-19", confirmUnknownClient: true }));
  await applyOnboarding(preview, { journalDirectory: await directory("okf-journal-"), externalProfileDirectory: await directory("okf-external-") });
  await grantInPlaceReorganize(root, NOW);
  return root;
}
const top = (path: string) => path.split("/")[0];

test("usporiadanie triedi len voľné súbory; podpriečinky ostanú na mieste ako prípady a vnorené sa nedotknú", async () => {
  const root = await reviewClient();
  const before = await documentsHash(root);
  const { inventory, plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(inventory.matters.map(matter => matter.path).sort()).toEqual(REVIEW_MATTERS);
  expect(plan.matters.filter(matter => matter.source === "folder").map(matter => matter.folder).sort()).toEqual(REVIEW_MATTERS);
  // Voľný súbor v koreni klienta ide do priečinka klienta; voľný súbor v koreni prípadu ostane v prípade.
  expect(plan.moves.find(move => move.from === "Plnomocenstvo.pdf")?.to).toBe("01_Podklady/Plnomocenstvo.pdf");
  for (const move of plan.moves.filter(move => move.from.includes("/"))) {
    expect(move.from.split("/")).toHaveLength(2);
    expect(top(move.to)).toBe(top(move.from));
  }
  // Vnorené priečinky (`Archív/M001 Spor X`, `M004/Strana A`, `Strana B`) ani pracovné priečinky advokáta sa nehýbu.
  const untouched = ["Archív/M001 Spor X/", "M004 Vyúčtovanie/Strana A/", "M004 Vyúčtovanie/Strana B/", "Korešpondencia/", "Podania 2024/"];
  expect(plan.moves.filter(move => untouched.some(prefix => move.from.startsWith(prefix)))).toEqual([]);
  expect(plan.moves.filter(move => move.renamed)).toEqual([]);
  expect(plan.create.filter(operation => !REVIEW_MATTERS.some(matter => operation.path.startsWith(`${matter}/`)) && !["00_Na_zatriedenie", "01_Podklady"].includes(top(operation.path)))).toEqual([]);

  await applyTriagePlan(plan, HOST);
  for (const path of ["M004 Vyúčtovanie/Strana A/zmluva.pdf", "M004 Vyúčtovanie/Strana B/zmluva.pdf", "Archív/M001 Spor X/Žaloba.pdf", "Korešpondencia/list.pdf"]) expect(await readFile(join(root, path), "utf8")).toBe(REVIEW_FOLDERS[path]);
  // Opakované usporiadanie nič nepresúva: prípady majú kartu, voľné súbory sú zaradené.
  await rm(join(root, IN_PLACE_MARKER));
  await grantInPlaceReorganize(root, NOW);
  expect((await prepareTriage(root, { now: NOW, ...HOST })).plan.moves).toEqual([]);
  expect((await undoTriage(root, plan.runId, HOST)).status).toBe("undone");
  expect(await documentsHash(root)).toBe(before);
});

test("odškrtnutý priečinok ostane úplne nedotknutý: bez karty, bez priečinkov a bez presunov", async () => {
  const root = await reviewClient();
  const { inventory, plan } = await prepareTriage(root, { now: NOW, ...HOST });
  const m004 = plan.matters.find(matter => matter.folder === "M004 Vyúčtovanie")!;
  const left = replanTriage(inventory, undefined, [], NOW, [m004.key]);
  expect(left.matters.find(matter => matter.key === m004.key)).toMatchObject({ left: true, documents: 0 });
  expect(left.moves.filter(move => move.from.startsWith("M004 Vyúčtovanie/"))).toEqual([]);
  expect(left.create.filter(operation => operation.path.startsWith("M004 Vyúčtovanie/"))).toEqual([]);
  expect(left.fingerprint).not.toBe(plan.fingerprint);
  expect(left.moves.some(move => move.from === "Pracovné verzie/stanovisko v1.docx")).toBe(true);
  await applyTriagePlan(left, HOST);
  expect((await readdir(join(root, "M004 Vyúčtovanie"))).sort()).toEqual(["01-zmluva.docx", "Strana A", "Strana B"]);
});

test("prípad so slovom druhu dokumentu uprostred názvu (`M008 Reklamácia faktúry`) ostane prípadom", async () => {
  const root = await convertedClient();
  const matters = ["M008 Reklamácia faktúry", "M011 Výpoveď zmluvy", "M010 Nájom skladu komunikácia"];
  const buckets = ["Faktúry 2023", "Od klienta"];
  for (const folder of [...matters, ...buckets]) {
    await mkdir(join(root, folder));
    await writeFile(join(root, folder, "dokument.pdf"), `%PDF-1.4 synthetic ${folder}`);
  }
  await grantInPlaceReorganize(root, NOW);
  const inventory = await scanTriage(root, HOST);
  for (const folder of matters) expect(inventory.matters.some(matter => matter.path === folder)).toBe(true);
  for (const folder of ["Emaily", "Korespondencia 2024", ...buckets]) expect(inventory.matters.some(matter => matter.path === folder)).toBe(false);
});

/** Recenzia 19. 10. 2026 (fix round 2): voľné súbory v koreni klienta smerujú spisovou značkou do odškrtnutého priečinka. */
async function sporClient(): Promise<{ root: string; spor: string }> {
  const base = await directory("okf-in-place-left-");
  const root = join(base, "BETA s. r. o.");
  await mkdir(root);
  await writeTriageFixture(root, { "Spor BETA 18Cb-47-2026/zaloba.pdf": "%PDF-1.4 synthetic claim", "Uznesenie 18Cb 47 2026.pdf": "%PDF-1.4 synthetic resolution", "Vyzva 18Cb_47_2026.pdf": "%PDF-1.4 synthetic call" });
  const preview = await planOnboarding(parseOnboardingRequest({ action: "existing", root, mode: "convert", title: "BETA s. r. o.", clientType: "po", language: "sk", jurisdiction: "sk", date: "2026-10-19", confirmUnknownClient: true }));
  await applyOnboarding(preview, { journalDirectory: await directory("okf-journal-"), externalProfileDirectory: await directory("okf-external-") });
  await grantInPlaceReorganize(root, NOW);
  return { root, spor: "Spor BETA 18Cb-47-2026" };
}
async function folderSnapshot(path: string): Promise<string> {
  const inspection = await inspectOnboardingRoot(path);
  return createHash("sha256").update(JSON.stringify(inspection.entries)).digest("hex");
}

test("odškrtnutý priečinok neprijme ani dokumenty zo spisovej značky z koreňa klienta; zápis a vrátenie ho nezmenia", async () => {
  const { root, spor } = await sporClient();
  const { inventory, plan } = await prepareTriage(root, { now: NOW, ...HOST });
  const key = inventory.matters.find(matter => matter.path === spor)!.id;
  // Zaškrtnutý: voľné súbory s rovnakou značkou idú do prípadu.
  expect(plan.moves.filter(move => move.to.startsWith(`${spor}/`)).map(move => move.from).sort()).toEqual(["Uznesenie 18Cb 47 2026.pdf", "Vyzva 18Cb_47_2026.pdf", `${spor}/zaloba.pdf`].sort());
  const left = replanTriage(inventory, undefined, [], NOW, [key]);
  expect(left.moves.filter(move => move.to.startsWith(`${spor}/`) || move.from.startsWith(`${spor}/`))).toEqual([]);
  expect(left.create.filter(operation => operation.path.startsWith(`${spor}/`))).toEqual([]);
  // Rovnaký spor sa na disku nezdvojí (fix round 3): žiadny nový prípad v Spisy/, voľné súbory idú na zatriedenie s poznámkou.
  expect(left.matters.filter(matter => !matter.left)).toEqual([]);
  expect(left.create.some(operation => operation.path.startsWith("Spisy"))).toBe(false);
  expect(left.moves.map(move => [move.to, move.role, move.leftFolder])).toEqual([
    ["00_Na_zatriedenie/Uznesenie 18Cb 47 2026.pdf", "inbox", spor],
    ["00_Na_zatriedenie/Vyzva 18Cb_47_2026.pdf", "inbox", spor],
  ]);
  const before = await folderSnapshot(join(root, spor));
  await applyTriagePlan(left, HOST);
  expect(await folderSnapshot(join(root, spor))).toBe(before);
  expect((await undoTriage(root, left.runId, HOST)).status).toBe("undone");
  expect(await folderSnapshot(join(root, spor))).toBe(before);
});

test("ani rozhodnutie modelu neposunie dokument do odškrtnutého priečinka", async () => {
  const { root, spor } = await sporClient();
  const inventory = await scanTriage(root, HOST);
  const key = inventory.matters.find(matter => matter.path === spor)!.id;
  const loose = inventory.documents.filter(document => !document.path.includes("/"));
  const classification = parseClassification({ schema: "lawoss.triage.classification/v1", treeDigest: inventory.treeDigest, matters: [], documents: loose.map(document => ({ id: document.id, role: "important_mail", matter: key, confidence: "high", reason: "patrí k sporu" })) }, inventory);
  const plan = buildTriagePlan(inventory, { classification, leaveInPlace: [key], today: "2026-10-19", runId: "triage-20261019-100000-abcdef", createdAt: NOW.toISOString() });
  expect(plan.moves.filter(move => move.to.startsWith(`${spor}/`) || move.from.startsWith(`${spor}/`))).toEqual([]);
  expect(plan.create.filter(operation => operation.path.startsWith(`${spor}/`))).toEqual([]);
  expect(plan.moves.map(move => [move.to, move.leftFolder]).sort()).toEqual([["00_Na_zatriedenie/Uznesenie 18Cb 47 2026.pdf", spor], ["00_Na_zatriedenie/Vyzva 18Cb_47_2026.pdf", spor]]);
  expect(plan.matters.filter(matter => !matter.left)).toEqual([]);
});

test("archív a holý rok sú predvolene odškrtnuté, ostatné priečinky zaškrtnuté", async () => {
  const root = await convertedClient();
  for (const folder of ["Archív 2023", "Záloha", "2024", "Old stuff", "M004 Vyúčtovanie"]) {
    await mkdir(join(root, folder));
    await writeFile(join(root, folder, "dokument.pdf"), `%PDF-1.4 synthetic ${folder}`);
  }
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  const state = Object.fromEntries(plan.matters.filter(matter => matter.source === "folder").map(matter => [matter.folder, matter.left === true]));
  expect(state).toEqual({ "2024": true, "Archív 2023": true, "Fotky": true, "M004 Vyúčtovanie": false, "Old stuff": true, "Stare": true, "Záloha": true });
  for (const name of ["Archív", "Archiv", "Staré", "Old", "Fotky", "Foto 2022", "Rôzne", "Rozne", "Misc", "Backup", "Záloha", "2024-03"]) expect(looksLikeArchiveFolder(name)).toBe(true);
  for (const name of ["M004 Vyúčtovanie", "Spor BETA", "Stavebné povolenie", "Fotovoltika Senec"]) expect(looksLikeArchiveFolder(name)).toBe(false);
  // Explicitný zoznam (advokát niečo prepol) má prednosť pred predvoľbou.
  const { plan: explicit } = await prepareTriage(root, { now: NOW, ...HOST, leaveInPlace: [] });
  expect(explicit.matters.some(matter => matter.left)).toBe(false);
});

test("limit prípadov počíta len zaškrtnuté; nad limit konkrétna chyba", async () => {
  const root = await convertedClient();
  for (let index = 0; index <= MAX_TRIAGE_MATTERS + 4; index++) {
    const folder = `Vec ${String(index).padStart(3, "0")}`;
    await mkdir(join(root, folder));
    await writeFile(join(root, folder, "dokument.pdf"), `%PDF-1.4 synthetic ${index}`);
  }
  await grantInPlaceReorganize(root, NOW);
  const { inventory, plan } = await prepareTriage(root, { now: NOW, ...HOST, leaveInPlace: [] });
  expect(() => parseTriagePlan(plan)).toThrow(expect.objectContaining({ code: "triage_too_many_matters" }));
  const all = inventory.matters.filter(matter => matter.implicit).map(matter => matter.id);
  const unchecked = replanTriage(inventory, undefined, [], NOW, all);
  expect(unchecked.matters.length).toBeGreaterThan(MAX_TRIAGE_MATTERS);
  expect(() => parseTriagePlan(unchecked)).not.toThrow();
  expect((await applyTriagePlan(unchecked, HOST)).status).toBe("applied");
});

/** Zámok simulovaný chybou EBUSY pri otvorení súboru (Word na Windows). */
function lockHooks(locked: string) {
  return {
    open: (async (path: Parameters<typeof open>[0], flags?: string | number) => {
      if (String(path).endsWith(locked)) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return open(path, flags);
    }) as typeof open,
  };
}
const LOCKED_DOCX = "Zmluva_o_dielo_v2.docx";

test("zamknutý súbor sa preskočí a nahlási, ostatné sa usporiadajú", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const locked = Object.keys(TRIAGE_FIXTURE).find(path => path.endsWith(".docx"));
  if (!locked) throw new Error("Fixture needs a .docx document.");
  const hooks = {
    open: (async (path: Parameters<typeof open>[0], flags?: string | number) => {
      if (String(path).endsWith(locked)) throw Object.assign(new Error("busy"), { code: "EBUSY" });
      return open(path, flags);
    }) as typeof open,
  };
  const inventory = await scanTriage(root, { hooks, ...HOST });
  expect(inventory.skipped).toContainEqual({ path: locked, reason: "locked" });
  expect(inventory.documents.some(document => document.path === locked)).toBe(false);
});

test("súbor zamknutý aj pri zápise nezablokuje zápis a nepresunie sa", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const before = await readFile(join(root, LOCKED_DOCX));
  const hooks = lockHooks(LOCKED_DOCX);
  const inventory = await scanTriage(root, { hooks, ...HOST });
  const plan = replanTriage(inventory, undefined, [], NOW);
  expect(plan.moves.length).toBeGreaterThan(0);
  expect(plan.moves.some(move => move.from === LOCKED_DOCX)).toBe(false);
  const applied = await applyTriagePlan(plan, { hooks, ...HOST });
  expect(applied).toMatchObject({ status: "applied", moved: plan.moves.length });
  expect(Buffer.compare(await readFile(join(root, LOCKED_DOCX)), before)).toBe(0);
  for (const move of plan.moves) expect((await readFile(join(root, move.to))).length).toBeGreaterThan(0);
});

test("súbor zamknutý pri náhľade a odomknutý pri zápise vyžiada nový náhľad", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const inventory = await scanTriage(root, { hooks: lockHooks(LOCKED_DOCX), ...HOST });
  const plan = replanTriage(inventory, undefined, [], NOW);
  await expect(applyTriagePlan(plan, HOST)).rejects.toBeInstanceOf(TriageConflictError);
});

test("zamknutý súbor spolu s iným problémom inšpekcie stále zastaví náhľad", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  await symlink(join(root, LOCKED_DOCX), join(root, "odkaz.docx"));
  await expect(scanTriage(root, { hooks: lockHooks(LOCKED_DOCX), ...HOST })).rejects.toThrow(/symbolick|nepodarilo prečítať/);
});

/**
 * Word na Windows: dokument sa dá otvoriť na čítanie, nie na zápis ani zmazanie. Sonda zápisu
 * (na win32 open s O_RDWR) sa simuluje chybou `code` len pre súbory z `locked`; čítanie ide ďalej.
 */
function wordHooks(locked: readonly string[], code = "EBUSY") {
  return { writeProbe: async (path: string) => { if (locked.some(name => path.endsWith(name))) throw Object.assign(new Error("locked for write"), { code }); } };
}

test("dokument otvorený vo Worde (čítanie áno, zápis nie) sa v náhľade preskočí ako locked", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const inventory = await scanTriage(root, { hooks: wordHooks([LOCKED_DOCX]), ...HOST });
  expect(inventory.skipped).toContainEqual({ path: LOCKED_DOCX, reason: "locked" });
  expect(inventory.documents.some(document => document.path === LOCKED_DOCX)).toBe(false);
  const plan = replanTriage(inventory, undefined, [], NOW);
  expect(plan.moves.length).toBeGreaterThan(0);
  expect(plan.moves.some(move => move.from === LOCKED_DOCX)).toBe(false);
  expect(await applyTriagePlan(plan, { hooks: wordHooks([LOCKED_DOCX]), ...HOST })).toMatchObject({ status: "applied", moved: plan.moves.length });
  await expect(readFile(join(root, LOCKED_DOCX))).resolves.toBeDefined();
});

test("dokument otvorený vo Worde až po náhľade zastaví zápis pred prvým presunom", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(plan.moves.some(move => move.from === LOCKED_DOCX)).toBe(true);
  const before = await documentsHash(root);
  const error = await applyTriagePlan(plan, { hooks: wordHooks([LOCKED_DOCX]), ...HOST }).then(() => undefined, (reason: unknown) => reason);
  expect(error).toBeInstanceOf(TriageConflictError);
  expect(error instanceof Error ? error.message : "").toContain(LOCKED_DOCX);
  expect(error instanceof Error ? error.message : "").toContain("nový náhľad");
  expect(await documentsHash(root)).toBe(before);
  await expect(readdir(join(root, ".lawoss/triage/runs", plan.runId))).resolves.not.toContain("plan.json");
});

test("súbor len na čítanie nie je zamknutý, zamietnutý zápis do zapisovateľného áno", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const readOnly = Object.keys(TRIAGE_FIXTURE).find(path => !path.includes("/") && path !== LOCKED_DOCX && !path.endsWith(".md"));
  if (!readOnly) throw new Error("Fixture needs a second top-level document.");
  await chmod(join(root, readOnly), 0o444);
  try {
    const inventory = await scanTriage(root, { hooks: wordHooks([readOnly, LOCKED_DOCX], "EPERM"), ...HOST });
    expect(inventory.documents.some(document => document.path === readOnly)).toBe(true);
    expect(inventory.skipped).toContainEqual({ path: LOCKED_DOCX, reason: "locked" });
  } finally { await chmod(join(root, readOnly), 0o644); }
});

// Skutočný zámok Windows ako Word: ostatní smú čítať (`Read`), zapisovať ani mazať nie.
test.skipIf(process.platform !== "win32")("Windows: dokument otvorený vo Worde sa preskočí v náhľade a nový zámok zastaví zápis", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  let release = await holdWindowsFileLock(join(root, LOCKED_DOCX), "Read");
  try {
    const inventory = await scanTriage(root, HOST);
    expect(inventory.skipped).toContainEqual({ path: LOCKED_DOCX, reason: "locked" });
    expect(inventory.documents.some(document => document.path === LOCKED_DOCX)).toBe(false);
  } finally { await release(); }
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(plan.moves.some(move => move.from === LOCKED_DOCX)).toBe(true);
  const before = await documentsHash(root);
  release = await holdWindowsFileLock(join(root, LOCKED_DOCX), "Read");
  try {
    await expect(applyTriagePlan(plan, HOST)).rejects.toThrow(/nový náhľad/);
  } finally { await release(); }
  expect(await documentsHash(root)).toBe(before);
}, 60_000);

test("vrátenie s keepChanged ponechá upravený dokument a ostatné vráti", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(plan.moves.length).toBeGreaterThan(1);
  await applyTriagePlan(plan, HOST);
  const changed = plan.moves[0]!;
  await writeFile(join(root, changed.to), "advokát to medzitým upravil");
  await expect(undoTriage(root, plan.runId, { keepChanged: false, ...HOST })).rejects.toThrow(/zmenených/);
  const result = await undoTriage(root, plan.runId, { keepChanged: true, ...HOST });
  expect(result).toMatchObject({ status: "undone", restored: plan.moves.length - 1 });
  expect(result.kept).toContain(changed.to);
  expect(await readFile(join(root, changed.to), "utf8")).toBe("advokát to medzitým upravil");
  for (const move of plan.moves.slice(1)) await expect(readFile(join(root, move.from))).resolves.toBeDefined();
});

test("bez keepChanged ostáva vrátenie všetko alebo nič a nič nezmení", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  await applyTriagePlan(plan, HOST);
  await writeFile(join(root, plan.moves[0]!.to), "zmena");
  const before = await documentsHash(root);
  await expect(undoTriage(root, plan.runId, { keepChanged: false, ...HOST })).rejects.toThrow();
  expect(await documentsHash(root)).toBe(before);
});

/** Prvý priečinok, ktorý beh vytvoril (karta veci). */
async function runCreatedDirectory(plan: { create: { kind: string; path: string }[] }): Promise<string> {
  const created = plan.create.find(operation => operation.kind === "directory");
  if (!created) throw new Error("Plan should create a directory.");
  return created.path;
}

test("Finder: .DS_Store vo vytvorenom priečinku nebráni vráteniu", async () => {
  const root = await convertedClient();
  const before = await documentsHash(root);
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  await applyTriagePlan(plan, HOST);
  await writeFile(join(root, await runCreatedDirectory(plan), ".DS_Store"), "x");
  const undone = await undoTriage(root, plan.runId, { keepChanged: false, ...HOST });
  expect(undone.status).toBe("undone");
  expect(await documentsHash(root)).toBe(before);
  await expect(readdir(join(root, await runCreatedDirectory(plan)))).rejects.toThrow();
});

test("Finder: s keepChanged sa priečinok s .DS_Store odstráni a nie je v kept", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  await applyTriagePlan(plan, HOST);
  const dir = await runCreatedDirectory(plan);
  await writeFile(join(root, dir, ".DS_Store"), "x");
  const result = await undoTriage(root, plan.runId, { keepChanged: true, ...HOST });
  expect(result.kept).not.toContain(dir);
  await expect(readdir(join(root, dir))).rejects.toThrow();
});

test("kept ukazuje na dokument, ktorý ostal na novom mieste, nie na nový súbor na starom", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  await applyTriagePlan(plan, HOST);
  const move = plan.moves[0]!;
  await writeFile(join(root, move.from), "nový súbor na starom mieste");
  const result = await undoTriage(root, plan.runId, { keepChanged: true, ...HOST });
  expect(result.kept).toContain(move.to);
  expect(result.kept).not.toContain(move.from);
  await expect(readFile(join(root, move.to))).resolves.toBeDefined();
  expect(await readFile(join(root, move.from), "utf8")).toBe("nový súbor na starom mieste");
});

test("súhlas nahradí značku patriacu inému priečinku (premenovaný klient)", async () => {
  const root = await convertedClient();
  await mkdir(join(root, ".lawoss"), { recursive: true });
  await writeFile(join(root, IN_PLACE_MARKER), JSON.stringify({ version: 1, root: "/stary/nazov", grantedAt: NOW.toISOString() }));
  await expect(verifyTriageTarget(root, undefined, HOST)).rejects.toThrow(/súhlas/);
  await grantInPlaceReorganize(root, NOW);
  expect(await verifyTriageTarget(root, undefined, HOST)).toEqual({ root, mode: "in_place", journalVerified: false });
  expect((await readdir(join(root, ".lawoss"))).filter(name => name !== "reorganize.json")).toEqual([]);
});

test("súhlas nahradí poškodenú značku", async () => {
  const root = await convertedClient();
  await mkdir(join(root, ".lawoss"), { recursive: true });
  await writeFile(join(root, IN_PLACE_MARKER), "{ nie json");
  await grantInPlaceReorganize(root, NOW);
  expect(await verifyTriageTarget(root, undefined, HOST)).toEqual({ root, mode: "in_place", journalVerified: false });
});

test("vrátenie na mieste bez voľby ponechá zmenený dokument", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW, ...HOST });
  expect(plan.moves.length).toBeGreaterThan(1);
  await applyTriagePlan(plan, HOST);
  const changed = plan.moves[0]!;
  await writeFile(join(root, changed.to), "advokát to medzitým upravil");
  const result = await undoTriage(root, plan.runId, HOST);
  expect(result.status).toBe("undone");
  expect(result.kept).toContain(changed.to);
  expect(await readFile(join(root, changed.to), "utf8")).toBe("advokát to medzitým upravil");
});

test("chyby pre priečinok na mieste nehovoria o klone", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  await symlink(join(root, LOCKED_DOCX), join(root, "odkaz.docx"));
  await expect(scanTriage(root, HOST)).rejects.toThrow(/^(?!.*Klon)/);
  await rm(join(root, "odkaz.docx"));
  await writeFile(join(root, IN_PLACE_MARKER), "x".repeat(70 * 1024));
  await expect(verifyTriageTarget(root, undefined, HOST)).rejects.toThrow(/Značka priečinka/);
});

test("súhlas nezapíše značku cez symbolický odkaz .lawoss mimo priečinka klienta (review VŘ k #137, bod 6)", async () => {
  const root = await convertedClient();
  const outside = await directory("okf-lawoss-outside-");
  await rm(join(root, ".lawoss"), { recursive: true, force: true });
  try { await symlink(outside, join(root, ".lawoss"), "junction"); }
  catch (error) { if (error && typeof error === "object" && "code" in error && ["EPERM", "EACCES", "ENOSYS"].includes(String(error.code))) return; throw error; }
  await expect(grantInPlaceReorganize(root, NOW)).rejects.toThrow(/symbolický odkaz/);
  expect(await readdir(outside)).toEqual([]);
});

/** Hláška pre advokáta, keď je klient na jedno usporiadanie priveľký (R7). */
const TOO_LARGE = { code: "triage_too_large", message: "Priečinok klienta je príliš veľký na usporiadanie naraz (viac ako 4 GB alebo 20 000 súborov). Zvoľte „Nie, nechaj ho tak, ako je“ alebo usporiadajte menší podpriečinok." };
const GiB = 1024 ** 3;
/** Riedky súbor danej veľkosti: na APFS a ext4 vznikne okamžite a na disku nezaberie miesto. */
async function sparseFile(path: string, size: number) { await writeFile(path, ""); await truncate(path, size); }

test("klient nad limitom usporiadania dostane zrozumiteľnú hlášku s kódom triage_too_large (R7)", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  await writeFile(join(root, "Velky podklad.pdf"), "x".repeat(1024));
  expect(TRIAGE_INSPECTION_LIMITS).toEqual({ maxBytes: 4 * GiB, maxEntries: 20_000 });
  await expect(scanTriage(root, { limits: { maxBytes: 10 }, ...HOST })).rejects.toMatchObject(TOO_LARGE);
  await expect(scanTriage(root, { limits: { maxBytes: 10 }, ...HOST })).rejects.toBeInstanceOf(TriageTooLargeError);
  await expect(scanTriage(root, { limits: { maxEntries: 1 }, ...HOST })).rejects.toMatchObject(TOO_LARGE);
});

test("zamknutý súbor pred prekročením limitu nezakryje hlášku o veľkosti (R7)", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  // `!` sa radí pred `.lawoss` aj pred dokumenty: zámok je prvý problém inšpekcie, limit až ďalší.
  await writeFile(join(root, "!otvoreny.docx"), "x");
  await expect(scanTriage(root, { hooks: lockHooks("!otvoreny.docx"), limits: { maxBytes: 10 }, ...HOST })).rejects.toMatchObject(TOO_LARGE);
});

test("zamknutý súbor sa aj s limitmi usporiadania preskočí ako locked (R7, Review Focus 4)", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  for (const hooks of [wordHooks([LOCKED_DOCX]), lockHooks(LOCKED_DOCX)]) {
    const inventory = await scanTriage(root, { hooks, ...HOST });
    expect(inventory.skipped).toContainEqual({ path: LOCKED_DOCX, reason: "locked" });
    expect(inventory.documents.some(document => document.path === LOCKED_DOCX)).toBe(false);
  }
});

// NTFS riedky súbor cez truncate nevytvorí (2 GiB by sa naozaj alokovali), preto len macOS a Linux.
test.skipIf(process.platform === "win32")("klient s 2 GB dokumentom sa usporiada s predvolenými limitmi, so starým limitom 1 GB nie (R7)", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  await sparseFile(join(root, "Sken spisu.pdf"), 2 * GiB);
  await expect(scanTriage(root, { limits: { maxBytes: GiB }, ...HOST })).rejects.toMatchObject(TOO_LARGE);
  const inventory = await scanTriage(root, HOST);
  expect(inventory.documents.find(document => document.path === "Sken spisu.pdf")?.size).toBe(2 * GiB);
  // Zápis znova prečíta celý strom; s pôvodným limitom 1 GB by hlásil „priečinok sa zmenil“.
  const plan = replanTriage(inventory, undefined, [], NOW);
  expect(await applyTriagePlan(plan, HOST)).toMatchObject({ status: "applied", moved: plan.moves.length });
}, 120_000);
