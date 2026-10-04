/**
 * Spoločné pravidlá všetkých pohľadov z pamäte OKF (Dnes, detail veci, klienti, bočný panel,
 * názov okna). Pohľady nič nepočítajú po svojom: okno, naliehavosť aj text lehoty idú odtiaľto
 * a naliehavosť priamo z `deadlineTier` vrstvy OKF, takže Lite aj Pro ukazujú to isté.
 */
import { deadlineLabel, deadlineTier } from "../../../../../lawoss/okf/read";
import { addDays } from "./read-model";

/** Koľko dní dopredu ukazujú prehľady lehôt (po lehote a neplatné dátumy vždy). */
export const HORIZON_DAYS = 14;

export type Urgency = "hot" | "near" | "calm";

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

/** Skutočný kalendárny deň v tvare RRRR-MM-DD; „2026-02-30" nie je 2. marec, ale chyba. */
export function isCalendarDay(value: string | undefined): value is string {
  if (!value || !ISO_DAY.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

/** Počet kalendárnych dní od `todayIso` po `date` (záporné = po lehote, NaN pre neplatný dátum). */
export function daysUntil(todayIso: string, date: string): number {
  if (!isCalendarDay(todayIso) || !isCalendarDay(date)) return Number.NaN;
  return Math.round((Date.parse(`${date}T00:00:00Z`) - Date.parse(`${todayIso}T00:00:00Z`)) / DAY_MS);
}

/**
 * Naliehavosť podľa `deadlineTier` (rovnako ako režim Pro a súhrn „do 7 dní"):
 * po lehote, dnes a zajtra horí; do 7 dní je blízko; neskôr pokoj.
 * Neplatný alebo nemožný dátum horí - musí ho niekto overiť.
 */
export function urgencyOf(date: string | undefined, todayIso: string, invalid?: boolean): Urgency {
  if (invalid || !isCalendarDay(date)) return "hot";
  const tier = deadlineTier(date, todayIso);
  if (tier === "overdue" || tier === "today") return "hot";
  return tier === "soon" ? "near" : "calm";
}

/** Patrí lehota do prehľadu: po lehote, neplatná, alebo do `HORIZON_DAYS`. */
export const inHorizon = (date: string, todayIso: string, invalid?: boolean): boolean =>
  Boolean(invalid) || !isCalendarDay(date) || date <= addDays(todayIso, HORIZON_DAYS);

/** Text lehoty zo zápisu („2026-10-09 Lehota na vyjadrenie"), inak názov záznamu, inak jeho ID. */
export function deadlineText(d: { title: string; raw?: string; label?: string; invalid?: true; recordId?: string }): string {
  const text = d.invalid ? undefined : d.label ?? deadlineLabel(d.raw);
  return text?.trim() || d.title.trim() || d.recordId || "?";
}

/** Kľúč pre React a kotvu: tá istá lehota toho istého záznamu môže byť v jeden deň dvakrát. */
export const deadlineKey = (d: { recordId: string; date: string; raw?: string; label?: string }, index: number): string =>
  `${d.recordId}/${d.date}/${d.raw ?? d.label ?? ""}/${index}`;
