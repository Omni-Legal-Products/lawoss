/**
 * Čítanie a zápis jedného pamäťového záznamu.
 *
 * Záznam je markdown so YAML frontmatterom a dvomi sekciami:
 *   ## Pravda    — aktuálny overený stav, prepisuje sa
 *   ## Historie  — append-only stopa, nikdy sa nemaže
 *
 * Frontmatter sa číta a píše v jurisdikčných kľúčoch, model je kanonický.
 */

import {
  FIELDS,
  canonicalField,
  canonicalType,
  fieldKey,
  typeKey,
  LAYER_OF,
  type Jurisdiction,
  type Layer,
  type RecordType,
} from "./schema.ts";

export const HEADINGS: Record<Jurisdiction, { truth: string; timeline: string }> = {
  cz: { truth: "Pravda", timeline: "Historie" },
  sk: { truth: "Pravda", timeline: "História" },
};

export interface TimelineEntry {
  readonly date: string;
  readonly text: string;
}

export interface OkfRecord {
  schema: number;
  id: string;
  type: RecordType;
  title: string;
  summary: string;
  layer: Layer;
  jurisdiction: Jurisdiction;
  status: string;
  created: string;
  updated: string;

  // zoznamy
  sources?: string[];
  related?: string[];
  deadlines?: string[];
  parties?: string[];
  area?: string[];
  business_scope?: string[];
  representatives?: string[];
  ubo?: string[];
  registries?: string[];

  // spis
  matter_ref?: string;
  court?: string;

  // identifikácia subjektu (§ 8 zák. č. 253/2008 Sb.)
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

  truth: string;
  timeline: TimelineEntry[];
}

const FM_DELIM = "---";

/** Polia, ktoré parser priraďuje výslovne; zvyšok sa berie z tabuľky. */
const CORE_FIELDS = new Set([
  "schema", "id", "type", "title", "summary",
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

function parseScalar(raw: string): string | number | string[] {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (inner === "") return [];
    return splitList(inner);
  }
  if (/^-?\d+(\.\d+)?$/.test(v)) return Number(v);
  return unquote(v);
}

function unquote(v: string): string {
  if (v.length >= 2 && ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'")))) {
    return v.slice(1, -1);
  }
  return v;
}

function parseFrontmatter(fm: string): Map<string, string | number | string[]> {
  const out = new Map<string, string | number | string[]>();
  for (const line of fm.split("\n")) {
    if (line.trim() === "" || line.trimStart().startsWith("#")) continue;
    const idx = line.indexOf(":");
    if (idx === -1) throw new Error(`Neplatný riadok frontmatteru: ${line}`);
    const key = line.slice(0, idx).trim();
    out.set(key, parseScalar(line.slice(idx + 1)));
  }
  return out;
}

function detectJurisdiction(raw: Map<string, unknown>): Jurisdiction {
  if (raw.has("jurisdikce")) return "cz";
  if (raw.has("jurisdikcia")) return "sk";
  throw new Error("Nedá sa určiť jurisdikcia — chýba pole jurisdikce (CZ) alebo jurisdikcia (SK)");
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
    const m = /^-\s*(\d{4}-\d{2}-\d{2})\s*[—-]\s*(.*)$/.exec(line.trim());
    if (m && m[1] && m[2] !== undefined) out.push({ date: m[1], text: m[2].trim() });
  }
  return out;
}

export function parseRecord(text: string): OkfRecord {
  const { fm, body } = splitFrontmatter(text);
  const raw = parseFrontmatter(fm);
  const j = detectJurisdiction(raw);

  const canon = new Map<string, string | number | string[]>();
  for (const [k, v] of raw) {
    const c = canonicalField(k, j);
    if (c === undefined) throw new Error(`Neznáme pole frontmatteru pre jurisdikciu ${j}: ${k}`);
    canon.set(c, v);
  }

  for (const f of FIELDS) {
    if (f.required && !canon.has(f.canonical)) {
      throw new Error(`Chýba povinné pole: ${fieldKey(f.canonical, j)}`);
    }
  }

  const typeRaw = String(canon.get("type"));
  const type = canonicalType(typeRaw, j);
  if (!type) throw new Error(`Neznámy typ záznamu pre jurisdikciu ${j}: ${typeRaw}`);

  const layer = String(canon.get("layer")) as Layer;
  if (layer !== LAYER_OF[type]) {
    throw new Error(`Typ ${typeRaw} patrí do vrstvy ${LAYER_OF[type]}, nie ${layer}`);
  }

  const rec: OkfRecord = {
    schema: Number(canon.get("schema")),
    id: String(canon.get("id")),
    type,
    title: String(canon.get("title")),
    summary: String(canon.get("summary")),
    layer,
    jurisdiction: j,
    status: String(canon.get("status")),
    created: String(canon.get("created")),
    updated: String(canon.get("updated")),
    truth: sectionBody(body, HEADINGS[j].truth) ?? "",
    timeline: parseTimeline(sectionBody(body, HEADINGS[j].timeline)),
  };

  // Nepovinné polia sa berú z tabuľky, nie z ručného zoznamu — inak by nové
  // pole ticho vypadlo pri čítaní a nikto by si toho nevšimol.
  const target = rec as unknown as Record<string, string | string[]>;
  for (const f of FIELDS) {
    if (CORE_FIELDS.has(f.canonical)) continue;
    const v = canon.get(f.canonical);
    if (v === undefined) continue;
    target[f.canonical] = f.kind === "list"
      ? (Array.isArray(v) ? v : [String(v)])
      : String(v);
  }
  return rec;
}

function emit(v: string | number | string[]): string {
  // Úvodzovka vnútri položky sa musí escapovať aj v zozname — inak sa
  // hodnota pri čítaní predčasne uzavrie a zvyšok sa rozsype.
  if (Array.isArray(v)) {
    return `[${v.map((x) => `"${x.replace(/"/g, '\\"')}"`).join(", ")}]`;
  }
  if (typeof v === "number") return String(v);
  return /[:#[\]"']/.test(v) ? `"${v.replace(/"/g, '\\"')}"` : v;
}

export function serializeRecord(r: OkfRecord): string {
  const j = r.jurisdiction;
  const lines: string[] = [FM_DELIM];
  for (const f of FIELDS) {
    const c = f.canonical;
    let value: string | number | string[] | undefined;
    if (c === "type") value = typeKey(r.type, j);
    else if (c === "jurisdiction") value = j;
    else value = (r as unknown as Record<string, string | number | string[] | undefined>)[c];
    if (value === undefined) continue;
    lines.push(`${fieldKey(c, j)}: ${emit(value)}`);
  }
  lines.push(FM_DELIM, "");
  lines.push(`## ${HEADINGS[j].truth}`, "", r.truth, "");
  lines.push(`## ${HEADINGS[j].timeline}`, "");
  for (const e of r.timeline) lines.push(`- ${e.date} — ${e.text}`);
  return lines.join("\n") + "\n";
}
