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
import { isOfficeFile } from "../../../../../lawoss/okf/read";
import { buildToday } from "./today-model";

const MINUTE = 60_000;

/**
 * Prekreslí stránku každú minútu: „dnes" sa zmení o polnoci a pozdrav podľa dennej doby,
 * aj keď sa pamäť nezmenila a react-query by nič neprekreslil.
 */
export function useMinuteTick(): number {
  const [tick, setTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setTick(Date.now()), MINUTE);
    return () => window.clearInterval(timer);
  }, []);
  return tick;
}

const clock = (ms: number, locale: Language) => new Intl.DateTimeFormat(locale, { hour: "2-digit", minute: "2-digit" }).format(new Date(ms));

/**
 * „Aktualizované práve teraz"; bod krátko zabliká, keď sa obsah pamäte naozaj zmenil.
 * Keď obnovenie zlyhá, stránka ostane s poslednými údajmi a povie, z kedy sú.
 */
export function LiveStamp({ meta, locale }: { meta: OkfPageMeta; locale: Language }) {
  const now = useMinuteTick();
  if (!meta.checkedAt) return null;
  if (meta.failed) {
    return <span className="lw-live" data-stale role="status" aria-live="polite">
      <span className="lw-live-dot" aria-hidden />
      {t("lawoss.lite.live_stale", locale, { time: clock(meta.checkedAt, locale) })}
    </span>;
  }
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

/** Najvyššia naliehavosť lehôt veci (rovnaké pravidlo ako všade), alebo nič, ak je všetko v pokoji. */
export function matterUrgency(deadlines: readonly { date: string; invalid?: true; file?: string }[], todayIso: string): Exclude<Urgency, "calm"> | undefined {
  // Lehota kancelárie patrí kancelárii: nerozsvieti bod pri každej veci, ukáže sa raz v Dnes.
  const levels = new Set(deadlines.filter((d) => !isOfficeFile(d.file)).map((d) => urgencyOf(d.date, todayIso, d.invalid)));
  return levels.has("hot") ? "hot" : levels.has("near") ? "near" : undefined;
}
