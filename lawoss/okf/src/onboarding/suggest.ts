/**
 * Návrh, či je vybraný priečinok prax, klient alebo vec. Číta len mená (žiadny obsah, žiadne
 * hashe), takže zvládne aj celú prax. Výsledok je návrh s mierou istoty; rozhoduje advokát.
 * `inspectOnboardingRoot` a jej `level` ostávajú autoritatívne pre zápis (brána `convert`).
 */
import { lstat, readdir, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { realpath } from "../canonical-path.ts";
import { decodeText } from "../../../okf-pamat/src/text-decode.ts";
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

export async function suggestOnboardingLevel(root: string): Promise<OnboardingSuggestion> {
  const survey = await surveyFolder(root);
  const base = { root: survey.root, complete: survey.complete, clients: [] };
  const index = indexChildren(survey.entries);
  const top = childrenOf(index, "");
  const topFiles = top.filter(entry => entry.kind === "file").map(entry => nameOf(entry.path).toLowerCase());
  if (topFiles.some(name => CLIENT_CARDS.has(name))) return { ...base, level: "client", marked: true, score: 1, signals: ["client_card"] };
  if (topFiles.some(name => MATTER_CARDS.has(name))) return { ...base, level: "matter", marked: true, score: 1, signals: ["matter_card"] };
  const office = OFFICE_DIRS.find(name => survey.entries.some(entry => entry.path === `${name}/okf.config` && entry.kind === "file"));
  if (office) {
    const config = await readFile(join(survey.root, office, "okf.config")).then(decodeText, () => "");
    const clientPattern = /^client_path:\s*["']?([^"'\r\n]+?)["']?\s*$/m.exec(config)?.[1] ?? "Klienti/*";
    return { ...base, level: "practice", marked: true, score: 1, signals: ["office_config"], clientPattern, clients: matchPattern(index, clientPattern) };
  }
  if (!top.length) return { ...base, level: "unknown", marked: false, score: 0, signals: ["empty"] };

  const dirs = top.filter(entry => entry.kind === "directory");
  const buckets = dirs.filter(entry => LETTER.test(nameOf(entry.path)));
  const bucketed = buckets.length >= PRACTICE_MIN_CLIENTS && buckets.length >= dirs.length * 0.8;
  const candidates = bucketed ? buckets.flatMap(bucket => childrenOf(index, bucket.path).filter(entry => entry.kind === "directory")) : dirs;
  const legal = candidates.filter(candidate => hasLegalForm(nameOf(candidate.path)));
  const withMatters = candidates.filter(candidate => childrenOf(index, candidate.path).some(entry => entry.kind === "directory" && looksLikeMatterName(nameOf(entry.path))));
  const clientish = new Set([...legal, ...withMatters].map(candidate => candidate.path));
  const ratio = candidates.length ? clientish.size / candidates.length : 0;
  if (candidates.length >= PRACTICE_MIN_CLIENTS && ratio >= PRACTICE_MIN_RATIO) {
    const signals: SuggestionSignal[] = [];
    if (bucketed) signals.push("letter_buckets");
    if (legal.length) signals.push("legal_form_children");
    if (withMatters.length) signals.push("matter_named_children");
    return { ...base, level: "practice", marked: false, score: round(ratio), signals, clientPattern: bucketed ? "*/*" : "*", clients: candidates.map(candidate => ({ path: candidate.path, name: nameOf(candidate.path) })) };
  }
  // The root is a native absolute path; only survey entries use portable "/" paths.
  if (looksLikeMatterName(basename(survey.root))) return { ...base, level: "matter", marked: false, score: 0.8, signals: ["matter_named_root"] };
  if (dirs.some(entry => looksLikeMatterName(nameOf(entry.path)))) return { ...base, level: "client", marked: false, score: 0.8, signals: ["matter_named_children"] };
  if (!dirs.length) return { ...base, level: "matter", marked: false, score: 0.5, signals: ["documents_only"] };
  return { ...base, level: "client", marked: false, score: 0.5, signals: ["plain_directories"] };
}
