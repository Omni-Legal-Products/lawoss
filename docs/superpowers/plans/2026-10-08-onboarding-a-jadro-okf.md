# Onboarding cez priečinok, plán A: jadro OKF

> **Pre agentných pracovníkov:** POVINNÝ SUB-SKILL: použi `superpowers:subagent-driven-development` (odporúčané) alebo `superpowers:executing-plans` a implementuj plán úloha po úlohe. Kroky používajú checkbox (`- [ ]`) syntax na sledovanie.

**Cieľ:** Jadro `lawoss/okf` vie navrhnúť, či je vybraný priečinok prax, klient alebo vec, vie z existujúcej praxe urobiť kanceláriu bez presunu súborov a vie priečinok klienta usporiadať na mieste s vrátením.

**Architektúra:**
- **Rozpoznanie** je nová funkcia `suggestOnboardingLevel` nad ľahkým prieskumom mien (`surveyFolder`). Nehashuje obsah, takže zvládne aj celú prax. Existujúca `inspectOnboardingRoot` a jej pole `level` sa nemenia, aby platila brána `convert`.
- **„Áno, usporiadaj“** nie je nový transakčný engine. Je to existujúce roztriedenie (`src/triage/`), ktoré dnes beží len v skúšobnom klone. Pribudne druhá povolená cesta: klient s výslovným súhlasom so zmenou na mieste (`.lawoss/reorganize.json`).
- **Prax** dostane kanceláriu novou požiadavkou `practice`. Tá vytvorí `Office/` a `AGENTS.md` na úrovni praxe a nič existujúce nepresunie.

**Tech stack:** TypeScript (strict, bez `any`), Bun 1.4.2. Testy jadra bežia cez `bun test test/` v `lawoss/okf` (nie `node --test`, to platí pre `okf-pamat`). Typy: `bun run typecheck`.

**Spec:** [lawOSS-like-SK-CZ `specs/2026-10-08-onboarding-pripojit-priecinok.md`](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/spec/onboarding-pripojit-priecinok/specs/2026-10-08-onboarding-pripojit-priecinok.md) (PR #92, schválil MČ 8. 10. 2026). Plán sa ním riadi; spec sa do forku nekopíruje.

**Poradie plánov:** A (tento) → C (server a tok v appke, stavia na A). B (AI bez priečinka) je nezávislý. D (vizuál) ide po C.

## Global Constraints

- Zelená zóna: všetky zmeny sú v `lawoss/okf/**`, bez riadku v `PATCHES.md`.
- OKF súbory sa zapisujú vždy lokálne do priečinka; `AGENTS.md` a `CLAUDE.md` majú zhodný obsah (spec P2).
- Nikdy sa nemaže ani neprepisuje existujúci súbor advokáta. Presun len v rámci toho istého priečinka (spec, režim `reorganize`).
- Návrh rozpoznania je vždy návrh s mierou istoty, nie rozhodnutie (spec P4).
- SK a CZ vzory (právne formy, spisové značky) sú v oddelených tabuľkách a majú oddelené testy (AGENTS.md: nikdy nepreklápať SK a CZ pojmy).
- Komentáre v kóde po slovensky, identifikátory po anglicky, commity po slovensky (`feat:`, `fix:`, `test:`).
- TypeScript bez `any` a bez `as`, okrem testovacích náhrad, ktoré už tak repo robí (`onboarding-classify.test.ts:158`).
- Režimy `map` a `trial_clone` ostávajú v jadre a v CLI (spec: odstránenie z kódu je samostatná zmena). Tento plán ich nemení.
- Po každej zmene v `src/` sa pred commitom pregeneruje `bundle/okf.js` (`bun run build`), lebo je v repozitári.

## Review Focus

- **Prax s tisíckami súborov alebo s neprístupným podpriečinkom:** prieskum sa nesmie zrútiť ani čítať obsah súborov. Po limite vráti neúplný, ale použiteľný návrh (`complete: false`). Test v úlohe 1.
- **Priečinok klienta s právnou formou v názve, ktorý má len 2 až 4 podpriečinky:** nesmie sa navrhnúť ako prax. Prah je 5 klientov a 50 %. Test v úlohe 1.
- **Existujúca prax, ktorá už má vlastný `AGENTS.md` v koreni:** plán kancelárie ho neprepíše ani k nemu nevytvorí rozdielny `CLAUDE.md`. Test v úlohe 2.
- **Usporiadanie na mieste bez súhlasu:** roztriedenie mimo skúšobného klona musí bez súhlasu `.lawoss/reorganize.json` naďalej odmietnuť. Test v úlohe 3.
- **Vrátenie po tom, čo advokát jeden presunutý dokument upravil:** ostatné sa vrátia, upravený ostane a nahlási sa. Bez voľby `keepChanged` sa správanie nemení (všetko alebo nič). Test v úlohe 5.

---

### Úloha 1: Návrh úrovne priečinka (prax, klient, vec)

**Files:**
- Create: `lawoss/okf/src/onboarding/suggest-patterns.ts`
- Create: `lawoss/okf/src/onboarding/suggest.ts`
- Test: `lawoss/okf/test/onboarding-suggest.test.ts`

**Interfaces:**
- Consumes: `findCaseNumber(text: string): CaseNumber | undefined` z `src/triage/rules.ts`; `VOLATILE_ENTRY` z `src/onboarding/classify.ts`; `realpath` z `src/canonical-path.ts`.
- Produces (plán C ich používa v serveri a UI):
  - `type SuggestedLevel = "practice" | "client" | "matter" | "unknown"`
  - `type SuggestionSignal = "office_config" | "client_card" | "matter_card" | "legal_form_children" | "matter_named_children" | "letter_buckets" | "matter_named_root" | "documents_only" | "plain_directories" | "empty"`
  - `type SuggestedClient = { path: string; name: string }` (`path` je relatívna ku koreňu)
  - `type OnboardingSuggestion = { root: string; level: SuggestedLevel; marked: boolean; score: number; signals: SuggestionSignal[]; clientPattern?: string; clients: SuggestedClient[]; complete: boolean }`
  - `suggestOnboardingLevel(root: string): Promise<OnboardingSuggestion>`
  - `surveyFolder(root: string, limits?: { maxDepth?: number; maxEntries?: number }): Promise<FolderSurvey>`
  - `PRACTICE_MIN_CLIENTS = 5`, `PRACTICE_MIN_RATIO = 0.5`
  - `hasLegalForm(name: string): boolean`, `looksLikeMatterName(name: string): boolean`

- [ ] **Krok 1: Napíš padajúce testy**

`lawoss/okf/test/onboarding-suggest.test.ts`:

```ts
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
```

Poznámka k testu „názov veci“: `1999 dôvodov` nie je vec, lebo rok musí byť v rozsahu 2000 až 2099 (`20\d{2}` v kroku 3). Vzory SK a CZ aj `looksLikeMatterName` s existujúcim `findCaseNumber` boli 8. 10. 2026 overené proti presne týmto menám: všetky očakávania v teste sedia.

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd lawoss/okf && bun test test/onboarding-suggest.test.ts`
Expected: FAIL, `Cannot find module '../src/onboarding/suggest.ts'`.

- [ ] **Krok 3: Implementuj vzory**

`lawoss/okf/src/onboarding/suggest-patterns.ts`:

```ts
/**
 * Vzory pre návrh úrovne priečinka. SK a CZ sú oddelené: rovnaká skratka (s.r.o., a.s.)
 * je v oboch, ale z.s., o.p.s. či z.ú. sú len české a š.p. či j.s.a. len slovenské.
 */
import { findCaseNumber } from "../triage/rules.ts";

const form = (body: string) => new RegExp(`(?:^|[\\s,(])${body}(?=$|[\\s,)])`, "iu");
/** Obchodný zákonník a zákon o štátnom podniku: s. r. o., a. s., k. s., v. o. s., š. p., j. s. a. */
export const SK_LEGAL_FORMS: readonly RegExp[] = [
  form("s\\.\\s?r\\.\\s?o\\.?"), form("a\\.\\s?s\\.?"), form("k\\.\\s?s\\.?"),
  form("v\\.\\s?o\\.\\s?s\\.?"), form("š\\.\\s?p\\.?"), form("j\\.\\s?s\\.\\s?a\\.?"),
];
/** Zákon o obchodních korporacích a NOZ: spol. s r.o., s.r.o., a.s., k.s., v.o.s., z.s., o.p.s., z.ú. */
export const CZ_LEGAL_FORMS: readonly RegExp[] = [
  form("spol\\.\\s?s\\s?r\\.\\s?o\\.?"), form("s\\.\\s?r\\.\\s?o\\.?"), form("a\\.\\s?s\\.?"), form("k\\.\\s?s\\.?"),
  form("v\\.\\s?o\\.\\s?s\\.?"), form("z\\.\\s?s\\.?"), form("o\\.\\s?p\\.\\s?s\\.?"), form("z\\.\\s?ú\\.?"),
];
export const hasLegalForm = (name: string): boolean => [...SK_LEGAL_FORMS, ...CZ_LEGAL_FORMS].some(pattern => pattern.test(name));
/** Vec: na začiatku rok 2000 až 2099 (voliteľne s mesiacom) a oddeľovač, alebo spisová značka v názve. */
const MATTER_DATE = /^20\d{2}(?:[-_. ](?:0[1-9]|1[0-2]))?(?:[-_ ]|$)/;
export const looksLikeMatterName = (name: string): boolean => MATTER_DATE.test(name) || findCaseNumber(name) !== undefined;
```

- [ ] **Krok 4: Implementuj prieskum a návrh**

`lawoss/okf/src/onboarding/suggest.ts`:

```ts
/**
 * Návrh, či je vybraný priečinok prax, klient alebo vec. Číta len mená (žiadny obsah, žiadne
 * hashe), takže zvládne aj celú prax. Výsledok je návrh s mierou istoty; rozhoduje advokát.
 * `inspectOnboardingRoot` a jej `level` ostávajú autoritatívne pre zápis (brána `convert`).
 */
import { lstat, readdir, readFile } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
import { realpath } from "../canonical-path.ts";
import { VOLATILE_ENTRY } from "./classify.ts";
import { hasLegalForm, looksLikeMatterName } from "./suggest-patterns.ts";

export type SuggestedLevel = "practice" | "client" | "matter" | "unknown";
export type SuggestionSignal = "office_config" | "client_card" | "matter_card" | "legal_form_children" | "matter_named_children" | "letter_buckets" | "matter_named_root" | "documents_only" | "plain_directories" | "empty";
export type SuggestedClient = { path: string; name: string };
export type OnboardingSuggestion = { root: string; level: SuggestedLevel; marked: boolean; score: number; signals: SuggestionSignal[]; clientPattern?: string; clients: SuggestedClient[]; complete: boolean };
export type SurveyEntry = { path: string; kind: "file" | "directory" };
export type FolderSurvey = { root: string; complete: boolean; entries: SurveyEntry[] };

/** Prvé prahy (spec, otvorená otázka 1); doladia sa na anonymizovanom strome reálnej praxe. */
export const PRACTICE_MIN_CLIENTS = 5;
export const PRACTICE_MIN_RATIO = 0.5;
const SURVEY_DEPTH = 4;
const SURVEY_ENTRIES = 50_000;
const CLIENT_CARDS = new Set(["client.md", "klient.md"]);
const MATTER_CARDS = new Set(["matter.md", "spis.md", "project.md", "projekt.md"]);
const OFFICE_DIRS = ["Office", "_kancelaria"];
const LETTER = /^\p{Lu}$/u;

const nameOf = (path: string): string => path.split("/").pop() ?? path;
const depthOf = (path: string): number => path ? path.split("/").length : 0;
const childrenOf = (survey: FolderSurvey, parent: string): SurveyEntry[] =>
  survey.entries.filter(entry => depthOf(entry.path) === depthOf(parent) + 1 && (parent === "" || entry.path.startsWith(`${parent}/`)));
const round = (value: number): number => Math.round(value * 100) / 100;

/** Mená položiek do hĺbky 4, do šírky (najprv celá horná úroveň). Skryté a prchavé mená vynechá, odkazy nesleduje. */
export async function surveyFolder(root: string, limits: { maxDepth?: number; maxEntries?: number } = {}): Promise<FolderSurvey> {
  const maxDepth = limits.maxDepth ?? SURVEY_DEPTH, maxEntries = limits.maxEntries ?? SURVEY_ENTRIES;
  if (!isAbsolute(root) || await realpath(root) !== resolve(root) || !(await lstat(root)).isDirectory()) throw new Error("Vyberte existujúci priečinok bez symbolických odkazov.");
  const survey: FolderSurvey = { root: resolve(root), complete: true, entries: [] };
  const queue: { relative: string; depth: number }[] = [{ relative: "", depth: 1 }];
  for (let next = queue.shift(); next; next = queue.shift()) {
    let names: string[];
    try { names = (await readdir(join(survey.root, next.relative))).sort(); }
    catch { survey.complete = false; continue; }
    for (const name of names) {
      if (name.startsWith(".") || VOLATILE_ENTRY.test(name)) continue;
      if (survey.entries.length >= maxEntries) { survey.complete = false; return survey; }
      const path = next.relative ? `${next.relative}/${name}` : name;
      try {
        const state = await lstat(join(survey.root, path));
        if (state.isSymbolicLink()) continue;
        if (state.isDirectory()) {
          survey.entries.push({ path, kind: "directory" });
          if (next.depth < maxDepth) queue.push({ relative: path, depth: next.depth + 1 });
        } else if (state.isFile()) survey.entries.push({ path, kind: "file" });
      } catch { survey.complete = false; }
    }
  }
  return survey;
}

/** Priečinky klientov podľa vzoru `client_path` z okf.config, relatívne ku koreňu praxe. */
function matchPattern(survey: FolderSurvey, pattern: string): SuggestedClient[] {
  let level = [""];
  for (const segment of pattern.split("/").filter(Boolean)) {
    level = level.flatMap(parent => childrenOf(survey, parent)
      .filter(entry => entry.kind === "directory" && !OFFICE_DIRS.includes(nameOf(entry.path)) && (segment === "*" || nameOf(entry.path) === segment))
      .map(entry => entry.path));
  }
  return level.filter(Boolean).map(path => ({ path, name: nameOf(path) }));
}

export async function suggestOnboardingLevel(root: string): Promise<OnboardingSuggestion> {
  const survey = await surveyFolder(root);
  const base = { root: survey.root, complete: survey.complete, clients: [] };
  const top = childrenOf(survey, "");
  const topFiles = top.filter(entry => entry.kind === "file").map(entry => nameOf(entry.path).toLowerCase());
  if (topFiles.some(name => CLIENT_CARDS.has(name))) return { ...base, level: "client", marked: true, score: 1, signals: ["client_card"] };
  if (topFiles.some(name => MATTER_CARDS.has(name))) return { ...base, level: "matter", marked: true, score: 1, signals: ["matter_card"] };
  const office = OFFICE_DIRS.find(name => survey.entries.some(entry => entry.path === `${name}/okf.config` && entry.kind === "file"));
  if (office) {
    const config = await readFile(join(survey.root, office, "okf.config"), "utf8").catch(() => "");
    const clientPattern = /^client_path:\s*"?([^"\n]+?)"?\s*$/m.exec(config)?.[1] ?? "Klienti/*";
    return { ...base, level: "practice", marked: true, score: 1, signals: ["office_config"], clientPattern, clients: matchPattern(survey, clientPattern) };
  }
  if (!top.length) return { ...base, level: "unknown", marked: false, score: 0, signals: ["empty"] };

  const dirs = top.filter(entry => entry.kind === "directory");
  const buckets = dirs.filter(entry => LETTER.test(nameOf(entry.path)));
  const bucketed = buckets.length >= PRACTICE_MIN_CLIENTS && buckets.length >= dirs.length * 0.8;
  const candidates = bucketed ? buckets.flatMap(bucket => childrenOf(survey, bucket.path).filter(entry => entry.kind === "directory")) : dirs;
  const legal = candidates.filter(candidate => hasLegalForm(nameOf(candidate.path)));
  const withMatters = candidates.filter(candidate => childrenOf(survey, candidate.path).some(entry => entry.kind === "directory" && looksLikeMatterName(nameOf(entry.path))));
  const clientish = new Set([...legal, ...withMatters].map(candidate => candidate.path));
  const ratio = candidates.length ? clientish.size / candidates.length : 0;
  if (candidates.length >= PRACTICE_MIN_CLIENTS && ratio >= PRACTICE_MIN_RATIO) {
    const signals: SuggestionSignal[] = [];
    if (bucketed) signals.push("letter_buckets");
    if (legal.length) signals.push("legal_form_children");
    if (withMatters.length) signals.push("matter_named_children");
    return { ...base, level: "practice", marked: false, score: round(ratio), signals, clientPattern: bucketed ? "*/*" : "*", clients: candidates.map(candidate => ({ path: candidate.path, name: nameOf(candidate.path) })) };
  }
  if (looksLikeMatterName(nameOf(survey.root))) return { ...base, level: "matter", marked: false, score: 0.8, signals: ["matter_named_root"] };
  if (dirs.some(entry => looksLikeMatterName(nameOf(entry.path)))) return { ...base, level: "client", marked: false, score: 0.8, signals: ["matter_named_children"] };
  if (!dirs.length) return { ...base, level: "matter", marked: false, score: 0.5, signals: ["documents_only"] };
  return { ...base, level: "client", marked: false, score: 0.5, signals: ["plain_directories"] };
}
```

Poznámka: test „vec, koreň pomenovaný ako vec“ vytvára dočasný priečinok s predponou `2024-03 Kúpna zmluva-`. `mkdtemp` k nej pridá náhodnú príponu, takže meno začína `2024-03 ` a vyhovie `MATTER_DATE`.

- [ ] **Krok 5: Spusti testy**

Run: `cd lawoss/okf && bun test test/onboarding-suggest.test.ts`
Expected: PASS všetkých 11 testov. Ak padne test „klient: podpriečinky pomenované ako veci“ kvôli `Faktúry/`, over, že `looksLikeMatterName("Faktúry")` vracia `false` (`findCaseNumber` nesmie vrátiť zhodu pre bežné slovo).

- [ ] **Krok 6: Typecheck a celé testy jadra**

Run: `cd lawoss/okf && bun run typecheck && bun test test/`
Expected: typecheck bez chýb; testy: 0 fail (pred zmenou 297 testov, 4 skip).

- [ ] **Krok 7: Commit**

```bash
git add lawoss/okf/src/onboarding/suggest.ts lawoss/okf/src/onboarding/suggest-patterns.ts lawoss/okf/test/onboarding-suggest.test.ts
git commit -m "feat: návrh úrovne priečinka (prax, klient, vec) z mien bez čítania obsahu"
```

---

### Úloha 2: Kancelária pre existujúcu prax a `AGENTS.md` na úrovni praxe

**Files:**
- Create: `lawoss/okf/templates/kancelaria/AGENTS.md`
- Create: `lawoss/okf/templates/cs/kancelaria/AGENTS.md`
- Create: `lawoss/okf/templates/en/kancelaria/AGENTS.md`
- Modify: `lawoss/okf/src/onboarding/entities.ts` (funkcia `officeConfig` na riadku 63 až 67, `planOffice` na riadku 69 až 73, nové `planPracticeOffice`)
- Modify: `lawoss/okf/src/onboarding/onboarding.ts` (typy `OnboardingRequest`, `OnboardingPreview`, `parseOnboardingRequest`, `planOnboarding`)
- Modify: `lawoss/okf/src/onboarding/cli.ts` (funkcia `savedPreview`, zoznam akcií)
- Test: `lawoss/okf/test/onboarding-practice.test.ts`

**Interfaces:**
- Consumes: `SuggestedClient`, `OnboardingSuggestion.clientPattern` z úlohy 1 (UI ich v pláne C pošle ako `clientPattern`).
- Produces:
  - `type WorkspaceScope = "client" | "practice"`
  - `type PracticeRequest = { root: string; title: string; jurisdiction: "sk" | "cz"; language: "sk" | "cs" | "en"; lawyerName: string; clientPattern: string; scope: WorkspaceScope }`
  - `planPracticeOffice(request: PracticeRequest): Promise<CreatePreview>`
  - nová požiadavka `{ action: "practice", ...PracticeRequest }` cez `parseOnboardingRequest` a `planOnboarding`; náhľad má `action: "practice"`, `target` = koreň praxe
  - `okf.config` má nový riadok `workspace_scope: client|practice`
  - `planOffice` (začať nanovo) zapíše aj koreňový `AGENTS.md` a `CLAUDE.md`, ak v rodičovi nie sú

- [ ] **Krok 1: Napíš padajúce testy**

`lawoss/okf/test/onboarding-practice.test.ts`:

```ts
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
```

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd lawoss/okf && bun test test/onboarding-practice.test.ts`
Expected: FAIL, `Invalid onboarding action.` pri `action: "practice"`.

- [ ] **Krok 3: Pridaj šablóny `AGENTS.md` praxe**

Šablóny nesú dva zástupné reťazce: `{{CLIENT_PATH}}` a `{{SCOPE_RULE}}`. Zoznam klientov ani mená protistrán sa do `AGENTS.md` praxe nezapisujú (spec, otvorená otázka 2: zoznam je odvoditeľný z priečinkov a `AGENTS.md` nemá prezradiť viac, než treba).

`lawoss/okf/templates/kancelaria/AGENTS.md`:

```markdown
# AGENTS.md: advokátska prax (OKF)

Tento priečinok je advokátska prax usporiadaná podľa OKF (otvorený klientsky folder framework). Pravidlá platia pre každý AI nástroj, ktorý tu pracuje.

## Štruktúra

- `Office/okf.config`: nastavenie kancelárie (jurisdikcia, jazyk, pracovné priečinky, kde sú klienti).
- `Office/memory/`: pamäť kancelárie, pravidlá a pramene spoločné pre všetkých klientov.
- Klienti: priečinky podľa vzoru `{{CLIENT_PATH}}` (relatívne k tomuto priečinku). Každý klient má vlastný `AGENTS.md`, kartu `client.md` a priečinok `memory/`.

## Pravidlá

- {{SCOPE_RULE}}
- Pred prácou na klientovi si prečítaj jeho `AGENTS.md` a kartu klienta.
- Súbory klientov nemeň, nepresúvaj ani nemaž bez výslovného pokynu advokáta.
```

`lawoss/okf/templates/cs/kancelaria/AGENTS.md`:

```markdown
# AGENTS.md: advokátní praxe (OKF)

Tato složka je advokátní praxe uspořádaná podle OKF (otevřený klientský folder framework). Pravidla platí pro každý AI nástroj, který zde pracuje.

## Struktura

- `Office/okf.config`: nastavení kanceláře (jurisdikce, jazyk, pracovní složky, kde jsou klienti).
- `Office/memory/`: paměť kanceláře, pravidla a prameny společné pro všechny klienty.
- Klienti: složky podle vzoru `{{CLIENT_PATH}}` (relativně k této složce). Každý klient má vlastní `AGENTS.md`, kartu `client.md` a složku `memory/`.

## Pravidla

- {{SCOPE_RULE}}
- Před prací na klientovi si přečti jeho `AGENTS.md` a kartu klienta.
- Soubory klientů neměň, nepřesouvej ani nemaž bez výslovného pokynu advokáta.
```

`lawoss/okf/templates/en/kancelaria/AGENTS.md`:

```markdown
# AGENTS.md: law practice (OKF)

This folder is a law practice organised by OKF (open client folder framework). These rules apply to every AI tool working here.

## Structure

- `Office/okf.config`: office settings (jurisdiction, language, working folders, where clients live).
- `Office/memory/`: office memory, rules and sources shared by all clients.
- Clients: folders matching `{{CLIENT_PATH}}` (relative to this folder). Each client has its own `AGENTS.md`, a `client.md` card and a `memory/` folder.

## Rules

- {{SCOPE_RULE}}
- Before working on a client, read its `AGENTS.md` and client card.
- Do not change, move or delete client files without the lawyer's explicit instruction.
```

- [ ] **Krok 4: Implementuj kanceláriu praxe v `entities.ts`**

Na začiatok `lawoss/okf/src/onboarding/entities.ts` pridaj importy šablón (rovnaký spôsob ako `src/templates.ts`):

```ts
import practiceAgentsSK from "../../templates/kancelaria/AGENTS.md" with { type: "text" };
import practiceAgentsCS from "../../templates/cs/kancelaria/AGENTS.md" with { type: "text" };
import practiceAgentsEN from "../../templates/en/kancelaria/AGENTS.md" with { type: "text" };
```

Nahraď funkciu `officeConfig` (riadky 63 až 67) a `planOffice` (riadky 69 až 73) týmto kódom a pridaj nové typy a funkcie:

```ts
export type WorkspaceScope = "client" | "practice";
export type PracticeRequest = { root: string; title: string; jurisdiction: "sk" | "cz"; language: "sk" | "cs" | "en"; lawyerName: string; clientPattern: string; scope: WorkspaceScope };

/** Pracovné priečinky novej veci aj ich roly výslovne; bez rolí by sa do založenej veci nedalo nič zaradiť. */
const officeConfig = (request: OfficeRequest, clientPath = "Klienti/*", scope: WorkspaceScope = "client") => {
  const roles = DEFAULT_FOLDER_ROLES[request.language];
  return `version: 1\ntitle: ${yaml(request.title)}\njurisdiction: ${request.jurisdiction}\nlanguage: ${request.language}\nlawyer_name: ${yaml(request.lawyerName)}\nstanding_authorization: ${yaml(request.lawyerName)}\nclient_path: ${yaml(clientPath)}\nworkspace_scope: ${scope}\nareas: ["Corporate", "IP", "Pracovne"]\nmatter_folders: ${JSON.stringify(Object.values(roles))}\nfolder_roles: ${JSON.stringify(roles)}\n`;
};

const PRACTICE_AGENTS: Record<"sk" | "cs" | "en", string> = { sk: practiceAgentsSK, cs: practiceAgentsCS, en: practiceAgentsEN };
/** Mlčanlivosť: predvolene jeden klient na pracovný priečinok (spec P5). */
const SCOPE_RULE: Record<"sk" | "cs" | "en", Record<WorkspaceScope, string>> = {
  sk: {
    client: "Pracuj vždy nad jedným klientom. Spisy iného klienta neotváraj ani necituj, ak to advokát výslovne nežiada (mlčanlivosť).",
    practice: "Advokát zvolil prácu nad celou praxou naraz. Aj tak drž informácie každého klienta oddelene a neprenášaj ich medzi klientmi (mlčanlivosť).",
  },
  cs: {
    client: "Pracuj vždy nad jedním klientem. Spisy jiného klienta neotevírej ani necituj, pokud to advokát výslovně nežádá (mlčenlivost).",
    practice: "Advokát zvolil práci nad celou praxí najednou. I tak drž informace každého klienta odděleně a nepřenášej je mezi klienty (mlčenlivost).",
  },
  en: {
    client: "Always work on one client. Do not open or quote another client's files unless the lawyer explicitly asks (confidentiality).",
    practice: "The lawyer chose to work on the whole practice at once. Still keep each client's information separate and never carry it between clients (confidentiality).",
  },
};
const practiceAgents = (language: "sk" | "cs" | "en", clientPath: string, scope: WorkspaceScope) =>
  PRACTICE_AGENTS[language].replaceAll("{{CLIENT_PATH}}", clientPath).replaceAll("{{SCOPE_RULE}}", SCOPE_RULE[language][scope]);
/** Koreňový AGENTS.md a CLAUDE.md praxe, len ak v koreni ani jeden nie je; vlastné pravidlá advokáta sa nikdy neprepíšu. */
function practiceInstructions(topNames: ReadonlySet<string>, language: "sk" | "cs" | "en", clientPath: string, scope: WorkspaceScope): CreateOperation[] {
  if (topNames.has("agents.md") || topNames.has("claude.md")) return [];
  const content = practiceAgents(language, clientPath, scope);
  return [file("AGENTS.md", content), file("CLAUDE.md", content)];
}
async function topLevelNames(parent: string): Promise<Set<string>> {
  const inspection = await inspectOnboardingParent(await realpath(parent));
  if (!inspection.complete) throw new Error(incompleteInspectionMessage("Parent could not be inspected completely.", inspection.issues));
  return new Set(inspection.entries.map(entry => entry.path.toLowerCase()));
}
/** Vzor klientov z okf.config: relatívny, najviac 4 časti, posledná je „*“, ostatné bezpečné mená alebo „*“. */
export function safeClientPattern(value: string): string {
  const parts = value.split("/");
  if (!value || parts.length > 4 || parts.at(-1) !== "*" || parts.some(part => part !== "*" && safeSegment(part) !== part)) throw new Error("Invalid client path pattern.");
  return parts.join("/");
}

export async function planOffice(request: OfficeRequest): Promise<CreatePreview> {
  const name = safeSegment(request.name ?? "Office");
  const target = join(request.parent, name);
  const names = await topLevelNames(request.parent);
  return { mode: "new", appFiles: "inside", target, plan: await rootPlan(request.parent, [directory(name), file(`${name}/okf.config`, officeConfig(request)), directory(`${name}/memory`), file(`${name}/memory/.keep`, ""), directory("Klienti"), file("Klienti/.keep", ""), ...practiceInstructions(names, request.language, "Klienti/*", "client")]) };
}
/** Existujúca prax: kancelária vedľa klientov, nič existujúce sa nepresúva (spec P5). */
export async function planPracticeOffice(request: PracticeRequest): Promise<CreatePreview> {
  const clientPath = safeClientPattern(request.clientPattern);
  const root = await realpath(request.root);
  const names = await topLevelNames(root);
  if (names.has("office") || names.has("_kancelaria")) throw new Error("Tento priečinok už kanceláriu má (Office/). Pripojte ho ako kanceláriu.");
  const office: OfficeRequest = { parent: root, title: request.title, jurisdiction: request.jurisdiction, language: request.language, lawyerName: request.lawyerName };
  return { mode: "new", appFiles: "inside", target: root, plan: await rootPlan(root, [directory("Office"), file("Office/okf.config", officeConfig(office, clientPath, request.scope)), directory("Office/memory"), file("Office/memory/.keep", ""), ...practiceInstructions(names, request.language, clientPath, request.scope)]) };
}
```

Over, že `inspectOnboardingParent`, `realpath` a `incompleteInspectionMessage` sú v `entities.ts` už importované (riadky 1 až 13); sú.

- [ ] **Krok 5: Zapoj požiadavku `practice` v `onboarding.ts`**

V `lawoss/okf/src/onboarding/onboarding.ts`:

1. Import rozšír o `planPracticeOffice`, `safeClientPattern`, `type PracticeRequest`:

```ts
import { executeCreate, planExistingClient, planNewClient, planNewMatter, planNewSubject, planOffice, planPracticeOffice, safeClientPattern, type AppFiles, type CreatePreview, type MapPreview, type PracticeRequest, type TrialClonePreview } from "./entities.ts";
```

2. Do `OnboardingRequest` pridaj na druhý riadok variant:

```ts
  | ({ action: "practice" } & PracticeRequest)
```

3. V `OnboardingPreview` rozšír zoznam akcií: `action: "office" | "practice" | "client" | "subject" | "matter" | "existing"`.

4. V `parseOnboardingRequest` hneď za vetvu `office` pridaj:

```ts
  if (value.action === "practice") {
    const jurisdiction = value.jurisdiction, language = value.language, scope = value.scope;
    if (jurisdiction !== "sk" && jurisdiction !== "cz") throw new Error("Invalid onboarding jurisdiction.");
    if (language !== "sk" && language !== "cs" && language !== "en") throw new Error("Invalid language.");
    if (scope !== "client" && scope !== "practice") throw new Error("Invalid workspace scope.");
    return { action: "practice", root: string(value.root, "root"), title: string(value.title, "title"), jurisdiction, language, lawyerName: string(value.lawyerName, "lawyerName"), clientPattern: safeClientPattern(string(value.clientPattern, "clientPattern")), scope };
  }
```

5. V `planOnboarding` za riadok s `office`:

```ts
  if (request.action === "practice") return { action: request.action, ...await planPracticeOffice(request) };
```

6. V `lawoss/okf/src/onboarding/cli.ts` vo funkcii `savedPreview` rozšír pretypovanie akcie na `"office" | "practice" | "client" | "subject" | "matter" | "existing"`.

- [ ] **Krok 6: Spusti testy**

Run: `cd lawoss/okf && bun test test/onboarding-practice.test.ts test/onboarding-entities.test.ts test/onboarding-cli.test.ts`
Expected: PASS. Ak padne existujúci test, ktorý porovnáva presný zoznam operácií kancelárie, doplň doň `AGENTS.md` a `CLAUDE.md` na koniec (nové správanie podľa spec, krok „Začať nanovo“).

- [ ] **Krok 7: Typecheck, celé testy, bundle**

Run: `cd lawoss/okf && bun run typecheck && bun test test/ && bun run build`
Expected: bez chýb; `bundle/okf.js` sa zmenil.

- [ ] **Krok 8: Commit**

```bash
git add lawoss/okf/templates/kancelaria lawoss/okf/templates/cs/kancelaria lawoss/okf/templates/en/kancelaria lawoss/okf/src/onboarding/entities.ts lawoss/okf/src/onboarding/onboarding.ts lawoss/okf/src/onboarding/cli.ts lawoss/okf/test/onboarding-practice.test.ts lawoss/okf/bundle/okf.js
git commit -m "feat: kancelária pre existujúcu prax a AGENTS.md na úrovni praxe"
```

---

### Úloha 3: Usporiadanie na mieste s výslovným súhlasom

**Files:**
- Modify: `lawoss/okf/src/triage/scan.ts` (nové `IN_PLACE_MARKER`, `grantInPlaceReorganize`, `verifyTriageTarget`; `scanTriage` na riadku 101 až 106)
- Modify: `lawoss/okf/src/triage/apply.ts` (`applyTriagePlan` riadok 175, `undoTriage` riadok 254)
- Modify: `lawoss/okf/src/triage/index.ts` (export)
- Test: `lawoss/okf/test/triage-in-place.test.ts`

**Interfaces:**
- Consumes: existujúce `scanTriage`, `prepareTriage`, `applyTriagePlan`, `undoTriage`, `verifyTrialClone`, `TrialCloneError`, `TRIAL_MARKER`.
- Produces:
  - `IN_PLACE_MARKER = ".lawoss/reorganize.json"`
  - `type TriageTarget = { root: string; mode: "trial" | "in_place"; journalVerified: boolean }`
  - `grantInPlaceReorganize(root: string, now?: Date): Promise<void>`: zapíše súhlas; vyžaduje priečinok klienta (karta klienta). Volá ho server až po kliknutí „Áno, usporiadaj“ (plán C).
  - `verifyTriageTarget(root: string, trialJournalDirectory?: string): Promise<TriageTarget>`

Tok v appke (plán C): „Áno, usporiadaj“ najprv urobí `convert` (rovnaké potvrdenie zoznamu nových súborov ako pri „Nie“). Potom server zavolá `grantInPlaceReorganize`, `prepareTriage` ukáže presuny pred a po a až po druhom potvrdení beží `applyTriagePlan`. Náhľad presunov sa teda počíta až nad priečinkom s kartou klienta, a preto sa nemení otlačok medzi náhľadom a zápisom.

- [ ] **Krok 1: Napíš padajúce testy**

`lawoss/okf/test/triage-in-place.test.ts`:

```ts
import { createHash } from "node:crypto";
import { afterEach, expect, setDefaultTimeout, test } from "bun:test";
import { mkdtemp, mkdir, readFile, readdir, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inspectOnboardingRoot } from "../src/onboarding/classify.ts";
import { applyOnboarding, parseOnboardingRequest, planOnboarding } from "../src/onboarding/onboarding.ts";
import { applyTriagePlan, grantInPlaceReorganize, IN_PLACE_MARKER, prepareTriage, TrialCloneError, undoTriage, verifyTriageTarget } from "../src/triage/index.ts";
import { TRIAGE_FIXTURE, writeTriageFixture } from "./fixtures/triage-client.ts";

setDefaultTimeout(30_000);
const paths: string[] = [];
afterEach(async () => { await Promise.all(paths.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function directory(prefix: string) { const path = await realpath(await mkdtemp(join(tmpdir(), prefix))); paths.push(path); return path; }
const NOW = new Date("2026-10-08T10:00:00Z");

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
  await expect(verifyTriageTarget(root)).rejects.toBeInstanceOf(TrialCloneError);
  await expect(prepareTriage(root, { now: NOW })).rejects.toThrow(/súhlas/);
});

test("súhlas vyžaduje kartu klienta a je idempotentný", async () => {
  const plain = await directory("okf-in-place-plain-");
  await expect(grantInPlaceReorganize(plain, NOW)).rejects.toThrow(/klienta/);
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  await grantInPlaceReorganize(root, NOW);
  expect(JSON.parse(await readFile(join(root, IN_PLACE_MARKER), "utf8"))).toEqual({ version: 1, root, grantedAt: NOW.toISOString() });
  expect(await verifyTriageTarget(root)).toEqual({ root, mode: "in_place", journalVerified: false });
});

test("súhlas z iného priečinka (skopírovaný marker) neplatí", async () => {
  const root = await convertedClient();
  await mkdir(join(root, ".lawoss"), { recursive: true });
  await writeFile(join(root, IN_PLACE_MARKER), JSON.stringify({ version: 1, root: "/iny/priecinok", grantedAt: NOW.toISOString() }));
  await expect(verifyTriageTarget(root)).rejects.toThrow(/súhlas/);
});

test("usporiadanie na mieste a jeho úplné vrátenie", async () => {
  const root = await convertedClient();
  const before = await documentsHash(root);
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW });
  expect(plan.moves.length).toBeGreaterThan(0);
  const applied = await applyTriagePlan(plan);
  expect(applied).toMatchObject({ status: "applied", moved: plan.moves.length });
  expect(await documentsHash(root)).not.toBe(before);
  const undone = await undoTriage(root, plan.runId);
  expect(undone.status).toBe("undone");
  expect(await documentsHash(root)).toBe(before);
  expect(await readdir(join(root, ".lawoss"))).toContain("reorganize.json");
});
```

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd lawoss/okf && bun test test/triage-in-place.test.ts`
Expected: FAIL, `grantInPlaceReorganize` nie je exportované.

- [ ] **Krok 3: Implementuj súhlas a overenie cieľa v `scan.ts`**

Do `lawoss/okf/src/triage/scan.ts` za `verifyTrialClone` (za riadok 87) pridaj:

```ts
/** Výslovný súhlas advokáta s usporiadaním priečinka klienta na mieste (spec: „Áno, usporiadaj“). */
export const IN_PLACE_MARKER = ".lawoss/reorganize.json";
export type TriageTarget = { root: string; mode: "trial" | "in_place"; journalVerified: boolean };
const NO_CONSENT = "Dokumenty sa presúvajú len po výslovnom súhlase s usporiadaním priečinka alebo v skúšobnom klone.";

/** Zapíše súhlas do `.lawoss/` klienta. Skrytý priečinok je mimo otlačku roztriedenia, náhľad sa ním nezmení. */
export async function grantInPlaceReorganize(rootInput: string, now: Date = new Date()): Promise<void> {
  if (!isAbsolute(rootInput)) throw new Error("Cesta ku klientovi musí byť absolútna.");
  const root = resolve(rootInput);
  if (await realpath(root) !== root || !(await lstat(root)).isDirectory()) throw new Error("Klient musí byť existujúci priečinok bez symbolických odkazov.");
  const inspection = await inspectOnboardingRoot(root);
  if (inspection.level !== "client") throw new Error("Usporiadať sa dá len priečinok klienta s kartou klienta. Najprv pridajte OKF súbory.");
  const dir = join(root, ".lawoss");
  await mkdir(dir, { recursive: true });
  const content = JSON.stringify({ version: 1, root, grantedAt: now.toISOString() });
  try { await writeFile(join(root, IN_PLACE_MARKER), content, { flag: "wx" }); }
  catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    const existing: unknown = JSON.parse(await readBounded(join(root, IN_PLACE_MARKER), 64 * 1024));
    if (!record(existing) || existing.root !== root) throw new TrialCloneError("Súhlas s usporiadaním patrí inému priečinku. Odstráňte .lawoss/reorganize.json a potvrďte usporiadanie znova.");
  }
}

/** Skúšobný klon (podľa značky) alebo klient so súhlasom na mieste; inak odmietne. */
export async function verifyTriageTarget(rootInput: string, trialJournalDirectory?: string): Promise<TriageTarget> {
  if (!isAbsolute(rootInput)) throw new TrialCloneError("Cesta musí byť absolútna.");
  const root = resolve(rootInput);
  const trial = await lstat(join(root, TRIAL_MARKER)).then(() => true, error => { if (missing(error)) return false; throw error; });
  if (trial) { const clone = await verifyTrialClone(root, trialJournalDirectory); return { root: clone.root, mode: "trial", journalVerified: clone.journalVerified }; }
  if (await realpath(root).catch(() => "") !== root) throw new TrialCloneError("Priečinok musí existovať a nesmie byť symbolický odkaz.");
  let consent: unknown;
  try { consent = JSON.parse(await readBounded(join(root, IN_PLACE_MARKER), 64 * 1024)); }
  catch (error) { if (error instanceof TrialCloneError) throw error; throw new TrialCloneError(NO_CONSENT); }
  if (!record(consent) || consent.version !== 1 || consent.root !== root || typeof consent.grantedAt !== "string") throw new TrialCloneError(NO_CONSENT);
  return { root, mode: "in_place", journalVerified: false };
}
```

Doplň importy na začiatku `scan.ts`: `mkdir` a `writeFile` z `node:fs/promises` (ak tam nie sú).

V `scanTriage` (riadky 101 až 106) nahraď:

```ts
  const clone = await verifyTrialClone(rootInput, options.trialJournalDirectory);
```

týmto:

```ts
  const clone = await verifyTriageTarget(rootInput, options.trialJournalDirectory);
```

a správu `"Skúšobný klon musí byť priečinok klienta s kartou klienta."` nahraď `"Usporiadať sa dá len priečinok klienta s kartou klienta."`.

- [ ] **Krok 4: Prepoj `apply.ts` a export**

V `lawoss/okf/src/triage/apply.ts` v `applyTriagePlan` aj v `undoTriage` nahraď `await verifyTrialClone(` za `await verifyTriageTarget(` a uprav import zo `./scan.ts`. Premenná sa ďalej volá `clone` a používa sa len `clone.root`, takže zvyšok kódu sa nemení.

V `lawoss/okf/src/triage/index.ts` rozšír export zo `./scan.ts`:

```ts
export { grantInPlaceReorganize, IN_PLACE_MARKER, looksLikeTrialName, scanTriage, TrialCloneError, TRIAL_MARKER, verifyTrialClone, verifyTriageTarget, type TriageTarget } from "./scan.ts";
```

- [ ] **Krok 5: Spusti testy roztriedenia**

Run: `cd lawoss/okf && bun test test/triage-in-place.test.ts test/triage.test.ts`
Expected: PASS. Existujúce testy skúšobného klona (`describe("skúšobný klon")`) musia prejsť bez zmeny. Ak niektorý test čaká pôvodnú správu „Toto nie je skúšobný klon…“ pre priečinok bez značky, uprav očakávanie na novú správu `NO_CONSENT` (priečinok bez značky aj bez súhlasu).

- [ ] **Krok 6: Typecheck, celé testy, bundle a commit**

Run: `cd lawoss/okf && bun run typecheck && bun test test/ && bun run build`
Expected: bez chýb.

```bash
git add lawoss/okf/src/triage/scan.ts lawoss/okf/src/triage/apply.ts lawoss/okf/src/triage/index.ts lawoss/okf/test/triage-in-place.test.ts lawoss/okf/test/triage.test.ts lawoss/okf/bundle/okf.js
git commit -m "feat: usporiadanie priečinka klienta na mieste po výslovnom súhlase"
```

---

### Úloha 4: Súbor otvorený vo Worde neblokuje usporiadanie

**Files:**
- Modify: `lawoss/okf/src/triage/types.ts` (`SkipReason`)
- Modify: `lawoss/okf/src/triage/scan.ts` (`scanTriage`: voľba `hooks`, tolerancia zamknutých súborov)
- Modify: `lawoss/okf/src/triage/apply.ts` (prvý zápis v `applyTriagePlan`)
- Modify: `lawoss/okf/onboarding.d.mts` (ak deklaruje `SkipReason`; inak bez zmeny)
- Test: `lawoss/okf/test/triage-in-place.test.ts`

**Interfaces:**
- Consumes: `InspectionHooks`, `inspectOnboardingRoot(root, limits, hooks)` z `classify.ts`.
- Produces:
  - `SkipReason` má novú hodnotu `"locked"`
  - `onlyLockedIssues(inspection: OnboardingInspection): boolean` (export zo `scan.ts`)
  - `scanTriage(root, { trialJournalDirectory?, limits?, jurisdiction?, hooks? })`

Spec: „Súbor otvorený vo Worde: jeho presun sa preskočí a nahlási, ostatné prebehnú.“ Zamknutý súbor má v inšpekcii druh `unsupported` a problém `locked_file`. Do dokumentov sa preto nedostane; pridá sa do `skipped` s dôvodom `locked`. Ak sa súbor medzi náhľadom a zápisom odomkne, zmení sa otlačok a zápis požiada o nový náhľad (bezpečná strana).

- [ ] **Krok 1: Napíš padajúci test**

Na koniec `lawoss/okf/test/triage-in-place.test.ts` pridaj (a do importov `open` z `node:fs/promises` a `scanTriage` z `../src/triage/index.ts`):

```ts
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
  const inventory = await scanTriage(root, { hooks });
  expect(inventory.skipped).toContainEqual({ path: locked, reason: "locked" });
  expect(inventory.documents.some(document => document.path === locked)).toBe(false);
});
```

- [ ] **Krok 2: Over, že test padá**

Run: `cd lawoss/okf && bun test test/triage-in-place.test.ts -t "zamknutý"`
Expected: FAIL s chybou „Klon sa nepodarilo prečítať celý (locked_file…)“.

- [ ] **Krok 3: Implementuj toleranciu**

V `lawoss/okf/src/triage/types.ts` rozšír:

```ts
export type SkipReason = "system" | "hidden" | "memory" | "in_matter" | "inside_entity" | "already_sorted" | "system_name" | "locked";
```

V `lawoss/okf/src/triage/scan.ts`:

1. Import rozšír o `type InspectionHooks` a `type OnboardingInspection` z `../onboarding/classify.ts`.
2. Pred `scanTriage` pridaj:

```ts
/** Neúplná inšpekcia len kvôli zamknutým súborom (Word, Outlook): tie sa preskočia, zvyšok sa dá usporiadať. */
export const onlyLockedIssues = (inspection: OnboardingInspection): boolean =>
  inspection.issues.length > 0 && inspection.issues.every(issue => issue.code === "locked_file");
```

3. Signatúru zmeň na `options: { trialJournalDirectory?: string; limits?: InspectionLimits; jurisdiction?: "sk" | "cz"; hooks?: InspectionHooks } = {}` a volanie na `inspectOnboardingRoot(clone.root, options.limits, options.hooks)`.
4. Podmienku `if (!inspection.complete) {` zmeň na `if (!inspection.complete && !onlyLockedIssues(inspection)) {`.
5. Hneď pred `if (documents.length > MAX_TRIAGE_DOCUMENTS)` pridaj:

```ts
  for (const issue of inspection.issues) if (issue.code === "locked_file") skipped.push({ path: issue.path, reason: "locked" });
```

V `lawoss/okf/src/triage/apply.ts` v prvom zápise `applyTriagePlan` zmeň podmienku:

```ts
      if (!inspection.complete || triageTreeDigest(inspection.entries) !== plan.treeDigest) throw new TriageConflictError("Klon sa od náhľadu zmenil. Pripravte nový náhľad.");
```

na:

```ts
      if ((!inspection.complete && !onlyLockedIssues(inspection)) || triageTreeDigest(inspection.entries) !== plan.treeDigest) throw new TriageConflictError("Priečinok sa od náhľadu zmenil. Pripravte nový náhľad.");
```

a doplň import `onlyLockedIssues` zo `./scan.ts`. Ak niektorý test v `triage.test.ts` čaká pôvodný text „Klon sa od náhľadu zmenil“, uprav ho na „Priečinok sa od náhľadu zmenil“.

- [ ] **Krok 4: Spusti testy, typecheck, bundle a commit**

Run: `cd lawoss/okf && bun test test/triage-in-place.test.ts test/triage.test.ts && bun run typecheck && bun test test/ && bun run build`
Expected: PASS, bez chýb.

```bash
git add lawoss/okf/src/triage/types.ts lawoss/okf/src/triage/scan.ts lawoss/okf/src/triage/apply.ts lawoss/okf/test/triage-in-place.test.ts lawoss/okf/test/triage.test.ts lawoss/okf/bundle/okf.js
git commit -m "fix: zamknutý súbor pri usporiadaní preskočiť a nahlásiť, nie zastaviť"
```

---

### Úloha 5: Čiastočné vrátenie, keď sa presunutý dokument medzitým zmenil

**Files:**
- Modify: `lawoss/okf/src/triage/apply.ts` (`TriageUndoResult`, `undoTriage` riadky 170 a 253 až 310)
- Modify: `lawoss/okf/onboarding.d.mts` (deklarácia `undoTriage`, ak tam je)
- Test: `lawoss/okf/test/triage-in-place.test.ts`

**Interfaces:**
- Consumes: `undoTriage` z úlohy 3 (už s `verifyTriageTarget`).
- Produces:
  - `undoTriage(root: string, runId: string, options?: { trialJournalDirectory?: string; keepChanged?: boolean }): Promise<TriageUndoResult>`
  - `type TriageUndoResult = { status: "undone" | "already_undone"; runId: string; restored: number; removed: number; kept: string[] }`

Spec: „Vrátenie, keď advokát medzitým súbor upravil alebo presunul: ten súbor sa nevracia, ostatné áno, na konci súhrn.“ Bez `keepChanged` ostáva dnešné správanie (všetko alebo nič), aby sa nezmenil skúšobný klon.

- [ ] **Krok 1: Napíš padajúce testy**

Na koniec `lawoss/okf/test/triage-in-place.test.ts`:

```ts
test("vrátenie s keepChanged ponechá upravený dokument a ostatné vráti", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW });
  expect(plan.moves.length).toBeGreaterThan(1);
  await applyTriagePlan(plan);
  const changed = plan.moves[0]!;
  await writeFile(join(root, changed.to), "advokát to medzitým upravil");
  await expect(undoTriage(root, plan.runId)).rejects.toThrow(/zmenených/);
  const result = await undoTriage(root, plan.runId, { keepChanged: true });
  expect(result).toMatchObject({ status: "undone", restored: plan.moves.length - 1 });
  expect(result.kept).toContain(changed.to);
  expect(await readFile(join(root, changed.to), "utf8")).toBe("advokát to medzitým upravil");
  for (const move of plan.moves.slice(1)) await expect(readFile(join(root, move.from))).resolves.toBeDefined();
});

test("bez keepChanged ostáva vrátenie všetko alebo nič a nič nezmení", async () => {
  const root = await convertedClient();
  await grantInPlaceReorganize(root, NOW);
  const { plan } = await prepareTriage(root, { now: NOW });
  await applyTriagePlan(plan);
  await writeFile(join(root, plan.moves[0]!.to), "zmena");
  const before = await documentsHash(root);
  await expect(undoTriage(root, plan.runId)).rejects.toThrow();
  expect(await documentsHash(root)).toBe(before);
});
```

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd lawoss/okf && bun test test/triage-in-place.test.ts -t "vrátenie"`
Expected: FAIL: prvý test na `keepChanged` (výsledok nemá `kept`, vrátenie vyhodí chybu).

- [ ] **Krok 3: Implementuj `keepChanged` v `undoTriage`**

V `lawoss/okf/src/triage/apply.ts`:

1. Typ výsledku:

```ts
export type TriageUndoResult = { status: "undone" | "already_undone"; runId: string; restored: number; removed: number; kept: string[] };
```

2. Signatúra: `export async function undoTriage(rootInput: string, runId: string, options: { trialJournalDirectory?: string; keepChanged?: boolean } = {}): Promise<TriageUndoResult>`.
3. Návrat `already_undone` doplň o `kept: []`.
4. V cykle nad `plan.moves` (dnes plní `problems` a `pending`) nahraď telo takto, aby sa pri `keepChanged` zmenené presuny ponechali:

```ts
    const kept: string[] = [];
    const conflict = (path: string) => { if (options.keepChanged) kept.push(path); else problems.push(path); };
    for (const move of plan.moves) {
      if (!moveIntents.has(move.id) || restored.has(move.id)) continue;
      const from = await fileDigest(join(root, move.from)), to = await fileDigest(join(root, move.to));
      if (to !== null && to !== move.sha256) conflict(move.to);
      else if (from !== null && from !== move.sha256) conflict(move.from);
      else if (from === null && to === null) conflict(move.to);
      else pending.push({ move, from, to });
    }
```

   (Deklaráciu `const kept` daj pred cyklus; `problems` a `pending` ostávajú.)
5. Kontrolu vytvorených položiek (dnes `apply.ts:279` až `285`) pri `keepChanged` preskoč: priečinky, v ktorých ostal ponechaný dokument, sa pri odstraňovaní jednoducho nevymažú (krok 6). Výsledný kód:

```ts
    if (!options.keepChanged) for (const operation of toRemove) {
      const state = await operationState(root, operation);
      if (state === "other") problems.push(operation.path);
      if (state === "ours" && operation.kind === "directory") {
        for (const name of await readdir(join(root, operation.path))) if (!owned.has(`${operation.path}/${name}`.toLocaleLowerCase())) problems.push(`${operation.path}/${name}`);
      }
    }
```

   Nasledujúci riadok (`apply.ts:286`, chýbajúci pôvodný priečinok pri čakajúcom presune) pri `keepChanged` tiež nepridáva do `problems`, ale presun vyradí z `pending` a cestu zapíše do `kept`:

```ts
    for (const item of [...pending]) if (item.from === null && !(await lstat(dirname(join(root, item.move.from))).then(state => state.isDirectory() && !state.isSymbolicLink()).catch(() => false))) {
      if (options.keepChanged) { kept.push(item.move.to); pending.splice(pending.indexOf(item), 1); }
      else problems.push(dirname(item.move.from));
    }
```

6. V záverečnom odstraňovaní vytvorených položiek pri `keepChanged` neodstraňuj neprázdny priečinok ani zmenený súbor; ponechaj ich a zapíš do `kept`:

```ts
    for (const operation of [...toRemove].reverse()) {
      const full = join(root, operation.path);
      const state = await operationState(root, operation);
      if (options.keepChanged) {
        if (state === "other" || (state === "ours" && operation.kind === "directory" && (await readdir(full)).length > 0)) { kept.push(operation.path); continue; }
      }
      await appendEvent(eventsPath, { t: "remove_intent", path: operation.path });
      if (state === "ours") { if (operation.kind === "directory") await rmdir(full); else await unlinkFile(full); await durableDirectory(dirname(full)); }
      else if (state === "other") throw new TriageConflictError(`Zmenené počas vrátenia: ${operation.path}`);
      await appendEvent(eventsPath, { t: "removed", path: operation.path });
      removedCount++;
    }
```

   Pozor: pôvodný kód volá `operationState` až po `remove_intent`. Pri `keepChanged: false` musí ostať poradie a správanie rovnaké ako dnes; preto vetvu bez `keepChanged` nechaj presne v pôvodnom poradí (`remove_intent`, potom `operationState`) a novú logiku použi len pri `keepChanged`.
7. Návrat: `return { status: "undone", runId, restored: restoredCount, removed: removedCount, kept };`

V `lawoss/okf/onboarding.d.mts` doplň do deklarácie výsledku vrátenia pole `kept: string[]` a do volieb `keepChanged?: boolean`, ak je `undoTriage` deklarované. Over: `rg -n "undoTriage" lawoss/okf/onboarding.d.mts`.

- [ ] **Krok 4: Spusti testy, typecheck, bundle a commit**

Run: `cd lawoss/okf && bun test test/triage-in-place.test.ts test/triage.test.ts && bun run typecheck && bun test test/ && bun run build`
Expected: PASS. Testy skúšobného klona (`describe("prerušenie a obnova")`) bez zmeny.

```bash
git add lawoss/okf/src/triage/apply.ts lawoss/okf/onboarding.d.mts lawoss/okf/test/triage-in-place.test.ts lawoss/okf/bundle/okf.js
git commit -m "feat: vrátenie usporiadania ponechá medzitým zmenené dokumenty"
```

---

### Úloha 6: Sprístupnenie pre server a CLI

**Files:**
- Modify: `lawoss/okf/onboarding.mjs`
- Modify: `lawoss/okf/onboarding.d.mts`
- Modify: `lawoss/okf/src/onboarding/cli.ts` (príkaz `suggest`)
- Test: `lawoss/okf/test/onboarding-cli.test.ts`

**Interfaces:**
- Consumes: všetko z úloh 1 až 5.
- Produces (plán C ich importuje cez `apps/server/src/lawoss/onboarding-runtime.ts`):
  - `suggestOnboardingLevel`, `grantInPlaceReorganize`, `verifyTriageTarget` zo seam `onboarding.mjs`
  - typy `OnboardingSuggestion`, `SuggestedLevel`, `SuggestedClient` v `onboarding.d.mts`; `OnboardingPreview.action` rozšírené o `"practice"`
  - CLI `okf onboard suggest <dir>`

- [ ] **Krok 1: Napíš padajúci test CLI**

Do `lawoss/okf/test/onboarding-cli.test.ts` pridaj test podľa vzoru existujúcich testov v súbore (pozri, ako volajú CLI a čítajú `result.output`):

```ts
test("onboard suggest vypíše návrh úrovne", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "okf-cli-suggest-")));
  await mkdir(join(root, "2024-03 Kúpna zmluva"), { recursive: true });
  const result = await run(["suggest", root]);
  expect(result.code).toBe(0);
  expect(JSON.parse(result.output)).toMatchObject({ level: "client", marked: false, signals: ["matter_named_children"] });
  await rm(root, { recursive: true, force: true });
});
```

`run(args)` je existujúca pomocná funkcia v tom istom súbore (`onboarding-cli.test.ts:16`, vracia `{ code, output }`); `mkdtemp`, `mkdir`, `realpath`, `rm`, `join` a `tmpdir` súbor už importuje.

- [ ] **Krok 2: Over, že test padá**

Run: `cd lawoss/okf && bun test test/onboarding-cli.test.ts -t "suggest"`
Expected: FAIL, výstup obsahuje `usage`.

- [ ] **Krok 3: Implementuj príkaz a seam**

V `lawoss/okf/src/onboarding/cli.ts` pridaj import `suggestOnboardingLevel` z `./suggest.ts`, rozšír `usage` o `okf onboard suggest <dir>` a za vetvu `classify` pridaj:

```ts
    if (command === "suggest") {
      only(flags, ["--json"]);
      if (args.length !== 2) throw new Error(usage);
      out(JSON.stringify(await suggestOnboardingLevel(args[1]!), null, 2));
      return 0;
    }
```

V `lawoss/okf/onboarding.mjs` pridaj:

```js
export { suggestOnboardingLevel } from "./src/onboarding/suggest.ts";
```

a export roztriedenia rozšír na:

```js
export { applyTriagePlan, grantInPlaceReorganize, listTriageRuns, parseClassification, prepareTriage, replanTriage, undoTriage, verifyTrialClone, verifyTriageTarget } from "./src/triage/index.ts";
```

V `lawoss/okf/onboarding.d.mts`:

```ts
export type SuggestedLevel = "practice" | "client" | "matter" | "unknown";
export interface SuggestedClient { path: string; name: string }
export interface OnboardingSuggestion {
  root: string;
  level: SuggestedLevel;
  marked: boolean;
  score: number;
  signals: string[];
  clientPattern?: string;
  clients: SuggestedClient[];
  complete: boolean;
}
export function suggestOnboardingLevel(root: string): Promise<OnboardingSuggestion>;
export function grantInPlaceReorganize(root: string, now?: Date): Promise<void>;
export function verifyTriageTarget(root: string, trialJournalDirectory?: string): Promise<{ root: string; mode: "trial" | "in_place"; journalVerified: boolean }>;
```

a v `OnboardingPreview` zmeň `action` na `"office" | "practice" | "client" | "subject" | "matter" | "existing"`.

- [ ] **Krok 4: Over server typy a testy**

Run: `cd lawoss/okf && bun test test/ && bun run typecheck && bun run build`
Run: `cd ../.. && pnpm --filter legalwork-server typecheck`
Expected: všetko bez chýb. Server zatiaľ nové funkcie nevolá (to je plán C), typecheck len overí, že seam a deklarácie sedia.

- [ ] **Krok 5: Commit**

```bash
git add lawoss/okf/onboarding.mjs lawoss/okf/onboarding.d.mts lawoss/okf/src/onboarding/cli.ts lawoss/okf/test/onboarding-cli.test.ts lawoss/okf/bundle/okf.js
git commit -m "feat: návrh úrovne a usporiadanie na mieste dostupné pre server a CLI"
```

---

## Mimo tohto plánu (patrí do plánu C)

- Server: endpointy `POST /lawoss/onboarding/suggest`, `POST /lawoss/onboarding/reorganize/grant`, hromadná úprava (jeden plán na klienta, postupne, súhrn), registrácia klientov praxe ako pracovných priečinkov.
- Oprava `400 invalid_scope`: hodí ju `apps/server/src/lawoss/onboarding.ts:123` (`POST /lawoss/onboarding/profile`), keď `inspectOnboardingRoot(clientRoot).level !== "client"`. Prvý krok plánu C je test, ktorý chybu zopakuje s presnými vstupmi z onboardingu.
- Predvolené hodnoty pre `convert` bez formulára „Prvý klient“: názov = meno priečinka, jurisdikcia a jazyk z kroku 1, typ klienta navrhnutý z právnej formy (`hasLegalForm` → `po`, inak `fo`) a upraviteľný na obrazovke „Toto som našiel“.
- Neúplné čítanie cloudového priečinka: `convert` dnes potrebuje úplnú inšpekciu klienta. Spec v tabuľke chýb hovorí, že `convert` má prejsť aj vtedy. Plán C to musí buď vyriešiť plytkou inšpekciou pre `convert`, alebo spec opraviť (návrh: opraviť spec, hlásiť „sprístupnite priečinok offline“).
