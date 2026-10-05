/**
 * Deterministické pravidlá roztriedenia. Čistý modul bez súborového systému a bez modelu:
 * rovnaký vstup dá vždy rovnaký výsledok, appka ich vie ukázať aj bez pripojeného modelu.
 *
 * Pravidlá čítajú iba názov, príponu a pôvodné priečinky dokumentu. Obsah dokumentu
 * nečítajú; na to slúži voliteľná klasifikácia modelom (skill `roztried-spis`).
 */

/** Stabilné roly pracovného profilu (`profile.ts`), do ktorých triedenie smie zaradiť dokument. */
export const TRIAGE_ROLES = ["inbox", "client_documents", "research", "drafts", "outputs", "correspondence", "important_mail"] as const;
export type TriageRole = (typeof TRIAGE_ROLES)[number];
export type Confidence = "high" | "medium" | "low";

/** Kód pravidla je strojový; appka ho prekladá, CLI ho vypíše ako je. */
export type RuleCode =
  | "email_file" | "data_box" | "power_of_attorney" | "court_decision" | "draft_marker" | "filing_final"
  | "filing_draft" | "contract" | "invoice" | "registry_extract" | "research" | "final_output"
  | "folder_hint" | "unknown";

export type RuleResult = { role: TriageRole | null; confidence: Confidence; rule: RuleCode; matched?: string; caseNumber?: CaseNumber };
export type CaseNumber = { key: string; display: string };

/** Malé písmená bez diakritiky, oddeľovače ako medzery. „Žaloba_v2“ → „zaloba v2“. */
export function normalizeText(value: string): string {
  return value.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[_\-.,;()[\]{}+]+/g, " ").replace(/\s+/g, " ").trim();
}

const EMAIL_EXT = new Set(["eml", "msg", "emlx", "mbox", "oft"]);
const DATA_BOX_EXT = new Set(["zfo", "asice", "asics"]);
const WORD_EXT = new Set(["docx", "doc", "docm", "odt", "rtf", "pages", "dotx"]);
const PDF_EXT = new Set(["pdf"]);

type Keyword = { words: readonly string[]; rule: RuleCode; role: TriageRole; confidence: Confidence; ext?: ReadonlySet<string> };

/** Slová sú už normalizované (bez diakritiky); zhoda je na hranici slova alebo ako začiatok slova. */
const KEYWORDS: readonly Keyword[] = [
  { rule: "power_of_attorney", role: "client_documents", confidence: "high", words: ["plnomocenstvo", "plnomocnenstvo", "plna moc", "plnou moc", "plne moci", "power of attorney", "splnomocnenie"] },
  { rule: "court_decision", role: "important_mail", confidence: "medium", words: ["rozsudok", "rozsudek", "rozsudku", "uznesenie", "uznesenia", "usneseni", "platobny rozkaz", "platebni rozkaz", "predvolanie", "predvolani", "vyzva sudu", "vyzva soudu", "exekucny prikaz", "exekucni prikaz", "upovedomenie", "vyrozumenie", "rozhodnutie", "rozhodnuti", "dorucenka", "judgment", "court order"] },
  { rule: "draft_marker", role: "drafts", confidence: "high", ext: WORD_EXT, words: ["draft", "navrh", "koncept", "pracovn", "wip", "redline", "verzia", "verze", "version", "rev", "v0", "v1", "v2", "v3", "v4", "v5", "v6", "v7", "v8", "v9"] },
  { rule: "filing_final", role: "outputs", confidence: "medium", ext: PDF_EXT, words: ["zaloba", "zalobu", "navrh na", "odvolanie", "odvolani", "dovolanie", "dovolani", "vyjadrenie", "vyjadreni", "replika", "duplika", "triplika", "podanie", "podani", "staznost", "stiznost", "odpor", "namietky", "namitky", "statement of claim", "appeal"] },
  { rule: "contract", role: "client_documents", confidence: "medium", words: ["zmluva", "zmluvy", "zmluvu", "smlouva", "smlouvy", "smlouvu", "dohoda", "dohody", "dodatok", "dodatek", "contract", "agreement", "nda"] },
  { rule: "invoice", role: "client_documents", confidence: "medium", words: ["faktura", "faktury", "invoice", "dobropis", "proforma", "ucet za", "vyuctovanie", "vyuctovani"] },
  { rule: "registry_extract", role: "client_documents", confidence: "medium", words: ["vypis", "list vlastnictva", "list vlastnictvi", "obchodny register", "obchodni rejstrik", "orsr", "rpvs", "zivnostensky", "extract"] },
  { rule: "research", role: "research", confidence: "medium", words: ["resers", "reserse", "reserz", "judikat", "judikatura", "research", "memo", "analyza", "komentar", "rozbor"] },
  { rule: "final_output", role: "outputs", confidence: "medium", words: ["stanovisko", "posudok", "posudek", "legal opinion", "opinion", "finalne", "finalni", "final"] },
];

/** Návrh podania vo Worde je pracovný dokument; do výstupov patrí až PDF. */
const FILING_DRAFT: Keyword = { rule: "filing_draft", role: "drafts", confidence: "medium", ext: WORD_EXT, words: KEYWORDS.find(item => item.rule === "filing_final")!.words };

/** Pôvodné priečinky, ktoré si advokát pomenoval sám; slabší signál ako názov dokumentu. */
const FOLDER_HINTS: readonly { words: readonly string[]; role: TriageRole }[] = [
  { role: "correspondence", words: ["korespondencia", "korespondence", "posta", "email", "emaily", "maily", "mail", "correspondence", "komunikacia", "komunikace"] },
  { role: "drafts", words: ["drafty", "drafts", "koncepty", "navrhy", "pracovne"] },
  { role: "client_documents", words: ["zmluvy", "smlouvy", "podklady", "od klienta", "dokumenty klienta", "doklady"] },
  { role: "outputs", words: ["podania", "podani", "vystupy", "outputs", "odoslane", "odeslane"] },
  { role: "research", words: ["reserse", "resers", "research", "judikatura"] },
];

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
/** Začiatok slova: „zmluv“ sa nájde v „zmluva“, ale „rev“ nie v „prevod“. Krátke tokeny (≤ 3) musia byť celé slovo. */
function findWord(text: string, words: readonly string[]): string | undefined {
  for (const word of words) {
    const tail = word.length <= 3 ? "(?:$|\\s|\\d)" : "";
    if (new RegExp(`(?:^|\\s)${escapeRegExp(word)}${tail}`).test(text)) return word;
  }
  return undefined;
}

/**
 * Spisová značka z názvu alebo priečinka: „8C 123/2023“, „15 C 123/2023“, „43 INS 8294/2021“.
 * V názve súboru býva lomka nahradená podčiarkovníkom alebo pomlčkou („8C_123_2023“).
 */
export function findCaseNumber(text: string): CaseNumber | undefined {
  const match = /(?:^|[^\p{L}\d])(\d{1,3})[ _-]?([A-Z][A-Za-z]{0,4})[ _/-]?(\d{1,6})[ _/-]((?:19|20)\d{2})(?![\p{L}\d])/u.exec(text);
  if (!match) return undefined;
  const [, senate, register, number, year] = match;
  if (!senate || !register || !number || !year) return undefined;
  const key = `${senate}${register.toUpperCase()}-${Number(number)}-${year}`;
  return { key, display: `${senate}${register} ${Number(number)}/${year}` };
}

export type RuleInput = { path: string; name: string; ext: string };

/** Prvé zhodné pravidlo vyhráva; poradie je zámerné (e-mail pred obsahom, návrh vo Worde pred podaním). */
export function classifyByRules(input: RuleInput): RuleResult {
  const ext = input.ext.toLowerCase();
  const stem = input.ext ? input.name.slice(0, -(input.ext.length + 1)) : input.name;
  const text = normalizeText(stem);
  const folders = input.path.split("/").slice(0, -1);
  const caseNumber = findCaseNumber(stem) ?? folders.map(findCaseNumber).find(Boolean);
  const result = (value: Omit<RuleResult, "caseNumber">): RuleResult => caseNumber ? { ...value, caseNumber } : value;
  if (EMAIL_EXT.has(ext)) return result({ role: "correspondence", confidence: "high", rule: "email_file", matched: `.${ext}` });
  if (DATA_BOX_EXT.has(ext)) return result({ role: "important_mail", confidence: ext === "zfo" ? "high" : "medium", rule: "data_box", matched: `.${ext}` });
  for (const keyword of [KEYWORDS[0]!, KEYWORDS[1]!, KEYWORDS[2]!, FILING_DRAFT, ...KEYWORDS.slice(3)]) {
    if (keyword.ext && !keyword.ext.has(ext)) continue;
    const matched = findWord(text, keyword.words);
    if (matched) return result({ role: keyword.role, confidence: keyword.confidence, rule: keyword.rule, matched });
  }
  for (const folder of [...folders].reverse()) {
    const name = normalizeText(folder);
    for (const hint of FOLDER_HINTS) {
      const matched = findWord(name, hint.words);
      if (matched) return result({ role: hint.role, confidence: "medium", rule: "folder_hint", matched: folder });
    }
  }
  return result({ role: null, confidence: "low", rule: "unknown" });
}
