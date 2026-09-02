/**
 * Per-machine experiment switches. Local on purpose: this is the state of the
 * person testing, not of the workspace, so it is never synced or shared.
 */
import { useSyncExternalStore } from "react";

import { EXPERIMENTS } from "./registry";

const STORAGE_KEY = "lawoss.experiments";

const KNOWN_FLAG_IDS = new Set(EXPERIMENTS.filter((item) => item.kind === "flag").map((item) => item.id));

let state: Record<string, boolean> = read();
const listeners = new Set<() => void>();

/** `globalThis` rather than `window` so the store also works under bun tests. */
function storage(): Storage | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null; // storage unavailable (private mode, capture)
  }
}

function read(): Record<string, boolean> {
  const store = storage();
  if (!store) return {};
  let raw: string | null = null;
  try {
    raw = store.getItem(STORAGE_KEY);
  } catch {
    return {};
  }
  if (!raw) return {};
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const next: Record<string, boolean> = {};
    for (const [id, value] of Object.entries(parsed)) {
      // Keep booleans only, and only for flags that still exist. A deleted
      // experiment must not be revivable from an old profile.
      if (typeof value === "boolean" && KNOWN_FLAG_IDS.has(id)) next[id] = value;
    }
    return next;
  } catch {
    return {}; // corrupted value — fall back to all-off rather than crashing boot
  }
}

function persist(): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore: the switch still applies for this session
  }
}

export function isExperimentOn(id: string): boolean {
  return state[id] === true;
}

export function setExperiment(id: string, on: boolean): void {
  if (!KNOWN_FLAG_IDS.has(id)) return;
  if (isExperimentOn(id) === on) return;
  state = { ...state, [id]: on };
  persist();
  for (const listener of listeners) listener();
}

export function resetExperiments(): void {
  state = {};
  persist();
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Reads the switch and re-renders when it flips. Unknown ids are always false. */
export function useExperiment(id: string): boolean {
  return useSyncExternalStore(
    subscribe,
    () => isExperimentOn(id),
    () => false, // server/prerender: experiments are off
  );
}

/** Test seam: re-reads localStorage as if the app had just booted. */
export function reloadExperimentsFromStorage(): void {
  state = read();
  for (const listener of listeners) listener();
}
