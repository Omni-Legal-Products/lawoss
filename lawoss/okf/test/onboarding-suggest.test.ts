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
test("holý rok alebo dátum nie je názov veci (archív podľa rokov)", () => {
  for (const name of ["2021", "2024-01", "2024_03", "2024-01-15", "2024.01.15"]) expect(looksLikeMatterName(name)).toBe(false);
  for (const name of ["2024-01 návrh", "2024-01-15 Zmluva", "2021 Spor"]) expect(looksLikeMatterName(name)).toBe(true);
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
// Jeden klient je typický prípad (spec P4); veci pomenované s firmou protistrany z neho prax nerobia.
test("SK klient s vecami pomenovanými aj s právnou formou protistrany je klient, nie prax", async () => {
  const root = await tree(["2024-01 Spor s Alfa s.r.o./žaloba.pdf", "2024-03 Kúpna zmluva Beta a. s./", "2023-11 Nájom kancelárie/", "2025-02 Due diligence Gama s. r. o./", "2022-06 Exekúcia Delta k. s./", "Faktúry/"]);
  expect(await suggestOnboardingLevel(root)).toMatchObject({ level: "client", marked: false, signals: ["matter_named_children"] });
});
test("CZ klient s věcmi pojmenovanými i s právní formou protistrany je klient, ne praxe", async () => {
  const root = await tree(["2024-01 Spor s Alfa s.r.o./žaloba.pdf", "2024-02 Smlouva o dílo Beta spol. s r.o./", "2023-09 Exekuce Gama a.s./", "2025-01 Vymáhání Spolek přátel, z.s./", "2024-05 Nájem Echo k.s./", "Faktury/"]);
  expect(await suggestOnboardingLevel(root)).toMatchObject({ level: "client", marked: false, signals: ["matter_named_children"] });
});
test("SK klient s datovanými podpriečinkami vecí nie je istá prax", async () => {
  const root = await tree(["Kúpna zmluva/2024-01 návrh/", "Nájomná zmluva/2024-02 návrh/", "Spor s Beta/2024-03 žaloba/", "Due diligence/2024-04 správa/", "Pracovné zmluvy/2025-01 návrh/"]);
  const suggestion = await suggestOnboardingLevel(root);
  // Od 13. 10. (slová veci) prevažujú mená vecí, takže návrh je rovno klient, nie slabá prax.
  expect(suggestion.level).toBe("client");
  expect(suggestion.signals).toEqual(["matter_named_children"]);
});
test("CZ klient s datovanými podsložkami věcí není jistá praxe", async () => {
  const root = await tree(["Kupní smlouva/2024-01 návrh/", "Nájemní smlouva/2024-02 návrh/", "Spor s Beta/2024-03 žaloba/", "Due diligence/2024-04 zpráva/", "Pracovní smlouvy/2025-01 návrh/"]);
  const suggestion = await suggestOnboardingLevel(root);
  // Od 13. 10. (slová veci) prevažujú mená vecí, takže návrh je rovno klient, nie slabá prax.
  expect(suggestion.level).toBe("client");
  expect(suggestion.signals).toEqual(["matter_named_children"]);
});
test("archív podľa rokov nie je prax s rokmi ako klientmi", async () => {
  const root = await tree(["2021/2021-03 Spor Alfa/", "2022/2022-05 Zmluva/", "2023/x.pdf", "2024/2024-01 Nájom/", "2025/2025-02 Exekúcia/"]);
  const suggestion = await suggestOnboardingLevel(root);
  expect(suggestion.level).not.toBe("practice");
  expect(suggestion.clients).toEqual([]);
});
test("vec: len dokumenty", async () => {
  expect(await suggestOnboardingLevel(await tree(["zmluva.docx", "plná moc.pdf"]))).toMatchObject({ level: "matter", score: 0.5, signals: ["documents_only"] });
});
test("vec: názov koreňa v natívnej ceste, nie názov jeho predka", async () => {
  // join/realpath deliberately retain native Windows separators on Windows CI.
  const root = await tree(["Podklady/a.pdf"], "2024-03 Kúpna zmluva-");
  expect(await suggestOnboardingLevel(root)).toMatchObject({ level: "matter", score: 0.8, signals: ["matter_named_root"] });
  const client = join(root, "Klient");
  await mkdir(join(client, "Podklady"), { recursive: true });
  expect(await suggestOnboardingLevel(client)).toMatchObject({ level: "client", score: 0.5, signals: ["plain_directories"] });
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
test("praxe s 300 klientmi sa vyhodnotí pod 2 sekundy", async () => {
  const root = await tree(Array.from({ length: 300 }, (_, i) => `Klient ${i} s. r. o./2024-01 Vec/`));
  const started = performance.now();
  const suggestion = await suggestOnboardingLevel(root);
  const elapsed = performance.now() - started;
  expect(suggestion.level).toBe("practice");
  expect(suggestion.clients.length).toBe(300);
  expect(elapsed).toBeLessThan(2000);
});
test("cesta musí byť existujúci kanonický priečinok", async () => {
  await expect(suggestOnboardingLevel("relative/path")).rejects.toThrow();
});

test("okf.config v UTF-16LE s BOM a client_path v apostrofoch", async () => {
  const office = await tree(["Office/okf.config", "AK/Alfa s. r. o./", "AK/Beta a. s./"]);
  await writeFile(join(office, "Office/okf.config"), Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('version: 1\r\nclient_path: "AK/*/*"\r\n', "utf16le")]));
  expect((await suggestOnboardingLevel(office)).clientPattern).toBe("AK/*/*");
  await writeFile(join(office, "Office/okf.config"), "version: 1\nclient_path: 'AK/*'\n");
  expect((await suggestOnboardingLevel(office)).clientPattern).toBe("AK/*");
});

test("SK klient s nedatovanými vecami pomenovanými podľa protistrany je klient, nie prax (MČ 13. 10., možnosť B)", async () => {
  const root = await tree(["Spor s Alfa s.r.o./", "Nájom Beta k.s./", "Žaloba Gama a.s./", "Kúpa Delta s.r.o./", "Exekúcia Omega s.r.o./"]);
  const suggestion = await suggestOnboardingLevel(root);
  expect(suggestion.level).toBe("client");
  expect(suggestion.clients).toEqual([]);
});
test("CZ klient s nedatovanými věcmi pojmenovanými podle protistrany je klient, ne praxe", async () => {
  const root = await tree(["Spor s Alfa s.r.o./", "Nájem Beta k.s./", "Žaloba Gama a.s./", "Koupě Delta s.r.o./", "Exekuce Omega s.r.o./"]);
  expect((await suggestOnboardingLevel(root)).level).toBe("client");
});
test("slovo veci musí stáť samostatne na začiatku; klient s podobným menom ostáva klientom", () => {
  for (const name of ["Spor s Alfa s.r.o.", "Nájom Beta k.s.", "Kúpna zmluva Delta", "Řízení Gama a.s.", "Věc Omega", "NÁVRH na vklad", "Výpoveď Beta"]) expect(looksLikeMatterName(name)).toBe(true);
  for (const name of ["Nájomné domy s.r.o.", "Sporiteľňa a.s.", "Alfa s.r.o.", "Novák Ján", "Kúpeľe Piešťany a.s."]) expect(looksLikeMatterName(name)).toBe(false);
  expect(looksLikeMatterName("Spor s Alfa".normalize("NFD"))).toBe(true);
  expect(looksLikeMatterName("Žaloba Beta".normalize("NFD"))).toBe(true);
  // Bez diakritiky (sken, e-mail, starý systém): test 16. 10. 2026, N2.
  for (const name of ["Kupa haly Senec", "Zaloba o zaplaceni", "Najom Beta k.s.", "Rizeni Gama a.s.", "VYPOVED Beta"]) expect(looksLikeMatterName(name)).toBe(true);
  for (const name of ["Najomne domy s.r.o.", "Sporitelna a.s.", "Kupele Piestany a.s.", "Novak Jan"]) expect(looksLikeMatterName(name)).toBe(false);
});
test("prax s klientmi s právnou formou ostáva praxou aj vedľa priečinka veci", async () => {
  const root = await tree(["Alfa s.r.o./", "Beta a.s./", "Gama k.s./", "Delta s.r.o./", "Epsilon s.r.o./", "Spor s Omega s.r.o./"]);
  expect((await suggestOnboardingLevel(root)).level).toBe("practice");
});
