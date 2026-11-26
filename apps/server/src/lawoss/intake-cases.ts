import type { IntakeCase } from "@legalwork/types/folder-intake";

const clean = (value: string) => value.replace(/\[([^\]]+)\]\([^)]*\)/gu, "$1").replace(/[*`]/gu, "").trim();
const fold = (value: string) => clean(value).normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
const caseColumn = /^(?:(?:nazov|nazev|name of) )?(?:pripad(?:u|y)?|spis(?:u|y)?|vec|case|matter|fall)$/u;
const phaseColumn = /^(?:stav|faza|faze|phase|status)$/u;
const nextColumn = /^(?:dalsi krok|next step|nachster schritt)$/u;
const safe = (value: string, limit: number) => value.length <= limit && !/[\p{Cc}\p{Cf}\u2028\u2029]/u.test(value);
const keyOf = (title: string) => fold(title).replace(/\s+/gu, " ").trim();

export function identifiedCases(text: string, source: string): IntakeCase[] {
  const cases = new Map<string, IntakeCase>();
  const add = (title: string, phase?: string, next?: string) => {
    title = clean(title);
    if (title.length < 3 || !safe(title, 180) || !/\p{L}/u.test(title) || caseColumn.test(fold(title))) return;
    cases.set(keyOf(title), { title, source, ...(phase && safe(phase, 350) ? { phase } : {}), ...(next && safe(next, 350) ? { next_step: next } : {}) });
  };
  let columns: string[] = [];
  let inCaseSection = 0;
  let fenced = false;
  for (const raw of text.split(/\r?\n/u)) {
    if (/^\s*```/u.test(raw)) { fenced = !fenced; continue; }
    if (fenced) continue;
    const line = raw.trim();
    if (line.startsWith("|")) {
      const cells = line.replace(/^\||\|$/gu, "").split("|").map(clean);
      if (cells.some(cell => caseColumn.test(fold(cell)))) { columns = cells.map(fold); continue; }
      if (columns.length && !/^[:\s|-]+$/u.test(line)) {
        add(cells[columns.findIndex(value => caseColumn.test(value))] ?? "", cells[columns.findIndex(v => phaseColumn.test(v))], cells[columns.findIndex(v => nextColumn.test(v))]);
      }
      continue;
    }
    columns = [];
    const heading = /^(#{1,6})\s+(.+)$/u.exec(line);
    if (heading) {
      const level = heading[1].length;
      if (inCaseSection && level <= inCaseSection) inCaseSection = 0;
      if (/^(?:(?:otvorene|aktivne|aktivni|identifikovane|open|active) )?(?:pripady|spisy|veci|matters|cases)$/u.test(fold(heading[2]))) { inCaseSection = level; continue; }
      if (inCaseSection && level === inCaseSection + 1) add(heading[2]);
    }
    const explicit = /^(?:pr[íi]pad|případ|vec|věc|case|matter|fall)\s*:\s*(.{3,180})$/iu.exec(clean(heading?.[2] ?? line));
    if (explicit) add(explicit[1]);
    else if (inCaseSection && /^[-*]\s+/u.test(line)) add(line.slice(2));
  }
  return [...cases.values()];
}

export { keyOf as intakeCaseKey };

/** Explicit file references in letters and judgments also work when the client has no Markdown. */
export function referencedCase(text: string, source: string): IntakeCase | undefined {
  const ref = /(?:spisov[áa]\s+zna[čc]ka|sp\.?\s*zn\.?|case\s+(?:no\.?|number))\s*[:.\-]?\s*(\d{1,3}\s*[\p{L}]{1,9}\s*[ /_-]\s*\d{1,6}[ /_-](?:19|20)\d{2})\b/iu.exec(text);
  return ref ? { title: ref[1].replace(/\s+/gu, "").replace(/[_-]/gu, "/"), source } : undefined;
}

/** Rank sentences against the document's own word frequencies, locally and without a model transfer. */
export function representativePassage(text: string) {
  const sentences = text.slice(0, 96_000).split(/\n+|(?<=[.!?])\s+(?=\p{Lu})/u).map(clean)
    .filter(s => s.length >= 18 && !/^(?:[|#>-]|\w+:\/\/)/u.test(s));
  const words = (s: string) => fold(s).match(/\p{L}{4,}/gu) ?? [];
  const counts = new Map<string, number>();
  for (const word of words(sentences.join(" "))) counts.set(word, (counts.get(word) ?? 0) + 1);
  let best = "", highest = -1;
  for (const sentence of sentences) {
    const tokens = words(sentence);
    const score = [...new Set(tokens)].reduce((sum, w) => sum + Math.log1p(counts.get(w) ?? 0), 0) / Math.sqrt(Math.max(8, tokens.length));
    if (score > highest) { best = sentence; highest = score; }
  }
  return (best || text.replace(/\s+/gu, " ").trim()).slice(0, 220);
}

type TopicSource = { path: string; heading: string; terms: string[] };
const stopWords = new Set("klient klienta klientovi spisu pripadu pripad podklady subory dokument dokumentu dokumenty datum stav strana pravne pravny tento tieto ktore ktora podla zmluva zmluvy client documents document file matter sources note notes status overview final draft".split(" "));

/** An inverted term index keeps discovery linear in the selected documents, including flat folders. */
export function topicSource(path: string, text: string): TopicSource | undefined {
  const filename = path.split("/").at(-1)!.replace(/\.[^.]+$/u, "");
  const heading = clean(text.match(/^#\s+([^\n]{3,180})$/mu)?.[1] ?? text.split(/\r?\n/u, 3).find(line => line.trim().length > 8 && line.trim().length < 110 && !/^(?:---|\||\[)/u.test(line.trim())) ?? filename.replace(/[_-]+/gu, " ")).trim();
  if (!text.trim() || !safe(heading,180)) return;
  const terms = [...new Set(fold(heading + " " + filename + " " + text.slice(0,1600)).match(/\p{L}{4,}/gu) ?? [])].filter(t => !stopWords.has(t));
  return {path, heading, terms};
}

export function topicSuggestions(docs: TopicSource[]): IntakeCase[] {
  const frequency = new Map<string, number>();
  for (const doc of docs) for (const term of doc.terms) frequency.set(term, 1 + (frequency.get(term) ?? 0));
  const seen = new Map<string, number[]>(), used = new Set<number>(), result: IntakeCase[] = [];
  docs.forEach((doc, current) => {
    const scores = new Map<number, number>();
    for (const term of doc.terms) {
      const count = frequency.get(term)!;
      if (count < 2 || count > Math.max(3, Math.min(24, docs.length / 3))) continue;
      const owners = seen.get(term) ?? [];
      for (const i of owners) scores.set(i,(scores.get(i) ?? 0) + Math.log1p(docs.length / count));
      owners.push(current); seen.set(term, owners);
    }
    const best = [...scores].sort((a,b) => b[1] - a[1])[0];
    if (!best || best[1] < 3 * Math.log1p(docs.length / 2) || used.has(best[0])) return;
    const anchor = docs[best[0]];
    result.push({title: anchor.heading, source: anchor.path});
    used.add(best[0]); used.add(current);
  });
  return result;
}
