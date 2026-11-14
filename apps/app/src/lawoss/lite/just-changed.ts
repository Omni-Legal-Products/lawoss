/**
 * „Práve zmenený riadok“ (design-system.md §4b): po zmene hodnoty riadku sa naň na chvíľu pridá trieda
 * `.lw-just-changed` (jednorazový zlatý odlesk, ktorý vybledne, lawoss/theme/lawoss-components.css).
 */
import { useEffect, useRef, useState } from "react";

export const JUST_CHANGED_CLASS = "lw-just-changed";
export const JUST_CHANGED_MS = 1200;

/**
 * Zmena, ktorú treba ukázať: obe hodnoty známe a rôzne. Prvé načítanie (`undefined` → hodnota) ani zmiznutie
 * hodnoty nie je „práve zmenené“, inak by pri štarte zablikali všetky riadky naraz.
 */
export const isVisibleChange = (previous: string | undefined, next: string | undefined): boolean =>
  previous !== undefined && next !== undefined && previous !== next;

/** `true` počas `durationMs` po viditeľnej zmene `value`; opakovaná zmena odpočet začne znova. */
export function useJustChanged(value: string | undefined, durationMs = JUST_CHANGED_MS): boolean {
  const previous = useRef(value);
  const [on, setOn] = useState(false);
  useEffect(() => {
    const before = previous.current;
    previous.current = value;
    if (!isVisibleChange(before, value)) return;
    setOn(true);
    const timer = setTimeout(() => setOn(false), durationMs);
    return () => clearTimeout(timer);
  }, [value, durationMs]);
  return on;
}
