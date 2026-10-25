/**
 * Návrh, či je vybraný priečinok prax, klient alebo vec. Číta len mená (žiadny obsah, žiadne
 * hashe), takže zvládne aj celú prax. Výsledok je návrh s mierou istoty; rozhoduje advokát.
 * `inspectOnboardingRoot` a jej `level` ostávajú autoritatívne pre zápis (brána `convert`).
 */
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { realpath } from "../canonical-path.ts";
import { decodeText } from "../../../okf-pamat/src/text-decode.ts";
import { findAncestorOffice, VOLATILE_ENTRY } from "./classify.ts";
import { codeOf, hasLegalForm, isBareDate, looksLikeMatterFolder, looksLikeMatterName, nestedClientCode, startsWithMatterWord } from "./suggest-patterns.ts";

export type SuggestedLevel = "practice" | "client" | "matter" | "unknown";
export type SuggestionSignal = "office_config" | "office_without_config" | "client_card" | "matter_card" | "legal_form_children" | "matter_named_children" | "coded_hierarchy" | "letter_buckets" | "matter_named_root" | "documents_only" | "plain_directories" | "empty" | "inside_office";
export type SuggestedClient = { path: string; name: string };
/**
 * `childOffices`: priame podpriečinky s kanceláriou OKF (`<meno>/Office/okf.config`); pole je len keď nejaký je.
 * `practiceCandidates` a `practicePattern`: klienti a vzor pre prípad, že advokát návrh ručne opraví na „Celá prax“
 * (N-9, 22. 10. 2026). Sú v každom návrhu; `clients` ostáva len pre návrh praxe, aby sa nezmenil jeho význam.
 */
/**
 * Náhľad stromu pre obrazovku „Toto sme našli“ (C1, 22. 10. 2026): pre koreň (`path` „“) a každého kandidáta praxe
 * jeho prípady a počet súborov. Len z už nasnímaných mien, bez ďalšieho čítania disku. `exact: false`, ak prieskum
 * pod jednotkou narazil na hĺbku alebo limit: počty sú vtedy dolná hranica. Mená sú mená priečinkov.
 */
export type SuggestedUnit = { path: string; matters: SuggestedClient[]; matterCount: number; files: number; exact: boolean };
export type OnboardingSuggestion = { root: string; level: SuggestedLevel; marked: boolean; score: number; signals: SuggestionSignal[]; clientPattern?: string; clients: SuggestedClient[]; practiceCandidates: SuggestedClient[]; practicePattern: string; complete: boolean; childOffices?: string[]; units: SuggestedUnit[] };
export type SurveyEntry = { path: string; kind: "file" | "directory" };
export type FolderSurvey = { root: string; complete: boolean; entries: SurveyEntry[] };

/** Prvé prahy (spec, otvorená otázka 1); doladia sa na anonymizovanom strome reálnej praxe. */
export const PRACTICE_MIN_CLIENTS = 5;
export const PRACTICE_MIN_RATIO = 0.5;
/** Kódovaná hierarchia (C002/M004…) je štrukturálny signál: stačia dvaja klienti (N-9, prax s tromi klientmi). */
export const CODED_MIN_CLIENTS = 2;
const CODED_SCORE = 0.8;
/** Kancelária OKF bez okf.config (Office/ s AGENTS.md, CLAUDE.md alebo memory/ a karty klientov v Klienti/*). */
const LEGACY_OFFICE_SCORE = 0.9;
/** Istota slabého návrhu (rovnaká ako pri obyčajných priečinkoch): advokát sa má rozhodnúť sám. */
const WEAK_SCORE = 0.5;
const SURVEY_DEPTH = 4;
/** Náhľad stromu ostáva malý aj pri veľkej praxi; zvyšok je len počet. */
const UNIT_LIMIT = 200;
const UNIT_MATTERS = 50;
const MATTER_FOLDERS = new Set(["spisy", "pripady", "případy", "matters"]);
const SURVEY_ENTRIES = 50_000;
const CLIENT_CARDS = new Set(["client.md", "klient.md"]);
const MATTER_CARDS = new Set(["matter.md", "spis.md", "project.md", "projekt.md"]);
const OFFICE_DIRS = ["Office", "_kancelaria"];
const OFFICE_EVIDENCE = new Set(["agents.md", "claude.md", "memory"]);
const CLIENTS_DIR = "Klienti";
const LETTER = /^\p{Lu}$/u;

/**
 * Meno z relatívnej cesty položky prieskumu, tá sa skladá cez „/“ na každej platforme. Koreň je natívna cesta, preto
 * `basename`. V NFC: „Případy“ z macOS alebo SMB v NFD sa inak s menami priečinkov prípadov nezhodne (#223).
 */
const nameOf = (path: string): string => rawNameOf(path).normalize("NFC");
/** Meno v tvare na disku: appka z neho skladá cestu (`childOffices` → výber podpriečinka), NFC by na NFD disku neexistovalo. */
const rawNameOf = (path: string): string => path.split("/").pop() ?? path;
/** Priami potomkovia každého priečinka; kľúč „“ je koreň. Index sa postaví raz, nie pri každom hľadaní. */
type ChildIndex = Map<string, SurveyEntry[]>;
const indexChildren = (entries: SurveyEntry[]): ChildIndex => {
  const index: ChildIndex = new Map();
  for (const entry of entries) {
    const slash = entry.path.lastIndexOf("/");
    const parent = slash < 0 ? "" : entry.path.slice(0, slash);
    const siblings = index.get(parent);
    if (siblings) siblings.push(entry); else index.set(parent, [entry]);
  }
  return index;
};
const childrenOf = (index: ChildIndex, parent: string): SurveyEntry[] => index.get(parent) ?? [];
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
function matchPattern(index: ChildIndex, pattern: string): SuggestedClient[] {
  let level = [""];
  for (const segment of pattern.split("/").filter(Boolean)) {
    level = level.flatMap(parent => childrenOf(index, parent)
      .filter(entry => entry.kind === "directory" && !OFFICE_DIRS.includes(nameOf(entry.path)) && (segment === "*" || nameOf(entry.path) === segment))
      .map(entry => entry.path));
  }
  return level.filter(Boolean).map(path => ({ path, name: nameOf(path) }));
}

/** Podpriečinky kandidáta, v ktorých môže ležať vec: priamo pod ním aj pod `Spisy/` (štruktúra OKF), ako v `mattersOf`. */
function matterLevelDirs(index: ChildIndex, parent: string): SurveyEntry[] {
  const dirs = childrenOf(index, parent).filter(entry => entry.kind === "directory");
  const filed = dirs.filter(entry => MATTER_FOLDERS.has(nameOf(entry.path).toLowerCase()))
    .flatMap(folder => childrenOf(index, folder.path).filter(entry => entry.kind === "directory"));
  return [...dirs, ...filed];
}

/**
 * Kódovaná hierarchia (R1 bod 1A): aspoň dvaja kandidáti na klienta s kódom jedného prefixu (C002, C017, C022),
 * kódovaní tvoria väčšinu kandidátov a aspoň dvaja a aspoň polovica z nich majú podpriečinok (aj pod `Spisy/`)
 * s kódom iného prefixu (M004…). Nový klient zatiaľ bez veci prax nezhodí na jedného klienta (review #221), ale
 * jeden klient s vecami M001…M005, z ktorých dve majú kódované podpriečinky (F001), praxou nie je. Iný prefix na
 * druhej úrovni odlíši prax od klienta s číslovanými vecami (M001…M003 so súbormi); rovnaký prefix pod
 * kódovaným kandidátom (C001/C010) prax vylúči. Ak sa kódovaní pomenúvajú slovom veci („M001 Spor“,
 * „M002 Zmluva“), sú to veci jedného klienta, nie klienti (review A4, I-1).
 */
function codedHierarchy(index: ChildIndex, candidates: readonly SurveyEntry[]): boolean {
  const coded = candidates.flatMap(candidate => { const code = codeOf(nameOf(candidate.path)); return code ? [{ candidate, code }] : []; });
  if (coded.length < CODED_MIN_CLIENTS || coded.length * 2 < candidates.length) return false;
  const prefixes = new Set(coded.map(({ code }) => code.prefix));
  const [prefix] = prefixes;
  if (prefixes.size !== 1 || !prefix) return false;
  if (coded.filter(({ code }) => startsWithMatterWord(code.rest)).length * 2 >= coded.length) return false;
  const childPrefixes = coded.map(({ candidate }) => matterLevelDirs(index, candidate.path)
    .flatMap(entry => { const child = codeOf(nameOf(entry.path)); return child ? [child.prefix] : []; }));
  if (childPrefixes.some(found => found.includes(prefix))) return false;
  const withMatters = childPrefixes.filter(found => found.length > 0).length;
  return withMatters >= CODED_MIN_CLIENTS && withMatters * 2 >= coded.length;
}

/**
 * Kancelária OKF bez `okf.config` (napr. založená skillom OKF alebo ručne, dátová sada v1): priečinok Office
 * s obsahom OKF a aspoň jeden klient s kartou v `Klienti/*`. Iba návrh; značkou kancelárie sa stane až zápisom
 * `okf.config` po potvrdení advokátom (holý Office bez okf.config kanceláriou nie je, classify.ts).
 */
function legacyOffice(index: ChildIndex): boolean {
  const office = OFFICE_DIRS.some(name => childrenOf(index, name).some(entry => OFFICE_EVIDENCE.has(nameOf(entry.path).toLowerCase())));
  return office && childrenOf(index, CLIENTS_DIR).some(client => client.kind === "directory" && childrenOf(index, client.path).some(entry => entry.kind === "file" && CLIENT_CARDS.has(nameOf(entry.path).toLowerCase())));
}

/** Hĺbka relatívnej cesty prieskumu („a“ = 1, „a/b“ = 2). */
const depthOf = (path: string): number => path ? path.split("/").length : 0;

/**
 * Prípady jednotky: podpriečinky `Spisy/` (štruktúra OKF) a popri nich podpriečinky s kartou veci, kódom („M004 …“)
 * alebo menom veci. Prázdny `Spisy/` z pomocných súborov tak prípady vedľa neho neskryje (N-A2-3, 23. 10. 2026).
 * Pracovné priečinky klienta („01_Podklady“) prípadmi nie sú.
 */
function mattersOf(index: ChildIndex, files: ReadonlySet<string>, unit: string, unitName: string): SuggestedClient[] {
  const prefix = unit ? `${unit}/` : "";
  const dirs = childrenOf(index, unit).filter(entry => entry.kind === "directory");
  const folders = dirs.filter(entry => MATTER_FOLDERS.has(nameOf(entry.path).toLowerCase()));
  // Priečinok s vlastnou kartou klienta (a bez karty prípadu) je vnorený klient, nie prípad (N-A4-4, MČ 23. 10. 2026).
  const card = (entry: SurveyEntry, cards: ReadonlySet<string>) => childrenOf(index, entry.path).some(child => child.kind === "file" && cards.has(nameOf(child.path).toLowerCase()));
  const nestedClient = (entry: SurveyEntry) => card(entry, CLIENT_CARDS) && !card(entry, MATTER_CARDS);
  const filed = folders.flatMap(folder => childrenOf(index, folder.path).filter(entry => entry.kind === "directory"));
  const beside = dirs.filter(entry => !folders.includes(entry)
    && ([...MATTER_CARDS].some(card => files.has(`${entry.path}/${card}`))
      || (looksLikeMatterFolder(nameOf(entry.path)) && !nestedClientCode(unitName, nameOf(entry.path)))));
  return [...filed, ...beside].filter(entry => !nestedClient(entry)).map(entry => ({ path: entry.path.slice(prefix.length), name: nameOf(entry.path) }));
}

/**
 * Strom náhľadu z prieskumu (počty súborov, prípady); prieskum sa nečíta znova. `clients`: pri návrhu praxe jej
 * klienti, ktorí nie sú prípadmi koreňa, hoci ich kód (C002) vyzerá ako kód veci (review #221).
 */
function unitsOf(survey: FolderSurvey, index: ChildIndex, paths: readonly string[], clients: ReadonlySet<string> = new Set()): SuggestedUnit[] {
  const files = new Set(survey.entries.filter(entry => entry.kind === "file").map(entry => entry.path));
  return paths.slice(0, UNIT_LIMIT).map(path => {
    const prefix = path ? `${path}/` : "";
    const inside = path ? survey.entries.filter(entry => entry.path.startsWith(prefix)) : survey.entries;
    // Priečinok v najväčšej hĺbke prieskumu sa už neotvoril: počty pod ním chýbajú.
    const exact = survey.complete && !inside.some(entry => entry.kind === "directory" && depthOf(entry.path) >= SURVEY_DEPTH);
    const matters = mattersOf(index, files, path, path ? nameOf(path) : basename(survey.root)).filter(matter => path || !clients.has(matter.path));
    return { path, matters: matters.slice(0, UNIT_MATTERS), matterCount: matters.length, files: inside.filter(entry => entry.kind === "file").length, exact };
  });
}

export async function suggestOnboardingLevel(root: string): Promise<OnboardingSuggestion> {
  const survey = await surveyFolder(root);
  const suggestion = await suggestFromSurvey(survey);
  const index = indexChildren(survey.entries);
  const clients = new Set(suggestion.level === "practice" ? suggestion.clients.map(client => client.path) : []);
  const units = unitsOf(survey, index, ["", ...new Set([...suggestion.clients, ...suggestion.practiceCandidates].map(client => client.path))], clients);
  return { ...suggestion, units };
}

async function suggestFromSurvey(survey: FolderSurvey): Promise<Omit<OnboardingSuggestion, "units">> {
  const index = indexChildren(survey.entries);
  const top = childrenOf(index, "");
  // Kancelária vnorená o úroveň nižšie (MČ 19. 10. 2026): advokát má zrejme pripojiť priamo ten podpriečinok.
  const files = new Set(survey.entries.filter(entry => entry.kind === "file").map(entry => entry.path));
  const childOffices = top.filter(entry => entry.kind === "directory" && OFFICE_DIRS.some(office => files.has(`${entry.path}/${office}/okf.config`))).map(entry => rawNameOf(entry.path));
  // Priečinky kancelárie nie sú klienti; ostatné priečinky najvyššej úrovne sú kandidáti (pri písmenách o úroveň nižšie).
  const dirs = top.filter(entry => entry.kind === "directory" && !OFFICE_DIRS.includes(nameOf(entry.path)));
  const buckets = dirs.filter(entry => LETTER.test(nameOf(entry.path)));
  const bucketed = buckets.length >= PRACTICE_MIN_CLIENTS && buckets.length >= dirs.length * 0.8;
  const candidates = bucketed ? buckets.flatMap(bucket => childrenOf(index, bucket.path).filter(entry => entry.kind === "directory")) : dirs;
  // Priečinok pomenovaný ako vec („2024-01 Spor s Alfa s.r.o.“) je vec, nie klient, aj keď nesie právnu formu
  // protistrany; holý rok či dátum je archív. Ani jeden sa nepočíta za klienta, v menovateli ostávajú.
  const matterNamed = candidates.filter(candidate => looksLikeMatterName(nameOf(candidate.path)));
  const clientCandidates = candidates.filter(candidate => !looksLikeMatterName(nameOf(candidate.path)) && !isBareDate(nameOf(candidate.path)));
  const heuristicClients = clientCandidates.map(candidate => ({ path: candidate.path, name: nameOf(candidate.path) }));
  const heuristicPattern = bucketed ? "*/*" : "*";
  // Kandidáti pre ručnú opravu na „Celá prax“: priečinok Klienti (štruktúra OKF), inak kandidáti heuristiky.
  const klienti = dirs.some(entry => nameOf(entry.path) === CLIENTS_DIR);
  const practice = klienti ? { practiceCandidates: matchPattern(index, `${CLIENTS_DIR}/*`), practicePattern: `${CLIENTS_DIR}/*` } : { practiceCandidates: heuristicClients, practicePattern: heuristicPattern };
  const base = { root: survey.root, complete: survey.complete, clients: [], ...practice, ...(childOffices.length ? { childOffices } : {}) };
  const topFiles = top.filter(entry => entry.kind === "file").map(entry => nameOf(entry.path).toLowerCase());
  if (topFiles.some(name => CLIENT_CARDS.has(name))) return { ...base, level: "client", marked: true, score: 1, signals: ["client_card"] };
  if (topFiles.some(name => MATTER_CARDS.has(name))) return { ...base, level: "matter", marked: true, score: 1, signals: ["matter_card"] };
  const office = OFFICE_DIRS.find(name => survey.entries.some(entry => entry.path === `${name}/okf.config` && entry.kind === "file"));
  if (office) {
    const config = await readFile(join(survey.root, office, "okf.config")).then(decodeText, () => "");
    const clientPattern = /^client_path:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(config)?.[1] ?? "Klienti/*";
    const clients = matchPattern(index, clientPattern);
    return { ...base, level: "practice", marked: true, score: 1, signals: ["office_config"], clientPattern, clients, practiceCandidates: clients, practicePattern: clientPattern };
  }
  if (legacyOffice(index)) {
    if (await findAncestorOffice(survey.root)) return { ...base, level: "unknown", marked: false, score: 0, signals: ["inside_office"] };
    const clients = matchPattern(index, `${CLIENTS_DIR}/*`);
    return { ...base, level: "practice", marked: false, score: LEGACY_OFFICE_SCORE, signals: ["office_without_config"], clientPattern: `${CLIENTS_DIR}/*`, clients, practiceCandidates: clients, practicePattern: `${CLIENTS_DIR}/*` };
  }
  if (!top.length) return { ...base, level: "unknown", marked: false, score: 0, signals: ["empty"] };

  const legal = clientCandidates.filter(candidate => hasLegalForm(nameOf(candidate.path)));
  const withMatters = clientCandidates.filter(candidate => childrenOf(index, candidate.path).some(entry => entry.kind === "directory" && looksLikeMatterName(nameOf(entry.path))));
  const clientish = new Set([...legal, ...withMatters].map(candidate => candidate.path));
  const ratio = candidates.length ? clientish.size / candidates.length : 0;
  // Prevažujú mená vecí: typický jeden klient (spec P4), nie prax.
  const mattersDominate = matterNamed.length * 2 > candidates.length;
  const coded = !bucketed && codedHierarchy(index, clientCandidates);
  const byNames = clientCandidates.length >= PRACTICE_MIN_CLIENTS && ratio >= PRACTICE_MIN_RATIO;
  if (!mattersDominate && (byNames || coded)) {
    // Vnútri existujúcej kancelárie nová prax nevznikne (planPracticeOffice ju odmietne); návrh nechá úroveň na advokátovi.
    if (await findAncestorOffice(survey.root)) return { ...base, level: "unknown", marked: false, score: 0, signals: ["inside_office"] };
    const signals: SuggestionSignal[] = [];
    if (coded) signals.push("coded_hierarchy");
    if (bucketed) signals.push("letter_buckets");
    if (legal.length) signals.push("legal_form_children");
    if (withMatters.length) signals.push("matter_named_children");
    // Jediný signál sú podpriečinky pomenované ako veci: rovnako vyzerá klient s datovanými verziami vecí
    // („Kúpna zmluva/2024-01 návrh“). Prax sa len ponúkne s nízkou istotou, rozhodne advokát.
    const score = coded ? Math.max(round(ratio), CODED_SCORE) : signals.length === 1 && signals[0] === "matter_named_children" ? Math.min(round(ratio), WEAK_SCORE) : round(ratio);
    return { ...base, level: "practice", marked: false, score, signals, clientPattern: heuristicPattern, clients: heuristicClients, practiceCandidates: heuristicClients, practicePattern: heuristicPattern };
  }
  if (looksLikeMatterName(basename(survey.root))) return { ...base, level: "matter", marked: false, score: 0.8, signals: ["matter_named_root"] };
  if (dirs.some(entry => looksLikeMatterName(nameOf(entry.path)))) return { ...base, level: "client", marked: false, score: 0.8, signals: ["matter_named_children"] };
  // Len dokumenty: ani jeden priečinok (ani holý Office, ten necháva rozhodnutie na advokátovi).
  if (!top.some(entry => entry.kind === "directory")) return { ...base, level: "matter", marked: false, score: 0.5, signals: ["documents_only"] };
  return { ...base, level: "client", marked: false, score: WEAK_SCORE, signals: ["plain_directories"] };
}
