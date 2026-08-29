/**
 * Mapovacia tabuľka OKF pamäte.
 *
 * Jediné miesto, kde žije rozdiel medzi českou a slovenskou nomenklatúrou.
 * Parser, serializer aj testy čítajú z tejto tabuľky — nové pole sa pridáva
 * raz sem, nie dvakrát do kódu.
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
  | "rule"
  | "lesson"
  | "authority";

export const RECORD_TYPES: readonly RecordType[] = [
  "matter",
  "decision",
  "subject",
  "question",
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
  rule: "L1",
  lesson: "L1",
  authority: "L3",
};

export type FieldKind = "string" | "number" | "list";

export interface FieldDef {
  readonly canonical: string;
  readonly cz: string;
  readonly sk: string;
  readonly kind: FieldKind;
  readonly required: boolean;
}

export const FIELDS: readonly FieldDef[] = [
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
  { canonical: "deadlines", cz: "lhuty", sk: "lehoty", kind: "list", required: false },
  { canonical: "parties", cz: "strany", sk: "strany", kind: "list", required: false },
  { canonical: "matter_ref", cz: "spisova_znacka", sk: "spisova_znacka", kind: "string", required: false },
  { canonical: "court", cz: "soud", sk: "sud", kind: "string", required: false },
  { canonical: "area", cz: "oblast_prava", sk: "oblast_prava", kind: "list", required: false },
  { canonical: "registry_id", cz: "ico", sk: "ico", kind: "string", required: false },
  { canonical: "birth_date", cz: "datum_narozeni", sk: "datum_narodenia", kind: "string", required: false },
];

const TYPE_KEYS: Record<RecordType, Record<Jurisdiction, string>> = {
  matter: { cz: "spis", sk: "spis" },
  decision: { cz: "rozhodnuti", sk: "rozhodnutie" },
  subject: { cz: "subjekt", sk: "subjekt" },
  question: { cz: "otazka", sk: "otazka" },
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
