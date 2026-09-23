/**
 * LAWOSS-lite / LAWOSS-pro: režim zobrazení nad stejnými daty. Lokální volba
 * zařízení (jako jazyk), nikdy součást workspace ani paměti věci.
 */
import { useSyncExternalStore } from "react";

export type UiMode = "lite" | "pro";
export const UI_MODE_STORAGE_KEY = "lawoss.uiMode";
/** Existence aktivního workspace = aplikace už byla používána (session-memory.ts). */
const ACTIVE_WORKSPACE_KEY = "legalwork.react.activeWorkspace";

const listeners = new Set<() => void>();

function storage(): Storage | null {
  try { return globalThis.localStorage ?? null; } catch { return null; }
}

function isUiMode(value: unknown): value is UiMode {
  return value === "lite" || value === "pro";
}

/** Uložená volba, jinak odvození: kdo už aplikaci používá, zůstává v pro. */
function resolve(): UiMode {
  const store = storage();
  if (!store) return "pro";
  try {
    const stored = store.getItem(UI_MODE_STORAGE_KEY);
    if (isUiMode(stored)) return stored;
    const derived: UiMode = store.getItem(ACTIVE_WORKSPACE_KEY) ? "pro" : "lite";
    store.setItem(UI_MODE_STORAGE_KEY, derived);
    return derived;
  } catch {
    return "pro"; // nečitelné úložiště nesmí přepnout zavedeného uživatele
  }
}

let state: UiMode = resolve();

function notify(): void { for (const listener of listeners) listener(); }

export function currentUiMode(): UiMode { return state; }
export function isLite(): boolean { return state === "lite"; }

export function setUiMode(mode: UiMode): void {
  if (!isUiMode(mode) || mode === state) return;
  state = mode;
  try { storage()?.setItem(UI_MODE_STORAGE_KEY, mode); } catch { /* platí aspoň pro tuto relaci */ }
  notify();
}

export function subscribeUiMode(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useUiMode(): UiMode {
  return useSyncExternalStore(subscribeUiMode, currentUiMode, () => "pro");
}

/** Test seam: znovu načte úložiště jako po startu aplikace. */
export function reloadUiModeFromStorage(): void {
  state = resolve();
  notify();
}

let installed = false;
/** Přepnutí v jiném okně (odpojené okno konverzace) se projeví i tady. */
export function initUiMode(): void {
  if (installed || typeof window === "undefined") return;
  installed = true;
  window.addEventListener("storage", (event) => {
    if (event.key !== UI_MODE_STORAGE_KEY) return;
    const next = isUiMode(event.newValue) ? event.newValue : resolve();
    if (next !== state) { state = next; notify(); }
  });
}
