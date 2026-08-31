/**
 * Mapovacia tabuľka OKF pamäte.
 *
 * Jediné miesto, kde žije rozdiel medzi českou a slovenskou nomenklatúrou.
 * Parser, serializer, detektor únikov aj testy čítajú z tejto tabuľky — nové
 * pole sa pridáva raz sem, nie dvakrát do kódu.
 *
 * Kľúče a hodnoty enumov sú technické identifikátory, preto bez diakritiky.
 * Ľudské texty (nadpisy sekcií, obsah) diakritiku nesú.
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

/**
 * Sila, s akou sa hodnota poľa hľadá pri kontrole úniku do L3.
 *   hard   — presný identifikátor, blokuje vždy
 *   strong — viacslovný údaj (meno, adresa), blokuje
 */
export type NeedleStrength = "hard" | "strong";

export interface FieldDef {
  readonly canonical: string;
  readonly cz: string;
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
  { canonical: "schema", cz: "okf", sk: "okf", kind: "number", required: true },
  { canonical: "id", cz: "id", sk: "id", kind: "string", required: true },
  { canonical: "type", cz: "typ", sk: "typ", kind: "string", required: true },
  { canonical: "title", cz: "nazev", sk: "nazov", kind: "string", required: true },
  { canonical: "summary", cz: "popis", sk: "popis", kind: "string", required: true },
  { canonical: "layer", cz: "vrstva", sk: "vrstva", kind: "string", required: true },
  { canonical: "jurisdiction", cz: "jurisdikce", sk: "jurisdikcia", kind: "string", required: true },
  { canonical: "status", cz: "stav", sk: "stav", kind: "string", required: true },
  { canonical: "created", cz: "vznik", sk: "vznik", kind: "string", required: true },
  { canonical: "updated", cz: "zmena", sk: "zmena", kind: "string", required: true },
  { canonical: "sources", cz: "zdroje", sk: "zdroje", kind: "list", required: false },
  { canonical: "related", cz: "souvisi", sk: "suvisi", kind: "list", required: false },

  // --- spis ---
  { canonical: "deadlines", cz: "lhuty", sk: "lehoty", kind: "list", required: false },
  { canonical: "parties", cz: "strany", sk: "strany", kind: "list", required: false },
  { canonical: "matter_ref", cz: "spisova_znacka", sk: "spisova_znacka", kind: "string", required: false },
  { canonical: "court", cz: "soud", sk: "sud", kind: "string", required: false },
  { canonical: "area", cz: "oblast_prava", sk: "oblast_prava", kind: "list", required: false },

  // --- identifikácia subjektu (§ 8 zák. č. 253/2008 Sb.) ---
  { canonical: "role", cz: "role", sk: "rola", kind: "string", required: false },
  { canonical: "person_type", cz: "typ_osoby", sk: "typ_osoby", kind: "string", required: false },
  { canonical: "registry_id", cz: "ico", sk: "ico", kind: "string", required: false, needle: "hard" },
  { canonical: "birth_date", cz: "datum_narozeni", sk: "datum_narodenia", kind: "string", required: false, sensitive: true, needle: "hard" },
  { canonical: "birth_number", cz: "rodne_cislo", sk: "rodne_cislo", kind: "string", required: false, sensitive: true, needle: "hard" },
  { canonical: "birth_place", cz: "misto_narozeni", sk: "miesto_narodenia", kind: "string", required: false },
  { canonical: "sex", cz: "pohlavi", sk: "pohlavie", kind: "string", required: false },
  { canonical: "citizenship", cz: "statni_obcanstvi", sk: "statne_obcianstvo", kind: "string", required: false },
  { canonical: "residence", cz: "trvaly_pobyt", sk: "trvaly_pobyt", kind: "string", required: false, sensitive: true, needle: "strong" },
  { canonical: "id_document_type", cz: "doklad_typ", sk: "doklad_typ", kind: "string", required: false },
  { canonical: "id_document_number", cz: "doklad_cislo", sk: "doklad_cislo", kind: "string", required: false, sensitive: true, needle: "hard" },
  { canonical: "id_document_issuer", cz: "doklad_vydal", sk: "doklad_vydal", kind: "string", required: false },
  { canonical: "id_document_valid_to", cz: "doklad_plati_do", sk: "doklad_plati_do", kind: "string", required: false },

  // --- právnická osoba ---
  { canonical: "legal_form", cz: "pravni_forma", sk: "pravna_forma", kind: "string", required: false },
  { canonical: "registered_office", cz: "sidlo", sk: "sidlo", kind: "string", required: false },
  { canonical: "registry_entry", cz: "zapis_v_rejstriku", sk: "zapis_v_registri", kind: "string", required: false },
  { canonical: "business_scope", cz: "predmet_podnikani", sk: "predmet_podnikania", kind: "list", required: false },
  { canonical: "representatives", cz: "jednajici_osoby", sk: "konajuce_osoby", kind: "list", required: false },
  { canonical: "ubo", cz: "skutecny_majitel", sk: "konecny_uzivatel_vyhod", kind: "list", required: false },
  { canonical: "pep", cz: "pep", sk: "pep", kind: "string", required: false },

  // --- prevereníe (úkon v čase) ---
  { canonical: "subject_ref", cz: "subjekt", sk: "subjekt", kind: "string", required: false },
  { canonical: "check_date", cz: "datum_provereni", sk: "datum_preverenia", kind: "string", required: false },
  { canonical: "mode", cz: "rezim", sk: "rezim", kind: "string", required: false },
  { canonical: "registries", cz: "registry", sk: "registre", kind: "list", required: false },
  { canonical: "pep_result", cz: "pep_vysledek", sk: "pep_vysledok", kind: "string", required: false },
  { canonical: "sanctions_result", cz: "sankce_vysledek", sk: "sankcie_vysledok", kind: "string", required: false },
  { canonical: "funds_origin", cz: "puvod_prostredku", sk: "povod_prostriedkov", kind: "string", required: false },
  { canonical: "risk", cz: "riziko", sk: "riziko", kind: "string", required: false },
  { canonical: "conclusion", cz: "zaver", sk: "zaver", kind: "string", required: false },
  { canonical: "valid_until", cz: "platnost_do", sk: "platnost_do", kind: "string", required: false },
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
 * Povinná identifikačná sada podľa AML predpisu danej jurisdikcie.
 *
 * CZ vychádza z § 8 zák. č. 253/2008 Sb. SK zámerne chýba: slovenský predpis
 * je zák. č. 297/2008 Z. z. a jeho požiadavky neboli overené. Predstierať ich
 * by bolo tiché prekladanie právnych pojmov medzi jurisdikciami, čo AGENTS.md
 * zakazuje. Doplní slovenský advokát.
 */
export const AML_REQUIRED: Partial<
  Record<Jurisdiction, { readonly fo: readonly string[]; readonly po: readonly string[] }>
> = {
  cz: {
    fo: [
      "title",
      "birth_number",
      "birth_place",
      "sex",
      "citizenship",
      "residence",
      "id_document_type",
      "id_document_number",
      "id_document_issuer",
      "id_document_valid_to",
    ],
    po: ["title", "registry_id", "registered_office", "legal_form", "registry_entry", "representatives"],
  },
};

const TYPE_KEYS: Record<RecordType, Record<Jurisdiction, string>> = {
  matter: { cz: "spis", sk: "spis" },
  decision: { cz: "rozhodnuti", sk: "rozhodnutie" },
  subject: { cz: "subjekt", sk: "subjekt" },
  question: { cz: "otazka", sk: "otazka" },
  screening: { cz: "provereni", sk: "preverenie" },
  rule: { cz: "pravidlo", sk: "pravidlo" },
  lesson: { cz: "pouceni", sk: "poucenie" },
  authority: { cz: "pramen", sk: "pramen" },
};

export function fieldKey(canonical: string, j: Jurisdiction): string {
  const f = FIELDS.find((x) => x.canonical === canonical);
  if (!f) throw new Error(`Neznáme kanonické pole: ${canonical}`);
  return j === "cz" ? f.cz : f.sk;
}

export function canonicalField(localKey: string, j: Jurisdiction): string | undefined {
  const f = FIELDS.find((x) => (j === "cz" ? x.cz : x.sk) === localKey);
  return f?.canonical;
}

export function typeKey(t: RecordType, j: Jurisdiction): string {
  return TYPE_KEYS[t][j];
}

export function canonicalType(localKey: string, j: Jurisdiction): RecordType | undefined {
  return RECORD_TYPES.find((t) => TYPE_KEYS[t][j] === localKey);
}
