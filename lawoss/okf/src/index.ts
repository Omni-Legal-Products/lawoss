/**
 * OKF pamäťové jadro — verejné API.
 *
 * Vrstvy pamäte podľa spec 0002:
 *   L1 kancelária  — pravidlá práce a poučenia (`rule`, `lesson`)
 *   L2 spis        — obsah veci (`matter`, `decision`, `subject`, `question`)
 *   L3 právo       — zdieľateľné pramene z verejných zdrojov (`authority`)
 *
 * Zápis vedie vždy cez planWrite → applyRecordWrite. Iná cesta na disk nie je.
 */

export {
  FIELDS, RECORD_TYPES, LAYER_OF, SENSITIVE_FIELDS, AML_REQUIRED,
  STATUS, PERSON_KINDS, ROLES, RISK, CONCLUSION, SCREENING_MODES,
  fieldLabel, canonicalField, typeLabel, isRecordType, isJurisdiction, needleFields,
  type Jurisdiction, type Layer, type RecordType, type FieldDef, type NeedleStrength,
  type Status, type PersonKind, type Role, type Risk, type Conclusion, type ScreeningMode,
} from "./schema.ts";

export {
  parseRecord, serializeRecord, HEADINGS,
  type OkfRecord, type TimelineEntry,
} from "./record.ts";

export {
  planWrite, authorize, ApprovalRequiredError, TimelineIntegrityError,
  type Approval, type WriteDiff, type WriteKind,
} from "./write.ts";

export { renderStatus, RenderConflictError, BLOCKS, type BlockName } from "./render.ts";
export { validateStore, type Finding, type Severity, type ValidateOptions } from "./validate.ts";
export { maskValue, maskRecord } from "./mask.ts";
export {
  readStore, readScope, findClientDir, MEMORY_DIR, applyRecordWrite, LeakBlockedError,
  writeIndex, ensureBrain, syncStatus,
  type Store, type Scope, type StoreProblem,
} from "./store.ts";

import { FIELDS, LAYER_OF, type Jurisdiction, type RecordType } from "./schema.ts";

/** Polia, ktoré newRecord priraďuje výslovne; zvyšok sa berie z tabuľky. */
const CORE_INIT_FIELDS = new Set([
  "okf", "id", "type", "title", "summary",
  "layer", "jurisdiction", "status", "created", "updated",
]);
import type { OkfRecord, TimelineEntry } from "./record.ts";

export interface NewRecordInit {
  id: string;
  type: RecordType;
  jurisdiction: Jurisdiction;
  title: string;
  summary: string;
  created: string;
  updated: string;
  truth: string;
  timeline: TimelineEntry[];
  status?: string;

  sources?: string[];
  related?: string[];
  deadlines?: string[];
  parties?: string[];
  area?: string[];
  business_scope?: string[];
  representatives?: string[];
  ubo?: string[];
  registries?: string[];

  matter_ref?: string;
  court?: string;

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

  legal_form?: string;
  registered_office?: string;
  registry_entry?: string;
  pep?: string;

  subject_ref?: string;
  check_date?: string;
  mode?: string;
  pep_result?: string;
  sanctions_result?: string;
  funds_origin?: string;
  risk?: string;
  conclusion?: string;
  valid_until?: string;
}

/**
 * Zostaví záznam so správnou vrstvou. Vrstva sa neurčuje ručne — vyplýva
 * z typu, takže sa nedá „omylom" založiť právny prameň ako spisový záznam.
 */
export function newRecord(init: NewRecordInit): OkfRecord {
  const rec: OkfRecord = {
    okf: 1,
    id: init.id,
    type: init.type,
    title: init.title,
    summary: init.summary,
    layer: LAYER_OF[init.type],
    jurisdiction: init.jurisdiction,
    status: init.status ?? "active",
    created: init.created,
    updated: init.updated,
    truth: init.truth,
    timeline: init.timeline,
  };
  // Nepovinné polia sa kopírujú podľa tabuľky, nie podľa ručného zoznamu —
  // inak by nové pole ticho vypadlo pri zakladaní záznamu.
  const src = init as unknown as Record<string, string | string[] | undefined>;
  const dst = rec as unknown as Record<string, string | string[]>;
  for (const f of FIELDS) {
    if (CORE_INIT_FIELDS.has(f.canonical)) continue;
    const v = src[f.canonical];
    if (v !== undefined) dst[f.canonical] = v;
  }
  return rec;
}
