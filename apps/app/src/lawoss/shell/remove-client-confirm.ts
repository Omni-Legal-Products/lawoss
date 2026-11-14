/**
 * LAWOSS: potvrdenie „Odobrať klienta“ v okne appky so slovenskými a českými tlačidlami namiesto systémového
 * `window.confirm` s anglickým „Cancel / OK“ (overenie alfy 12, 14. 11. 2026). Volajú ho `session-route.tsx`
 * a `settings-route.tsx`; okno kreslí `RemoveClientConfirmHost` v `shell/providers.tsx`, PATCHES.md.
 */
import { t } from "@/i18n";

export function removeClientCopy() {
  return {
    title: t("lawoss.client.remove_title"),
    message: t("lawoss.client.remove_body"),
    confirm: t("lawoss.client.remove_confirm"),
    cancel: t("lawoss.client.remove_cancel"),
  };
}

let pending: ((confirmed: boolean) => void) | null = null;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

/** Otvorí potvrdenie v hostiteľovi; bez hostiteľa (náhľady, testy) použije natívne okno ako doteraz. */
export function requestRemoveClientConfirm(): Promise<boolean> {
  if (!hosts) {
    const copy = removeClientCopy();
    return Promise.resolve(typeof window !== "undefined" && window.confirm(`${copy.title}\n\n${copy.message}`));
  }
  pending?.(false);
  return new Promise((resolve) => {
    pending = resolve;
    emit();
  });
}

export function settleRemoveClientConfirm(confirmed: boolean): void {
  const current = pending;
  pending = null;
  emit();
  current?.(confirmed);
}

export const removeClientConfirmStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => { listeners.delete(listener); };
  },
  snapshot: (): boolean => pending !== null,
  attachHost() {
    hosts += 1;
    return () => {
      hosts -= 1;
      if (!hosts) settleRemoveClientConfirm(false);
    };
  },
};
