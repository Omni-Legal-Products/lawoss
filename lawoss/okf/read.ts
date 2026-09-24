/**
 * Prehľad nad pamäťou spisov pre UI — čistá funkcia nad už načítanými
 * záznamami. Nesiaha na disk ani na server; súbory načíta volajúci
 * (v aplikácii `apps/app/src/lawoss/okf/read-model.ts`).
 *
 * Berie iba to, čo v záznamoch skutočne je. Nič nedopočítava — žiadne lehoty
 * z predpisov, žiadne odvodené termíny. Lehota je dátum v poli `deadlines`,
 * úloha je záznam typu `task`, udalosť je riadok v `## History`.
 */
import type { ManualStatus } from "../okf-pamat/src/manual-status.ts";
import type { OkfRecord } from "../okf-pamat/src/record.ts";

/** `invalid`: datum lhůty nemá tvar RRRR-MM-DD — UI ho ukáže k ověření, nikdy ho tiše nezahodí. */
/** `file`: skutočný súbor záznamu — totožnosť zdieľaného záznamu (ID sa razia per spis, nie sú jedinečné). */
type OverviewDeadline = { date: string; title: string; recordId: string; invalid?: true; file?: string };
type OverviewTask = { id: string; title: string; assignee?: string; due?: string; file?: string };

export type MatterOverview = {
  /** Cesta priečinka veci relatívne ku koreňu workspace-u. */
  path: string;
  /** Skutočná cesta načítanej karty, vrátane starších názvov. */
  cardPath?: string;
  title: string;
  matterRef?: string;
  court?: string;
  state?: string;
  matterKind?: string;
  deadlines: OverviewDeadline[];
  openTasks: OverviewTask[];
  lastEvent?: { date: string; text: string };
  counts: { records: number; evidence: number; subjects: number };
};

export type MatterInput = {
  path: string;
  /** Skutočná cesta načítanej karty, vrátane starších názvov. */
  cardPath?: string;
  /** Frontmatter kanonickej alebo staršej karty, ak existuje (`title`, `spisova_znacka`, `sud`, `status`). */
  cardFrontmatter?: Record<string, string>;
  records: OkfRecord[];
  /** All directories contributing to this matter, including shared client and office. */
  scopePaths?: string[];
  intake?: string;
  manualStatus?: ManualStatus;
  /** `id` záznamu → cesta jeho súboru. Prehľad ju nepotrebuje, detail veci ňou odkazuje na zdroj. */
  recordFiles?: Record<string, string>;
};

export type UpcomingDeadline = OverviewDeadline & {
  matter: Pick<MatterOverview, "path" | "title" | "matterRef" | "court">;
};

export type Overview = {
  matters: MatterOverview[];
  /** Dátum ≥ dnes, vzostupne. */
  upcomingDeadlines: UpcomingDeadline[];
  /** Dátum < dnes, vzostupne. */
  overdue: UpcomingDeadline[];
  totals: { matters: number; deadlinesWithin7Days: number; openTasks: number; overdue: number; records: number };
};

/** Vyradený záznam (nahradený, zrušený, zakázaný, prekonaný) už nenesie živé lehoty ani úlohy — ako validátor. */
const RETIRED_STATUS = new Set(["superseded", "void", "banned", "deprecated"]);
const isRetired = (r: OkfRecord): boolean => RETIRED_STATUS.has(r.status);

/** Otvorená úloha: nie je hotová ani vyradená. Zdieľa prehľad, cockpit aj lite. */
export const isOpenTask = (r: OkfRecord): boolean => r.type === "task" && r.state !== "done" && !isRetired(r);

/** Totožnosť záznamu naprieč spismi: jeho súbor; bez súboru (testy, staršie vstupy) len v rámci spisu. */
export const recordKey = (matterPath: string, r: { id: string; file?: string }): string => r.file ?? `${matterPath}\u0000${r.id}`;

export const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** `RRRR-MM-DD`, ktorý je skutočným kalendárnym dňom (nie 2026-02-30). */
export const isCalendarDay = (day: string): boolean => {
  if (!ISO_DAY.test(day)) return false;
  const d = new Date(`${day}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === day;
};

/** Počet dní medzi dvomi `RRRR-MM-DD`; nevalidný vstup → 0. */
export function daysBetween(from: string, to: string): number {
  if (!ISO_DAY.test(from) || !ISO_DAY.test(to)) return 0;
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/**
 * Lehoty záznamu pre prehľad a cockpit: vyradený záznam žiadne nemá; `RRRR-MM-DD` s časom
 * sa oreže na deň; iný tvar ostáva ako text s `invalid` (`raw` = pôvodná hodnota pre potvrdenie).
 */
export function recordDeadlines(r: OkfRecord): { date: string; raw: string; invalid?: true }[] {
  if (isRetired(r)) return [];
  return (r.deadlines ?? []).map((raw) => {
    const day = /^(\d{4}-\d{2}-\d{2})(?:[T ].*)?$/.exec(raw.trim())?.[1];
    return day && isCalendarDay(day) ? { date: day, raw } : { date: raw, raw, invalid: true as const };
  });
}


/** `RRRR-MM-DD` + n dní; nevalidný vstup vráti nezmenený. */
export function addDays(iso: string, days: number): string {
  if (!ISO_DAY.test(iso)) return iso;
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export type DeadlineTier = "overdue" | "today" | "soon" | "later";

/** Zaradenie lehoty voči dnešku: po termíne, dnes/zajtra, do 7 dní, neskôr. */
export function deadlineTier(date: string, today: string): DeadlineTier {
  if (date < today) return "overdue";
  if (date <= addDays(today, 1)) return "today";
  if (date <= addDays(today, 7)) return "soon";
  return "later";
}

const byDate = (a: OverviewDeadline, b: OverviewDeadline): number =>
  a.date < b.date ? -1 : a.date > b.date ? 1 : a.title.localeCompare(b.title);

export const lastSegment = (path: string): string => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

function matterOverview(input: MatterInput): MatterOverview {
  const card = input.cardFrontmatter ?? {};
  const matterRecord = input.records.find((r) => r.type === "matter");
  const deadlines: OverviewDeadline[] = [];
  let lastEvent: MatterOverview["lastEvent"];
  for (const r of input.records) {
    const file = input.recordFiles?.[r.id];
    for (const d of recordDeadlines(r)) deadlines.push({ date: d.date, title: r.title, recordId: r.id, ...(d.invalid ? { invalid: d.invalid } : {}), ...(file ? { file } : {}) });
    for (const e of r.timeline) {
      if (!lastEvent || e.date > lastEvent.date) lastEvent = { date: e.date, text: e.text };
    }
  }
  deadlines.sort(byDate);
  const openTasks = input.records
    .filter(isOpenTask)
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((t) => ({ id: t.id, title: t.title, assignee: t.assignee, due: t.due, ...(input.recordFiles?.[t.id] ? { file: input.recordFiles[t.id] } : {}) }));

  const out: MatterOverview = {
    path: input.path,
    title: card.title || matterRecord?.title || lastSegment(input.path),
    deadlines,
    openTasks,
    counts: {
      records: input.records.length,
      evidence: input.records.filter((r) => r.type === "evidence").length,
      subjects: input.records.filter((r) => r.type === "subject").length,
    },
  };
  if (input.cardPath) out.cardPath = input.cardPath;
  const matterRef = card.matter_ref || card.spisova_znacka || matterRecord?.matter_ref;
  const court = card.court || card.sud || matterRecord?.court;
  const state = card.status || matterRecord?.status;
  const matterKind = card.matter_kind || matterRecord?.extra?.matter_kind;
  if (typeof matterKind === "string") out.matterKind = matterKind;
  if (matterRef) out.matterRef = matterRef;
  if (court) out.court = court;
  if (state) out.state = state;
  if (lastEvent) out.lastEvent = lastEvent;
  return out;
}

export function buildOverview(matters: readonly MatterInput[], today: string): Overview {
  const overviews = matters.map(matterOverview);
  const all: UpcomingDeadline[] = overviews.flatMap((m) =>
    m.deadlines.map((d) => ({ ...d, matter: { path: m.path, title: m.title, matterRef: m.matterRef, court: m.court } })),
  );
  all.sort(byDate);
  const week = addDays(today, 7);
  // Neplatné datum sa nedá porovnať s dneškom: nikdy nie „po lehote“, ostáva medzi nadchádzajúcimi.
  const upcomingDeadlines = all.filter((d) => d.invalid || d.date >= today);
  const overdue = all.filter((d) => !d.invalid && d.date < today);
  return {
    matters: overviews,
    upcomingDeadlines,
    overdue,
    totals: {
      matters: overviews.length,
      deadlinesWithin7Days: upcomingDeadlines.filter((d) => !d.invalid && d.date <= week).length,
      // Úloha zo zdieľaného súboru (klient, kancelária) je v súčte jedna; rovnaké ID v dvoch spisoch sú dve úlohy.
      openTasks: new Set(overviews.flatMap((m) => m.openTasks.map((t) => recordKey(m.path, t)))).size,
      overdue: overdue.length,
      records: overviews.reduce((n, m) => n + m.counts.records, 0),
    },
  };
}
