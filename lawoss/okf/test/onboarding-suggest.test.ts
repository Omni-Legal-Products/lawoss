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

test("kancelária OKF v priamom podpriečinku sa ohlási (MČ 19. 10.: Neusporiadany-klient a Usporiadana-kancelaria vedľa seba)", async () => {
  const root = await tree(["Neusporiadany-klient/zmluva.docx", "Usporiadana-kancelaria/Klienti/", "Usporiadana-kancelaria/Office/okf.config", "Iná/_kancelaria/okf.config"]);
  const suggestion = await suggestOnboardingLevel(root);
  expect(suggestion).toMatchObject({ level: "client", signals: ["plain_directories"] });
  expect(suggestion.childOffices).toEqual(["Iná", "Usporiadana-kancelaria"]);
  // Bez kancelárie v podpriečinku pole nie je (staré tvary návrhu ostávajú rovnaké).
  expect(await suggestOnboardingLevel(await tree(["A/", "B/"]))).not.toHaveProperty("childOffices");
});

// N-9 (akceptácia 22. 10. 2026): malá prax s internými kódmi klientov a vecí (pieskovisko 3-neusporiadana-prax).
test("prax s tromi kódovanými klientmi (C0xx/M0xx) je prax so signálom coded_hierarchy", async () => {
  const root = await tree(["C002 SYN Hron Technológie, a. s./M004 Vyúčtovanie nájmu/doc.pdf", "C017 SYN Zuzana Šimková/M049 Reklamácia čerpadla/doc.pdf", "C022 SYN Michal Ľupták servis/M064 Odmena za služby/doc.pdf"]);
  const suggestion = await suggestOnboardingLevel(root);
  expect(suggestion).toMatchObject({ level: "practice", marked: false, clientPattern: "*", practicePattern: "*" });
  expect(suggestion.signals).toContain("coded_hierarchy");
  expect(suggestion.score).toBeGreaterThanOrEqual(0.8);
  expect(suggestion.clients.map(client => client.path)).toEqual(["C002 SYN Hron Technológie, a. s.", "C017 SYN Zuzana Šimková", "C022 SYN Michal Ľupták servis"]);
  expect(suggestion.practiceCandidates).toEqual(suggestion.clients);
});
test("kódovaná hierarchia: negatívne prípady ostávajú klientom", async () => {
  // Štyri právne formy bez podpriečinkov, tematické priečinky klienta, jeden klient s číslovanými vecami so súbormi, holý Office.
  for (const paths of [
    ["Alfa s. r. o./", "Beta a. s./", "Gama s.r.o./", "Delta k. s./"],
    ["Zmluvy/2024-01/zmluva.pdf", "Korešpondencia/2024-02/list.pdf"],
    ["M001 Spor/žaloba.pdf", "M002 Zmluva/zmluva.pdf", "M003 Nájom/nájom.pdf"],
    ["Office/", "Klienti/A/"],
    // Rovnaký prefix na oboch úrovniach nie je prax.
    ["C001 Alfa/C010 podklady/", "C002 Beta/C020 podklady/"],
  ]) {
    const suggestion = await suggestOnboardingLevel(await tree(paths));
    expect(suggestion.level).not.toBe("practice");
    expect(suggestion.signals).not.toContain("coded_hierarchy");
  }
});
test("každý návrh klienta alebo veci nesie kandidátov praxe pre ručnú voľbu (N-9)", async () => {
  const plain = await suggestOnboardingLevel(await tree(["A/", "B/"]));
  expect(plain).toMatchObject({ level: "client", signals: ["plain_directories"], clients: [], practicePattern: "*" });
  expect(plain.practiceCandidates.map(client => client.path)).toEqual(["A", "B"]);
  const matters = await suggestOnboardingLevel(await tree(["2024-03 Kúpna zmluva/zmluva.docx", "Faktúry/"]));
  expect(matters.level).toBe("client");
  expect(matters.practiceCandidates.map(client => client.path)).toEqual(["Faktúry"]);
  expect((await suggestOnboardingLevel(await tree(["zmluva.docx"]))).practiceCandidates).toEqual([]);
  // Priečinok kancelárie nie je kandidát na klienta; pri Klienti/ sa berú klienti z neho.
  const office = await suggestOnboardingLevel(await tree(["Office/", "Klienti/A/", "Klienti/B/", "Archív/"]));
  expect(office).toMatchObject({ practicePattern: "Klienti/*" });
  expect(office.practiceCandidates.map(client => client.path)).toEqual(["Klienti/A", "Klienti/B"]);
});

// N-14 (akceptácia 22. 10. 2026): kancelária OKF bez okf.config (dátová sada v1, pieskovisko 4-usporiadana-kancelaria).
test("kancelária bez okf.config (Office s obsahom OKF a Klienti s kartami) je prax so vzorom Klienti/*", async () => {
  const root = await tree(["Office/AGENTS.md", "Office/memory/x.md", "Klienti/A/client.md", "Klienti/B/client.md", "Klienti/C/"]);
  const suggestion = await suggestOnboardingLevel(root);
  expect(suggestion).toMatchObject({ level: "practice", marked: false, score: 0.9, signals: ["office_without_config"], clientPattern: "Klienti/*", practicePattern: "Klienti/*" });
  expect(suggestion.clients.map(client => client.path)).toEqual(["Klienti/A", "Klienti/B", "Klienti/C"]);
  // Kódované mená klientov (C001-syn-…) nesmú zvoliť inú vetvu.
  const coded = await suggestOnboardingLevel(await tree(["Office/CLAUDE.md", "Klienti/C001-syn-alfa-s-r-o/client.md", "Klienti/C001-syn-alfa-s-r-o/Spisy/M001-spor/matter.md", "Klienti/C002-syn-beta/klient.md"]));
  expect(coded.signals).toEqual(["office_without_config"]);
});
test("holý Office bez obsahu OKF alebo Klienti bez kariet nie je kancelária bez okf.config", async () => {
  for (const paths of [["Office/", "Klienti/A/client.md"], ["Office/AGENTS.md", "Klienti/A/", "Klienti/B/zmluva.pdf"]]) {
    expect((await suggestOnboardingLevel(await tree(paths))).signals).not.toContain("office_without_config");
  }
});
