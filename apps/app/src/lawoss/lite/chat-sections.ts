/**
 * Pripnuté a nedávne chaty v bežnom režime (rozhodnutie MČ 19. 10. 2026, oprava po review): predvolene
 * vypnuté, ale prepínač v natívnom prispôsobení panela funguje. Voľba bežného režimu sa ukladá zvlášť
 * (`lawoss.lite.chatSections`), Pokročilý ďalej používa natívnu konfiguráciu panela bez zmeny.
 */
import { useCallback, useSyncExternalStore } from "react";
import type { UiMode } from "./ui-mode";

export const LITE_CHAT_SECTIONS_KEY = "lawoss.lite.chatSections";
/** Sekcie chatu, ktoré bežný režim predvolene neukáže. */
const LITE_DEFAULT_OFF: ReadonlySet<string> = new Set(["sectionPinned", "sectionRecent"]);

type Choices = Readonly<Record<string, boolean>>;

/** Je sekcia chatu vidieť? Pokročilý: natívna voľba; bežný: pri pripnutých a nedávnych voľba bežného režimu, inak natívna. */
export function chatSectionShown(key: string, mode: UiMode, enabled: boolean, liteChoices: Choices): boolean {
  if (mode === "pro" || !LITE_DEFAULT_OFF.has(key)) return enabled;
  return liteChoices[key] ?? false;
}

const read = (): Choices => {
  try {
    const raw = globalThis.localStorage?.getItem(LITE_CHAT_SECTIONS_KEY);
    const parsed: unknown = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(Object.entries(parsed).filter((entry): entry is [string, boolean] => typeof entry[1] === "boolean"));
  } catch { return {}; }
};

let choices: Choices = read();
const listeners = new Set<() => void>();
const subscribe = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
const EMPTY: Choices = {};

/** Uloží voľbu bežného režimu; nečitateľné úložisko = voľba platí do reštartu. */
export function setLiteChatSection(key: string, value: boolean): void {
  choices = { ...choices, [key]: value };
  try { globalThis.localStorage?.setItem(LITE_CHAT_SECTIONS_KEY, JSON.stringify(choices)); } catch { /* pohodlie, nie stav */ }
  for (const listener of listeners) listener();
}

/** Test seam: znovu načíta úložisko. */
export function reloadLiteChatSections(): void {
  choices = read();
  for (const listener of listeners) listener();
}

/** Viditeľnosť sekcií chatu pre panel aj jeho prispôsobenie v danom režime. */
export function useChatSectionVisibility(mode: UiMode) {
  const current = useSyncExternalStore(subscribe, () => choices, () => EMPTY);
  const handles = useCallback((key: string) => mode === "lite" && LITE_DEFAULT_OFF.has(key), [mode]);
  const shown = useCallback((key: string, enabled: boolean) => chatSectionShown(key, mode, enabled, current), [mode, current]);
  return { handles, shown, set: setLiteChatSection };
}
