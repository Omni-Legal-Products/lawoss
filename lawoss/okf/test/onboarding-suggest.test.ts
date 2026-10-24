import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PRACTICE_MIN_CLIENTS, suggestOnboardingLevel, surveyFolder } from "../src/onboarding/suggest.ts";
import { CZ_LEGAL_FORMS, SK_LEGAL_FORMS, codeOf, hasLegalForm, looksLikeMatterFolder, looksLikeMatterName } from "../src/onboarding/suggest-patterns.ts";

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
test("kódovaná prax ostane praxou aj s novým klientom bez prípadu a s prípadmi pod Spisy/ (review #221)", async () => {
  const unit = (suggestion: Awaited<ReturnType<typeof suggestOnboardingLevel>>, path: string) => suggestion.units.find(entry => entry.path === path);
  const fresh = await suggestOnboardingLevel(await tree(["C002 Hron/M004 Najem/a.pdf", "C017 Simkova/M049 Reklamacia/b.pdf", "C022 Novy klient/zmluva.pdf"]));
  expect(fresh).toMatchObject({ level: "practice" });
  expect(fresh.signals).toContain("coded_hierarchy");
  expect(fresh.clients.map(client => client.path)).toEqual(["C002 Hron", "C017 Simkova", "C022 Novy klient"]);
  // Klienti praxe nie sú prípadmi jej koreňa, hoci ich kód vyzerá ako kód veci.
  expect(unit(fresh, "")?.matters).toEqual([]);
  expect(unit(fresh, "C002 Hron")?.matters.map(matter => matter.path)).toEqual(["M004 Najem"]);
  const filed = await suggestOnboardingLevel(await tree(["C001 Alfa/Spisy/M001 Uhrada/a.pdf", "C002 Beta/Spisy/M002 Najem/b.pdf", "C003 Gama/Spisy/M003 Kupa/c.pdf"]));
  expect(filed).toMatchObject({ level: "practice" });
  expect(filed.signals).toContain("coded_hierarchy");
  expect(unit(filed, "")?.matters).toEqual([]);
  expect(unit(filed, "C003 Gama")?.matters.map(matter => matter.path)).toEqual(["Spisy/M003 Kupa"]);
  // Jeden kódovaný klient s prípadom nestačí: dvaja noví klienti bez prípadov ostávajú na rozhodnutí advokáta.
  const single = await suggestOnboardingLevel(await tree(["C002 Hron/M004 Najem/a.pdf", "C017 Novy/zmluva.pdf", "C022 Novy/zmluva.pdf"]));
  expect(single.signals).not.toContain("coded_hierarchy");
  // Rovnaký prefix pod kódovaným kandidátom vylúči prax aj vedľa kandidátov s iným prefixom.
  const mixed = await suggestOnboardingLevel(await tree(["C001 Alfa/M001 x/", "C002 Beta/M002 y/", "C003 Gama/C030 podklady/"]));
  expect(mixed.signals).not.toContain("coded_hierarchy");
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
    // Review #221: jeden klient s vecami M001–M005, len dve majú kódované podpriečinky.
    ["M001 Novak/F001 Faktura/", "M002 Horvath/F002 Faktura/", "M003 Kral/", "M004 Bielik/", "M005 Urban/"],
    // Review A4, I-1: jeden klient s číslovanými vecami a sekciami, roky, fiškálne roky, fotky.
    ["M001 Spor/D01 Podania/", "M002 Zmluva/D02 Drafty/", "M003 Exekúcia/D01 x/"],
    ["M001 Spor/D001 Podania/", "M002 Zmluva/D002 Drafty/", "M003 Exekúcia/D001 x/"],
    ["SP-2023-01 Novák/K-01 Korešpondencia/", "SP-2023-02 Hraško/K-02 Podania/"],
    ["FY2023/Q01 Faktúry/", "FY2024/Q02 Faktúry/"],
    ["IMG_2023 Leto/DSC 001 Pláž/", "IMG_2024 Zima/DSC 002 Hory/"],
    ["2023/A001 x/", "2024/A002 y/"],
    ["IMG_0001 Leto/DSC_0002 Pláž/", "IMG_0003 Zima/DSC_0004 Hory/"],
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
  // Holý Office s dokumentmi nie je „len dokumenty“ (prípad), rozhodnutie ostáva na advokátovi.
  expect(await suggestOnboardingLevel(await tree(["Office/", "zmluva.docx"]))).toMatchObject({ level: "client", signals: ["plain_directories"], practiceCandidates: [] });
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

test("náhľad stromu: prípady a počty súborov z prieskumu, kancelária aj jeden klient (C1)", async () => {
  const office = await tree([
    "Office/AGENTS.md",
    "Klienti/C001-syn-tatran/client.md",
    "Klienti/C001-syn-tatran/Spisy/M001-uhrada/",
    "Klienti/C001-syn-tatran/Spisy/M003-spolocnik/",
    "Klienti/C002-syn-hron/client.md",
    "Klienti/C002-syn-hron/01_Podklady/zmluva.pdf",
  ]);
  const suggestion = await suggestOnboardingLevel(office);
  const unit = (path: string) => suggestion.units.find(item => item.path === path);
  expect(unit("Klienti/C001-syn-tatran")).toMatchObject({ matters: [{ path: "Spisy/M001-uhrada", name: "M001-uhrada" }, { path: "Spisy/M003-spolocnik", name: "M003-spolocnik" }], matterCount: 2, files: 1 });
  // Hĺbka prieskumu (4) končí pri prípadoch: počet súborov pod nimi je len dolná hranica.
  expect(unit("Klienti/C001-syn-tatran")?.exact).toBe(false);
  expect(unit("Klienti/C002-syn-hron")).toMatchObject({ matters: [], matterCount: 0, files: 2, exact: true });

  // Jeden klient bez Spisy/: prípady podľa kódu, karty alebo mena veci; pracovné priečinky nie.
  const client = await tree(["M004 Vyúčtovanie/a.pdf", "Zmluva/matter.md", "2024-03 Kúpna zmluva/", "01_Podklady/b.pdf", "Pošta/"]);
  const root = (await suggestOnboardingLevel(client)).units.find(item => item.path === "");
  expect(root?.matters.map(matter => matter.name).sort()).toEqual(["2024-03 Kúpna zmluva", "M004 Vyúčtovanie", "Zmluva"]);
  expect(root).toMatchObject({ files: 3, exact: true });
});

test("náhľad stromu: prázdny Spisy/ z pomocných súborov neskryje prípady vedľa neho (N-A2-3)", async () => {
  const practice = await tree([
    "AGENTS.md",
    "C002 SYN Hron/client.md",
    "C002 SYN Hron/Spisy/.keep",
    "C002 SYN Hron/01_Podklady/.keep",
    "C002 SYN Hron/M004 Vyúčtovanie nájmu/a.pdf",
    "C002 SYN Hron/M005 Neakceptovaný modul/b.pdf",
    "C017 SYN Šimková/client.md",
    "C017 SYN Šimková/Spisy/M049 Reklamácia/c.pdf",
    "C017 SYN Šimková/M050 Výpoveď/d.pdf",
  ]);
  const suggestion = await suggestOnboardingLevel(practice);
  const unit = (path: string) => suggestion.units.find(item => item.path === path);
  expect(unit("C002 SYN Hron")?.matters.map(matter => matter.path).sort()).toEqual(["M004 Vyúčtovanie nájmu", "M005 Neakceptovaný modul"]);
  expect(unit("C002 SYN Hron")?.matterCount).toBe(2);
  // Spisy/ a prípady vedľa neho spolu, pracovné priečinky ani samotný Spisy/ nie.
  expect(unit("C017 SYN Šimková")?.matters.map(matter => matter.path).sort()).toEqual(["M050 Výpoveď", "Spisy/M049 Reklamácia"]);
});

test("#223: interný kód aj v NFD (Č001) a bez falošných pozitív bežných skratiek", () => {
  expect(codeOf("Č001 Spor")).toEqual({ prefix: "Č", rest: "Spor" });
  expect(codeOf("Č001 Spor".normalize("NFD"))).toEqual({ prefix: "Č", rest: "Spor" });
  for (const name of ["ISO 27001 certifikácia", "EUR 500 záloha", "OSŘ 160", "OSŘ 160".normalize("NFD"), "HR 001", "STN 730540", "DPH 2025 priznanie", "ZOK 120"]) {
    expect(codeOf(name)).toBeUndefined();
    expect(looksLikeMatterFolder(name)).toBe(false);
  }
  // Skutočné kódy klienta a veci ostávajú.
  for (const name of ["C001 SYN Alfa", "M004 Vyúčtovanie", "C001-syn-tatran", "SYN-0049 Reklamácia"]) expect(codeOf(name)).toBeDefined();
});
test("#223: priečinok prípadov v NFD (Případy z macOS/SMB) a kódy v NFD sa rozpoznajú ako v NFC", async () => {
  for (const form of ["NFC", "NFD"] as const) {
    const root = await tree([`Klient/${"Případy".normalize(form)}/X/a.pdf`, `Klient/${"Č001 Spor".normalize(form)}/b.pdf`, "Klient/01_Podklady/c.pdf"], `okf-suggest-${form}-`);
    const matters = (await suggestOnboardingLevel(join(root, "Klient"))).units.find(entry => entry.path === "")?.matters ?? [];
    expect(matters.map(matter => matter.path.normalize("NFC")).sort()).toEqual(["Případy/X", "Č001 Spor"].sort());
    expect(matters.map(matter => matter.name).sort()).toEqual(["X", "Č001 Spor"].sort());
  }
});
test("#223: tematické podpriečinky so skratkou a vnorený klient s kartou nie sú prípady v náhľade", async () => {
  const root = await tree([
    "client.md", "M001 Spor/a.pdf", "ISO 27001 certifikácia/b.pdf", "EUR 500 záloha/c.pdf", "OSŘ 160/d.pdf", "HR 001/e.pdf",
    // N-A4-4: odmietnutý vnorený klient s kódom nie je prípad vonkajšieho klienta.
    "C099 SYN Vnoreny/client.md", "C099 SYN Vnoreny/M001 Cudzí/f.pdf",
  ]);
  const suggestion = await suggestOnboardingLevel(root);
  expect(suggestion.units.find(entry => entry.path === "")?.matters.map(matter => matter.path)).toEqual(["M001 Spor"]);
});
