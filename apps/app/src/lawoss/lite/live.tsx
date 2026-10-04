/** @jsxImportSource react */
/**
 * Drobnosti, ktoré robia pohľady z OKF živými: indikátor aktualizácie, počet horiacich
 * lehôt v názve okna a skok na konkrétnu lehotu. Všetko vychádza z tej istej pamäte.
 */
import { useEffect, useState } from "react";
import { t, type Language } from "@/i18n";
import type { OkfReadResult } from "../okf/read-model";
import type { OkfPageMeta } from "../domains/okf-page";
import { urgencyOf, type Urgency } from "../okf/view-rules";
import { buildToday, nextDeadline } from "./today-model";

const MINUTE = 60_000;

/** „Aktualizované práve teraz"; bod krátko zabliká, keď sa obsah pamäte naozaj zmenil. */
export function LiveStamp({ meta, locale }: { meta: OkfPageMeta; locale: Language }) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, []);
  if (!meta.checkedAt) return null;
  const minutes = Math.floor(Math.max(0, now - meta.checkedAt) / MINUTE);
  return (
    <span className="lw-live" role="status" aria-live="polite">
      <span key={meta.changedAt} className="lw-live-dot" aria-hidden />
      {minutes < 1 ? t("lawoss.lite.live_now", locale) : t("lawoss.lite.live_minutes", locale, { count: minutes })}
    </span>
  );
}

/** Počet lehôt, ktoré horia (dnes, po lehote, neplatný dátum), podľa spoločných pravidiel. */
export function hotDeadlineCount(data: Pick<OkfReadResult, "matters" | "upcomingDeadlines" | "overdue" | "inputs">, todayIso: string): number {
  return buildToday(data, todayIso).deadlines.filter((d) => urgencyOf(d.date, todayIso, d.invalid) === "hot").length;
}

const TITLE_COUNT = /^\(\d+\)\s+/;

/** „(2) LAWOSS": horiace lehoty vidno aj v názve okna, keď je appka v pozadí. */
export function useHotTitle(count: number): void {
  useEffect(() => {
    if (typeof document === "undefined") return;
    const base = document.title.replace(TITLE_COUNT, "");
    document.title = count > 0 ? `(${count}) ${base}` : base;
    return () => { document.title = document.title.replace(TITLE_COUNT, ""); };
  }, [count]);
}

/** Kotva lehoty v detaile veci; rovnaká v odkaze z Dnes aj v cieli. */
export const deadlineAnchor = (recordId: string, date: string): string =>
  `lehota-${`${recordId}-${date}`.replace(/[^\p{L}\p{N}_-]+/gu, "-")}`;

/** Naliehavosť najbližšej lehoty veci, alebo nič, ak nič nehorí ani sa neblíži. */
export function matterUrgency(deadlines: readonly { date: string; invalid?: true }[], todayIso: string): Exclude<Urgency, "calm"> | undefined {
  if (deadlines.some((d) => d.invalid || (d.date < todayIso))) return "hot";
  const next = nextDeadline(deadlines, todayIso);
  if (!next) return undefined;
  const urgency = urgencyOf(next, todayIso);
  return urgency === "calm" ? undefined : urgency;
}
