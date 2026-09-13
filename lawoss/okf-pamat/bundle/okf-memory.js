#!/usr/bin/env node
// @lawoss/okf-pamat — vygenerované z bin/okf-memory.ts cez `bun run build`. Needitovať ručne.

// src/cli.ts
import { existsSync as existsSync3, mkdirSync as mkdirSync2, readFileSync as readFileSync3, writeFileSync as writeFileSync2 } from "node:fs";
import { join as join3, resolve as resolve2 } from "node:path";

// src/store.ts
import { existsSync as existsSync2, mkdirSync, readFileSync as readFileSync2, readdirSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join as join2, relative, resolve, sep } from "node:path";

// src/schema.ts
var RECORD_TYPES = [
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
  "authority"
];
var LAYER_OF = {
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
  authority: "L3"
};
var STATUS = ["active", "superseded", "void"];
var PERSON_KINDS = ["natural_person", "legal_person", "sole_trader"];
var ROLES = ["client", "counterparty", "representative", "ubo"];
var RISK = ["low", "medium", "high"];
var CONCLUSION = ["proceed", "enhanced_diligence", "decline"];
var EVENT_KINDS = [
  "dorucenie",
  "podanie",
  "pojednavanie",
  "rozhodnutie",
  "vyzva",
  "hovor",
  "email"
];
var TASK_STATES = ["pending", "in_progress", "blocked", "done"];
var PROOF_STATUS = ["proven", "unproven", "disputed"];
var CONFIDENCE = ["high", "medium", "low"];
var EVIDENCE_STRENGTH = ["direct", "indirect"];
var PROCEDURAL_STATUS = ["proposed", "taken"];
var EVIDENCE_KINDS = [
  "document",
  "witness",
  "expert_opinion",
  "party_examination",
  "inspection"
];
var SCREENING_PROVISION = {
  cz: "§ 9 zák. č. 253/2008 Sb."
};
var SCREENING_MODES = ["light", "medium", "hard"];
var FIELDS = [
  { canonical: "okf", cz: "okf", sk: "okf", kind: "number", required: true },
  { canonical: "id", cz: "id", sk: "id", kind: "string", required: true },
  { canonical: "type", cz: "typ", sk: "typ", kind: "string", required: true },
  { canonical: "title", cz: "název", sk: "názov", kind: "string", required: true },
  {
    canonical: "description",
    cz: "popis",
    sk: "popis",
    kind: "string",
    required: true,
    aliases: ["summary"]
  },
  { canonical: "layer", cz: "vrstva", sk: "vrstva", kind: "string", required: true },
  { canonical: "jurisdiction", cz: "jurisdikce", sk: "jurisdikcia", kind: "string", required: true },
  {
    canonical: "status",
    cz: "stav",
    sk: "stav",
    kind: "string",
    required: true,
    values: STATUS
  },
  { canonical: "created", cz: "vznik", sk: "vznik", kind: "string", required: true },
  { canonical: "updated", cz: "změna", sk: "zmena", kind: "string", required: true },
  { canonical: "sources", cz: "zdroje", sk: "zdroje", kind: "maplist", required: false },
  { canonical: "related", cz: "souvisí", sk: "súvisí", kind: "list", required: false },
  { canonical: "tags", cz: "štítky", sk: "štítky", kind: "list", required: false },
  { canonical: "truth_digest", cz: "otisk pravdy", sk: "odtlačok pravdy", kind: "string", required: false },
  { canonical: "deadlines", cz: "lhůty", sk: "lehoty", kind: "list", required: false },
  { canonical: "parties", cz: "strany", sk: "strany", kind: "list", required: false },
  { canonical: "matter_ref", cz: "spisová značka", sk: "spisová značka", kind: "string", required: false },
  { canonical: "court", cz: "soud", sk: "súd", kind: "string", required: false },
  { canonical: "area", cz: "oblast práva", sk: "oblasť práva", kind: "list", required: false },
  {
    canonical: "role",
    cz: "role",
    sk: "rola",
    kind: "string",
    required: false,
    values: ROLES
  },
  {
    canonical: "person_type",
    cz: "typ osoby",
    sk: "typ osoby",
    kind: "string",
    required: false,
    values: PERSON_KINDS
  },
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
  { canonical: "legal_form", cz: "právní forma", sk: "právna forma", kind: "string", required: false },
  { canonical: "registered_office", cz: "sídlo", sk: "sídlo", kind: "string", required: false },
  { canonical: "registry_entry", cz: "zápis v rejstříku", sk: "zápis v registri", kind: "string", required: false },
  { canonical: "business_address", cz: "místo podnikání", sk: "miesto podnikania", kind: "string", required: false },
  { canonical: "business_scope", cz: "předmět podnikání", sk: "predmet podnikania", kind: "list", required: false },
  { canonical: "representatives", cz: "jednající osoby", sk: "konajúce osoby", kind: "list", required: false },
  { canonical: "ubo", cz: "skutečný majitel", sk: "konečný užívateľ výhod", kind: "list", required: false },
  { canonical: "pep", cz: "PEP", sk: "PEP", kind: "string", required: false },
  { canonical: "subject_ref", cz: "subjekt", sk: "subjekt", kind: "string", required: false },
  { canonical: "check_date", cz: "datum prověření", sk: "dátum preverenia", kind: "string", required: false },
  {
    canonical: "mode",
    cz: "režim",
    sk: "režim",
    kind: "string",
    required: false,
    values: SCREENING_MODES
  },
  { canonical: "registries", cz: "registry", sk: "registre", kind: "list", required: false },
  { canonical: "pep_result", cz: "výsledek PEP", sk: "výsledok PEP", kind: "string", required: false },
  { canonical: "sanctions_result", cz: "výsledek sankcí", sk: "výsledok sankcií", kind: "string", required: false },
  { canonical: "funds_origin", cz: "původ prostředků", sk: "pôvod prostriedkov", kind: "string", required: false },
  {
    canonical: "risk",
    cz: "riziko",
    sk: "riziko",
    kind: "string",
    required: false,
    values: RISK
  },
  {
    canonical: "conclusion",
    cz: "závěr",
    sk: "záver",
    kind: "string",
    required: false,
    values: CONCLUSION
  },
  { canonical: "valid_until", cz: "platnost do", sk: "platnosť do", kind: "string", required: false },
  { canonical: "claimed_by", cz: "tvrdí", sk: "tvrdí", kind: "string", required: false },
  { canonical: "claimed_at", cz: "kdy tvrzeno", sk: "kedy tvrdené", kind: "string", required: false },
  { canonical: "claimed_in", cz: "kde tvrzeno", sk: "kde tvrdené", kind: "string", required: false },
  { canonical: "legal_question", cz: "právní otázka", sk: "právna otázka", kind: "string", required: false },
  { canonical: "burden_of_proof", cz: "důkazní břemeno", sk: "dôkazné bremeno", kind: "string", required: false },
  { canonical: "supporting_evidence", cz: "podporující důkazy", sk: "podporujúce dôkazy", kind: "list", required: false },
  { canonical: "contradicting_evidence", cz: "vyvracející důkazy", sk: "vyvracajúce dôkazy", kind: "list", required: false },
  {
    canonical: "proof_status",
    cz: "stav prokázání",
    sk: "stav preukázania",
    kind: "string",
    required: false,
    values: PROOF_STATUS
  },
  {
    canonical: "credibility",
    cz: "věrohodnost",
    sk: "vierohodnosť",
    kind: "string",
    required: false,
    values: CONFIDENCE
  },
  {
    canonical: "evidence_kind",
    cz: "druh důkazu",
    sk: "druh dôkazu",
    kind: "string",
    required: false,
    values: EVIDENCE_KINDS
  },
  { canonical: "origin_date", cz: "datum vzniku", sk: "dátum vzniku", kind: "string", required: false },
  { canonical: "author", cz: "autor", sk: "autor", kind: "string", required: false },
  { canonical: "formal_requirements", cz: "formální náležitosti", sk: "formálne náležitosti", kind: "string", required: false },
  { canonical: "proves", cz: "k prokázání", sk: "na preukázanie", kind: "list", required: false },
  {
    canonical: "evidence_strength",
    cz: "síla důkazu",
    sk: "sila dôkazu",
    kind: "string",
    required: false,
    values: EVIDENCE_STRENGTH
  },
  {
    canonical: "reliability",
    cz: "spolehlivost",
    sk: "spoľahlivosť",
    kind: "string",
    required: false,
    values: CONFIDENCE
  },
  { canonical: "objection", cz: "námitka", sk: "námietka", kind: "string", required: false },
  {
    canonical: "procedural_status",
    cz: "procesní stav",
    sk: "procesný stav",
    kind: "string",
    required: false,
    values: PROCEDURAL_STATUS
  },
  { canonical: "effective_from", cz: "účinnost od", sk: "účinnosť od", kind: "string", required: false },
  { canonical: "effective_to", cz: "účinnost do", sk: "účinnosť do", kind: "string", required: false },
  { canonical: "verified", cz: "ověření", sk: "overenia", kind: "maplist", required: false },
  { canonical: "verified_at", cz: "ověřeno dne", sk: "overené dňa", kind: "string", required: false },
  { canonical: "verified_against", cz: "ověřeno proti", sk: "overené proti", kind: "string", required: false },
  { canonical: "procedural_role", cz: "procesní postavení", sk: "procesné postavenie", kind: "string", required: false },
  { canonical: "representation", cz: "zastoupení", sk: "zastúpenie", kind: "string", required: false },
  { canonical: "legal_capacity", cz: "způsobilost být účastníkem", sk: "spôsobilosť byť účastníkom", kind: "string", required: false },
  { canonical: "capacity_notes", cz: "poznámky ke způsobilosti", sk: "poznámky k spôsobilosti", kind: "string", required: false },
  { canonical: "assignee", cz: "řeší", sk: "rieši", kind: "string", required: false },
  { canonical: "depends_on", cz: "závisí na", sk: "závisí od", kind: "list", required: false },
  { canonical: "acceptance", cz: "akceptační kritéria", sk: "akceptačné kritériá", kind: "list", required: false },
  { canonical: "priority", cz: "priorita", sk: "priorita", kind: "string", required: false },
  {
    canonical: "state",
    cz: "stav úkolu",
    sk: "stav úlohy",
    kind: "string",
    required: false,
    values: TASK_STATES
  },
  { canonical: "due", cz: "termín", sk: "termín", kind: "string", required: false }
];
var SENSITIVE_FIELDS = FIELDS.filter((f) => f.sensitive).map((f) => f.canonical);
function needleFields() {
  return FIELDS.filter((f) => f.needle !== undefined);
}
var CZ_FO = [
  "title",
  { primary: "birth_number", fallback: ["birth_date", "sex"] },
  "birth_place",
  "residence",
  "citizenship",
  "id_document_type",
  "id_document_number",
  "id_document_issuer",
  "id_document_valid_to"
];
var SK_FO = [
  "title",
  { primary: "birth_number", fallback: ["birth_date"] },
  "residence",
  "citizenship",
  "id_document_type",
  "id_document_number"
];
var AML_REQUIRED = {
  cz: {
    natural_person: CZ_FO,
    legal_person: ["title", "registered_office", "registry_id", "representatives"],
    sole_trader: [...CZ_FO, "registered_office", "registry_id"]
  },
  sk: {
    natural_person: SK_FO,
    legal_person: ["title", "registered_office", "registry_id", "registry_entry", "representatives"],
    sole_trader: [...SK_FO, "business_address", "registry_entry"]
  }
};
var TYPE_LABELS = {
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
  authority: { cz: "pramen", sk: "prameň" }
};
var VALUE_LABELS = {
  status: {
    active: { cz: "platný", sk: "platný" },
    superseded: { cz: "překonaný", sk: "prekonaný" },
    void: { cz: "zrušený", sk: "zrušený" }
  },
  role: {
    client: { cz: "klient", sk: "klient" },
    counterparty: { cz: "protistrana", sk: "protistrana" },
    representative: { cz: "zástupce", sk: "zástupca" },
    ubo: { cz: "skutečný majitel", sk: "konečný užívateľ výhod" }
  },
  person_type: {
    natural_person: { cz: "fyzická osoba", sk: "fyzická osoba" },
    legal_person: { cz: "právnická osoba", sk: "právnická osoba" },
    sole_trader: { cz: "podnikatel", sk: "podnikateľ" }
  },
  risk: {
    low: { cz: "nízké", sk: "nízke" },
    medium: { cz: "střední", sk: "stredné" },
    high: { cz: "vysoké", sk: "vysoké" }
  },
  conclusion: {
    proceed: { cz: "pokračovat", sk: "pokračovať" },
    enhanced_diligence: { cz: "zesílená kontrola", sk: "zosilnená kontrola" },
    decline: { cz: "odmítnout", sk: "odmietnuť" }
  },
  proof_status: {
    proven: { cz: "prokázáno", sk: "preukázané" },
    unproven: { cz: "neprokázáno", sk: "nepreukázané" },
    disputed: { cz: "sporné", sk: "sporné" }
  },
  credibility: {
    high: { cz: "vysoká", sk: "vysoká" },
    medium: { cz: "střední", sk: "stredná" },
    low: { cz: "nízká", sk: "nízka" }
  },
  reliability: {
    high: { cz: "vysoká", sk: "vysoká" },
    medium: { cz: "střední", sk: "stredná" },
    low: { cz: "nízká", sk: "nízka" }
  },
  evidence_strength: {
    direct: { cz: "přímý", sk: "priamy" },
    indirect: { cz: "nepřímý", sk: "nepriamy" }
  },
  procedural_status: {
    proposed: { cz: "navržen", sk: "navrhnutý" },
    taken: { cz: "proveden", sk: "vykonaný" }
  },
  event_kind: {
    dorucenie: { cz: "doručení", sk: "doručenie" },
    podanie: { cz: "podání", sk: "podanie" },
    pojednavanie: { cz: "jednání", sk: "pojednávanie" },
    rozhodnutie: { cz: "rozhodnutí", sk: "rozhodnutie" },
    vyzva: { cz: "výzva", sk: "výzva" },
    hovor: { cz: "hovor", sk: "hovor" },
    email: { cz: "e-mail", sk: "e-mail" }
  },
  state: {
    pending: { cz: "čeká", sk: "čaká" },
    in_progress: { cz: "rozpracováno", sk: "rozpracované" },
    blocked: { cz: "blokován", sk: "blokovaná" },
    done: { cz: "hotovo", sk: "hotové" }
  },
  evidence_kind: {
    document: { cz: "listina", sk: "listina" },
    witness: { cz: "výslech svědka", sk: "výsluch svedka" },
    expert_opinion: { cz: "znalecký posudek", sk: "znalecký posudok" },
    party_examination: { cz: "výslech účastníka", sk: "výsluch účastníka" },
    inspection: { cz: "ohledání", sk: "ohliadka" }
  }
};
function valueLabel(field, value, j) {
  return VALUE_LABELS[field]?.[value]?.[j] ?? value;
}
function fieldLabel(canonical, j) {
  const f = FIELDS.find((x) => x.canonical === canonical);
  if (!f)
    throw new Error(`Neznáme pole: ${canonical}`);
  return j === "cz" ? f.cz : f.sk;
}
function canonicalField(key) {
  return FIELDS.find((x) => x.canonical === key || x.aliases?.includes(key))?.canonical;
}
function typeLabel(t, j) {
  return TYPE_LABELS[t][j];
}
function isRecordType(value) {
  return RECORD_TYPES.includes(value);
}
function isJurisdiction(value) {
  return value === "cz" || value === "sk";
}
function truthDigest(truth) {
  let h = 2166136261;
  const s = truth.trim().replace(/\r\n/g, `
`);
  for (let i = 0;i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}
var OKF_VERSION = "0.2";

// src/record.ts
var HEADINGS = { truth: "Truth", timeline: "History" };
var FM_DELIM = "---";
var CORE_FIELDS = new Set([
  "okf",
  "id",
  "type",
  "title",
  "description",
  "layer",
  "jurisdiction",
  "status",
  "created",
  "updated"
]);
function splitFrontmatter(text) {
  const lines = text.split(`
`);
  if (lines[0]?.trim() !== FM_DELIM) {
    throw new Error("Záznam nemá frontmatter — chýba úvodný oddeľovač ---");
  }
  const end = lines.indexOf(FM_DELIM, 1);
  if (end === -1) {
    throw new Error("Záznam má neuzavretý frontmatter — chýba koncový oddeľovač ---");
  }
  return { fm: lines.slice(1, end).join(`
`), body: lines.slice(end + 1).join(`
`) };
}
function splitList(inner) {
  const out = [];
  let cur = "";
  let quote;
  let quoted = false;
  for (let i = 0;i < inner.length; i++) {
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
      if (cur.trim() === "")
        cur = "";
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
function parseScalar(raw) {
  const v = raw.trim();
  if (v.startsWith("[") && v.endsWith("]")) {
    const inner = v.slice(1, -1).trim();
    if (inner === "")
      return [];
    return splitList(inner);
  }
  if (v.startsWith("{") && v.endsWith("}"))
    return parseFlowMap(v.slice(1, -1));
  if (/^-?(0|[1-9]\d*)(\.\d+)?$/.test(v))
    return Number(v);
  return unquote(v);
}
function parseFlowMap(inner) {
  const out = {};
  if (inner.trim() === "")
    return out;
  for (const part of splitList(inner)) {
    const idx = part.indexOf(":");
    if (idx === -1)
      throw new Error(`Neplatná položka mapovania: ${part}`);
    const key = part.slice(0, idx).trim();
    const val = parseScalar(part.slice(idx + 1));
    if (Array.isArray(val) || typeof val === "object") {
      throw new Error(`Mapovanie v mapovaní sa nepodporuje: ${key}`);
    }
    out[key] = val;
  }
  return out;
}
function unquote(v) {
  if (v.length >= 2 && (v.startsWith('"') && v.endsWith('"') || v.startsWith("'") && v.endsWith("'"))) {
    return v.slice(1, -1);
  }
  return v;
}
var indentOf = (line) => line.length - line.trimStart().length;
function parseFrontmatter(fm) {
  const out = new Map;
  const lines = fm.split(`
`);
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] ?? "";
    if (line.trim() === "" || line.trimStart().startsWith("#")) {
      i++;
      continue;
    }
    if (indentOf(line) !== 0)
      throw new Error(`Riadok ${i + 1}: neočakávané odsadenie: ${line}`);
    const idx = line.indexOf(":");
    if (idx === -1)
      throw new Error(`Riadok ${i + 1}: neplatný riadok frontmatteru: ${line}`);
    const key = line.slice(0, idx).trim();
    const rest = line.slice(idx + 1);
    if (rest.trim() !== "") {
      out.set(key, parseScalar(rest));
      i++;
      continue;
    }
    const block = [];
    let j = i + 1;
    while (j < lines.length) {
      const l = lines[j] ?? "";
      if (l.trim() === "") {
        j++;
        continue;
      }
      if (indentOf(l) === 0)
        break;
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
function parseBlock(block, firstLineNo) {
  const base = indentOf(block[0] ?? "");
  const first = (block[0] ?? "").trim();
  if (!first.startsWith("- ")) {
    const map = {};
    block.forEach((l, k) => {
      if (indentOf(l) !== base) {
        throw new Error(`Riadok ${firstLineNo + k}: nerovnaké odsadenie v mapovaní: ${l}`);
      }
      const idx = l.indexOf(":");
      if (idx === -1)
        throw new Error(`Riadok ${firstLineNo + k}: chýba dvojbodka: ${l}`);
      if (l.slice(idx + 1).trim() === "") {
        throw new Error(`Riadok ${firstLineNo + k}: vnorený blok sa nepodporuje: ${l}`);
      }
      const v = parseScalar(l.slice(idx + 1));
      if (typeof v === "object")
        throw new Error(`Riadok ${firstLineNo + k}: vnorené mapovanie sa nepodporuje`);
      map[l.slice(0, idx).trim()] = v;
    });
    return map;
  }
  const items = [];
  let cur;
  let fieldIndent;
  block.forEach((l, k) => {
    const ind = indentOf(l);
    const t = l.trim();
    if (ind === base) {
      fieldIndent = undefined;
      if (!t.startsWith("- "))
        throw new Error(`Riadok ${firstLineNo + k}: očakávaná položka „- ": ${l}`);
      const body = t.slice(2).trim();
      const idx = body.indexOf(":");
      if (idx === -1 || body.startsWith('"') || body.startsWith("'") || body.startsWith("[") || body.startsWith("{")) {
        const v2 = parseScalar(body);
        if (typeof v2 === "object" && !Array.isArray(v2)) {
          cur = v2;
          items.push(cur);
          return;
        }
        if (Array.isArray(v2))
          throw new Error(`Riadok ${firstLineNo + k}: zoznam v zozname sa nepodporuje`);
        cur = undefined;
        items.push(v2);
        return;
      }
      if (body.slice(idx + 1).trim() === "") {
        throw new Error(`Riadok ${firstLineNo + k}: vnorený blok v položke sa nepodporuje: ${l}`);
      }
      cur = {};
      const v = parseScalar(body.slice(idx + 1));
      if (typeof v === "object")
        throw new Error(`Riadok ${firstLineNo + k}: vnorená hodnota sa nepodporuje`);
      cur[body.slice(0, idx).trim()] = v;
      items.push(cur);
      return;
    }
    if (ind > base) {
      if (!cur)
        throw new Error(`Riadok ${firstLineNo + k}: odsadený riadok bez položky: ${l}`);
      fieldIndent ??= ind;
      if (ind !== fieldIndent) {
        throw new Error(`Riadok ${firstLineNo + k}: hlbšie vnorenie v položke sa nepodporuje: ${l}`);
      }
      const idx = t.indexOf(":");
      if (idx === -1)
        throw new Error(`Riadok ${firstLineNo + k}: chýba dvojbodka: ${l}`);
      if (t.slice(idx + 1).trim() === "") {
        throw new Error(`Riadok ${firstLineNo + k}: vnorený blok v položke sa nepodporuje: ${l}`);
      }
      const v = parseScalar(t.slice(idx + 1));
      if (typeof v === "object")
        throw new Error(`Riadok ${firstLineNo + k}: vnorená hodnota sa nepodporuje`);
      cur[t.slice(0, idx).trim()] = v;
      return;
    }
    throw new Error(`Riadok ${firstLineNo + k}: neočakávané odsadenie: ${l}`);
  });
  const maps = items.filter((x) => typeof x === "object");
  if (maps.length === 0)
    return items.map((x) => String(x));
  if (maps.length !== items.length) {
    throw new Error(`Riadok ${firstLineNo}: zoznam mieša skaláre a mapovania`);
  }
  return items;
}
function readJurisdiction(raw) {
  const value = raw.get("jurisdiction");
  if (value === undefined) {
    throw new Error("Záznam nemá pole jurisdiction — bez neho sa nedá lokalizovať výstup");
  }
  const j = String(value);
  if (!isJurisdiction(j))
    throw new Error(`Neznáma jurisdikcia: ${j}`);
  return j;
}
function sectionBody(body, heading) {
  const re = new RegExp(`^##\\s+${heading}\\s*$`, "m");
  const m = re.exec(body);
  if (!m)
    return;
  const start = m.index + m[0].length;
  const rest = body.slice(start);
  const next = /^##\s+/m.exec(rest);
  return (next ? rest.slice(0, next.index) : rest).trim();
}
function parseTimeline(raw) {
  if (!raw)
    return [];
  const out = [];
  for (const line of raw.split(`
`)) {
    const m = /^-\s*(\d{4}-\d{2}-\d{2})\s*(?:\[([a-z_]+)\]\s*)?[—-]\s*(.*)$/.exec(line.trim());
    if (!m || !m[1] || m[3] === undefined)
      continue;
    out.push(m[2] === undefined ? { date: m[1], text: m[3].trim() } : { date: m[1], text: m[3].trim(), kind: m[2] });
  }
  return out;
}
function parseRecord(text) {
  const { fm, body } = splitFrontmatter(text);
  const raw = parseFrontmatter(fm);
  const j = readJurisdiction(raw);
  const canon = new Map;
  const extra = {};
  for (const [k, v] of raw) {
    const kanon = canonicalField(k);
    if (kanon === undefined) {
      extra[k] = v;
      continue;
    }
    canon.set(kanon, v);
  }
  for (const f of FIELDS) {
    if (f.required && !canon.has(f.canonical)) {
      throw new Error(`Chýba povinné pole: ${f.canonical}`);
    }
  }
  const typeRaw = String(canon.get("type"));
  if (!isRecordType(typeRaw))
    throw new Error(`Neznámy typ záznamu: ${typeRaw}`);
  const type = typeRaw;
  const layer = String(canon.get("layer"));
  if (layer !== LAYER_OF[type]) {
    throw new Error(`Typ ${typeRaw} patrí do vrstvy ${LAYER_OF[type]}, nie ${layer}`);
  }
  const rec = {
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
    timeline: parseTimeline(sectionBody(body, HEADINGS.timeline))
  };
  const target = rec;
  for (const f of FIELDS) {
    if (CORE_FIELDS.has(f.canonical))
      continue;
    const v = canon.get(f.canonical);
    if (v === undefined)
      continue;
    target[f.canonical] = coerceField(f.kind, v, f.canonical);
  }
  if (Object.keys(extra).length > 0)
    rec.extra = extra;
  return rec;
}
function coerceField(kind, v, key) {
  const isMap = (x) => typeof x === "object" && x !== null && !Array.isArray(x);
  switch (kind) {
    case "list":
      return Array.isArray(v) ? v.map((x) => isMap(x) ? JSON.stringify(x) : String(x)) : [String(v)];
    case "map":
      if (isMap(v))
        return stringifyMap(v);
      throw new Error(`Pole ${key} má byť mapovanie`);
    case "maplist": {
      const items = Array.isArray(v) ? v : [v];
      return items.map((x) => isMap(x) ? stringifyMap(x) : { title: String(x) });
    }
    default:
      if (typeof v === "object")
        throw new Error(`Pole ${key} má byť jednoduchá hodnota`);
      return String(v);
  }
}
function stringifyMap(m) {
  const out = {};
  for (const [k, val] of Object.entries(m))
    out[k] = String(val);
  return out;
}
function emitScalar(v) {
  if (typeof v === "number")
    return String(v);
  return /[:#[\]"'{}]/.test(v) ? `"${v.replace(/"/g, "\\\"")}"` : v;
}
function emitLines(key, v) {
  if (Array.isArray(v)) {
    if (v.length === 0)
      return [`${key}: []`];
    if (typeof v[0] === "object") {
      const out = [`${key}:`];
      for (const m of v) {
        const ks = Object.keys(m);
        ks.forEach((k, i) => out.push(`${i === 0 ? "  - " : "    "}${k}: ${emitScalar(m[k] ?? "")}`));
        if (ks.length === 0)
          out.push("  - {}");
      }
      return out;
    }
    return [`${key}: [${v.map((x) => `"${x.replace(/"/g, "\\\"")}"`).join(", ")}]`];
  }
  if (typeof v === "object") {
    const ks = Object.keys(v);
    if (ks.length === 0)
      return [`${key}: {}`];
    return [`${key}:`, ...ks.map((k) => `  ${k}: ${emitScalar(v[k] ?? "")}`)];
  }
  return [`${key}: ${emitScalar(v)}`];
}
function serializeRecord(r) {
  const lines = [FM_DELIM];
  const src = r;
  for (const f of FIELDS) {
    const value = src[f.canonical];
    if (value === undefined)
      continue;
    lines.push(...emitLines(f.canonical, value));
  }
  for (const [k, v] of Object.entries(r.extra ?? {})) {
    lines.push(...emitLines(k, v));
  }
  lines.push(FM_DELIM, "");
  lines.push(`## ${HEADINGS.truth}`, "", r.truth, "");
  lines.push(`## ${HEADINGS.timeline}`, "");
  for (const e of r.timeline) {
    lines.push(`- ${e.date}${e.kind ? ` [${e.kind}]` : ""} — ${e.text}`);
  }
  return lines.join(`
`) + `
`;
}

// src/mask.ts
var DOT = "•";
function maskDigits(value) {
  return value.replace(/\d/g, DOT);
}
function maskValue(canonical, value) {
  if (value === "")
    return value;
  if (!SENSITIVE_FIELDS.includes(canonical))
    return value;
  switch (canonical) {
    case "birth_number": {
      const m = /^(\d{6})(\/?)(\d+)$/.exec(value);
      if (!m)
        return maskDigits(value);
      return `${m[1]}${m[2]}${DOT.repeat((m[3] ?? "").length)}`;
    }
    case "id_document_number": {
      const keep = Math.min(2, value.length);
      return value.slice(0, keep) + DOT.repeat(value.length - keep);
    }
    case "birth_date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      return m ? `${m[1]}-${DOT.repeat(2)}-${DOT.repeat(2)}` : maskDigits(value);
    }
    case "residence":
      return maskDigits(value);
    default:
      return maskDigits(value);
  }
}
function maskRecord(r) {
  const copy = { ...r, timeline: [...r.timeline] };
  const target = copy;
  for (const key of SENSITIVE_FIELDS) {
    const v = target[key];
    if (typeof v === "string")
      target[key] = maskValue(key, v);
  }
  return copy;
}

// src/render.ts
function odkaz(id, href) {
  const cesta = href?.(id);
  return cesta ? `[${id}](${cesta})` : id;
}
var BLOCKS = ["parties", "facts", "deadlines", "timeline", "tasks", "documents", "records", "evidence_matrix"];
var BLOCK_HEADINGS = {
  deadlines: { cz: "Lhůty", sk: "Lehoty" },
  timeline: { cz: "Chronologie", sk: "Chronológia" },
  records: { cz: "Záznamy paměti", sk: "Záznamy pamäte" },
  evidence_matrix: { cz: "Dokazování", sk: "Dokazovanie" },
  tasks: { cz: "Otevřené úkoly", sk: "Otvorené úlohy" },
  parties: { cz: "Strany", sk: "Strany" },
  facts: { cz: "Fakta věci", sk: "Fakty veci" },
  documents: { cz: "Klíčové dokumenty", sk: "Kľúčové dokumenty" }
};
var EMPTY = {
  cz: "_(zatím nic)_",
  sk: "_(zatiaľ nič)_"
};
function startMarker(b) {
  return `<!-- okf:render:${b}:start -->`;
}
function endMarker(b) {
  return `<!-- okf:render:${b}:end -->`;
}
function renderDeadlines(records, j, href) {
  const rows = [];
  for (const r of records) {
    for (const d of r.deadlines ?? [])
      rows.push(`| ${d} | ${r.title} | ${odkaz(r.id, href)} |`);
  }
  if (rows.length === 0)
    return EMPTY[j];
  rows.sort();
  const head = j === "cz" ? "| Datum | Věc | Záznam |" : "| Dátum | Vec | Záznam |";
  return [head, "|---|---|---|", ...rows].join(`
`);
}
function renderTimeline(records, j, href) {
  const rows = [];
  for (const r of records) {
    for (const e of r.timeline) {
      rows.push({
        date: e.date,
        line: `| ${e.date} | ${e.kind ? valueLabel("event_kind", e.kind, j) : ""} | ${e.text} | ${odkaz(r.id, href)} |`
      });
    }
  }
  if (rows.length === 0)
    return EMPTY[j];
  rows.sort((a, b) => a.date < b.date ? -1 : a.date > b.date ? 1 : 0);
  const head = j === "cz" ? "| Datum | Druh | Událost | Záznam |" : "| Dátum | Druh | Udalosť | Záznam |";
  return [head, "|---|---|---|---|", ...rows.map((r) => r.line)].join(`
`);
}
function renderRecords(records, j, href) {
  if (records.length === 0)
    return EMPTY[j];
  const head = "| Záznam | Typ | Popis |";
  const rows = [...records].sort((a, b) => a.id < b.id ? -1 : 1).map((r) => `| ${odkaz(r.id, href)} | ${typeLabel(r.type, j)} | ${r.description} |`);
  return [head, "|---|---|---|", ...rows].join(`
`);
}
function cellMark(claim, e) {
  if ((claim.contradicting_evidence ?? []).includes(e.id))
    return "✗";
  if (!(claim.supporting_evidence ?? []).includes(e.id))
    return "–";
  if (e.evidence_strength === "indirect")
    return "~";
  if (e.evidence_strength === "direct" && e.reliability === "high")
    return "✓✓";
  return "✓";
}
var MATRIX_LABELS = {
  cz: {
    claim: "Tvrzení",
    state: "Stav",
    burden: "Břemeno nese",
    credibility: "Věrohodnost",
    legend: "✓✓ přímý a spolehlivý · ✓ podpůrný · ~ nepřímý · ✗ vyvrací · – nesouvisí",
    burdenHead: "Důkazní břemeno"
  },
  sk: {
    claim: "Tvrdenie",
    state: "Stav",
    burden: "Bremeno nesie",
    credibility: "Vierohodnosť",
    legend: "✓✓ priamy a spoľahlivý · ✓ podporný · ~ nepriamy · ✗ vyvracia · – nesúvisí",
    burdenHead: "Dôkazné bremeno"
  }
};
function renderEvidenceMatrix(records, j, _href) {
  const claims = records.filter((r) => r.type === "claim").sort((a, b) => a.id < b.id ? -1 : 1);
  if (claims.length === 0)
    return EMPTY[j];
  const evidence = records.filter((r) => r.type === "evidence").sort((a, b) => a.id < b.id ? -1 : 1);
  const L = MATRIX_LABELS[j];
  const head = [L.claim, ...evidence.map((e) => e.id), L.state];
  const rows = claims.map((c) => [
    c.id,
    ...evidence.map((e) => cellMark(c, e)),
    valueLabel("proof_status", c.proof_status ?? "—", j)
  ]);
  const bremeno = [
    `| ${L.claim} | ${L.burden} | ${L.state} | ${L.credibility} |`,
    "|---|---|---|---|",
    ...claims.map((c) => `| ${c.id} | ${c.burden_of_proof ?? "—"} | ` + `${valueLabel("proof_status", c.proof_status ?? "—", j)} | ` + `${valueLabel("credibility", c.credibility ?? "—", j)} |`)
  ];
  return [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
    ...rows.map((r) => `| ${r.join(" | ")} |`),
    "",
    `_${L.legend}_`,
    "",
    `**${L.burdenHead}**`,
    "",
    ...bremeno
  ].join(`
`);
}
function renderTasks(records, j, href) {
  const open = records.filter((r) => r.type === "task" && r.state !== "done").sort((a, b) => a.id < b.id ? -1 : 1);
  if (open.length === 0)
    return EMPTY[j];
  const head = j === "cz" ? "| Úkol | Věc | Řeší | Stav | Termín |" : "| Úloha | Vec | Rieši | Stav | Termín |";
  const rows = open.map((t) => `| ${odkaz(t.id, href)} | ${t.title} | ${t.assignee ?? "—"} | ` + `${valueLabel("state", t.state ?? "—", j)} | ${t.due ?? "—"} |`);
  return [head, "|---|---|---|---|---|", ...rows].join(`
`);
}
function cell(s) {
  return s.replace(/\|/g, "\\|").replace(/\s*\n\s*/g, " ").trim();
}
function sourceLink(s) {
  const label = s.title ?? s.id ?? s.resource ?? "?";
  if (!s.resource)
    return cell(label);
  const name = /^https?:\/\//.test(s.resource) ? label : s.resource.split("/").pop() ?? label;
  return `[${cell(name)}](${s.resource})`;
}
var ROLE_ORDER = ["client", "counterparty", "representative", "ubo"];
function renderParties(records, j, href) {
  const subjects = records.filter((r) => r.type === "subject").sort((a, b) => ROLE_ORDER.indexOf(a.role ?? "") - ROLE_ORDER.indexOf(b.role ?? "") || (a.id < b.id ? -1 : 1));
  if (subjects.length === 0)
    return EMPTY[j];
  const head = j === "cz" ? "| Role | Subjekt | IČO / RČ | Záznam |" : "| Rola | Subjekt | IČO / RČ | Záznam |";
  const rows = subjects.map((s) => {
    const ident = s.registry_id ?? (s.birth_number ? maskValue("birth_number", s.birth_number) : "—");
    return `| ${valueLabel("role", s.role ?? "—", j)} | ${cell(s.title)} | ${ident} | ${odkaz(s.id, href)} |`;
  });
  return [head, "|---|---|---|---|", ...rows].join(`
`);
}
function renderFacts(records, j, href) {
  const rows = [];
  let n = 0;
  const byId = (a, b) => a.id < b.id ? -1 : 1;
  for (const r of records.filter((x) => x.type === "matter").sort(byId)) {
    const src = new Map((r.sources ?? []).map((s) => [s.id ?? "", s]));
    for (const raw of r.truth.split(`
`)) {
      const line = raw.replace(/^[-*]\s+/, "").trim();
      if (!line)
        continue;
      const refs = [...line.matchAll(/\[\^([^\]]+)\]/g)].map((m) => m[1] ?? "");
      const text = line.replace(/\[\^[^\]]+\]/g, "").replace(/\*\*/g, "").trim();
      const zdroj = refs.map((id) => {
        const s = src.get(id);
        return s ? sourceLink(s) : `[^${id}]`;
      }).join(", ") || "—";
      const kedy = refs.map((id) => src.get(id)?.last_modified).find(Boolean) ?? r.updated;
      rows.push(`| ${++n} | ${cell(text)} | ${zdroj} | ${kedy} | ${odkaz(r.id, href)} |`);
    }
  }
  for (const c of records.filter((x) => x.type === "claim").sort(byId)) {
    const kto = c.claimed_by ? j === "cz" ? `tvrdí ${c.claimed_by}` : `tvrdí ${c.claimed_by}` : "—";
    rows.push(`| ${++n} | ${cell(c.title)} | ${cell(kto)} | ${c.claimed_at ?? c.updated} | ${odkaz(c.id, href)} |`);
  }
  if (rows.length === 0)
    return EMPTY[j];
  const head = j === "cz" ? "| # | Fakt | Zdroj | Zjištěno | Záznam |" : "| # | Fakt | Zdroj | Zistené | Záznam |";
  return [head, "|---|---|---|---|---|", ...rows].join(`
`);
}
function renderDocuments(records, j, href) {
  const docs = records.filter((r) => r.type === "evidence").sort((a, b) => a.id < b.id ? -1 : 1);
  if (docs.length === 0)
    return EMPTY[j];
  const head = j === "cz" ? "| Dokument | Druh | Datum | Umístění | Záznam |" : "| Dokument | Druh | Dátum | Umiestnenie | Záznam |";
  const rows = docs.map((e) => {
    const kde = (e.sources ?? []).filter((s) => s.resource).map(sourceLink).join(", ") || "—";
    return `| ${cell(e.title)} | ${valueLabel("evidence_kind", e.evidence_kind ?? "—", j)} | ${e.origin_date ?? "—"} | ${kde} | ${odkaz(e.id, href)} |`;
  });
  return [head, "|---|---|---|---|---|", ...rows].join(`
`);
}
var RENDERERS = {
  parties: renderParties,
  facts: renderFacts,
  documents: renderDocuments,
  deadlines: renderDeadlines,
  timeline: renderTimeline,
  records: renderRecords,
  evidence_matrix: renderEvidenceMatrix,
  tasks: renderTasks
};
function replaceBlock(text, b, body) {
  const start = text.indexOf(startMarker(b));
  if (start === -1)
    return;
  const afterStart = start + startMarker(b).length;
  const end = text.indexOf(endMarker(b), afterStart);
  if (end === -1) {
    throw new Error(`Blok ${b} má otvárací marker bez uzatváracieho — súbor sa neprepisuje`);
  }
  return text.slice(0, afterStart) + `
` + body + `
` + text.slice(end);
}
function appendBlock(text, b, body, j) {
  const section = [
    "",
    `## ${BLOCK_HEADINGS[b][j]}`,
    startMarker(b),
    body,
    endMarker(b),
    ""
  ].join(`
`);
  return text.replace(/\n*$/, `
`) + section;
}
function statusSkeleton(j) {
  const head = j === "cz" ? `# Status věci

> **Fáze:** 
> **Další krok:** 
` : `# Status veci

> **Fáza:** 
> **Ďalší krok:** 
`;
  return BLOCKS.reduce((t, b) => appendBlock(t, b, EMPTY[j], j), head);
}

class RenderConflictError extends Error {
}
var BLOCK_HEADING_ALIASES = {
  deadlines: ["Lhůty", "Lehoty"],
  timeline: ["Chronologie", "Chronológia"],
  records: ["Záznamy paměti", "Záznamy pamäte", "Záznamy"],
  evidence_matrix: ["Dokazování", "Dokazovanie"],
  tasks: ["Otevřené úkoly", "Otvorené úlohy", "Úkoly", "Úlohy"],
  parties: ["Strany", "Strany věci", "Strany veci", "Účastníci", "Účastníci řízení"],
  facts: ["Fakta věci", "Fakty veci", "Fakta", "Fakty", "Skutkový stav"],
  documents: ["Klíčové dokumenty", "Kľúčové dokumenty", "Dokumenty", "Listiny"]
};
var MARKER_ONLY = ["records", "evidence_matrix", "tasks", "parties", "facts", "documents"];
var SOFT_HEADING = ["parties", "facts", "documents"];
function bareHeading(text, b) {
  return findBareHeading(text, b)?.alias;
}
function findBareHeading(text, b) {
  for (const alias of BLOCK_HEADING_ALIASES[b]) {
    const re = new RegExp(`^##\\s*(?:\\d+\\.\\s*)?${alias}\\s*$`, "mi");
    const m = re.exec(text);
    if (m)
      return { alias, end: m.index + m[0].trimEnd().length };
  }
  return;
}
function retrofitStatus(existing, records, j, href) {
  let out = existing;
  const inserted = [];
  for (const b of BLOCKS) {
    if (out.includes(startMarker(b)))
      continue;
    const hit = findBareHeading(out, b);
    if (!hit)
      continue;
    const body = RENDERERS[b](records, j, href);
    out = out.slice(0, hit.end) + `
${startMarker(b)}
${body}
${endMarker(b)}
` + out.slice(hit.end);
    inserted.push(b);
  }
  return { text: out, inserted };
}
function renderStatus(existing, records, j, href) {
  let out = existing;
  for (const b of BLOCKS) {
    const body = RENDERERS[b](records, j, href);
    const replaced = replaceBlock(out, b, body);
    if (replaced !== undefined) {
      out = replaced;
      continue;
    }
    const bare = bareHeading(out, b);
    if (bare !== undefined && SOFT_HEADING.includes(b))
      continue;
    if (bare !== undefined) {
      throw new RenderConflictError(`Sekcia „${bare}" v _STATUS.md existuje, ale nemá markery — render by ` + `pripojil druhú rovnakú sekciu a v spise by vznikli dve pravdy. ` + `Doplň markery cez retrofit a spusti sync znova.`);
    }
    if (MARKER_ONLY.includes(b))
      continue;
    out = appendBlock(out, b, body, j);
  }
  return out;
}

// src/validate.ts
var MIN_NAME_LENGTH = 4;
var STRONG_SINGLE_TOKEN_LENGTH = 8;
function normalize(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/\s+/g, " ").trim();
}
function escapeRegex(s) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
function atWordBoundary(body) {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "u");
}
var LEGAL_FORM = /[\s,]*(spol\.?\s*s\s*r\.?\s*o\.?|s\.?\s*r\.?\s*o\.?|a\.\s*s\.?|v\.\s*o\.\s*s\.?|o\.\s*p\.\s*s\.?|z\.\s*s\.?|z\.\s*u\.?|k\.\s*s\.?)\s*$/;
function exactNeedle(value, source, label) {
  const chars = value.replace(/[^0-9a-zA-Z]/g, "");
  if (chars.length < 3)
    return;
  const body = chars.split("").map(escapeRegex).join("[ \\u00a0/.\\-]?");
  return { pattern: atWordBoundary(body), label, source, strength: "hard" };
}
function birthDateNeedle(value, source) {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!iso)
    return exactNeedle(value, source, value);
  const [, y, mm, dd] = iso;
  if (!y || !mm || !dd)
    return;
  const d = String(Number(dd));
  const m = String(Number(mm));
  const local = `0?${d}\\.\\s*0?${m}\\.\\s*${y}`;
  return {
    pattern: atWordBoundary(`${escapeRegex(value.trim())}|${local}`),
    label: value,
    source,
    strength: "hard"
  };
}
function phraseNeedle(value, source) {
  const tokens = normalize(value).split(" ").filter((t) => t.length > 0);
  if (tokens.length === 0)
    return;
  const body = tokens.map(escapeRegex).join("\\s+");
  return { pattern: atWordBoundary(body), label: value, source, strength: "strong" };
}
function nameNeedle(title, source) {
  const stripped = normalize(title).replace(LEGAL_FORM, "").trim();
  const all = stripped.split(" ").filter((t) => t.length > 0);
  const tokens = all.filter((t) => t.length >= 2);
  if (tokens.length === 0)
    return;
  let strength;
  if (tokens.length >= 2)
    strength = "strong";
  else if ((tokens[0] ?? "").length >= STRONG_SINGLE_TOKEN_LENGTH)
    strength = "strong";
  else if ((tokens[0] ?? "").length >= MIN_NAME_LENGTH)
    strength = "weak";
  else
    return;
  const body = all.map(escapeRegex).join("\\s+");
  return { pattern: atWordBoundary(body), label: title, source, strength };
}
function needleForField(f, value, source) {
  if (f.canonical === "birth_date")
    return birthDateNeedle(value, source);
  if (f.needle === "strong")
    return phraseNeedle(value, source);
  return exactNeedle(value, source, value);
}
function clientNeedles(records) {
  const out = [];
  for (const r of records) {
    if (r.type !== "subject")
      continue;
    const raw = r;
    for (const f of needleFields()) {
      const v = raw[f.canonical];
      if (typeof v !== "string" || v.trim() === "")
        continue;
      const n = needleForField(f, v, r.id);
      if (n)
        out.push(n);
    }
    if (r.title) {
      const n = nameNeedle(r.title, r.id);
      if (n)
        out.push(n);
    }
  }
  for (const r of records) {
    if (r.layer !== "L2")
      continue;
    const text = [r.truth, ...r.timeline.map((e) => e.text)].join(`
`);
    for (const m of text.matchAll(BIRTH_NUMBER_PATTERN_G)) {
      const n = exactNeedle(m[0], r.id, "rodné číslo v texte záznamu");
      if (n)
        out.push(n);
    }
  }
  return out;
}
function recordText(r) {
  return [r.title, r.description, r.truth, ...r.timeline.map((e) => `${e.date} ${e.text}`)].join(`
`);
}
function linkTargets(r) {
  const out = [
    ...r.related ?? [],
    ...r.supporting_evidence ?? [],
    ...r.contradicting_evidence ?? [],
    ...r.proves ?? []
  ];
  if (r.subject_ref)
    out.push(r.subject_ref);
  if (r.claimed_by)
    out.push(r.claimed_by);
  for (const m of recordText(r).matchAll(/\[\[([^\]]+)\]\]/g)) {
    if (m[1])
      out.push(m[1]);
  }
  return out;
}
function leakFinding(r, n, nameSeverity = "error") {
  if (n.strength === "strong" && nameSeverity === "warning") {
    return {
      severity: "warning",
      code: "L3_LEAK_NAME",
      recordId: r.id,
      message: `Právny prameň ${r.id} obsahuje meno „${n.label}" subjektu ${n.source}. ` + `Kancelária to podľa okf.config pripúšťa ako varovanie — posúď, či ho preformulovať.`
    };
  }
  if (n.strength === "weak") {
    return {
      severity: "warning",
      code: "L3_LEAK_SUSPECT",
      recordId: r.id,
      message: `Právny prameň ${r.id} obsahuje „${n.label}" — zhoda so subjektom ${n.source}, ` + `ale meno je krátke a môže ísť o zhodu náhodou. Posúď a buď ho prepíš, alebo nechaj.`
    };
  }
  return {
    severity: "error",
    code: "L3_LEAK",
    recordId: r.id,
    message: `Právny prameň ${r.id} obsahuje identifikátor klienta „${n.label}" ` + `zo záznamu ${n.source}. Vrstva L3 je zdieľateľná — klientske údaje do nej nesmú.`
  };
}
var IDENTIFIED_ROLES = ["client", "representative", "ubo"];
var BIRTH_NUMBER_PATTERN = /\b\d{6}\s?\/\s?\d{3,4}\b/;
var BIRTH_NUMBER_PATTERN_G = new RegExp(BIRTH_NUMBER_PATTERN.source, "g");
function sensitiveInSummary(r) {
  const raw = r;
  if (BIRTH_NUMBER_PATTERN.test(r.description)) {
    return {
      severity: "error",
      code: "SENSITIVE_IN_SUMMARY",
      recordId: r.id,
      message: `Popis záznamu ${r.id} obsahuje rodné číslo. Popis sa renderuje do INDEX.md ` + `a do _STATUS.md — citlivý údaj patrí do poľa frontmatteru, nie do popisu.`
    };
  }
  for (const key of SENSITIVE_FIELDS) {
    const v = raw[key];
    if (typeof v === "string" && v.trim().length >= 4 && r.description.includes(v)) {
      return {
        severity: "error",
        code: "SENSITIVE_IN_SUMMARY",
        recordId: r.id,
        message: `Popis záznamu ${r.id} opakuje citlivý údaj z poľa ` + `${fieldLabel(key, r.jurisdiction)}. Popis sa renderuje do INDEX.md a do _STATUS.md.`
      };
    }
  }
  return;
}
function filled(raw, canonical) {
  const v = raw[canonical];
  if (v === undefined)
    return false;
  if (typeof v === "string")
    return v.trim() !== "";
  if (Array.isArray(v))
    return v.length > 0;
  return true;
}
function amlCompleteness(r) {
  if (!IDENTIFIED_ROLES.some((role) => role === r.role))
    return;
  const ruleset = AML_REQUIRED[r.jurisdiction];
  if (!ruleset)
    return;
  const kind = PERSON_KINDS.find((k) => k === r.person_type);
  if (!kind)
    return;
  const raw = r;
  const missing = [];
  for (const req of ruleset[kind]) {
    if (typeof req === "string") {
      if (!filled(raw, req))
        missing.push(req);
      continue;
    }
    if (filled(raw, req.primary))
      continue;
    const chybaju = req.fallback.filter((c) => !filled(raw, c));
    if (chybaju.length === 0)
      continue;
    missing.push(req.primary, ...chybaju);
  }
  if (missing.length === 0)
    return;
  const keys = [...new Set(missing)].map((c) => fieldLabel(c, r.jurisdiction)).join(", ");
  const predpis = r.jurisdiction === "sk" ? "§ 7 ods. 1 zák. č. 297/2008 Z. z." : "§ 5 ods. 1 zák. č. 253/2008 Sb.";
  return {
    severity: "warning",
    code: "AML_INCOMPLETE",
    recordId: r.id,
    message: `Identifikácia subjektu ${r.id} nie je úplná podľa ${predpis} — chýba: ${keys}`
  };
}
function validateStore(records, opts = {}) {
  const findings = [];
  const ids = new Set(records.map((r) => r.id));
  const seen = new Set;
  for (const r of records) {
    if (seen.has(r.id)) {
      findings.push({
        severity: "error",
        code: "DUPLICATE_ID",
        recordId: r.id,
        message: `Identifikátor ${r.id} nesie viac než jeden záznam`
      });
    }
    seen.add(r.id);
  }
  const needles = clientNeedles(records);
  for (const r of records) {
    if (r.layer !== "L3")
      continue;
    const haystack = normalize(recordText(r));
    for (const n of needles) {
      if (n.pattern.test(haystack))
        findings.push(leakFinding(r, n, opts.nameLeakSeverity));
    }
  }
  for (const r of records) {
    for (const target of linkTargets(r)) {
      if (!ids.has(target)) {
        findings.push({
          severity: "error",
          code: "BROKEN_LINK",
          recordId: r.id,
          message: `Záznam ${r.id} odkazuje na neexistujúci záznam ${target}`
        });
      }
    }
  }
  for (const r of records) {
    const last = r.timeline.at(-1);
    if (last && last.date > r.updated) {
      findings.push({
        severity: "warning",
        code: "STALE_UPDATED",
        recordId: r.id,
        message: `Záznam ${r.id} má zmena: ${r.updated}, ale história siaha do ${last.date}`
      });
    }
  }
  for (const r of records) {
    const f = sensitiveInSummary(r);
    if (f)
      findings.push(f);
  }
  const povolene = (values) => values.join(", ");
  for (const r of records) {
    const raw = r;
    for (const f of FIELDS) {
      const v = raw[f.canonical];
      if (!f.values || typeof v !== "string" || v === "" || f.values.includes(v))
        continue;
      findings.push({
        severity: "warning",
        code: "UNKNOWN_VALUE",
        recordId: r.id,
        message: `Pole ${f.canonical} záznamu ${r.id} má hodnotu „${v}", ktorú schéma nepozná. ` + `Kontroly viazané na toto pole sa nevykonajú. Povolené: ${povolene(f.values)}.`
      });
    }
    for (const e of r.timeline) {
      if (!e.kind || EVENT_KINDS.includes(e.kind))
        continue;
      findings.push({
        severity: "warning",
        code: "UNKNOWN_VALUE",
        recordId: r.id,
        message: `História záznamu ${r.id} má druh udalosti „${e.kind}", ktorý schéma nepozná. ` + `Povolené: ${povolene(EVENT_KINDS)}.`
      });
    }
  }
  const dokazy = new Map(records.filter((r) => r.type === "evidence").map((r) => [r.id, r]));
  const tvrdenia = new Map(records.filter((r) => r.type === "claim").map((r) => [r.id, r]));
  for (const [id, claim] of tvrdenia) {
    const uvedene = [...claim.supporting_evidence ?? [], ...claim.contradicting_evidence ?? []];
    for (const eId of uvedene) {
      const e = dokazy.get(eId);
      if (!e)
        continue;
      if ((e.proves ?? []).includes(id))
        continue;
      findings.push({
        severity: "warning",
        code: "LINK_ASYMMETRY",
        recordId: id,
        message: `Tvrdenie ${id} sa opiera o dôkaz ${eId}, ale ${eId} tvrdenie ${id} neuvádza v poli k preukázaniu.`
      });
    }
  }
  for (const [id, e] of dokazy) {
    for (const cId of e.proves ?? []) {
      const claim = tvrdenia.get(cId);
      if (!claim)
        continue;
      const uvedene = [...claim.supporting_evidence ?? [], ...claim.contradicting_evidence ?? []];
      if (uvedene.includes(id))
        continue;
      findings.push({
        severity: "warning",
        code: "LINK_ASYMMETRY",
        recordId: id,
        message: `Dôkaz ${id} má preukazovať tvrdenie ${cId}, ale ${cId} ho medzi dôkazmi neuvádza.`
      });
    }
  }
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const ulohy = new Map(records.filter((r) => r.type === "task").map((r) => [r.id, r]));
  const stav = new Map;
  const vCykle = new Set;
  const navstiv = (id, cesta) => {
    if (stav.get(id) === "done")
      return;
    if (stav.get(id) === "open") {
      for (const x of cesta.slice(cesta.indexOf(id)))
        vCykle.add(x);
      return;
    }
    stav.set(id, "open");
    for (const d of ulohy.get(id)?.depends_on ?? []) {
      if (ulohy.has(d))
        navstiv(d, [...cesta, id]);
    }
    stav.set(id, "done");
  };
  for (const id of ulohy.keys())
    navstiv(id, []);
  for (const id of [...vCykle].sort()) {
    findings.push({
      severity: "error",
      code: "TASK_CYCLE",
      recordId: id,
      message: `Úloha ${id} je súčasťou cyklu závislostí — plán sa nedá dokončiť.`
    });
  }
  for (const [id, t] of ulohy) {
    if (t.state === "blocked") {
      const blokuje = (t.depends_on ?? []).some((d) => ulohy.get(d)?.state !== "done");
      if (!blokuje) {
        findings.push({
          severity: "warning",
          code: "TASK_BLOCKED_WITHOUT_BLOCKER",
          recordId: id,
          message: `Úloha ${id} je blokovaná, ale žiadna jej závislosť nie je otvorená — blokovaná úloha bez blokátora je zabudnutá úloha.`
        });
      }
    }
    if (t.due && t.due < today && t.state !== "done") {
      findings.push({
        severity: "warning",
        code: "TASK_OVERDUE",
        recordId: id,
        message: `Úloha ${id} mala byť hotová do ${t.due}.`
      });
    }
  }
  for (const r of records) {
    if (r.type !== "authority")
      continue;
    if (r.effective_to && r.effective_to < today) {
      findings.push({
        severity: "warning",
        code: "AUTHORITY_STALE",
        recordId: r.id,
        message: `Prameň ${r.id} platil do ${r.effective_to} — citácia môže mieriť na zrušené znenie.`
      });
    }
    if (!r.verified_at && !r.verified_against && (r.verified ?? []).length === 0) {
      findings.push({
        severity: "warning",
        code: "AUTHORITY_UNVERIFIED",
        recordId: r.id,
        message: `Prameň ${r.id} nenesie stopu overenia (overené dňa / proti čomu). ` + `Prameň bez stopy overenia je dohad, nie prameň.`
      });
    }
    for (const zdroj of r.sources ?? []) {
      const text = zdroj.title ?? "";
      if (!/\bSb\.|\bZ\.\s?z\./.test(text))
        continue;
      if (/č\.\s?\d+\s?\/\s?\d{4}/.test(text))
        continue;
      findings.push({
        severity: "warning",
        code: "CITATION_INCOMPLETE",
        recordId: r.id,
        message: `Prameň ${r.id}: citácia „${text}" odkazuje na predpis, ale neuvádza jeho číslo a rok.`
      });
    }
  }
  const screenings = records.filter((r) => r.type === "screening");
  for (const r of screenings) {
    if (r.valid_until && r.valid_until < today) {
      findings.push({
        severity: "warning",
        code: "AML_EXPIRED",
        recordId: r.id,
        message: `Preverenie ${r.id} platilo do ${r.valid_until} a je po lehote. ` + `§ 9 AML zákona vyžaduje priebežnú kontrolu — zopakuj a založ nový záznam.`
      });
    }
  }
  for (const r of records) {
    const ids2 = new Set((r.sources ?? []).map((z) => z.id).filter((x) => !!x));
    const text = [r.truth, ...r.timeline.map((e) => e.text)].join(`
`);
    const pouzite = new Set([...text.matchAll(/\[\^([^\]\s]+)\]/g)].map((m) => m[1] ?? ""));
    for (const label of pouzite) {
      if (ids2.has(label))
        continue;
      findings.push({
        severity: "error",
        code: "CITATION_UNRESOLVED",
        recordId: r.id,
        message: `Záznam ${r.id} sa odvoláva na prameň [^${label}], ktorý v \`sources\` nemá ` + `položku s týmto id. Tvrdenie vyzerá podložene a nie je.`
      });
    }
    const vsetky = (r.sources ?? []).map((z) => z.id).filter((x) => !!x);
    for (const dup of vsetky.filter((x, i) => vsetky.indexOf(x) !== i)) {
      findings.push({
        severity: "error",
        code: "SOURCE_ID_DUPLICATE",
        recordId: r.id,
        message: `Záznam ${r.id} má v \`sources\` id „${dup}" viackrát — poznámka pod čiarou by nevedela, na ktorý mieri.`
      });
    }
  }
  for (const r of records) {
    if (r.status !== "active")
      continue;
    for (const d of r.deadlines ?? []) {
      if (d >= today)
        continue;
      findings.push({
        severity: "warning",
        code: "DEADLINE_PASSED",
        recordId: r.id,
        message: `Lehota ${d} záznamu ${r.id} uplynula. Ak bola splnená, zapíš to do histórie ` + `a lehotu odstráň; ak nie, rieš ju hneď.`
      });
    }
  }
  for (const r of records) {
    if (!r.truth_digest)
      continue;
    if (r.truth_digest === truthDigest(r.truth))
      continue;
    findings.push({
      severity: "warning",
      code: "TRUTH_EDITED_OUTSIDE",
      recordId: r.id,
      message: `Pravda záznamu ${r.id} sa zmenila mimo nástroja — v Histórii k tomu ` + `nemusí byť riadok. Doplň ho, alebo zápis zopakuj cez okf-memory write.`
    });
  }
  for (const r of records) {
    if (r.type !== "subject" || r.role !== "client")
      continue;
    if (!screenings.some((p) => p.subject_ref === r.id)) {
      findings.push({
        severity: "warning",
        code: "AML_MISSING",
        recordId: r.id,
        message: `Klient ${r.id} nemá žiadny záznam o preverení (typ screening).`
      });
    }
  }
  for (const r of records) {
    if (r.type !== "subject" || r.role !== "client")
      continue;
    if (!/insolven|konkurz|konkurs|likvid/i.test(r.capacity_notes ?? ""))
      continue;
    findings.push({
      severity: "warning",
      code: "CAPACITY_CONFLICT_CHECK",
      recordId: r.id,
      message: `Klient ${r.id} má v poznámkach k spôsobilosti „${r.capacity_notes}". ` + `Over konflikt záujmov skôr, než ho nájde protistrana.`
    });
  }
  const unverified = records.find((r) => r.type === "subject" && PERSON_KINDS.some((k) => k === r.person_type) && IDENTIFIED_ROLES.some((role) => role === r.role) && AML_REQUIRED[r.jurisdiction] === undefined);
  if (unverified) {
    findings.push({
      severity: "warning",
      code: "AML_RULESET_UNVERIFIED",
      recordId: unverified.id,
      message: `Pre jurisdikciu ${unverified.jurisdiction} nie je overená povinná identifikačná sada, ` + `takže sa úplnosť nekontroluje. Doplní advokát danej jurisdikcie.`
    });
  } else {
    for (const r of records) {
      if (r.type !== "subject")
        continue;
      const f = amlCompleteness(r);
      if (f)
        findings.push(f);
    }
  }
  return findings;
}

// src/write.ts
class TimelineIntegrityError extends Error {
}

class ApprovalRequiredError extends Error {
}

class StaleUpdatedError extends Error {
}
function sameEntry(a, b) {
  return a !== undefined && b !== undefined && a.date === b.date && a.text === b.text && a.kind === b.kind;
}
function assertAppendOnly(before, after) {
  if (after.timeline.length < before.timeline.length) {
    throw new TimelineIntegrityError(`História záznamu ${before.id} sa nesmie skracovať (${before.timeline.length} → ${after.timeline.length})`);
  }
  for (let i = 0;i < before.timeline.length; i++) {
    if (!sameEntry(before.timeline[i], after.timeline[i])) {
      throw new TimelineIntegrityError(`História záznamu ${before.id} sa nesmie prepisovať — riadok ${i + 1} sa zmenil`);
    }
  }
}
function assertUpdatedBumped(before, after, today = new Date().toISOString().slice(0, 10)) {
  const obsahSaZmenil = before.truth !== after.truth || after.timeline.length > before.timeline.length;
  if (!obsahSaZmenil)
    return;
  if (after.updated !== before.updated)
    return;
  if (after.updated === today)
    return;
  throw new StaleUpdatedError(`Záznam ${before.id}: zmena obsahu musí posunúť updated (teraz ${before.updated})`);
}
function assertTruthTraced(before, after) {
  if (before.truth === after.truth)
    return;
  if (after.timeline.length === before.timeline.length) {
    throw new TimelineIntegrityError(`Záznam ${before.id}: zmena sekcie „Truth" musí pridať riadok do „History" v tom istom zápise`);
  }
}
function describe(before, after) {
  const lines = [];
  if (!before && after) {
    lines.push(`+ nový záznam ${after.id} (${after.type}, ${after.layer})`);
    lines.push(`+ Truth: ${after.truth}`);
    for (const e of after.timeline)
      lines.push(`+ History: ${e.date} — ${e.text}`);
    return lines;
  }
  if (before && !after) {
    lines.push(`- zmazanie záznamu ${before.id} (${before.type}, ${before.layer})`);
    return lines;
  }
  if (!before || !after)
    return lines;
  if (before.truth !== after.truth) {
    lines.push(`~ Truth: ${before.truth}`);
    lines.push(`~ Truth → ${after.truth}`);
  }
  for (const key of ["title", "description", "status", "updated"]) {
    if (before[key] !== after[key])
      lines.push(`~ ${key}: ${before[key]} → ${after[key]}`);
  }
  for (const e of after.timeline.slice(before.timeline.length)) {
    lines.push(`+ History: ${e.date} — ${e.text}`);
  }
  return lines;
}
function planWrite(before, after, reason) {
  if (reason.trim() === "") {
    throw new Error("Zápis do pamäte musí niesť dôvod — bez neho sa nedá revidovať");
  }
  if (!before && !after)
    throw new Error("Prázdny zápis: chýba pôvodný aj nový stav");
  if (before && after) {
    if (before.id !== after.id) {
      throw new Error(`Zápis nesmie meniť id záznamu (${before.id} → ${after.id})`);
    }
    assertAppendOnly(before, after);
    assertTruthTraced(before, after);
    assertUpdatedBumped(before, after);
  }
  const kind = !before ? "create" : !after ? "delete" : "update";
  const subject = after ?? before;
  if (!subject)
    throw new Error("Prázdny zápis");
  const layer = subject.layer;
  const requiresApproval = kind === "delete" || layer === "L1" || layer === "L3";
  return {
    kind,
    id: subject.id,
    layer,
    reason: reason.trim(),
    requiresApproval,
    before,
    after,
    lines: describe(before, after)
  };
}
function isTimestamp(value) {
  return value.trim() !== "" && !Number.isNaN(Date.parse(value));
}
function authorize(diff, approval) {
  if (!diff.requiresApproval)
    return;
  if (approval && approval.by.trim() !== "" && isTimestamp(approval.at))
    return;
  const why = diff.kind === "delete" ? "mazanie záznamu" : `zápis do vrstvy ${diff.layer}`;
  throw new ApprovalRequiredError(`${why} (${diff.id}) vyžaduje schválenie človekom — agent smie iba navrhnúť`);
}

// src/config.ts
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
var CONFIG_FILE = "okf.config";
function text(v) {
  return typeof v === "string" ? v.trim() : "";
}
function readConfig(officeDir) {
  if (!officeDir)
    return;
  const path = join(officeDir, CONFIG_FILE);
  if (!existsSync(path))
    return;
  return parseFrontmatter(readFileSync(path, "utf8"));
}
function readClientPath(officeDir) {
  const v = readConfig(officeDir)?.get("client_path");
  return typeof v === "string" && v.trim() !== "" ? v.trim() : undefined;
}
function matchesClientPath(relative, pattern) {
  const seg = relative.split("/").filter((x) => x !== "");
  const pat = pattern.split("/").filter((x) => x !== "");
  if (seg.length !== pat.length)
    return false;
  return pat.every((p, i) => p === "*" || p === seg[i]);
}
function isIsoDate(s) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s))
    return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
function inspectStandingAuthorization(officeDir) {
  const kv = readConfig(officeDir);
  if (!kv || !kv.has("standing_authorization"))
    return {};
  const by = text(kv.get("standing_authorization"));
  const expiresAt = text(kv.get("expires_at"));
  const grantedAt = text(kv.get("granted_at"));
  const reason = text(kv.get("reason"));
  const raw = kv.get("scope");
  const scope = Array.isArray(raw) ? raw.filter((x) => typeof x === "string") : [];
  if (!by)
    return { problem: "chýba standing_authorization (meno advokáta)" };
  if (!expiresAt)
    return { problem: "chýba expires_at" };
  if (!isIsoDate(expiresAt))
    return { problem: `expires_at „${expiresAt}" nie je dátum RRRR-MM-DD` };
  if (grantedAt && !isIsoDate(grantedAt))
    return { problem: `granted_at „${grantedAt}" nie je dátum RRRR-MM-DD` };
  if (grantedAt && grantedAt > expiresAt)
    return { problem: `granted_at ${grantedAt} je po expires_at ${expiresAt}` };
  if (!reason)
    return { problem: "chýba reason" };
  if (scope.length === 0)
    return { problem: "chýba scope (napr. [L1, L3])" };
  return { auth: { by, grantedAt, expiresAt, scope, reason } };
}
function readStandingAuthorization(officeDir) {
  return inspectStandingAuthorization(officeDir).auth;
}
function readNameLeakSeverity(officeDir) {
  const kv = readConfig(officeDir);
  const sev = text(kv?.get("leak_name_severity"));
  const reason = text(kv?.get("leak_name_reason"));
  return sev === "warning" && reason !== "" ? "warning" : "error";
}
function isExpired(auth, today) {
  return auth.expiresAt < today;
}
function covers(auth, diff, today = new Date().toISOString().slice(0, 10)) {
  if (diff.kind === "delete")
    return false;
  if (isExpired(auth, today))
    return false;
  return auth.scope.includes(diff.layer);
}

// src/store.ts
var INDEX_FILE = "index.md";
var LOG_FILE = "log.md";
var LEGACY_INDEX_FILE = "INDEX.md";
var BRAIN_FILE = "BRAIN.md";
var STATUS_FILE = "_STATUS.md";
var MEMORY_DIR = "memory";
var MATTER_CARDS = ["matter.md", "spis.md", "project.md", "projekt.md"];
function jurisdictionFromCard(dir) {
  for (const name of MATTER_CARDS) {
    const path = join2(dir, name);
    if (!existsSync2(path))
      continue;
    const m = /^jurisdiction:\s*(cz|sk)\s*$/m.exec(readFileSync2(path, "utf8"));
    if (m?.[1] === "cz" || m?.[1] === "sk")
      return m[1];
  }
  return;
}
function readStore(dir) {
  const memoryDir = join2(dir, MEMORY_DIR);
  const records = [];
  const problems = [];
  if (existsSync2(memoryDir)) {
    for (const name of readdirSync(memoryDir).sort()) {
      if (!name.endsWith(".md"))
        continue;
      if (name === INDEX_FILE || name === LOG_FILE || name === LEGACY_INDEX_FILE)
        continue;
      try {
        records.push(parseRecord(readFileSync2(join2(memoryDir, name), "utf8")));
      } catch (e) {
        problems.push({ file: name, message: e instanceof Error ? e.message : String(e) });
      }
    }
  }
  const j = records[0]?.jurisdiction ?? jurisdictionFromCard(dir) ?? "cz";
  return { dir, jurisdiction: j, memoryDir, records, problems };
}
function slug(s) {
  return s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 48);
}
function fileFor(store, r) {
  const existing = existsSync2(store.memoryDir) ? readdirSync(store.memoryDir).find((n) => n.startsWith(`${r.id}-`) || n === `${r.id}.md`) : undefined;
  return join2(store.memoryDir, existing ?? `${r.id}-${slug(r.title)}.md`);
}

class LeakBlockedError extends Error {
}
var STANDING = Symbol("okf.standing-authorization");

class ConcurrentWriteError extends Error {
}
function assertNotStale(store, diff) {
  const before = diff.before;
  if (!before)
    return;
  const naDisku = store.records.find((r) => r.id === before.id);
  if (!naDisku || naDisku.updated === before.updated)
    return;
  throw new ConcurrentWriteError(`Záznam ${before.id} sa medzitým zmenil: vychádzaš zo stavu ${before.updated}, ` + `na disku je ${naDisku.updated}. Načítaj ho znova a zápis zopakuj.`);
}
function assertNoLeak(dir, after) {
  if (after.layer !== "L3")
    return;
  const scope = readScope(dir);
  if (scope.problems.length > 0) {
    const subory = scope.problems.map((p) => p.file).join(", ");
    throw new LeakBlockedError(`Zápis záznamu ${after.id} odmietnutý — v dosahu spisu sú nečitateľné záznamy (${subory}), ` + `takže brána úniku by bola slepá. Oprav ich alebo presuň mimo ${MEMORY_DIR}/.`);
  }
  const ostatne = scope.records.filter((r) => r.id !== after.id);
  const chyby = validateStore([...ostatne, after], {
    nameLeakSeverity: readNameLeakSeverity(findOfficeDir(dir))
  }).filter((f) => f.recordId === after.id && f.severity === "error" && f.code === "L3_LEAK");
  if (chyby.length === 0)
    return;
  throw new LeakBlockedError(`Zápis záznamu ${after.id} odmietnutý — ${chyby.map((f) => f.message).join(" ")}`);
}
function standingApproval(dir, diff, today) {
  const auth = readStandingAuthorization(findOfficeDir(dir));
  if (!auth || !covers(auth, diff, today))
    return;
  return {
    by: `${auth.by} (trvalé poverenie do ${auth.expiresAt})`,
    at: new Date().toISOString()
  };
}
function applyRecordWrite(dir, diff, approval, leakScopeDir = dir) {
  authorize(diff, approval === STANDING ? standingApproval(dir, diff) : approval);
  if (diff.after)
    assertNoLeak(leakScopeDir, diff.after);
  const store = readStore(dir);
  assertNotStale(store, diff);
  if (!existsSync2(store.memoryDir))
    mkdirSync(store.memoryDir, { recursive: true });
  if (diff.kind === "delete") {
    if (diff.before)
      rmSync(fileFor(store, diff.before), { force: true });
    return;
  }
  const after = diff.after;
  if (!after)
    throw new Error(`Návrh ${diff.kind} nemá nový stav záznamu`);
  const zapis = { ...after, truth_digest: truthDigest(after.truth) };
  writeFileSync(fileFor(store, zapis), serializeRecord(zapis), "utf8");
}
function linkResolver(store, zVnutraMemory) {
  const podlaId = new Map;
  if (existsSync2(store.memoryDir)) {
    for (const name of readdirSync(store.memoryDir)) {
      if (!name.endsWith(".md"))
        continue;
      const id = name.replace(/\.md$/, "").split("-").slice(0, 2).join("-");
      if (!podlaId.has(id))
        podlaId.set(id, name);
    }
  }
  return (id) => {
    const name = podlaId.get(id);
    if (!name)
      return;
    return zVnutraMemory ? `./${name}` : `./${MEMORY_DIR}/${name}`;
  };
}
function statusLinkResolver(dir) {
  return linkResolver(readStore(dir), false);
}
function writeIndex(dir) {
  const store = readStore(dir);
  if (!existsSync2(store.memoryDir))
    return;
  const j = store.jurisdiction;
  const href = linkResolver(store, true);
  const nadpis = {
    L1: { cz: "Kancelář (L1)", sk: "Kancelária (L1)" },
    L2: { cz: "Spis (L2)", sk: "Spis (L2)" },
    L3: { cz: "Právo (L3)", sk: "Právo (L3)" }
  };
  const lines = [
    "---",
    `okf_version: "${OKF_VERSION}"`,
    "---",
    "",
    `# ${j === "cz" ? "Rejstřík paměti" : "Register pamäte"}`,
    "",
    j === "cz" ? "> Generováno. Needituj ručně — přepíše se." : "> Generované. Needituj ručne — prepíše sa."
  ];
  for (const layer of ["L2", "L1", "L3"]) {
    const vo = [...store.records].filter((r) => r.layer === layer).sort((a, b) => a.id < b.id ? -1 : 1);
    if (vo.length === 0)
      continue;
    lines.push("", `## ${nadpis[layer]?.[j] ?? layer}`, "");
    for (const r of vo) {
      const cesta = href(r.id);
      const odkaz2 = cesta ? `[${r.id}](${cesta})` : r.id;
      lines.push(`* ${odkaz2} — ${typeLabel(r.type, j)} — ${r.description}`);
    }
  }
  const klientDir = findClientDir(dir);
  if (klientDir) {
    const ks = readStore(klientDir);
    if (ks.records.length > 0) {
      const prefix = relative(store.memoryDir, ks.memoryDir).split(sep).join("/");
      const kh = linkResolver(ks, true);
      lines.push("", "## Klient", "");
      for (const r of [...ks.records].sort((a, b) => a.id < b.id ? -1 : 1)) {
        const c = kh(r.id);
        const odkaz2 = c ? `[${r.id}](${prefix}/${c.slice(2)})` : r.id;
        lines.push(`* ${odkaz2} — ${typeLabel(r.type, j)} — ${r.description}`);
      }
    }
  }
  if (readdirSync(store.memoryDir).includes(LEGACY_INDEX_FILE)) {
    rmSync(join2(store.memoryDir, LEGACY_INDEX_FILE), { force: true });
  }
  writeFileSync(join2(store.memoryDir, INDEX_FILE), lines.join(`
`) + `
`, "utf8");
}
function writeLog(dir) {
  const store = readStore(dir);
  if (!existsSync2(store.memoryDir))
    return;
  const j = store.jurisdiction;
  const href = linkResolver(store, true);
  const podlaDatumu = new Map;
  for (const r of store.records) {
    for (const e of r.timeline) {
      const cesta = href(r.id);
      const odkaz2 = cesta ? `[${r.id}](${cesta})` : r.id;
      const druh = e.kind ? `**${valueLabel("event_kind", e.kind, j)}**: ` : "";
      const zoznam = podlaDatumu.get(e.date) ?? [];
      zoznam.push(`* ${druh}${e.text} — ${odkaz2}`);
      podlaDatumu.set(e.date, zoznam);
    }
  }
  const lines = [`# ${j === "cz" ? "Historie spisu" : "História spisu"}`, ""];
  for (const datum of [...podlaDatumu.keys()].sort().reverse()) {
    lines.push(`## ${datum}`, "", ...podlaDatumu.get(datum) ?? [], "");
  }
  writeFileSync(join2(store.memoryDir, LOG_FILE), lines.join(`
`), "utf8");
}
function ensureBrain(dir, j) {
  const path = join2(dir, BRAIN_FILE);
  if (existsSync2(path))
    return;
  const mem = MEMORY_DIR;
  const cz = [
    "# BRAIN.md — protokol paměti spisu",
    "",
    "Vstupní bod pro agenty. Čti v tomto pořadí, dál jen cíleně přes odkazy.",
    "",
    "1. `matter.md` (dříve `spis.md`) — karta věci",
    `2. \`${STATUS_FILE}\` — **Fáze** a **Další krok** nahoře; tabulky mezi markery generuje paměť`,
    `3. \`${mem}/${INDEX_FILE}\` — rejstřík paměti, odtud na konkrétní záznam`,
    "",
    "## Zápisová disciplína",
    "",
    "- Každý záznam má sekci **Truth** (aktuální stav) a **History** (append-only).",
    "- Změna Truth musí ve stejném zápisu přidat řádek do History. Nástroj to vynucuje.",
    "- Do L2 (spis) zapisuje agent sám. Do **L1** (pravidla, poučení) a **L3** (právní prameny)",
    "  a při **mazání** jen člověk — nástroj bez schválení zápis odmítne.",
    `- \`${STATUS_FILE}\` mimo markery patří advokátovi. Needituj to.`,
    "",
    "## Tři úrovně paměti",
    "",
    `- \`${mem}/\` zde ve spisu — obsah věci (L2)`,
    "- `../../memory/` u klienta — subjekty a AML prověření (identifikace se dělá jednou)",
    `- \`${OFFICE_DIR}/memory/\` — pravidla a poučení (L1) a právní prameny (L3)`,
    "",
    "Pramen patří kanceláři, ne spisu: jinak se týž judikát zkopíruje do deseti",
    "spisů a kontrola úniku běží desetkrát nad týmž textem.",
    "",
    "## Jediná paměť věci",
    "",
    `Tento adresář (\`${mem}/\`) je **jediné** místo, kam se paměť zapisuje.`,
    "Najdeš-li ve spisu `_memory.md`, `lrd.json`, `progress.txt`, `LEARNINGS.md`",
    "nebo adresáře `facts/`, `research/`, `strategy/` ze starších nástrojů —",
    "**čti je jako archiv, ale nezapisuj do nich.** Dvě paměti v jednom spisu",
    "znamenají dvě pravdy a jedna z nich bude tiše zastaralá.",
    ""
  ];
  const sk = [
    "# BRAIN.md — protokol pamäte spisu",
    "",
    "Vstupný bod pre agentov. Čítaj v tomto poradí, ďalej len cielene cez odkazy.",
    "",
    "1. `matter.md` (predtým `spis.md`) — karta veci",
    `2. \`${STATUS_FILE}\` — **Fáza** a **Ďalší krok** hore; tabuľky medzi markermi generuje pamäť`,
    `3. \`${mem}/${INDEX_FILE}\` — register pamäte, odtiaľ na konkrétny záznam`,
    "",
    "## Zápisová disciplína",
    "",
    "- Každý záznam má sekciu **Truth** (aktuálny stav) a **History** (append-only).",
    "- Zmena Truth musí v tom istom zápise pridať riadok do History. Nástroj to vynucuje.",
    "- Do L2 (spis) zapisuje agent sám. Do **L1** (pravidlá, poučenia) a **L3** (právne pramene)",
    "  a pri **mazaní** iba človek — nástroj bez schválenia zápis odmietne.",
    `- \`${STATUS_FILE}\` mimo markerov patrí advokátovi. Needituj to.`,
    "",
    "## Tri úrovne pamäte",
    "",
    `- \`${mem}/\` tu v spise — obsah veci (L2)`,
    "- `../../memory/` u klienta — subjekty a AML preverenia (identifikácia sa robí raz)",
    `- \`${OFFICE_DIR}/memory/\` — pravidlá a poučenia (L1) a právne pramene (L3)`,
    "",
    "Prameň patrí kancelárii, nie spisu: inak sa ten istý judikát skopíruje do",
    "desiatich spisov a kontrola úniku beží desaťkrát nad tým istým textom.",
    "",
    "## Jediná pamäť veci",
    "",
    `Tento adresár (\`${mem}/\`) je **jediné** miesto, kam sa pamäť zapisuje.`,
    "Ak nájdeš v spise `_memory.md`, `lrd.json`, `progress.txt`, `LEARNINGS.md`",
    "alebo adresáre `facts/`, `research/`, `strategy/` zo starších nástrojov —",
    "**čítaj ich ako archív, ale nezapisuj do nich.** Dve pamäte v jednom spise",
    "znamenajú dve pravdy a jedna z nich bude ticho zastaraná.",
    ""
  ];
  writeFileSync(path, (j === "cz" ? cz : sk).join(`
`), "utf8");
}
function syncStatus(dir) {
  const store = readStore(dir);
  const path = join2(dir, STATUS_FILE);
  const existing = existsSync2(path) ? readFileSync2(path, "utf8") : "";
  const next = renderStatus(existing, store.records, store.jurisdiction, linkResolver(store, false));
  if (next !== existing)
    writeFileSync(path, next, "utf8");
}
function retrofitStatusFile(dir, apply) {
  const store = readStore(dir);
  const path = join2(dir, STATUS_FILE);
  if (!existsSync2(path))
    return [];
  const existing = readFileSync2(path, "utf8");
  const { text: text2, inserted } = retrofitStatus(existing, store.records, store.jurisdiction, linkResolver(store, false));
  if (apply && inserted.length > 0)
    writeFileSync(path, text2, "utf8");
  return inserted;
}
var CLIENT_CARDS = ["client.md", "klient.md"];
var OFFICE_DIR = "Office";
var LEGACY_OFFICE_DIR = "_kancelaria";
var OFFICE_DIRS = [OFFICE_DIR, LEGACY_OFFICE_DIR];
function findOfficeDir(startDir, maxUp = 8) {
  let dir = resolve(startDir);
  if (OFFICE_DIRS.some((n) => dir.endsWith(`/${n}`)))
    return dir;
  for (let i = 0;i < maxUp; i++) {
    const candidate = OFFICE_DIRS.map((n) => join2(dir, n)).find((c) => existsSync2(c));
    if (candidate)
      return candidate;
    const parent = dirname(dir);
    if (parent === dir)
      return;
    dir = parent;
  }
  return;
}
function findClientDir(matterDir, maxUp = 4) {
  let dir = resolve(matterDir);
  for (let i = 0;i < maxUp; i++) {
    const parent = dirname(dir);
    if (parent === dir)
      return;
    if (CLIENT_CARDS.some((c) => existsSync2(join2(parent, c))))
      return parent;
    dir = parent;
  }
  return findClientByPath(matterDir, maxUp);
}
function findClientByPath(matterDir, maxUp) {
  const officeDir = findOfficeDir(matterDir);
  if (!officeDir)
    return;
  const pattern = readClientPath(officeDir);
  if (!pattern)
    return;
  const root = dirname(officeDir);
  let dir = resolve(matterDir);
  for (let i = 0;i < maxUp; i++) {
    const parent = dirname(dir);
    if (parent === dir)
      return;
    const rel = relative(root, parent);
    if (rel !== "" && !rel.startsWith("..") && matchesClientPath(rel, pattern))
      return parent;
    dir = parent;
  }
  return;
}
function readScope(matterDir) {
  const matter = readStore(matterDir);
  const clientDir = findClientDir(matterDir);
  const client = clientDir ? readStore(clientDir) : undefined;
  const clientRecords = client?.records ?? [];
  const najdena = findOfficeDir(matterDir);
  const officeDir = najdena && resolve(najdena) !== resolve(matterDir) ? najdena : undefined;
  const office = officeDir ? readStore(officeDir) : undefined;
  const officeRecords = office?.records ?? [];
  return {
    matter,
    clientDir,
    clientRecords,
    officeDir,
    officeRecords,
    records: [...matter.records, ...clientRecords, ...officeRecords],
    problems: [...matter.problems, ...client?.problems ?? [], ...office?.problems ?? []]
  };
}

// src/cli.ts
var dnes = () => new Date().toISOString().slice(0, 10);
var USAGE = [
  "okf-memory — pamäť spisu (OKF)",
  "",
  "  okf-memory read     <spis>            prehľad pamäte",
  "  okf-memory validate <spis>            kontrola schémy, únikov L2→L3 a odkazov",
  "  okf-memory sync     <spis> [--apply]  projekcia do _STATUS.md, index.md a log.md",
  "  okf-memory retrofit <spis> [--apply]  doplní markery do existujúcich sekcií _STATUS.md",
  "  okf-memory aml      <spis>            subjekty a stav AML preverenia",
  '  okf-memory write    <spis> --file <záznam.md> --reason "…" [--apply] [--approve-as "meno"]',
  "",
  "  --approve-as sa nevyžaduje, keď zápis kryje trvalé poverenie advokáta",
  `  v ${OFFICE_DIR}/${CONFIG_FILE} — viď AGENTNI-ZAPISY.md`,
  "  okf-memory init     <spis> [--sk] [--apply]   BRAIN.md a adresár pamäte",
  "",
  "Bez --apply sa nič nezapisuje."
].join(`
`);
function flagValue(rest, name) {
  const i = rest.indexOf(name);
  if (i === -1)
    return;
  const v = rest[i + 1];
  return v === undefined || v.startsWith("--") ? undefined : v;
}
function ok(out) {
  return { code: 0, out };
}
function problemLines(problems) {
  if (problems.length === 0)
    return [];
  return [
    "Nečitateľné súbory (preskočené):",
    ...problems.map((p) => `  ERROR PARSE_ERROR ${p.file}: ${p.message}`),
    ""
  ];
}
function riadkov(n) {
  if (n === 1)
    return "1 riadok";
  if (n >= 2 && n <= 4)
    return `${n} riadky`;
  return `${n} riadkov`;
}
function nadpisZapisu(kind) {
  if (kind === "create")
    return "Nový záznam";
  if (kind === "delete")
    return "Zmazanie záznamu";
  return "Zmena záznamu";
}
function zaznamov(n) {
  if (n === 1)
    return "1 záznam";
  if (n >= 2 && n <= 4)
    return `${n} záznamy`;
  return `${n} záznamov`;
}
function runCli(argv) {
  const [cmd, dir, ...rest] = argv;
  const apply = rest.includes("--apply");
  if (!cmd || !dir)
    return { code: 2, out: USAGE };
  if (!existsSync3(dir))
    return { code: 2, out: `Cesta neexistuje: ${dir}

${USAGE}` };
  switch (cmd) {
    case "read": {
      const scope = readScope(dir);
      const lines = [
        ...problemLines(scope.problems),
        `Spis: ${dir}`,
        `Jurisdikcia: ${scope.matter.jurisdiction}   Záznamov: ${scope.records.length}` + (scope.clientDir ? `, u klienta ${scope.clientRecords.length}` : "") + (scope.officeDir ? `, v kancelárii ${scope.officeRecords.length}` : ""),
        "",
        ...scope.records.map(maskRecord).map((r) => `  ${r.id.padEnd(8)} ${r.layer}  ${typeLabel(r.type, r.jurisdiction).padEnd(12)} ${r.description}`)
      ];
      return ok(lines.join(`
`));
    }
    case "validate": {
      const scope = readScope(dir);
      const office = findOfficeDir(dir);
      const findings = validateStore(scope.records, { nameLeakSeverity: readNameLeakSeverity(office) });
      const problems = problemLines(scope.problems);
      const kontrola = inspectStandingAuthorization(office);
      const poverenie = [];
      if (kontrola.problem) {
        poverenie.push(`WARNING STANDING_AUTH_INVALID ${OFFICE_DIR}/${CONFIG_FILE}: ${kontrola.problem} — ` + `poverenie neplatí a zápisy do L1/L3 vyžadujú --approve-as.`);
      } else if (kontrola.auth && isExpired(kontrola.auth, dnes())) {
        poverenie.push(`WARNING STANDING_AUTH_EXPIRED ${OFFICE_DIR}/${CONFIG_FILE}: ` + `trvalé poverenie (${kontrola.auth.by}) uplynulo ${kontrola.auth.expiresAt} — ` + `zápisy do ${kontrola.auth.scope.join(", ")} znova vyžadujú --approve-as.`);
      }
      if (findings.length === 0 && problems.length === 0 && poverenie.length === 0) {
        return ok("OK — pamäť je konzistentná.");
      }
      const lines = [
        ...poverenie,
        ...problems,
        ...findings.map((f) => `${f.severity.toUpperCase()} ${f.code} ${f.recordId}: ${f.message}`)
      ];
      const hasError = scope.problems.length > 0 || findings.some((f) => f.severity === "error");
      return { code: hasError ? 1 : 0, out: lines.join(`
`) };
    }
    case "retrofit": {
      const bloky = retrofitStatusFile(dir, apply);
      if (bloky.length === 0)
        return ok("Nič na doplnenie — každá známa sekcia už markery má, alebo v súbore nie je.");
      return ok(`${apply ? "Doplnené" : "dry-run: doplnil by som"} markery do ${bloky.length} sekcií: ${bloky.join(", ")}` + `${apply ? ". Spusti sync." : ". Zapíš s --apply."}`);
    }
    case "sync": {
      const s = readStore(dir);
      try {
        if (!apply) {
          const statusPath = join3(dir, "_STATUS.md");
          const before = existsSync3(statusPath) ? readFileSync3(statusPath, "utf8") : "";
          const after = renderStatus(before, s.records, s.jurisdiction, statusLinkResolver(dir));
          const zmena = before === after ? "bez zmeny" : "_STATUS.md by sa zmenil";
          return ok(`dry-run: ${zmena}; INDEX.md by dostal ${riadkov(s.records.length)}. Zapíš s --apply.`);
        }
        syncStatus(dir);
        writeIndex(dir);
        writeLog(dir);
        const klient = findClientDir(dir);
        if (klient) {
          writeIndex(klient);
          writeLog(klient);
        }
        return ok(`Zapísané: _STATUS.md, index.md a log.md (${zaznamov(s.records.length)})` + `${klient ? " + index.md a log.md u klienta" : ""}.`);
      } catch (e) {
        if (e instanceof RenderConflictError)
          return { code: 1, out: `KONFLIKT: ${e.message}` };
        throw e;
      }
    }
    case "aml": {
      const scope = readScope(dir);
      const subjekty = scope.records.filter((r) => r.type === "subject");
      const preverenia = scope.records.filter((r) => r.type === "screening");
      const findings = validateStore(scope.records, { nameLeakSeverity: readNameLeakSeverity(findOfficeDir(dir)) });
      const lines = [
        ...problemLines(scope.problems),
        `Spis:   ${dir}`,
        `Klient: ${scope.clientDir ?? "— (subjekty nie sú na klientskej úrovni)"}`,
        ""
      ];
      if (subjekty.length === 0) {
        lines.push("Žiadne subjekty — AML evidencia je prázdna.");
        return ok(lines.join(`
`));
      }
      for (const raw of subjekty) {
        const r = maskRecord(raw);
        lines.push(`${r.id}  ${(r.role ?? "—").padEnd(12)} ${(r.person_type ?? "—").padEnd(4)} ${r.title}`);
        for (const key of ["birth_number", "birth_date", "id_document_number", "residence", "registry_id", "pep"]) {
          const v = r[key];
          if (typeof v === "string" && v !== "") {
            lines.push(`        ${fieldLabel(key, r.jurisdiction).padEnd(18)} ${v}`);
          }
        }
        const mine = preverenia.filter((p) => p.subject_ref === raw.id);
        if (mine.length === 0 && raw.role === "client") {
          const opora = SCREENING_PROVISION[raw.jurisdiction];
          lines.push(`        preverenie        — žiadne (preverenie klienta sa vyžaduje` + `${opora ? ` — ${opora}` : ""})`);
        }
        for (const p of mine) {
          lines.push(`        preverenie        ${p.id}  ${p.check_date ?? "?"}  režim ${p.mode ?? "?"}` + `  riziko ${p.risk ?? "?"}  platí do ${p.valid_until ?? "?"}`);
        }
        lines.push("");
      }
      const relevantne = findings.filter((f) => f.code.startsWith("AML_") || f.code.startsWith("SENSITIVE"));
      if (relevantne.length > 0) {
        lines.push("Nálezy:");
        for (const f of relevantne) {
          lines.push(`  ${f.severity.toUpperCase()} ${f.code} ${f.recordId}: ${f.message}`);
        }
      } else {
        lines.push("AML evidencia bez nálezov.");
      }
      return ok(lines.join(`
`));
    }
    case "write": {
      const file = flagValue(rest, "--file");
      const reason = flagValue(rest, "--reason");
      const approveAs = flagValue(rest, "--approve-as");
      if (!file || !reason) {
        return { code: 2, out: `Príkaz write vyžaduje --file a --reason.

${USAGE}` };
      }
      if (!existsSync3(file))
        return { code: 2, out: `Súbor návrhu neexistuje: ${file}` };
      let after;
      try {
        after = parseRecord(readFileSync3(file, "utf8"));
      } catch (e) {
        return { code: 2, out: `Návrh sa nedá prečítať: ${e instanceof Error ? e.message : String(e)}` };
      }
      const office = findOfficeDir(dir);
      const cielovy = after.layer !== "L2" && office && resolve2(office) !== resolve2(dir) ? office : dir;
      const store = readStore(cielovy);
      const before = store.records.find((r) => r.id === after.id);
      if (before && before.created !== after.created) {
        const prefix = after.id.replace(/\d+$/, "");
        const max = store.records.filter((r) => r.id.startsWith(prefix)).reduce((m, r) => Math.max(m, Number(r.id.slice(prefix.length)) || 0), 0);
        const volne = `${prefix}${String(max + 1).padStart(3, "0")}`;
        return {
          code: 1,
          out: `ODMIETNUTÉ: identifikátor ${after.id} už v ${cielovy === dir ? "spise" : OFFICE_DIR + "/"} ` + `patrí inému záznamu („${before.title}", založený ${before.created}). ` + `Voľné je ${volne} — prečísluj návrh aj odkazy naň.`
        };
      }
      let diff;
      try {
        diff = planWrite(before, after, reason);
      } catch (e) {
        return { code: 1, out: `ODMIETNUTÉ: ${e instanceof Error ? e.message : String(e)}` };
      }
      const out = [
        `${nadpisZapisu(diff.kind)} ${diff.id} (${after.type}, ${diff.layer})`,
        `Dôvod: ${diff.reason}`,
        "",
        ...diff.lines,
        ""
      ];
      if (cielovy !== dir)
        out.push(`Cieľ: ${OFFICE_DIR}/ — vrstva ${diff.layer} patrí kancelárii, nie spisu.`, "");
      if (after.layer !== "L2" && !office)
        out.push(`Upozornenie: nad spisom sa nenašla kancelária (${OFFICE_DIR}/) — vrstva ${after.layer} ostáva v spise.`, "");
      const trvale = approveAs === undefined ? standingApproval(dir, diff) : undefined;
      const approval = approveAs !== undefined ? { by: approveAs, at: new Date().toISOString() } : trvale;
      if (!apply) {
        out.push(!diff.requiresApproval ? "dry-run: nič sa nezapísalo. Zapíš s --apply." : trvale !== undefined ? `dry-run: zápis do vrstvy ${diff.layer} kryje trvalé poverenie ` + `(${trvale.by}). Zapíš s --apply.` : `dry-run: zápis do vrstvy ${diff.layer} vyžaduje schválenie človekom. ` + `Zapíš s --apply --approve-as "<meno>".`);
        return ok(out.join(`
`));
      }
      if (diff.requiresApproval && approval === undefined) {
        out.push(`ODMIETNUTÉ: zápis do vrstvy ${diff.layer} vyžaduje --approve-as "<meno advokáta>" ` + `alebo trvalé poverenie v ${OFFICE_DIR}/${CONFIG_FILE}. ` + `Meno zadáva človek, agent si ho nekonštruuje sám.`);
        return { code: 1, out: out.join(`
`) };
      }
      let zapis = diff;
      if (approval !== undefined) {
        const auditovany = {
          ...after,
          updated: after.updated > approval.at.slice(0, 10) ? after.updated : approval.at.slice(0, 10),
          timeline: [
            ...after.timeline,
            { date: approval.at.slice(0, 10), text: `schválil ${approval.by} — ${diff.reason}` }
          ]
        };
        try {
          zapis = planWrite(before, auditovany, reason);
        } catch (e) {
          return { code: 1, out: `ODMIETNUTÉ: ${e instanceof Error ? e.message : String(e)}` };
        }
      }
      try {
        applyRecordWrite(cielovy, zapis, approval, dir);
      } catch (e) {
        return { code: 1, out: `ODMIETNUTÉ: ${e instanceof Error ? e.message : String(e)}` };
      }
      out.push(`Zapísané: ${diff.id}${cielovy !== dir ? ` do ${OFFICE_DIR}/` : ""}${approval ? ` (schválil ${approval.by})` : ""}.`);
      return ok(out.join(`
`));
    }
    case "init": {
      const zKarty = jurisdictionFromCard(dir);
      const jurisdiction = rest.includes("--sk") ? "sk" : rest.includes("--cz") ? "cz" : zKarty ?? "cz";
      const zdroj = rest.includes("--sk") || rest.includes("--cz") ? "prepínač" : zKarty ? "karta veci" : "predvolené";
      if (zdroj === "predvolené") {
        return {
          code: 2,
          out: "Spis nemá jurisdikciu: uveď --cz alebo --sk, alebo `jurisdiction: cz|sk` " + "v karte veci (matter.md / spis.md). Bez nej sa pamäť nezaloží."
        };
      }
      if (!apply) {
        return ok(`dry-run: založil by som adresár ${MEMORY_DIR}/ a BRAIN.md ` + `(jurisdikcia ${jurisdiction}, zdroj: ${zdroj}). Zapíš s --apply.`);
      }
      mkdirSync2(join3(dir, MEMORY_DIR), { recursive: true });
      ensureBrain(dir, jurisdiction);
      const status = join3(dir, STATUS_FILE);
      const kostra = !existsSync3(status);
      if (kostra)
        writeFileSync2(status, statusSkeleton(jurisdiction), "utf8");
      return ok(`Založené: ${MEMORY_DIR}/, BRAIN.md${kostra ? ` a ${STATUS_FILE} so všetkými blokmi` : ""} ` + `(jurisdikcia ${jurisdiction}, zdroj: ${zdroj}).`);
    }
    default:
      return { code: 2, out: `Neznámy príkaz: ${cmd}

${USAGE}` };
  }
}

// bin/okf-memory.ts
var result = runCli(process.argv.slice(2));
process.stdout.write(result.out + `
`);
process.exit(result.code);
