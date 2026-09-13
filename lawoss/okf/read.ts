/**
 * Prehľad nad pamäťou spisov pre UI — čistá funkcia nad už načítanými
 * záznamami. Nesiaha na disk ani na server; súbory načíta volajúci
 * (v aplikácii `apps/app/src/lawoss/okf/read-model.ts`).
 *
 * Berie iba to, čo v záznamoch skutočne je. Nič nedopočítava — žiadne lehoty
 * z predpisov, žiadne odvodené termíny. Lehota je dátum v poli `deadlines`,
 * úloha je záznam typu `task`, udalosť je riadok v `## History`.
 */
import type { OkfRecord } from "../okf-pamat/src/record.ts";

export type OverviewDeadline = { date: string; title: string; recordId: string };
export type OverviewTask = { id: string; title: string; assignee?: string; due?: string };

export type MatterOverview = {
  /** Cesta priečinka veci relatívne ku koreňu workspace-u. */
  path: string;
  title: string;
  matterRef?: string;
  court?: string;
  state?: string;
  deadlines: OverviewDeadline[];
  openTasks: OverviewTask[];
  lastEvent?: { date: string; text: string };
  counts: { records: number; evidence: number; subjects: number };
};

export type MatterInput = {
  path: string;
  /** Frontmatter karty `spis.md`, ak existuje (`title`, `spisova_znacka`, `sud`, `status`). */
  cardFrontmatter?: Record<string, string>;
  records: OkfRecord[];
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

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

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

const lastSegment = (path: string): string => path.replace(/[\\/]+$/, "").split(/[\\/]/).pop() || path;

function matterOverview(input: MatterInput): MatterOverview {
  const card = input.cardFrontmatter ?? {};
  const matterRecord = input.records.find((r) => r.type === "matter");
  const deadlines: OverviewDeadline[] = [];
  let lastEvent: MatterOverview["lastEvent"];
  for (const r of input.records) {
    for (const date of r.deadlines ?? []) deadlines.push({ date, title: r.title, recordId: r.id });
    for (const e of r.timeline) {
      if (!lastEvent || e.date > lastEvent.date) lastEvent = { date: e.date, text: e.text };
    }
  }
  deadlines.sort(byDate);
  const openTasks = input.records
    .filter((r) => r.type === "task" && r.state !== "done")
    .sort((a, b) => (a.id < b.id ? -1 : 1))
    .map((t) => ({ id: t.id, title: t.title, assignee: t.assignee, due: t.due }));

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
  const matterRef = card.spisova_znacka || matterRecord?.matter_ref;
  const court = card.sud || matterRecord?.court;
  const state = card.status || matterRecord?.status;
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
  const upcomingDeadlines = all.filter((d) => d.date >= today);
  const overdue = all.filter((d) => d.date < today);
  return {
    matters: overviews,
    upcomingDeadlines,
    overdue,
    totals: {
      matters: overviews.length,
      deadlinesWithin7Days: upcomingDeadlines.filter((d) => d.date <= week).length,
      openTasks: overviews.reduce((n, m) => n + m.openTasks.length, 0),
      overdue: overdue.length,
      records: overviews.reduce((n, m) => n + m.counts.records, 0),
    },
  };
}
