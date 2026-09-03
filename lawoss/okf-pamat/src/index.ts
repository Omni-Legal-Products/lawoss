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
  PROOF_STATUS, CONFIDENCE, EVIDENCE_STRENGTH, PROCEDURAL_STATUS, TASK_STATES,
  EVIDENCE_KINDS, EVIDENCE_KIND_PROVISION, SCREENING_PROVISION, EVENT_KINDS,
  fieldLabel, canonicalField, typeLabel, truthDigest, OKF_VERSION, isRecordType, isJurisdiction, needleFields,
  type Jurisdiction, type Layer, type RecordType, type FieldDef, type NeedleStrength,
  type Status, type PersonKind, type Role, type Risk, type Conclusion, type ScreeningMode,
  type ProofStatus, type Confidence, type EvidenceStrength, type ProceduralStatus, type EvidenceKind, type TaskState, type EventKind,
} from "./schema.ts";

export {
  parseRecord, serializeRecord, parseFrontmatter, HEADINGS,
  type OkfRecord, type TimelineEntry, type Source, type Verification, type FmValue, type FmMap,
} from "./record.ts";

export {
  planWrite, authorize, ApprovalRequiredError, TimelineIntegrityError, StaleUpdatedError,
  type Approval, type WriteDiff, type WriteKind,
} from "./write.ts";

export { renderStatus, RenderConflictError, BLOCKS, MARKER_ONLY, type BlockName, type LinkResolver } from "./render.ts";
export { validateStore, type Finding, type Severity, type ValidateOptions } from "./validate.ts";
export { maskValue, maskRecord } from "./mask.ts";
export {
  readStandingAuthorization, covers, isExpired, CONFIG_FILE,
  readClientPath, matchesClientPath,
  type StandingAuthorization,
} from "./config.ts";
export {
  readStore, readScope, findClientDir, findOfficeDir, MEMORY_DIR, OFFICE_DIR, applyRecordWrite, LeakBlockedError, ConcurrentWriteError,
  writeIndex, writeLog, ensureBrain, syncStatus, standingApproval, statusLinkResolver,
  type Store, type Scope, type StoreProblem,
} from "./store.ts";

import { FIELDS, LAYER_OF, type Jurisdiction, type RecordType } from "./schema.ts";
import { coerceField, type FmValue } from "./record.ts";

/** Polia, ktoré newRecord priraďuje výslovne; zvyšok sa berie z tabuľky. */
const CORE_INIT_FIELDS = new Set([
  "okf", "id", "type", "title", "description",
  "layer", "jurisdiction", "status", "created", "updated",
]);
import type { OkfRecord, TimelineEntry, Source, Verification } from "./record.ts";

export interface NewRecordInit {
  id: string;
  type: RecordType;
  jurisdiction: Jurisdiction;
  title: string;
  description: string;
  created: string;
  updated: string;
  truth: string;
  timeline: TimelineEntry[];
  status?: string;

  /** Reťazec sa prijme ako `{ title }` — rovnako ako pri čítaní starých spisov. */
  sources?: (string | Source)[];
  verified?: Verification[];
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

  truth_digest?: string;
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
    description: init.description,
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
  const src = init as unknown as Record<string, FmValue | undefined>;
  const dst = rec as unknown as Record<string, FmValue>;
  for (const f of FIELDS) {
    if (CORE_INIT_FIELDS.has(f.canonical)) continue;
    const v = src[f.canonical];
    if (v !== undefined) dst[f.canonical] = coerceField(f.kind, v, f.canonical);
  }
  return rec;
}
