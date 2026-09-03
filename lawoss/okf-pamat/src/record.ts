/**
 * Čítanie a zápis jedného pamäťového záznamu.
 *
 * Záznam je markdown so YAML frontmatterom a dvomi sekciami:
 *   ## Truth    — aktuálny overený stav, prepisuje sa
 *   ## History  — append-only stopa, nikdy sa nemaže
 *
 * Kľúče frontmatteru aj nadpisy sekcií sú kanonické (anglické) pre obe
 * jurisdikcie. Lokalizuje sa až výstup pre človeka.
 */

import {
  FIELDS,
  canonicalField,
  isJurisdiction,
  isRecordType,
  LAYER_OF,
  type Jurisdiction,
  type Layer,
  type RecordType,
} from "./schema.ts";

/**
 * Nadpisy sekcií záznamu. Anglické pre obe jurisdikcie — záznam je formát,
 * nie dokument. Ľudským rozhraním je `_STATUS.md`, a ten zostáva lokalizovaný.
 */
export const HEADINGS = { truth: "Truth", timeline: "History" } as const;

/** Skalár frontmatteru. */
export type FmScalar = string | number;
/** Ploché mapovanie — jeden prameň, jedno overenie. */
export type FmMap = Record<string, FmScalar>;
/**
 * Hodnota frontmatteru. Presne tie tvary, ktoré Open Knowledge Format používa:
 * skalár, zoznam skalárov, ploché mapovanie a zoznam plochých mapovaní.
 * Nič hlbšie — hlbší tvar je chyba, nie ticho preparsovaný údaj.
 */
export type FmValue = FmScalar | string[] | FmMap | FmMap[];

/** Prameň podľa OKF v0.2 — `id` je kľúč pre poznámku pod čiarou `[^id]`. */
export interface Source {
  id?: string;
  title?: string;
  resource?: string;
  author?: string;
  last_modified?: string;
}

/** Overenie podľa OKF v0.2. Prameň sa overuje opakovane, preto zoznam. */
export interface Verification {
  by: string;
  at: string;
}

export interface TimelineEntry {
  readonly date: string;
  readonly text: string;
  /** Druh udalosti. Voliteľný — staršie záznamy ho nemajú a musia ďalej fungovať. */
  readonly kind?: string;
}

export interface OkfRecord {
  /** Verzia formátu. Kľúč `okf:` je zároveň značkou, podľa ktorej sa súbor pozná. */
  okf: number;
  id: string;
  type: RecordType;
  title: string;
  description: string;
  layer: Layer;
  jurisdiction: Jurisdiction;
  status: string;
  created: string;
  updated: string;

  // štruktúrované podľa OKF v0.2
  sources?: Source[];
  verified?: Verification[];

  // zoznamy
  related?: string[];
  tags?: string[];
  deadlines?: string[];
  parties?: string[];
  area?: string[];
  business_scope?: string[];
  representatives?: string[];
  ubo?: string[];
  registries?: string[];
  supporting_evidence?: string[];
  contradicting_evidence?: string[];
  proves?: string[];
  depends_on?: string[];
  acceptance?: string[];

  // spis
  truth_digest?: string;
  matter_ref?: string;
  court?: string;

  // identifikácia subjektu — zoznam údajov § 5 zák. č. 253/2008 Sb.
  role?: string;
  person_type?: string;
  registry_id?: string;
  birth_date?: string;
  birth_number?: string;
  birth_place?: string;
  sex?: string;
  citizenship?: string;
  residence?: string;
  id_document_type?: string;
  id_document_number?: string;
  id_document_issuer?: string;
  id_document_valid_to?: string;

  // právnická osoba
  legal_form?: string;
  registered_office?: string;
  registry_entry?: string;
  pep?: string;

  // preverenie
  subject_ref?: string;
  check_date?: string;
  mode?: string;
  pep_result?: string;
  sanctions_result?: string;
  funds_origin?: string;
  risk?: string;
  conclusion?: string;
  valid_until?: string;

  // tvrdenie (claim)
  claimed_by?: string;
  claimed_at?: string;
  claimed_in?: string;
  legal_question?: string;
  burden_of_proof?: string;
  proof_status?: string;
  credibility?: string;

  // dôkaz (evidence)
  evidence_kind?: string;
  origin_date?: string;
  author?: string;
  formal_requirements?: string;
  evidence_strength?: string;
  reliability?: string;
  objection?: string;
  procedural_status?: string;
  effective_from?: string;
  effective_to?: string;
  verified_at?: string;
  verified_against?: string;
  procedural_role?: string;
  representation?: string;
  legal_capacity?: string;
  capacity_notes?: string;
  assignee?: string;
  priority?: string;
  state?: string;
  due?: string;

  truth: string;
  timeline: TimelineEntry[];

  /**
   * Kľúče frontmatteru, ktoré schéma nepozná — zachovajú sa tak, ako prišli.
   *
   * Advokát pracujúci v Obsidiane si do záznamu prirodzene doplní `tags:`.
   * Kým sa neznámy kľúč považoval za chybu, celý záznam vypadol zo store —
   * a s ním **aj z jehiel detektora únikov**. Tichým dôsledkom pridania tagu
   * teda nebolo nepohodlie, ale slepá brána.
   */
  extra?: Record<string, FmValue>;
}

const FM_DELIM = "---";

/** Polia, ktoré parser priraďuje výslovne; zvyšok sa berie z tabuľky. */
const CORE_FIELDS = new Set([
  "okf", "id", "type", "title", "description",
  "layer", "jurisdiction", "status", "created", "updated",
]);

function splitFrontmatter(text: string): { fm: string; body: string } {
  const lines = text.split("\n");
  if (lines[0]?.trim() !== FM_DELIM) {
    throw new Error("Záznam nemá frontmatter — chýba úvodný oddeľovač ---");
  }
  const end = lines.indexOf(FM_DELIM, 1);
  if (end === -1) {
    throw new Error("Záznam má neuzavretý frontmatter — chýba koncový oddeľovač ---");
  }
  return { fm: lines.slice(1, end).join("\n"), body: lines.slice(end + 1).join("\n") };
}

/**
 * Rozdelí obsah `[…]` na položky. Čiarka vnútri úvodzoviek nie je oddeľovač —
 * bez toho sa „Doprava, s.r.o." rozpadne na dva zmrzačené reťazce a tichá
 * strata dát sa prejaví až pri prvom read-modify-write cykle.
 */
function splitList(inner: string): string[] {
  const out: string[] = [];
  let cur = "";
  let quote: string | undefined;
  let quoted = false;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner.charAt(i);
    if (quote !== undefined) {
      if (ch === "\\" && inner.charAt(i + 1) === quote) {
        cur += quote;
        i++;
        continue;
      }
      if (ch === quote) {
        quote = undefined;
        continue;
      }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      // Medzera medzi čiarkou a úvodzovkou patrí formátovaniu, nie hodnote.
      if (cur.trim() === "") cur = "";
      quote = ch;
      quoted = true;
      continue;
    }
    if (ch === ",") {
      out.push(quoted ? cur : cur.trim());
      cur = "";
      quoted = false;
      continue;
    }
    cur += ch;
  }
  out.push(quoted ? cur : cur.trim());
  return out;
}

function parseScalar(raw: string): FmScalar | string[] | FmMap {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (inner === "") return [];
    return splitList(inner);
  }
  if (v.startsWith("{") && v.endsWith("}")) return parseFlowMap(v.slice(1, -1));
  // Číslo len bez vedúcej nuly: „04920040" je IČO, nie 4920040. Tretina
  // českých IČO začína nulou a stratená nula urobí z overeného údaja
  // nesprávny — a jehla úniku postavená na zlom čísle nikdy nesadne na to pravé.
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(v)) return Number(v);
  return unquote(v);
}

/** `{ by: x, at: y }` — tvar, ktorým OKF zapisuje `generated` a `verified`. */
function parseFlowMap(inner: string): FmMap {
  const out: FmMap = {};
  if (inner.trim() === "") return out;
  for (const part of splitList(inner)) {
    const idx = part.indexOf(":");
    if (idx === -1) throw new Error(`Neplatná položka mapovania: ${part}`);
    const key = part.slice(0, idx).trim();
    const val = parseScalar(part.slice(idx + 1));
    if (Array.isArray(val) || typeof val === "object") {
      throw new Error(`Mapovanie v mapovaní sa nepodporuje: ${key}`);
    }
    out[key] = val;
  }
  return out;
}

function unquote(v: string): string {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

const indentOf = (line: string): number => line.length - line.trimStart().length;

/**
 * Riadkový čítač frontmatteru rozšírený o bloky, ktoré používa OKF:
 *
 *   sources:            verified:            tags:
 *     - id: x             - by: a              - klient
 *       title: y            at: b              - vozidlo
 *
 * Nie je to YAML. Je to presne tento tvar a nič iné — čokoľvek hlbšie alebo
 * inak odsadené skončí chybou s číslom riadku. V právnom dokumente je tichý
 * omyl v citácii horší než odmietnutý súbor.
 */
export function parseFrontmatter(fm: string): Map<string, FmValue> {
  const out = new Map<string, FmValue>();
  const lines = fm.split("\n");
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trimStart().startsWith("#")) { i++; continue; }
    if (indentOf(line) !== 0) throw new Error(`Riadok ${i + 1}: neočakávané odsadenie: ${line}`);
    const idx = line.indexOf(":");
    if (idx === -1) throw new Error(`Riadok ${i + 1}: neplatný riadok frontmatteru: ${line}`);
    const key = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1);

    if (rest.trim() !== "") {
      out.set(key, parseScalar(rest));
      i++;
      continue;
    }

    // Prázdna hodnota → blok na ďalších riadkoch.
    const block: string[] = [];
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j] ?? "";
      if (l.trim() === "") { j++; continue; }
      if (indentOf(l) === 0) break;
      block.push(l);
      j++;
    }
    if (block.length === 0) {
      out.set(key, "");
    } else {
      out.set(key, parseBlock(block, i + 2));
    }
    i = j;
  }
  return out;
}

function parseBlock(block: string[], firstLineNo: number): string[] | FmMap | FmMap[] {
  const base = indentOf(block[0] ?? "");
  const first = (block[0] ?? "").trim();

  if (!first.startsWith("- ")) {
    // ploché mapovanie
    const map: FmMap = {};
    block.forEach((l, k) => {
      if (indentOf(l) !== base) {
        throw new Error(`Riadok ${firstLineNo + k}: nerovnaké odsadenie v mapovaní: ${l}`);
      }
      const idx = l.indexOf(":");
      if (idx === -1) throw new Error(`Riadok ${firstLineNo + k}: chýba dvojbodka: ${l}`);
      if (l.slice(idx + 1).trim() === "") {
        throw new Error(`Riadok ${firstLineNo + k}: vnorený blok sa nepodporuje: ${l}`);
      }
      const v = parseScalar(l.slice(idx + 1));
      if (typeof v === "object") throw new Error(`Riadok ${firstLineNo + k}: vnorené mapovanie sa nepodporuje`);
      map[l.slice(0, idx).trim()] = v;
    });
    return map;
  }

  // zoznam: buď skaláre, alebo ploché mapovania — nie zmes
  const items: (FmScalar | FmMap)[] = [];
  let cur: FmMap | undefined;
  // Hĺbka polí položky sa určí prvým pokračovacím riadkom. Čokoľvek hlbšie
  // je vnorený blok — a ten sa neprečíta „nejako", ale odmietne.
  let fieldIndent: number | undefined;
  block.forEach((l, k) => {
    const ind = indentOf(l);
    const t = l.trim();
    if (ind === base) {
      fieldIndent = undefined;
      if (!t.startsWith("- ")) throw new Error(`Riadok ${firstLineNo + k}: očakávaná položka „- ": ${l}`);
      const body = t.slice(2).trim();
      const idx = body.indexOf(":");
      if (idx === -1 || body.startsWith('"') || body.startsWith("'") || body.startsWith("[") || body.startsWith("{")) {
        const v = parseScalar(body);
        if (typeof v === "object" && !Array.isArray(v)) { cur = v; items.push(cur); return; }
        if (Array.isArray(v)) throw new Error(`Riadok ${firstLineNo + k}: zoznam v zozname sa nepodporuje`);
        cur = undefined;
        items.push(v);
        return;
      }
      if (body.slice(idx + 1).trim() === "") {
        throw new Error(`Riadok ${firstLineNo + k}: vnorený blok v položke sa nepodporuje: ${l}`);
      }
      cur = {};
      const v = parseScalar(body.slice(idx + 1));
      if (typeof v === "object") throw new Error(`Riadok ${firstLineNo + k}: vnorená hodnota sa nepodporuje`);
      cur[body.slice(0, idx).trim()] = v;
      items.push(cur);
      return;
    }
    if (ind > base) {
      if (!cur) throw new Error(`Riadok ${firstLineNo + k}: odsadený riadok bez položky: ${l}`);
      fieldIndent ??= ind;
      if (ind !== fieldIndent) {
        throw new Error(`Riadok ${firstLineNo + k}: hlbšie vnorenie v položke sa nepodporuje: ${l}`);
      }
      const idx = t.indexOf(":");
      if (idx === -1) throw new Error(`Riadok ${firstLineNo + k}: chýba dvojbodka: ${l}`);
      if (t.slice(idx + 1).trim() === "") {
        throw new Error(`Riadok ${firstLineNo + k}: vnorený blok v položke sa nepodporuje: ${l}`);
      }
      const v = parseScalar(t.slice(idx + 1));
      if (typeof v === "object") throw new Error(`Riadok ${firstLineNo + k}: vnorená hodnota sa nepodporuje`);
      cur[t.slice(0, idx).trim()] = v;
      return;
    }
    throw new Error(`Riadok ${firstLineNo + k}: neočakávané odsadenie: ${l}`);
  });

  const maps = items.filter((x) => typeof x === "object");
  if (maps.length === 0) return items.map((x) => String(x));
  if (maps.length !== items.length) {
    throw new Error(`Riadok ${firstLineNo}: zoznam mieša skaláre a mapovania`);
  }
  return items as FmMap[];
}

/**
 * Jurisdikcia je hodnota poľa, nie názov adresára ani prítomnosť kľúča.
 * Vďaka tomu môžu český a slovenský záznam ležať vedľa seba.
 */
function readJurisdiction(raw: Map<string, unknown>): Jurisdiction {
  const value = raw.get("jurisdiction");
  if (value === undefined) {
    throw new Error("Záznam nemá pole jurisdiction — bez neho sa nedá lokalizovať výstup");
  }
  const j = String(value);
  if (!isJurisdiction(j)) throw new Error(`Neznáma jurisdikcia: ${j}`);
  return j;
}

function sectionBody(body: string, heading: string): string | undefined {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "m");
  const m = re.exec(body);
  if (!m) return undefined;
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}

function parseTimeline(raw: string | undefined): TimelineEntry[] {
  if (!raw) return [];
  const out: TimelineEntry[] = [];
  for (const line of raw.split("\n")) {
    const m = /^-\s*(\d{4}-\d{2}-\d{2})\s*(?:\[([a-z_]+)\]\s*)?[—-]\s*(.*)$/.exec(line.trim());
    if (!m || !m[1] || m[3] === undefined) continue;
    out.push(m[2] === undefined
      ? { date: m[1], text: m[3].trim() }
      : { date: m[1], text: m[3].trim(), kind: m[2] });
  }
  return out;
}

export function parseRecord(text: string): OkfRecord {
  const { fm, body } = splitFrontmatter(text);
  const raw = parseFrontmatter(fm);
  const j = readJurisdiction(raw);

  const canon = new Map<string, FmValue>();
  const extra: Record<string, FmValue> = {};
  for (const [k, v] of raw) {
    const kanon = canonicalField(k);
    if (kanon === undefined) {
      extra[k] = v;
      continue;
    }
    // Kľúčom je kanonický názov, nie ten zo súboru — inak by starý alias
    // (`summary`) prešiel kontrolou neznámych polí, ale kontrola povinných
    // polí by ho nenašla a záznam by spadol na „chýba description".
    canon.set(kanon, v);
  }

  for (const f of FIELDS) {
    if (f.required && !canon.has(f.canonical)) {
      throw new Error(`Chýba povinné pole: ${f.canonical}`);
    }
  }

  const typeRaw = String(canon.get("type"));
  if (!isRecordType(typeRaw)) throw new Error(`Neznámy typ záznamu: ${typeRaw}`);
  const type: RecordType = typeRaw;

  const layer = String(canon.get("layer")) as Layer;
  if (layer !== LAYER_OF[type]) {
    throw new Error(`Typ ${typeRaw} patrí do vrstvy ${LAYER_OF[type]}, nie ${layer}`);
  }

  const rec: OkfRecord = {
    okf: Number(canon.get("okf")),
    id: String(canon.get("id")),
    type,
    title: String(canon.get("title")),
    description: String(canon.get("description")),
    layer,
    jurisdiction: j,
    status: String(canon.get("status")),
    created: String(canon.get("created")),
    updated: String(canon.get("updated")),
    truth: sectionBody(body, HEADINGS.truth) ?? "",
    timeline: parseTimeline(sectionBody(body, HEADINGS.timeline)),
  };

  // Nepovinné polia sa berú z tabuľky, nie z ručného zoznamu — inak by nové
  // pole ticho vypadlo pri čítaní a nikto by si toho nevšimol.
  const target = rec as unknown as Record<string, FmValue>;
  for (const f of FIELDS) {
    if (CORE_FIELDS.has(f.canonical)) continue;
    const v = canon.get(f.canonical);
    if (v === undefined) continue;
    target[f.canonical] = coerceField(f.kind, v, f.canonical);
  }
  if (Object.keys(extra).length > 0) rec.extra = extra;
  return rec;
}

/**
 * Prispôsobí prečítanú hodnotu druhu poľa. Staré tvary sa prijímajú:
 * `sources: ["§ 129 o. s. ř."]` (zoznam reťazcov) sa stane zoznamom prameňov
 * s `title`, aby staršie spisy bežali ďalej bez migrácie.
 */
export function coerceField(kind: string, v: FmValue, key: string): FmValue {
  const isMap = (x: unknown): x is FmMap => typeof x === "object" && x !== null && !Array.isArray(x);
  switch (kind) {
    case "list":
      return Array.isArray(v) ? (v as unknown[]).map((x) => (isMap(x) ? JSON.stringify(x) : String(x))) : [String(v)];
    case "map":
      if (isMap(v)) return stringifyMap(v);
      throw new Error(`Pole ${key} má byť mapovanie`);
    case "maplist": {
      const items = Array.isArray(v) ? (v as unknown[]) : [v];
      return items.map((x) => (isMap(x) ? stringifyMap(x) : { title: String(x) }));
    }
    default:
      if (typeof v === "object") throw new Error(`Pole ${key} má byť jednoduchá hodnota`);
      return String(v);
  }
}

function stringifyMap(m: FmMap): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, val] of Object.entries(m)) out[k] = String(val);
  return out;
}

function emitScalar(v: FmScalar): string {
  if (typeof v === "number") return String(v);
  return /[:#[\]"'{}]/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

/**
 * Zapíše hodnotu tak, aby ju prečítal späť `parseFrontmatter` — a ktorýkoľvek
 * OKF konzument. Mapovania idú blokovo, lebo tak ich píše spec a tak sú
 * čitateľné aj pre človeka v Obsidiane.
 */
function emitLines(key: string, v: FmValue): string[] {
  if (Array.isArray(v)) {
    if (v.length === 0) return [`${key}: []`];
    if (typeof v[0] === "object") {
      const out = [`${key}:`];
      for (const m of v as FmMap[]) {
        const ks = Object.keys(m);
        ks.forEach((k, i) => out.push(`${i === 0 ? "  - " : "    "}${k}: ${emitScalar(m[k] ?? "")}`));
        if (ks.length === 0) out.push("  - {}");
      }
      return out;
    }
    // Úvodzovka vnútri položky sa musí escapovať aj v zozname — inak sa
    // hodnota pri čítaní predčasne uzavrie a zvyšok sa rozsype.
    return [`${key}: [${(v as string[]).map((x) => `"${x.replace(/"/g, '\\"')}"`).join(", ")}]`];
  }
  if (typeof v === "object") {
    const ks = Object.keys(v);
    if (ks.length === 0) return [`${key}: {}`];
    return [`${key}:`, ...ks.map((k) => `  ${k}: ${emitScalar(v[k] ?? "")}`)];
  }
  return [`${key}: ${emitScalar(v)}`];
}

export function serializeRecord(r: OkfRecord): string {
  const lines: string[] = [FM_DELIM];
  const src = r as unknown as Record<string, FmValue | undefined>;
  for (const f of FIELDS) {
    const value = src[f.canonical];
    if (value === undefined) continue;
    lines.push(...emitLines(f.canonical, value));
  }
  // Cudzie kľúče idú na koniec frontmatteru, aby round-trip nič nestratil.
  for (const [k, v] of Object.entries(r.extra ?? {})) {
    lines.push(...emitLines(k, v));
  }
  lines.push(FM_DELIM, "");
  lines.push(`## ${HEADINGS.truth}`, "", r.truth, "");
  lines.push(`## ${HEADINGS.timeline}`, "");
  for (const e of r.timeline) {
    lines.push(`- ${e.date}${e.kind ? ` [${e.kind}]` : ""} — ${e.text}`);
  }
  return lines.join("\n") + "\n";
}
