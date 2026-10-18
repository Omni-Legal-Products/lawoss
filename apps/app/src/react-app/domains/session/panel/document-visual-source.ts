import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { t } from "@/i18n";
import { documentClientIdentity } from "./document-processing";

export type DocumentVisualSource = { client: LegalworkServerClient; workspaceId: string; path: string };
type Owner = { hash: string | null; visible: () => boolean; refresh: (expectedHash: string) => Promise<void> };
const owners = new Map<string, Set<Owner>>();
const listeners = new Set<() => void>();
const key = (source: DocumentVisualSource) => JSON.stringify([documentClientIdentity(source.client), source.workspaceId, source.path]);
const changed = () => listeners.forEach(listener => listener());
export const subscribeDocumentVisualSources = (listener: () => void) => { listeners.add(listener); return () => { listeners.delete(listener); }; };
export const documentVisualSourceVerified = (source: DocumentVisualSource, hash: string) => [...(owners.get(key(source)) ?? [])].some(owner => owner.hash === hash);

/** This receipt belongs to the actual persistent viewer, not a file path tab or
 * a fetched preparation. A changed blob or disposed owner retracts it. */
export function registerDocumentVisualSource(source: DocumentVisualSource, handlers: Omit<Owner, "hash">) {
  const id = key(source), owner: Owner = { ...handlers, hash: null };
  const registered = owners.get(id) ?? new Set(); registered.add(owner); owners.set(id, registered);
  return {
    verified(hash: string | null) { if (owner.hash !== hash) { owner.hash = hash; changed(); } },
    dispose() { registered.delete(owner); if (!registered.size) owners.delete(id); changed(); },
  };
}

export async function openDocumentVisualSource(source: DocumentVisualSource, expectedHash: string, open: () => void) {
  for (const owner of owners.get(key(source)) ?? []) owner.hash = null;
  changed(); open();
  const end = Date.now() + 15000;
  while (Date.now() < end) {
    const owner = [...(owners.get(key(source)) ?? [])].find(owner => owner.visible());
    if (owner) { await owner.refresh(expectedHash); if (owner.hash !== expectedHash) throw new Error(t("documents.visual_open_required")); return; }
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error(t("documents.visual_open_required"));
}
