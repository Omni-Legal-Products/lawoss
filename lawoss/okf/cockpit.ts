/**
 * Read-only cockpit jednej veci — čistá logika nad prehľadom pamäte spisov
 * (`read.ts`). Nesiaha na disk, nič nepočíta z predpisov a nič nezapisuje.
 *
 * Berie iba to, čo v záznamoch skutočne je: fakt je záznam s prameňom, lehota
 * je dátum v poli `deadlines`, úloha je záznam typu `task`, udalosť je riadok
 * v `## History`. Čo sa nedalo prečítať, skončí v `unreadable` — nikdy ticho
 * nezmizne.
 */
import type { OkfRecord } from "../okf-pamat/src/record.ts";
import type { RecordType } from "../okf-pamat/src/schema.ts";
import { deadlineTier, type MatterInput, type MatterOverview } from "./read.ts";

/** Odkiaľ údaj pochádza. Slovo, nie farba — stav musí byť čitateľný aj bez nej. */
export type Provenance = "overené" | "AI návrh" | "zapísané" | "overenie neurčené" | "strojovo overené";

/** Prečo riadok čaká na advokáta. Opäť slovo, nie farba. */
export type AttentionState = "po termíne" | "blíži sa" | "neparsovateľné" | "chýba údaj" | "bez prameňa" | "nespracované";

export type MatterProblem = { path: string; message: string };

export type CockpitInput = {
  matters: readonly MatterOverview[];
  /** Záznamy tej istej veci, ako ich prečítal read-model. */
  inputs: readonly MatterInput[];
  problems: readonly MatterProblem[];
};

export type CockpitField = { label: string; value: string; missing: boolean };
export type CockpitFact = {
  id: string;
  title: string;
  kind: string;
  source?: string;
  locator?: string;
  date?: string;
  provenance: Provenance;
  file: string;
};
export type CockpitTask = { id: string; title: string; assignee?: string; due?: string; overdue: boolean; file: string };
export type CockpitDeadline = {
  date: string;
  title: string;
  recordId: string;
  provenance: Provenance;
  source?: string;
  file: string;
  overdue: boolean;
  confirmed: boolean;
};
export type AttentionRow = {
  id: string;
  kind: "lehota" | "úloha" | "nález" | "záznam";
  state: AttentionState;
  title: string;
  detail: string;
  date?: string;
  provenance?: Provenance;
  /** Zdrojový súbor, z ktorého riadok pochádza. */
  file: string;
};
export type CockpitEvent = { date: string; text: string; kind?: string; recordId: string; file: string };

export const REGISTER_ORDER = ["obal", "fakty", "ulohy", "lehoty"] as const;
export type RegisterId = (typeof REGISTER_ORDER)[number];
export type CockpitRegister = { id: RegisterId; label: string; note: string; count: number };

export type Cockpit = {
  matter: MatterOverview;
  /** Meno klienta z cesty `AK/<písmeno>/<klient>/Spisy/<vec>`, ak ju cesta má. */
  client?: string;
  jurisdiction?: string;
  registers: readonly CockpitRegister[];
  obal: readonly CockpitField[];
  facts: readonly CockpitFact[];
  tasks: readonly CockpitTask[];
  deadlines: { confirmed: readonly CockpitDeadline[]; candidates: readonly CockpitDeadline[] };
  attention: readonly AttentionRow[];
  events: readonly CockpitEvent[];
  unreadable: readonly MatterProblem[];
  /** Žiaden nález validácie — hlavička ukáže „OKF validné". */
  okfValid: boolean;
};

const KIND_LABEL: Record<RecordType, string> = {
  matter: "spis",
  decision: "rozhodnutie",
  subject: "subjekt",
  question: "otázka",
  screening: "preverenie",
  claim: "tvrdenie",
  evidence: "dôkaz",
  task: "úloha",
  rule: "pravidlo",
  lesson: "poučenie",
  authority: "prameň",
};

/** Typy, ktoré patria do registra FAKTY — spis je obal a úloha má vlastný register. */
const FACT_TYPES = new Set<RecordType>(["decision", "subject", "question", "screening", "claim", "evidence", "authority", "rule", "lesson"]);

/** Fakt bez prameňa je nález validácie; pri týchto typoch prameň chýbať nesmie. */
const NEEDS_SOURCE = new Set<RecordType>(["claim", "evidence", "decision"]);

/** Calendar validity is required; Date.parse alone normalizes invalid dates such as February 30. */
function validVerificationTime(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2}))?$/.test(value)) return false;
  const day = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  return !Number.isNaN(day.getTime()) && day.toISOString().slice(0, 10) === value.slice(0, 10) && !Number.isNaN(Date.parse(value));
}

/** Legacy verification without actor type never implies human approval. */
export function provenance(record: OkfRecord): Provenance {
  if (record.verified?.some((v) => v.type === "human" && typeof v.by === "string" && v.by.trim() && validVerificationTime(v.at) && v.truth === record.truth)) return "overené";
  if (record.verified?.some((v) => v.type === "machine")) return "strojovo overené";
  if ((record.verified?.length ?? 0) > 0) return "overenie neurčené";
  if (record.extra && "generated" in record.extra) return "AI návrh";
  return "zapísané";
}

/** Confirmation applies only to this date and the exact reviewed Truth. */
export function deadlineConfirmed(record: OkfRecord, date: string): boolean {
  return record.verified?.some((v) => v.type === "human" && typeof v.by === "string" && Boolean(v.by.trim()) && validVerificationTime(v.at) && v.at.slice(0, 10) >= record.updated.slice(0, 10) &&
    v.deadline === date && v.truth === record.truth) ?? false;
}

const MEMORY_DIR = "memory";

function fileOf(input: MatterInput, record: OkfRecord): string {
  return input.recordFiles?.[record.id] ?? `${input.path}/${MEMORY_DIR}/`;
}

const firstSource = (record: OkfRecord): { title?: string; resource?: string } | undefined => record.sources?.[0];

/** Dátum faktu tak, ako ho záznam nesie; nič sa nedopočítava. */
function factDate(record: OkfRecord): string | undefined {
  return record.origin_date ?? record.claimed_at ?? record.check_date ?? record.verified_at ?? record.updated;
}

/** `AK/N/Novák Jan/Spisy/vec` → `Novák Jan`. Iná cesta klienta nenesie. */
export function clientFromPath(path: string): string | undefined {
  const parts = path.split("/");
  return parts[0] === "AK" && parts.length >= 3 ? parts[2] : undefined;
}

function facts(input: MatterInput): CockpitFact[] {
  return input.records
    .filter((r) => FACT_TYPES.has(r.type))
    .map((r) => {
      const src = firstSource(r);
      const fact: CockpitFact = {
        id: r.id,
        title: r.title,
        kind: KIND_LABEL[r.type],
        provenance: provenance(r),
        file: fileOf(input, r),
      };
      if (src?.title) fact.source = src.title;
      if (src?.resource) fact.locator = src.resource;
      const date = factDate(r);
      if (date) fact.date = date;
      return fact;
    })
    .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

function tasks(input: MatterInput, todayIso: string): CockpitTask[] {
  return input.records
    .filter((r) => r.type === "task" && r.state !== "done")
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((r) => {
      const task: CockpitTask = {
        id: r.id,
        title: r.title,
        overdue: r.due !== undefined && r.due < todayIso,
        file: fileOf(input, r),
      };
      if (r.assignee) task.assignee = r.assignee;
      if (r.due) task.due = r.due;
      return task;
    });
}

function deadlines(input: MatterInput, todayIso: string): CockpitDeadline[] {
  const out: CockpitDeadline[] = [];
  for (const r of input.records) {
    for (const date of r.deadlines ?? []) {
      const item: CockpitDeadline = {
        date,
        title: r.title,
        recordId: r.id,
        provenance: provenance(r),
        file: fileOf(input, r),
        overdue: deadlineTier(date, todayIso) === "overdue",
        confirmed: deadlineConfirmed(r, date),
      };
      const src = firstSource(r);
      if (src?.title) item.source = src.title;
      out.push(item);
    }
  }
  return out.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title)));
}

function events(input: MatterInput): CockpitEvent[] {
  const out: CockpitEvent[] = [];
  for (const r of input.records) {
    for (const e of r.timeline) {
      const event: CockpitEvent = { date: e.date, text: e.text, recordId: r.id, file: fileOf(input, r) };
      if (e.kind) event.kind = e.kind;
      out.push(event);
    }
  }
  return out.sort((a, b) => (a.date > b.date ? -1 : a.date < b.date ? 1 : 0));
}

function obal(matter: MatterOverview, jurisdiction: string | undefined): CockpitField[] {
  const field = (label: string, value: string | undefined, fallback: string): CockpitField =>
    value ? { label, value, missing: false } : { label, value: fallback, missing: true };
  return [
    ...(!matter.matterKind || matter.matterKind === "dispute" ? [
      field("Spisová značka", matter.matterRef, "nie je v karte ani v zázname"),
      field("Súd / orgán", matter.court, "nie je v karte ani v zázname"),
    ] : []),
    field("Jurisdikcia", jurisdiction, "záznam veci chýba"),
    field("Stav konania", matter.state, "nie je v karte ani v zázname"),
  ];
}

const STATE_RANK: Record<AttentionState, number> = {
  "nespracované": 2,
  "po termíne": 0,
  "blíži sa": 1,
  neparsovateľné: 2,
  "bez prameňa": 3,
  "chýba údaj": 4,
};

/**
 * Čo čaká na advokáta: uplynuté a blížiace sa lehoty, úlohy po termíne,
 * nálezy validácie a záznamy, ktoré sa nedali prečítať. Zoradené podľa
 * naliehavosti, v rámci nej podľa dátumu.
 */
export function attention(
  matter: MatterOverview,
  input: MatterInput,
  problems: readonly MatterProblem[],
  todayIso: string,
): AttentionRow[] {
  const rows: AttentionRow[] = [];
  for (const line of (input.intake ?? "").split("\n")) {
    const cells = line.trim().split("|").slice(1, -1).map((cell) => cell.trim());
    if (cells[4] !== "pending") continue;
    rows.push({ id: `vstup:${cells[0]}`, kind: "záznam", state: "nespracované",
      title: `Nespracovaný vstup ${cells[0]}`, detail: `${cells[2]} · ${cells[3]}`,
      file: `${input.path}/VSTUPY.md` });
  }


  for (const d of deadlines(input, todayIso)) {
    const tier = deadlineTier(d.date, todayIso);
    if (tier === "later") continue;
    rows.push({
      id: `lehota:${d.recordId}:${d.date}`,
      kind: "lehota",
      state: tier === "overdue" ? "po termíne" : "blíži sa",
      title: d.title,
      detail: d.source ?? `záznam ${d.recordId}`,
      date: d.date,
      provenance: d.provenance,
      file: d.file,
    });
  }

  for (const t of tasks(input, todayIso)) {
    if (!t.overdue || t.due === undefined) continue;
    rows.push({
      id: `uloha:${t.id}`,
      kind: "úloha",
      state: "po termíne",
      title: t.title,
      detail: t.assignee ? `zodpovedá ${t.assignee}` : "bez zodpovednej osoby",
      date: t.due,
      file: t.file,
    });
  }

  for (const p of problems) {
    rows.push({
      id: `zaznam:${p.path}`,
      kind: "záznam",
      state: "neparsovateľné",
      title: p.path.split("/").pop() ?? p.path,
      detail: p.message,
      file: p.path,
    });
  }

  for (const r of input.records) {
    if (!NEEDS_SOURCE.has(r.type) || firstSource(r)) continue;
    rows.push({
      id: `nalez:prameň:${r.id}`,
      kind: "nález",
      state: "bez prameňa",
      title: r.title,
      detail: `${KIND_LABEL[r.type]} bez poľa sources — tvrdenie bez prameňa sa nedá overiť`,
      provenance: provenance(r),
      file: fileOf(input, r),
    });
  }

  for (const f of obal(matter, undefined).filter((f) => ["Spisová značka", "Súd / orgán"].includes(f.label))) {
    if (!f.missing) continue;
    rows.push({
      id: `nalez:obal:${f.label}`,
      kind: "nález",
      state: "chýba údaj",
      title: `Obal: ${f.label}`,
      detail: "doplní sa v karte spisu alebo v zázname typu matter",
      file: `${matter.path}/spis.md`,
    });
  }

  if (input.records.length === 0) {
    rows.push({
      id: "nalez:pamäť",
      kind: "nález",
      state: "chýba údaj",
      title: "Vec nemá pamäť",
      detail: "priečinok memory/ je prázdny alebo chýba — cockpit nemá čo čítať",
      file: `${matter.path}/${MEMORY_DIR}/`,
    });
  }

  return rows.sort((a, b) => {
    const s = STATE_RANK[a.state] - STATE_RANK[b.state];
    if (s !== 0) return s;
    if (a.date && b.date && a.date !== b.date) return a.date < b.date ? -1 : 1;
    return a.title.localeCompare(b.title);
  });
}

/** Vec podľa cesty; bez cesty prvá vec v prehľade. Neznáma cesta → `null`. */
export function selectMatter(matters: readonly MatterOverview[], path: string | null): MatterOverview | null {
  if (!path) return matters[0] ?? null;
  return matters.find((m) => m.path === path) ?? null;
}

export function buildCockpit(data: CockpitInput, path: string | null, todayIso: string): Cockpit | null {
  const matter = selectMatter(data.matters, path);
  if (!matter) return null;
  const input = data.inputs.find((i) => i.path === matter.path) ?? { path: matter.path, records: [] };
  const unreadable = data.problems.filter((p) => (input.scopePaths ?? [matter.path]).some((dir) => p.path === dir || p.path === (dir ? `${dir}/memory` : "memory") || p.path.startsWith(dir ? `${dir}/memory/` : "memory/") || (dir === matter.path && p.path.startsWith(`${dir}/`))));
  const jurisdiction = input.records.find((r) => r.type === "matter")?.jurisdiction ?? input.cardFrontmatter?.jurisdiction;

  const all = deadlines(input, todayIso);
  const candidates = all.filter((d) => !d.confirmed);
  const confirmed = all.filter((d) => d.confirmed);
  const factRows = facts(input);
  const taskRows = tasks(input, todayIso);
  const attentionRows = attention(matter, input, unreadable, todayIso);
  const fields = obal(matter, jurisdiction);

  const cockpit: Cockpit = {
    matter,
    registers: [
      { id: "obal", label: "Obal", note: "spisová značka, súd, jurisdikcia, stav", count: fields.filter((f) => !f.missing).length },
      { id: "fakty", label: "Fakty", note: "zdroj a lokátor zo záznamu", count: factRows.length },
      { id: "ulohy", label: "Úlohy", note: "otvorené, kto, termín", count: taskRows.length },
      { id: "lehoty", label: "Lehoty", note: `${confirmed.length} potvrdených · ${candidates.length} kandidátov`, count: all.length },
    ],
    obal: fields,
    facts: factRows,
    tasks: taskRows,
    deadlines: { confirmed, candidates },
    attention: attentionRows,
    events: events(input),
    unreadable,
    okfValid: attentionRows.every((r) => r.kind !== "nález" && r.state !== "neparsovateľné"),
  };
  const client = clientFromPath(matter.path);
  if (client) cockpit.client = client;
  if (jurisdiction) cockpit.jurisdiction = jurisdiction;
  return cockpit;
}
