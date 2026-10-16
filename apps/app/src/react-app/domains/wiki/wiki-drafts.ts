import { useCallback, useEffect, useRef, useState } from "react";
import type { WikiDocument } from "@legalwork/types/wiki";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";

export type WikiDraft = WikiDocument & { wikiId: string; baseline: string; saving: boolean; error: string | null };
// Keep unsaved source when the main pane unmounts. No editor serialization is involved.
const retained = new Map<string, WikiDraft>();
const listeners = new Set<() => void>();
const pendingSaves = new Map<string, Promise<boolean>>();
let unloadGuardInstalled = false;

function restoreDrafts(scope: string) {
  try {
    const raw = window.localStorage.getItem(`legalwork.wiki.drafts.${scope}`);
    if (!raw) return;
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return;
    for (const value of parsed) {
      if (typeof value !== "object" || value === null || !("wikiId" in value) || !("path" in value)
        || !("content" in value) || !("baseline" in value) || !("revision" in value) || !("updatedAt" in value)
        || typeof value.wikiId !== "string" || typeof value.path !== "string" || typeof value.content !== "string"
        || typeof value.baseline !== "string" || typeof value.revision !== "string" || typeof value.updatedAt !== "number") continue;
      const key = draftKey(scope, value.wikiId, value.path);
      if (!retained.has(key)) retained.set(key, { wikiId: value.wikiId, path: value.path, content: value.content,
        baseline: value.baseline, revision: value.revision, updatedAt: value.updatedAt, saving: false, error: null });
    }
  } catch { /* The in-memory draft remains available if browser storage is full. */ }
}

function persistDrafts(scope: string) {
  const dirty = [...retained.entries()].filter(([key, draft]) => key.startsWith(`[${JSON.stringify(scope)},`) && draft.content !== draft.baseline).map(([, draft]) => ({ ...draft, saving: false }));
  try {
    if (dirty.length) window.localStorage.setItem(`legalwork.wiki.drafts.${scope}`, JSON.stringify(dirty));
    else window.localStorage.removeItem(`legalwork.wiki.drafts.${scope}`);
  } catch { /* beforeunload guards the remaining in-memory text. */ }
}
const draftKey = (scope: string, wikiId: string, path: string) => JSON.stringify([scope, wikiId, path]);

export function wikiDraftHasChanges(scope: string, wikiId: string, path: string) {
  restoreDrafts(scope);
  const draft = retained.get(draftKey(scope, wikiId, path));
  return Boolean(draft && (draft.saving || draft.content !== draft.baseline));
}

export function wikiHasUnsavedChanges(scope: string, wikiId: string) {
  restoreDrafts(scope);
  return [...retained.entries()].some(([key, draft]) => key.startsWith(`[${JSON.stringify(scope)},`) && draft.wikiId === wikiId && (draft.saving || draft.content !== draft.baseline));
}

export function acceptWikiSave(draft: WikiDraft, sent: string, saved: WikiDocument): WikiDraft {
  return { ...draft, revision: saved.revision, updatedAt: saved.updatedAt, baseline: saved.content,
    content: draft.content === sent ? saved.content : draft.content, saving: false, error: null };
}

export function useWikiDrafts(client: Pick<LegalworkServerClient, "readWikiPage" | "writeWikiPage"> | null, scope: string, onSaved: () => void, editableWikiId: string | null) {
  const [drafts, setDrafts] = useState(() => { restoreDrafts(scope); return new Map(retained); });
  const draftRef = useRef(drafts);
  const onSavedRef = useRef(onSaved);
  onSavedRef.current = onSaved;
  const set = useCallback((key: string, draft: WikiDraft) => {
    retained.set(key, draft);
    draftRef.current = new Map(draftRef.current).set(key, draft);
    setDrafts(draftRef.current);
    persistDrafts(scope);
    for (const listener of listeners) listener();
  }, [scope]);

  const load = useCallback(async (wikiId: string, path: string, force = false) => {
    if (!client) return;
    const key = draftKey(scope, wikiId, path);
    const current = draftRef.current.get(key);
    if (!force && current && (current.content !== current.baseline || current.saving)) return;
    const doc = await client.readWikiPage(wikiId, path);
    // A user may have started typing while the read was pending.
    const latest = draftRef.current.get(key);
    if (!force && latest && (latest.content !== latest.baseline || latest.saving)) return;
    set(key, { ...doc, wikiId, baseline: doc.content, saving: false, error: null });
  }, [client, scope, set]);

  const save = useCallback(async (wikiId: string, path: string) => {
    if (!client || wikiId !== editableWikiId) return false;
    const key = draftKey(scope, wikiId, path);
    const current = draftRef.current.get(key);
    if (!current || current.content === current.baseline) return true;
    const pending = pendingSaves.get(key);
    if (pending) return pending;
    set(key, { ...current, saving: true, error: null });
    const saving = (async () => { try {
      const saved = await client.writeWikiPage(wikiId, { path, content: current.content, baseRevision: current.revision });
      const latest = draftRef.current.get(key);
      if (latest) set(key, acceptWikiSave(latest, current.content, saved));
      onSavedRef.current();
      return true;
    } catch (error) {
      const latest = draftRef.current.get(key);
      if (latest) set(key, { ...latest, saving: false, error: error instanceof Error ? error.message : String(error) });
      return false;
    } finally { pendingSaves.delete(key); } })();
    pendingSaves.set(key, saving);
    return saving;
  }, [client, scope, set, editableWikiId]);

  useEffect(() => {
    if (!editableWikiId) return;
    const timer = window.setTimeout(() => {
      for (const [key, draft] of draftRef.current) {
        if (draft.wikiId === editableWikiId && key.startsWith(`[${JSON.stringify(scope)},`) && draft.content !== draft.baseline && !draft.error && !draft.saving) void save(draft.wikiId, draft.path);
      }
    }, 800);
    return () => window.clearTimeout(timer);
  }, [drafts, scope, save, editableWikiId]);

  useEffect(() => {
    restoreDrafts(scope);
    const update = () => { draftRef.current = new Map(retained); setDrafts(draftRef.current); };
    update();
    listeners.add(update);
    if (!unloadGuardInstalled) {
      window.addEventListener("beforeunload", (event) => {
        if ([...retained.values()].some((draft) => draft.content !== draft.baseline)) { event.preventDefault(); event.returnValue = ""; }
      });
      unloadGuardInstalled = true;
    }
    return () => { listeners.delete(update); };
  }, [scope]);

  return {
    get: (wikiId: string, path: string) => draftRef.current.get(draftKey(scope, wikiId, path)), load, save,
    change: (wikiId: string, path: string, content: string) => {
      if (wikiId !== editableWikiId) return;
      const key = draftKey(scope, wikiId, path);
      const current = draftRef.current.get(key);
      if (current) set(key, { ...current, content, error: null });
    },
    remove: (wikiId: string, path: string) => {
      const key = draftKey(scope, wikiId, path);
      retained.delete(key); persistDrafts(scope);
      const next = new Map(draftRef.current); next.delete(key); draftRef.current = next; setDrafts(next); for (const listener of listeners) listener();
    },
    dirty: [...drafts.entries()].filter(([key, draft]) => key.startsWith(`[${JSON.stringify(scope)},`) && draft.content !== draft.baseline).map(([, draft]) => draft),
  };
}
