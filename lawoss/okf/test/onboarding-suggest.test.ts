import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRACTICE_MIN_CLIENTS, suggestOnboardingLevel, surveyFolder } from "../src/onboarding/suggest.ts";
import { CZ_LEGAL_FORMS, SK_LEGAL_FORMS, hasLegalForm, looksLikeMatterName } from "../src/onboarding/suggest-patterns.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
/** Strom zo zoznamu ciest; cesta končiaca „/“ je priečinok, inak prázdny súbor. */
async function tree(paths: string[], name = "okf-suggest-"): Promise<string> {
  const root = await realpath(await mkdtemp(join(tmpdir(), name)));
  roots.push(root);
  for (const path of paths) {
    if (path.endsWith("/")) await mkdir(join(root, path), { recursive: true });
    else { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), path.endsWith(".md") ? "---\ntype: client\ntitle: X\n---\n" : "x"); }
  }
  return root;
}

test("SK právne formy sa rozpoznajú, obyčajné slová nie", () => {
  for (const name of ["Alfa s. r. o.", "Beta s.r.o.", "Gama, a. s.", "Delta k. s.", "Epsilon v. o. s.", "Lesy SR, š. p.", "Zeta j. s. a."]) expect(SK_LEGAL_FORMS.some(form => form.test(name))).toBe(true);
  for (const name of ["Novák Ján", "Asistent", "Kasa", "Zmluvy"]) expect(hasLegalForm(name)).toBe(false);
});
test("CZ právne formy sa rozpoznajú oddelene", () => {
  for (const name of ["Alfa spol. s r.o.", "Beta s.r.o.", "Gama, a.s.", "Spolek přátel, z.s.", "Nadace, o.p.s.", "Ústav, z.ú."]) expect(CZ_LEGAL_FORMS.some(form => form.test(name))).toBe(true);
  expect(SK_LEGAL_FORMS.some(form => form.test("Spolek přátel, z.s."))).toBe(false);
});
test("názov veci: dátum na začiatku alebo spisová značka", () => {
  for (const name of ["2024-03 Kúpna zmluva", "2024 Spor o náhradu", "2025_11 Due diligence", "12C 34/2024 žaloba", "23 Cdo 1234/2023"]) expect(looksLikeMatterName(name)).toBe(true);
  for (const name of ["Zmluvy", "Pošta", "1999 dôvodov", "Faktúry"]) expect(looksLikeMatterName(name)).toBe(false);
});

test("označený klient, vec a kancelária majú prednosť pred heuristikou", async () => {
  expect(await suggestOnboardingLevel(await tree(["client.md", "Zmluvy/"]))).toMatchObject({ level: "client", marked: true, score: 1, signals: ["client_card"] });
  expect(await suggestOnboardingLevel(await tree(["spis.md"]))).toMatchObject({ level: "matter", marked: true });
  const office = await tree(["Office/okf.config", "Klienti/Alfa s. r. o./", "Klienti/Beta a. s./"]);
  await writeFile(join(office, "Office/okf.config"), 'version: 1\nclient_path: "Klienti/*"\n');
  const suggestion = await suggestOnboardingLevel(office);
  expect(suggestion).toMatchObject({ level: "practice", marked: true, clientPattern: "Klienti/*" });
  expect(suggestion.clients.map(client => client.path)).toEqual(["Klienti/Alfa s. r. o.", "Klienti/Beta a. s."]);
});

test("neoznačená SK prax s právnymi formami je prax so zoznamom klientov", async () => {
  const root = await tree(["Alfa s. r. o./2024-01 Zmluva/", "Beta a. s./", "Gama s.r.o./", "Novák Ján/2023-05 Rozvod/", "Delta k. s./", "Archív/"]);
  const suggestion = await suggestOnboardingLevel(root);
  expect(suggestion.level).toBe("practice");
  expect(suggestion.marked).toBe(false);
  expect(suggestion.clientPattern).toBe("*");
  expect(suggestion.clients.map(client => client.name)).toEqual(["Alfa s. r. o.", "Archív", "Beta a. s.", "Delta k. s.", "Gama s.r.o.", "Novák Ján"]);
  expect(suggestion.score).toBeGreaterThanOrEqual(0.5);
  expect(suggestion.signals).toContain("legal_form_children");
});

test("neoznačená CZ prax s klientmi podľa písmen (AK/písmeno/klient)", async () => {
  const paths = ["A/Alfa s.r.o./2024-02 Smlouva/", "B/Beta a.s./", "C/Česká, z.s./", "D/Dvořák Petr/2023 Spor/", "E/Echo spol. s r.o./", "F/Fiala Jan/2025-01 Dědictví/"];
  const suggestion = await suggestOnboardingLevel(await tree(paths));
  expect(suggestion).toMatchObject({ level: "practice", clientPattern: "*/*" });
  expect(suggestion.signals).toContain("letter_buckets");
  expect(suggestion.clients.map(client => client.path)).toContain("D/Dvořák Petr");
});

test("klient s právnou formou a menej ako piatimi podpriečinkami nie je prax", async () => {
  const root = await tree(["Alfa s. r. o./", "Beta a. s./", "Gama s.r.o./", "Delta k. s./"]);
  expect((await suggestOnboardingLevel(root)).level).not.toBe("practice");
  expect(PRACTICE_MIN_CLIENTS).toBe(5);
});

test("klient: podpriečinky pomenované ako veci", async () => {
  expect(await suggestOnboardingLevel(await tree(["2024-03 Kúpna zmluva/zmluva.docx", "2025-01 Spor/žaloba.pdf", "Faktúry/"]))).toMatchObject({ level: "client", marked: false, score: 0.8, signals: ["matter_named_children"] });
});
test("vec: len dokumenty, alebo koreň pomenovaný ako vec", async () => {
  expect(await suggestOnboardingLevel(await tree(["zmluva.docx", "plná moc.pdf"]))).toMatchObject({ level: "matter", score: 0.5, signals: ["documents_only"] });
  expect(await suggestOnboardingLevel(await tree(["Podklady/a.pdf"], "2024-03 Kúpna zmluva-"))).toMatchObject({ level: "matter", score: 0.8, signals: ["matter_named_root"] });
});
test("prázdny priečinok je neznámy; skryté priečinky sa ignorujú", async () => {
  expect(await suggestOnboardingLevel(await tree([".git/", ".DS_Store"]))).toMatchObject({ level: "unknown", score: 0, signals: ["empty"] });
});
test("prieskum nečíta obsah a pri limite vráti neúplný výsledok", async () => {
  const root = await tree(Array.from({ length: 30 }, (_, i) => `Klient ${i} s. r. o./2024-0${(i % 9) + 1} Vec/`));
  const survey = await surveyFolder(root, { maxEntries: 10 });
  expect(survey.complete).toBe(false);
  expect(survey.entries.length).toBe(10);
  const full = await suggestOnboardingLevel(root);
  expect(full).toMatchObject({ level: "practice", complete: true });
  expect(full.clients.length).toBe(30);
});
test("cesta musí byť existujúci kanonický priečinok", async () => {
  await expect(suggestOnboardingLevel("relative/path")).rejects.toThrow();
});
