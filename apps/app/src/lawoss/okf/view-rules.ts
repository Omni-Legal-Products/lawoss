/**
 * Spoločné pravidlá všetkých pohľadov z pamäte OKF (Dnes, detail veci, karty vecí).
 * Pohľady nič nepočítajú po svojom: okno, naliehavosť aj text lehoty idú odtiaľto,
 * takže tá istá lehota z toho istého súboru vyzerá všade rovnako.
 */
import { deadlineLabel } from "../../../../../lawoss/okf/read";
import { addDays } from "./read-model";

/** Koľko dní dopredu ukazujú prehľady lehôt (po lehote a neplatné dátumy vždy). */
export const HORIZON_DAYS = 14;
/** Lehota do toľkých dní je „blízko" (zlatá), dnes a po lehote „horí". */
export const NEAR_DAYS = 3;

export type Urgency = "hot" | "near" | "calm";

const DAY_MS = 86_400_000;
const dayMs = (iso: string) => Date.parse(`${iso}T00:00:00Z`);

/** Počet kalendárnych dní od `todayIso` po `date` (záporné = po lehote). */
export const daysUntil = (todayIso: string, date: string): number => Math.round((dayMs(date) - dayMs(todayIso)) / DAY_MS);

/** Neplatný dátum a lehota dnes alebo po nej horí, do `NEAR_DAYS` je blízko, inak pokoj. */
export function urgencyOf(date: string, todayIso: string, invalid?: boolean): Urgency {
  if (invalid) return "hot";
  const left = daysUntil(todayIso, date);
  if (left <= 0) return "hot";
  return left <= NEAR_DAYS ? "near" : "calm";
}

/** Patrí lehota do prehľadu: po lehote, neplatná, alebo do `HORIZON_DAYS`. */
export const inHorizon = (date: string, todayIso: string, invalid?: boolean): boolean =>
  Boolean(invalid) || date <= addDays(todayIso, HORIZON_DAYS);

/** Text lehoty zo zápisu („2026-10-09 Lehota na vyjadrenie"), inak názov záznamu. */
export function deadlineText(d: { title: string; raw?: string; label?: string; invalid?: true }): string {
  if (d.invalid) return d.title;
  return d.label ?? deadlineLabel(d.raw) ?? d.title;
}
