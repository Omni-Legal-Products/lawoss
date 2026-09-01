/**
 * Schéma OKF pamäte.
 *
 * **Jadro stojí na anglických kľúčoch** (rozhodnutie O6). Na disku je jeden
 * kanonický tvar pre obe jurisdikcie — `type: decision`, `deadlines:`,
 * `## Truth`. Spis prenesený medzi jurisdikciami sa tým neprepisuje a nová
 * krajina je nový locale, nie tretí stĺpec schémy a migrácia dát.
 *
 * Stĺpce `cz` a `sk` **prestali byť kľúčmi** a sú z nich popisky pre človeka:
 * používa ich validátor v hláškach a appka pri zobrazení. Perzistencia je
 * anglická, rozhranie lokalizované.
 *
 * Kde sa právo medzi jurisdikciami naozaj líši, riešením nie je jeden kľúč
 * s dvomi prekladmi, ale **dve kanonické polia s odlišným významom** —
 * preklad rieši jazyk, nie rozdiel v práve.
 */

export type Jurisdiction = "cz" | "sk";
export type Layer = "L1" | "L2" | "L3";

export type RecordType =
  | "matter"
  | "decision"
  | "subject"
  | "question"
  | "screening"
  | "rule"
  | "lesson"
  | "authority";

export const RECORD_TYPES: readonly RecordType[] = [
  "matter",
  "decision",
  "subject",
  "question",
  "screening",
  "rule",
  "lesson",
  "authority",
];

/** Do ktorej pamäťovej vrstvy typ patrí. Určuje, kto smie zapisovať. */
export const LAYER_OF: Record<RecordType, Layer> = {
  matter: "L2",
  decision: "L2",
  subject: "L2",
  question: "L2",
  screening: "L2",
  rule: "L1",
  lesson: "L1",
  authority: "L3",
};

export type FieldKind = "string" | "number" | "list";

/** Stav záznamu. `superseded` = prekonaný novším, `void` = zrušený ako omyl. */
export const STATUS = ["active", "superseded", "void"] as const;
export type Status = (typeof STATUS)[number];

/** Druh osoby. Rozlíšenie fyzická × právnická je v CZ aj SK rovnaké. */
export const PERSON_KINDS = ["natural_person", "legal_person", "sole_trader"] as const;
export type PersonKind = (typeof PERSON_KINDS)[number];

/** Vzťah subjektu ku kancelárii — nie procesné postavenie v konaní. */
export const ROLES = ["client", "counterparty", "representative", "ubo"] as const;
export type Role = (typeof ROLES)[number];

/** Riziková kategória AML preverenia. */
export const RISK = ["low", "medium", "high"] as const;
export type Risk = (typeof RISK)[number];

/** Záver AML preverenia. */
export const CONCLUSION = ["proceed", "enhanced_diligence", "decline"] as const;
export type Conclusion = (typeof CONCLUSION)[number];

/** Režim subjektového preverenia podľa spec 0002. */
export const SCREENING_MODES = ["light", "medium", "hard"] as const;
export type ScreeningMode = (typeof SCREENING_MODES)[number];

/**
 * Sila, s akou sa hodnota poľa hľadá pri kontrole úniku do L3.
 *   hard   — presný identifikátor, blokuje vždy
 *   strong — viacslovný údaj (meno, adresa), blokuje
 */
export type NeedleStrength = "hard" | "strong";

export interface FieldDef {
  /** Kľúč na disku. Rovnaký pre obe jurisdikcie. */
  readonly canonical: string;
  /** Popisok pre českého používateľa. Nie kľúč. */
  readonly cz: string;
  /** Popisok pre slovenského používateľa. Nie kľúč. */
  readonly sk: string;
  readonly kind: FieldKind;
  readonly required: boolean;
  /** Údaj, ktorý sa maskuje vo výstupoch pre človeka a nesmie do `popis`. */
  readonly sensitive?: boolean;
  /** Hodnota sa hľadá v právnych prameňoch ako možný únik z L2. */
  readonly needle?: NeedleStrength;
}

export const FIELDS: readonly FieldDef[] = [
  // --- jadro záznamu ---
  { canonical: "okf", cz: "okf", sk: "okf", kind: "number", required: true },
  { canonical: "id", cz: "id", sk: "id", kind: "string", required: true },
  { canonical: "type", cz: "typ", sk: "typ", kind: "string", required: true },
  { canonical: "title", cz: "název", sk: "názov", kind: "string", required: true },
  { canonical: "summary", cz: "popis", sk: "popis", kind: "string", required: true },
  { canonical: "layer", cz: "vrstva", sk: "vrstva", kind: "string", required: true },
  { canonical: "jurisdiction", cz: "jurisdikce", sk: "jurisdikcia", kind: "string", required: true },
  { canonical: "status", cz: "stav", sk: "stav", kind: "string", required: true },
  { canonical: "created", cz: "vznik", sk: "vznik", kind: "string", required: true },
  { canonical: "updated", cz: "změna", sk: "zmena", kind: "string", required: true },
  { canonical: "sources", cz: "zdroje", sk: "zdroje", kind: "list", required: false },
  { canonical: "related", cz: "souvisí", sk: "súvisí", kind: "list", required: false },

  // --- spis ---
  { canonical: "deadlines", cz: "lhůty", sk: "lehoty", kind: "list", required: false },
  { canonical: "parties", cz: "strany", sk: "strany", kind: "list", required: false },
  { canonical: "matter_ref", cz: "spisová značka", sk: "spisová značka", kind: "string", required: false },
  { canonical: "court", cz: "soud", sk: "súd", kind: "string", required: false },
  { canonical: "area", cz: "oblast práva", sk: "oblasť práva", kind: "list", required: false },

  // --- identifikácia subjektu (§ 8 zák. č. 253/2008 Sb.) ---
  { canonical: "role", cz: "role", sk: "rola", kind: "string", required: false },
  { canonical: "person_type", cz: "typ osoby", sk: "typ osoby", kind: "string", required: false },
  { canonical: "registry_id", cz: "IČO", sk: "IČO", kind: "string", required: false, needle: "hard" },
  { canonical: "birth_date", cz: "datum narození", sk: "dátum narodenia", kind: "string", required: false, sensitive: true, needle: "hard" },
  { canonical: "birth_number", cz: "rodné číslo", sk: "rodné číslo", kind: "string", required: false, sensitive: true, needle: "hard" },
  { canonical: "birth_place", cz: "místo narození", sk: "miesto narodenia", kind: "string", required: false },
  { canonical: "sex", cz: "pohlaví", sk: "pohlavie", kind: "string", required: false },
  { canonical: "citizenship", cz: "státní občanství", sk: "štátna príslušnosť", kind: "string", required: false },
  { canonical: "residence", cz: "trvalý pobyt", sk: "trvalý pobyt", kind: "string", required: false, sensitive: true, needle: "strong" },
  { canonical: "id_document_type", cz: "druh dokladu", sk: "druh dokladu", kind: "string", required: false },
  { canonical: "id_document_number", cz: "číslo dokladu", sk: "číslo dokladu", kind: "string", required: false, sensitive: true, needle: "hard" },
  { canonical: "id_document_issuer", cz: "doklad vydal", sk: "doklad vydal", kind: "string", required: false },
  { canonical: "id_document_valid_to", cz: "doklad platí do", sk: "doklad platí do", kind: "string", required: false },

  // --- právnická osoba ---
  { canonical: "legal_form", cz: "právní forma", sk: "právna forma", kind: "string", required: false },
  { canonical: "registered_office", cz: "sídlo", sk: "sídlo", kind: "string", required: false },
  { canonical: "registry_entry", cz: "zápis v rejstříku", sk: "zápis v registri", kind: "string", required: false },
  { canonical: "business_address", cz: "místo podnikání", sk: "miesto podnikania", kind: "string", required: false },
  { canonical: "business_scope", cz: "předmět podnikání", sk: "predmet podnikania", kind: "list", required: false },
  { canonical: "representatives", cz: "jednající osoby", sk: "konajúce osoby", kind: "list", required: false },
  { canonical: "ubo", cz: "skutečný majitel", sk: "konečný užívateľ výhod", kind: "list", required: false },
  { canonical: "pep", cz: "PEP", sk: "PEP", kind: "string", required: false },

  // --- prevereníe (úkon v čase) ---
  { canonical: "subject_ref", cz: "subjekt", sk: "subjekt", kind: "string", required: false },
  { canonical: "check_date", cz: "datum prověření", sk: "dátum preverenia", kind: "string", required: false },
  { canonical: "mode", cz: "režim", sk: "režim", kind: "string", required: false },
  { canonical: "registries", cz: "registry", sk: "registre", kind: "list", required: false },
  { canonical: "pep_result", cz: "výsledek PEP", sk: "výsledok PEP", kind: "string", required: false },
  { canonical: "sanctions_result", cz: "výsledek sankcí", sk: "výsledok sankcií", kind: "string", required: false },
  { canonical: "funds_origin", cz: "původ prostředků", sk: "pôvod prostriedkov", kind: "string", required: false },
  { canonical: "risk", cz: "riziko", sk: "riziko", kind: "string", required: false },
  { canonical: "conclusion", cz: "závěr", sk: "záver", kind: "string", required: false },
  { canonical: "valid_until", cz: "platnost do", sk: "platnosť do", kind: "string", required: false },
];

/** Údaje, ktoré sa maskujú vo výstupoch pre človeka a nesmú do `popis`. */
export const SENSITIVE_FIELDS: readonly string[] = FIELDS.filter((f) => f.sensitive).map(
  (f) => f.canonical,
);

/** Polia, ktorých hodnoty sa hľadajú pri kontrole úniku do L3. */
export function needleFields(): readonly FieldDef[] {
  return FIELDS.filter((f) => f.needle !== undefined);
}

/**
 * Povinná identifikačná sada podľa AML predpisu jurisdikcie.
 *
 * Overené proti doslovnému zneniu 31. 8. 2026:
 *   CZ — § 5 ods. 1 zák. č. 253/2008 Sb. (identifikačné údaje).
 *        Pozor: § 8 upravuje *vykonanie* identifikácie, nie výpočet údajov.
 *   SK — § 7 ods. 1 zák. č. 297/2008 Z. z. (identifikácia), znenie k 17. 8. 2026,
 *        načítané z portálu Slov-Lex.
 *
 * Sady sa vecne líšia a neprekladajú sa: CZ žiada miesto narodenia, vydavateľa
 * dokladu a jeho platnosť, ktoré SK nežiada; SK žiada označenie registra
 * a číslo zápisu u právnickej osoby, ktoré CZ nežiada. Preto dve sady, nie jedna.
 */
export type AmlRequirement =
  | string
  | {
      /** Údaj, ktorý stačí sám o sebe. */
      readonly primary: string;
      /** Čo je potrebné, ak primárny údaj pridelený nebol. */
      readonly fallback: readonly string[];
    };

/** Spoločné pre českú fyzickú osobu — § 5 ods. 1 písm. a). */
const CZ_FO: readonly AmlRequirement[] = [
  "title",
  // „rodné číslo, a nebylo-li přiděleno, datum narození a pohlaví"
  { primary: "birth_number", fallback: ["birth_date", "sex"] },
  "birth_place",
  "residence",
  "citizenship",
  "id_document_type",
  "id_document_number",
  "id_document_issuer",
  "id_document_valid_to",
];

/** Spoločné pre slovenskú fyzickú osobu — § 7 ods. 1 písm. a). */
const SK_FO: readonly AmlRequirement[] = [
  "title",
  // „rodného čísla alebo dátumu narodenia, ak rodné číslo nebolo pridelené"
  { primary: "birth_number", fallback: ["birth_date"] },
  "residence",
  "citizenship",
  "id_document_type",
  "id_document_number",
];

export const AML_REQUIRED: Partial<
  Record<Jurisdiction, Readonly<Record<PersonKind, readonly AmlRequirement[]>>>
> = {
  cz: {
    natural_person: CZ_FO,
    // § 5 ods. 1 písm. b) bod 1 a 2 — firma/názov, sídlo, IČO, člen štatutárneho orgánu.
    // Právnu formu ani zápis v registri ustanovenie nežiada.
    legal_person: ["title", "registered_office", "registry_id", "representatives"],
    // „jde-li o podnikající fyzickou osobu, též její obchodní firma, sídlo
    // a identifikační číslo osoby"
    sole_trader: [...CZ_FO, "registered_office", "registry_id"],
  },
  sk: {
    natural_person: SK_FO,
    // § 7 ods. 1 písm. b) — názov, sídlo, IČO, označenie registra a číslo zápisu,
    // osoba oprávnená konať a členovia riadiaceho orgánu.
    legal_person: ["title", "registered_office", "registry_id", "registry_entry", "representatives"],
    // FO-podnikateľ: adresa miesta podnikania, označenie registra a číslo zápisu.
    // IČO je „ak bolo pridelené", teda podmienené — nevynucuje sa.
    sole_trader: [...SK_FO, "business_address", "registry_entry"],
  },
};

/** Popisok typu záznamu pre človeka. Na disku je vždy kanonický anglický názov. */
const TYPE_LABELS: Record<RecordType, Record<Jurisdiction, string>> = {
  matter: { cz: "spis", sk: "spis" },
  decision: { cz: "rozhodnutí", sk: "rozhodnutie" },
  subject: { cz: "subjekt", sk: "subjekt" },
  question: { cz: "otázka", sk: "otázka" },
  screening: { cz: "prověření", sk: "preverenie" },
  rule: { cz: "pravidlo", sk: "pravidlo" },
  lesson: { cz: "poučení", sk: "poučenie" },
  authority: { cz: "pramen", sk: "prameň" },
};

/** Popisok poľa pre človeka — do hlášok a do rozhrania, nikdy do súboru. */
export function fieldLabel(canonical: string, j: Jurisdiction): string {
  const f = FIELDS.find((x) => x.canonical === canonical);
  if (!f) throw new Error(`Neznáme pole: ${canonical}`);
  return j === "cz" ? f.cz : f.sk;
}

/** Je to kľúč, ktorý schéma pozná? Kľúče sú kanonické, teda bez prekladu. */
export function canonicalField(key: string): string | undefined {
  return FIELDS.find((x) => x.canonical === key)?.canonical;
}

export function typeLabel(t: RecordType, j: Jurisdiction): string {
  return TYPE_LABELS[t][j];
}

export function isRecordType(value: string): value is RecordType {
  return (RECORD_TYPES as readonly string[]).includes(value);
}

export function isJurisdiction(value: string): value is Jurisdiction {
  return value === "cz" || value === "sk";
}
