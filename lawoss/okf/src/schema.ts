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
  | "claim"
  | "evidence"
  | "task"
  | "rule"
  | "lesson"
  | "authority";

export const RECORD_TYPES: readonly RecordType[] = [
  "matter",
  "decision",
  "subject",
  "question",
  "screening",
  "claim",
  "evidence",
  "task",
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
  claim: "L2",
  evidence: "L2",
  task: "L2",
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

/**
 * Druhy udalosti v histórii záznamu. Slovník je **otvorený** — neznámy druh
 * sa nepremenúva a nebráni zápisu; advokát smie zapísať aj to, čo slovník
 * nepozná. Slúži na filtrovanie chronológie, nie na výpočet lehôt.
 */
export const EVENT_KINDS = [
  "dorucenie", "podanie", "pojednavanie", "rozhodnutie", "vyzva", "hovor", "email",
] as const;
export type EventKind = (typeof EVENT_KINDS)[number];

/** Stav úlohy. `blocked` znamená, že čaká na inú úlohu — nie „nechce sa mi". */
export const TASK_STATES = ["pending", "in_progress", "blocked", "done"] as const;
export type TaskState = (typeof TASK_STATES)[number];

/** Stav preukázania tvrdenia. Hodnotu zapisuje advokát, nástroj ju neodvodzuje. */
export const PROOF_STATUS = ["proven", "unproven", "disputed"] as const;
export type ProofStatus = (typeof PROOF_STATUS)[number];

/** Miera dôveryhodnosti tvrdenia alebo spoľahlivosti dôkazu. */
export const CONFIDENCE = ["high", "medium", "low"] as const;
export type Confidence = (typeof CONFIDENCE)[number];

/** Priamy dôkaz × nepriamy (indícia). */
export const EVIDENCE_STRENGTH = ["direct", "indirect"] as const;
export type EvidenceStrength = (typeof EVIDENCE_STRENGTH)[number];

/** Procesný stav dôkazu — navrhnutý × vykonaný. */
export const PROCEDURAL_STATUS = ["proposed", "taken"] as const;
export type ProceduralStatus = (typeof PROCEDURAL_STATUS)[number];

/** Druhy dôkazu. Hodnoty sú kanonické, právne ukotvenie je jurisdikčné. */
export const EVIDENCE_KINDS = [
  "document", "witness", "expert_opinion", "party_examination", "inspection",
] as const;
export type EvidenceKind = (typeof EVIDENCE_KINDS)[number];

/**
 * Ustanovenie, ktoré druh dôkazu upravuje.
 *
 * CZ overené 2. 9. 2026 v plnom znení zák. č. 99/1963 Sb. Pozor na dve
 * rozšírené nepresnosti: **§ 125 nie je listina**, ale demonštratívny výpočet
 * dôkazných prostriedkov („zejména… a jiné listiny"); listinu upravuje § 129
 * a ohliadku § 130, nie § 129.
 *
 * SK zámerne chýba — slovenský procesný predpis (Civilný sporový poriadok)
 * nebol overený a domýšľať ho by bolo tiché prekladanie právnych pojmov.
 */
/**
 * Ustanovenie, z ktorého plynie povinnosť preverenia (kontroly) klienta.
 *
 * Overené 2. 9. 2026 v plnom znení: v ČR je to **§ 9** („Kontrola klienta"),
 * nie § 8 — ten upravuje *prevádzanie* identifikácie. Slovenské ustanovenie
 * overené nie je; 297/2008 Z. z. má vlastné číslovanie a domýšľať sa nesmie.
 */
export const SCREENING_PROVISION: Partial<Record<Jurisdiction, string>> = {
  cz: "§ 9 zák. č. 253/2008 Sb.",
};

export const EVIDENCE_KIND_PROVISION: Partial<
  Record<Jurisdiction, Readonly<Record<EvidenceKind, string>>>
> = {
  cz: {
    document: "§ 129 zák. č. 99/1963 Sb.",
    witness: "§ 126 zák. č. 99/1963 Sb.",
    expert_opinion: "§ 127 zák. č. 99/1963 Sb. (§ 127a při posudku předloženém účastníkem)",
    party_examination: "§ 131 zák. č. 99/1963 Sb.",
    inspection: "§ 130 zák. č. 99/1963 Sb.",
  },
};

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

  // --- identifikácia subjektu (zoznam údajov § 5 zák. č. 253/2008 Sb.) ---
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

  // --- tvrdenie (claim) ---
  { canonical: "claimed_by", cz: "tvrdí", sk: "tvrdí", kind: "string", required: false },
  { canonical: "claimed_at", cz: "kdy tvrzeno", sk: "kedy tvrdené", kind: "string", required: false },
  { canonical: "claimed_in", cz: "kde tvrzeno", sk: "kde tvrdené", kind: "string", required: false },
  { canonical: "legal_question", cz: "právní otázka", sk: "právna otázka", kind: "string", required: false },
  { canonical: "burden_of_proof", cz: "důkazní břemeno", sk: "dôkazné bremeno", kind: "string", required: false },
  { canonical: "supporting_evidence", cz: "podporující důkazy", sk: "podporujúce dôkazy", kind: "list", required: false },
  { canonical: "contradicting_evidence", cz: "vyvracející důkazy", sk: "vyvracajúce dôkazy", kind: "list", required: false },
  { canonical: "proof_status", cz: "stav prokázání", sk: "stav preukázania", kind: "string", required: false },
  { canonical: "credibility", cz: "věrohodnost", sk: "vierohodnosť", kind: "string", required: false },

  // --- dôkaz (evidence) ---
  { canonical: "evidence_kind", cz: "druh důkazu", sk: "druh dôkazu", kind: "string", required: false },
  { canonical: "origin_date", cz: "datum vzniku", sk: "dátum vzniku", kind: "string", required: false },
  { canonical: "author", cz: "autor", sk: "autor", kind: "string", required: false },
  { canonical: "formal_requirements", cz: "formální náležitosti", sk: "formálne náležitosti", kind: "string", required: false },
  { canonical: "proves", cz: "k prokázání", sk: "na preukázanie", kind: "list", required: false },
  { canonical: "evidence_strength", cz: "síla důkazu", sk: "sila dôkazu", kind: "string", required: false },
  { canonical: "reliability", cz: "spolehlivost", sk: "spoľahlivosť", kind: "string", required: false },
  { canonical: "objection", cz: "námitka", sk: "námietka", kind: "string", required: false },
  { canonical: "procedural_status", cz: "procesní stav", sk: "procesný stav", kind: "string", required: false },

  // --- právny prameň (authority): časová platnosť a stopa overenia ---
  { canonical: "effective_from", cz: "účinnost od", sk: "účinnosť od", kind: "string", required: false },
  { canonical: "effective_to", cz: "účinnost do", sk: "účinnosť do", kind: "string", required: false },
  { canonical: "verified_at", cz: "ověřeno dne", sk: "overené dňa", kind: "string", required: false },
  { canonical: "verified_against", cz: "ověřeno proti", sk: "overené proti", kind: "string", required: false },

  // --- procesné postavenie subjektu (nie AML) ---
  { canonical: "procedural_role", cz: "procesní postavení", sk: "procesné postavenie", kind: "string", required: false },
  { canonical: "representation", cz: "zastoupení", sk: "zastúpenie", kind: "string", required: false },
  { canonical: "legal_capacity", cz: "způsobilost být účastníkem", sk: "spôsobilosť byť účastníkom", kind: "string", required: false },
  { canonical: "capacity_notes", cz: "poznámky ke způsobilosti", sk: "poznámky k spôsobilosti", kind: "string", required: false },

  // --- úloha (task) ---
  { canonical: "assignee", cz: "řeší", sk: "rieši", kind: "string", required: false },
  { canonical: "depends_on", cz: "závisí na", sk: "závisí od", kind: "list", required: false },
  { canonical: "acceptance", cz: "akceptační kritéria", sk: "akceptačné kritériá", kind: "list", required: false },
  { canonical: "priority", cz: "priorita", sk: "priorita", kind: "string", required: false },
  { canonical: "state", cz: "stav úkolu", sk: "stav úlohy", kind: "string", required: false },
  { canonical: "due", cz: "termín", sk: "termín", kind: "string", required: false },
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
  claim: { cz: "tvrzení", sk: "tvrdenie" },
  evidence: { cz: "důkaz", sk: "dôkaz" },
  task: { cz: "úkol", sk: "úloha" },
  rule: { cz: "pravidlo", sk: "pravidlo" },
  lesson: { cz: "poučení", sk: "poučenie" },
  authority: { cz: "pramen", sk: "prameň" },
};

/**
 * Popisky hodnôt enumov. Na disku je kanonická anglická hodnota, človeku
 * sa ukazuje jeho jazyk — rovnaká deľba ako pri kľúčoch.
 */
const VALUE_LABELS: Record<string, Record<string, Record<Jurisdiction, string>>> = {
  status: {
    active: { cz: "platný", sk: "platný" },
    superseded: { cz: "překonaný", sk: "prekonaný" },
    void: { cz: "zrušený", sk: "zrušený" },
  },
  role: {
    client: { cz: "klient", sk: "klient" },
    counterparty: { cz: "protistrana", sk: "protistrana" },
    representative: { cz: "zástupce", sk: "zástupca" },
    ubo: { cz: "skutečný majitel", sk: "konečný užívateľ výhod" },
  },
  person_type: {
    natural_person: { cz: "fyzická osoba", sk: "fyzická osoba" },
    legal_person: { cz: "právnická osoba", sk: "právnická osoba" },
    sole_trader: { cz: "podnikatel", sk: "podnikateľ" },
  },
  risk: {
    low: { cz: "nízké", sk: "nízke" },
    medium: { cz: "střední", sk: "stredné" },
    high: { cz: "vysoké", sk: "vysoké" },
  },
  conclusion: {
    proceed: { cz: "pokračovat", sk: "pokračovať" },
    enhanced_diligence: { cz: "zesílená kontrola", sk: "zosilnená kontrola" },
    decline: { cz: "odmítnout", sk: "odmietnuť" },
  },
  proof_status: {
    proven: { cz: "prokázáno", sk: "preukázané" },
    unproven: { cz: "neprokázáno", sk: "nepreukázané" },
    disputed: { cz: "sporné", sk: "sporné" },
  },
  credibility: {
    high: { cz: "vysoká", sk: "vysoká" },
    medium: { cz: "střední", sk: "stredná" },
    low: { cz: "nízká", sk: "nízka" },
  },
  reliability: {
    high: { cz: "vysoká", sk: "vysoká" },
    medium: { cz: "střední", sk: "stredná" },
    low: { cz: "nízká", sk: "nízka" },
  },
  evidence_strength: {
    direct: { cz: "přímý", sk: "priamy" },
    indirect: { cz: "nepřímý", sk: "nepriamy" },
  },
  procedural_status: {
    proposed: { cz: "navržen", sk: "navrhnutý" },
    taken: { cz: "proveden", sk: "vykonaný" },
  },
  event_kind: {
    dorucenie: { cz: "doručení", sk: "doručenie" },
    podanie: { cz: "podání", sk: "podanie" },
    pojednavanie: { cz: "jednání", sk: "pojednávanie" },
    rozhodnutie: { cz: "rozhodnutí", sk: "rozhodnutie" },
    vyzva: { cz: "výzva", sk: "výzva" },
    hovor: { cz: "hovor", sk: "hovor" },
    email: { cz: "e-mail", sk: "e-mail" },
  },
  state: {
    pending: { cz: "čeká", sk: "čaká" },
    in_progress: { cz: "rozpracováno", sk: "rozpracované" },
    blocked: { cz: "blokován", sk: "blokovaná" },
    done: { cz: "hotovo", sk: "hotové" },
  },
  evidence_kind: {
    document: { cz: "listina", sk: "listina" },
    witness: { cz: "výslech svědka", sk: "výsluch svedka" },
    expert_opinion: { cz: "znalecký posudek", sk: "znalecký posudok" },
    party_examination: { cz: "výslech účastníka", sk: "výsluch účastníka" },
    inspection: { cz: "ohledání", sk: "ohliadka" },
  },
};

/**
 * Popisok hodnoty enumu. Neznámu hodnotu vráti nezmenenú — advokát smie
 * zapísať aj to, čo slovník nepozná, a nesmie tým prísť o obsah.
 */
export function valueLabel(field: string, value: string, j: Jurisdiction): string {
  return VALUE_LABELS[field]?.[value]?.[j] ?? value;
}

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
