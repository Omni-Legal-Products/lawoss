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
  FIELDS, RECORD_TYPES, LAYER_OF, fieldKey, canonicalField, typeKey, canonicalType,
  type Jurisdiction, type Layer, type RecordType, type FieldDef,
} from "./schema.ts";

export {
  parseRecord, serializeRecord, HEADINGS,
  type OkfRecord, type TimelineEntry,
} from "./record.ts";

export {
  planWrite, authorize, ApprovalRequiredError, TimelineIntegrityError,
  type Approval, type WriteDiff, type WriteKind,
} from "./write.ts";

export { renderStatus, BLOCKS, type BlockName } from "./render.ts";
export { validateStore, type Finding, type Severity } from "./validate.ts";
export {
  readStore, memoryDirName, applyRecordWrite, writeIndex, ensureBrain, syncStatus,
  type Store,
} from "./store.ts";

import { LAYER_OF, type Jurisdiction, type RecordType } from "./schema.ts";
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
  matter_ref?: string;
  court?: string;
  area?: string[];
  registry_id?: string;
  birth_date?: string;
}

/**
 * Zostaví záznam so správnou vrstvou. Vrstva sa neurčuje ručne — vyplýva
 * z typu, takže sa nedá „omylom" založiť právny prameň ako spisový záznam.
 */
export function newRecord(init: NewRecordInit): OkfRecord {
  const rec: OkfRecord = {
    schema: 1,
    id: init.id,
    type: init.type,
    title: init.title,
    summary: init.summary,
    layer: LAYER_OF[init.type],
    jurisdiction: init.jurisdiction,
    status: init.status ?? "platny",
    created: init.created,
    updated: init.updated,
    truth: init.truth,
    timeline: init.timeline,
  };
  const optionalLists = ["sources", "related", "deadlines", "parties", "area"] as const;
  for (const k of optionalLists) {
    const v = init[k];
    if (v !== undefined) rec[k] = v;
  }
  const optionalScalars = ["matter_ref", "court", "registry_id", "birth_date"] as const;
  for (const k of optionalScalars) {
    const v = init[k];
    if (v !== undefined) rec[k] = v;
  }
  return rec;
}
