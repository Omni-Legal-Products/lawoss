import { documentNavigationTargetSchema, type DocumentNavigationTarget } from "@legalwork/types/office-editor";
import { acceptTemplateRevisions, templateRevisionIds } from "./docx-template-revisions";
import { normalizeDocxLineBreaks } from "./docx-line-breaks";
import { isDocumentReadTool } from "./document-agent-read";
/** @jsxImportSource react */
import { type RefObject, useCallback, useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from "react";
import { flushSync } from "react-dom";
import { DocxEditor, type DocxEditorRef, type EditorMode } from "@eigenpal/docx-editor-react";
import { DocxReviewer } from "@eigenpal/docx-editor-agents";
import { useDocxAgentTools } from "@eigenpal/docx-editor-agents/react";
import { setGoogleFontsEnabled } from "@eigenpal/docx-editor-core";
import { acceptChangeById, rejectChangeById } from "@eigenpal/docx-editor-core/prosemirror/commands";
import { extractTrackedChanges } from "@eigenpal/docx-editor-core/prosemirror/utils/extractTrackedChanges";
import "@eigenpal/docx-editor-react/styles.css";
import "./office-fonts.css";

import { getResolvedThemeMode, subscribeToTheme, type ResolvedThemeMode } from "@/app/theme";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { ConfirmModal } from "../../../design-system/modals/confirm-modal";
import { loadFontsFromGoogle, rememberFontDecision, unresolvedDocumentFonts } from "./docx-font-consent";
import { drainDocxRecovery, draftDecisionPendingApi, keepDocxVersion, readDocxRecovery, removeDocxRecovery, writeDocxRecovery, type DocxRecovery } from "./docx-recovery";
import { useDocxPageFit } from "./use-docx-page-fit";
import { useDocxReviewCard } from "./use-docx-review-card";
import "./docx-editor-layout.css";
import "./docx-editor-theme.css";
import { useControlActions } from "../../../shell/control/control-provider";
import { t } from "@/i18n";
import { createDocumentAutosave } from "./document-autosave";

// The editor otherwise injects a fonts.googleapis.com stylesheet for any font a
// document names that isn't installed locally — which would tell Google the
// typefaces used in a client's file. office-fonts.css bundles the substitutes
// it used to fetch, so nothing is disclosed and nothing changes about how a
// document renders. Calibri, Cambria, Arial, Helvetica, Times New Roman and
// Courier New keep Word's pagination, being metric compatible; the other
// families are look-alikes and can re-wrap. Page-global, so it is set once at
// import, before any document.
setGoogleFontsEnabled(false);

export type DocxEditorApi = {
  navigate: (target: DocumentNavigationTarget) => Promise<unknown>;
  /** Serialize and persist the current document. Never clears edits made during a save. */
  save: () => Promise<boolean>;
  flushSave: () => Promise<boolean>;
  drain: () => Promise<void>;
  /** Serialize the live draft without writing to the workspace or clearing its dirty state. */
  getBuffer: () => Promise<ArrayBuffer | null>;
  executeAgentTool: (toolName: string, args: Record<string, unknown>) => Promise<DocxEditorToolResult>;
  discardRecovery: () => Promise<void>;
  revision: () => number;
  isDirty: () => boolean;
};

export type DocxEditorToolResult = {
  success: boolean;
  data?: unknown;
  error?: string;
  saved?: boolean;
};

type ArtifactDocxEditorProps = {
  name: string;
  /** Captured on mount. The panel controls when a different disk revision is loaded. */
  content: ArrayBuffer;
  author?: string;
  readOnly?: boolean;
  interactionLocked?: boolean;
  legacyRecoveryKey?: string;
  onSave?: (buffer: ArrayBuffer) => void | Promise<void>;
  onDirtyChange?: (dirty: boolean) => void;
  apiRef?: RefObject<DocxEditorApi | null>;
  recoveryKey?: string;
  baseUpdatedAt?: number | null;
  onRestore?: (baseUpdatedAt: number | null) => void;
  autosave?: boolean;
  onAutosaveError?: (error: string | null) => void;
};

const AUTHOR_KEY = "legalwork.docx.reviewer";
let documentInstance = 0;
// Eigenpal's File > Save exports a download, even when onSave is supplied.
// Name that action accurately; the panel Save button / Cmd+S persist to the workspace.
// Read lazily: a module-scope t() would freeze the English label at import,
// before initLocale() picks the language.
const EDITOR_LABELS = {
  toolbar: {
    get save() {
      return t("artifact.download_copy");
    },
    saveShortcut: "",
  },
};

const REVIEW_TOOL_NAMES = new Set(["accept_changes", "reject_changes"]);

/** Native document/comment updates must reach the React editor ref before a
 * save reads it, otherwise a delayed callback leaves an already-saved edit dirty. */
function flushEditorUpdate<T>(update: () => T): T {
  let result!: T;
  flushSync(() => { result = update(); });
  return result;
}

function requestedChangeIds(args: Record<string, unknown>): number[] | null {
  if (!Array.isArray(args.changeIds)) return null;
  const ids = args.changeIds.filter(
    (value): value is number => typeof value === "number" && Number.isInteger(value) && value >= 0,
  );
  return ids.length === args.changeIds.length && ids.length > 0 ? [...new Set(ids)] : null;
}

function decideTrackedChanges(
  editor: DocxEditorRef | null,
  decision: "accept" | "reject",
  requestedIds: number[],
): DocxEditorToolResult {
  const view = editor?.getEditorRef()?.getView();
  if (!view) return { success: false, error: t("docx.editor_not_ready") };

  const { entries } = extractTrackedChanges(view.state);
  const ids = new Set<number>();
  for (const requestedId of requestedIds) {
    const entry = entries.find((candidate) => (
      Number(candidate.revisionId) === requestedId
      || Number(candidate.insertionRevisionId) === requestedId
      || candidate.coalescedRevisionIds?.some((id) => Number(id) === requestedId)
    ));
    if (!entry) {
      ids.add(requestedId);
      continue;
    }
    ids.add(Number(entry.revisionId));
    if (entry.insertionRevisionId !== undefined) ids.add(Number(entry.insertionRevisionId));
    entry.coalescedRevisionIds?.forEach((id) => ids.add(Number(id)));
  }

  const command = decision === "accept" ? acceptChangeById : rejectChangeById;
  let applied = 0;
  for (const id of ids) {
    if (command(id)(view.state, view.dispatch)) applied += 1;
  }
  if (applied === 0) {
    return { success: false, error: t("docx.unknown_change_ids") };
  }
  const verb = decision === "accept" ? "Accepted" : "Rejected";
  return { success: true, data: `${verb} ${applied} tracked-change revision${applied === 1 ? "" : "s"}.` };
}

function useThemeColorMode(): ResolvedThemeMode {
  return useSyncExternalStore(subscribeToTheme, getResolvedThemeMode, getResolvedThemeMode);
}

export function ArtifactDocxEditor(props: ArtifactDocxEditorProps) {
  const [recovery, setRecovery] = useState<DocxRecovery | null>(null);
  const [checked, setChecked] = useState(Boolean(!props.recoveryKey || props.readOnly));
  const [restored, setRestored] = useState<DocxRecovery | null>(null);
  useEffect(() => {
    if (!props.recoveryKey || props.readOnly) { setChecked(true); return; }
    let active = true;
    const key = props.recoveryKey;
    void readDocxRecovery(key, props.legacyRecoveryKey).then((draft) => {
      if (active) { setRecovery(draft); setChecked(true); }
    }).catch(() => {
      if (active) { setChecked(true); toast.error(t("docx.recovery_unavailable")); }
    });
    return () => { active = false; };
  }, [props.recoveryKey, props.legacyRecoveryKey, props.readOnly]);
  const { apiRef, name } = props;
  useEffect(() => {
    if (!recovery || !apiRef) return;
    const pending = draftDecisionPendingApi(name);
    apiRef.current = pending;
    return () => { if (apiRef.current === pending) apiRef.current = null; };
  }, [recovery, apiRef, name]);
  if (!checked) return <div className="p-6 text-sm" role="status">{t("docx.checking_draft")}</div>;
  if (recovery) return <div className="space-y-4 p-6">
    <h3 className="font-medium">{t("docx.recover_prompt")}</h3>
    <p className="text-sm text-muted-foreground">{t("docx.recover_saved_draft", { name: props.name, time: new Date(recovery.savedAt).toLocaleString() })}</p>
    {recovery.baseUpdatedAt !== props.baseUpdatedAt && <p className="text-sm">{t("docx.recover_body")}</p>}
    <div className="flex gap-2">
      <Button onClick={() => { props.onRestore?.(recovery.baseUpdatedAt); setRestored(recovery); setRecovery(null); }}>{t("docx.recover_draft")}</Button>
      <Button variant="outline" onClick={() => {
        void removeDocxRecovery(recovery.key).then(() => setRecovery(null)).catch(() => toast.error(t("docx.discard_recovery_failed")));
      }}>{t("docx.discard_and_open")}</Button>
    </div>
  </div>;
  return <LiveDocxEditor {...props} content={restored?.buffer ?? props.content} recovered={!!restored} />;
}

function LiveDocxEditor({ name, content, author, readOnly = false, interactionLocked = false, onSave, onDirtyChange, apiRef, recoveryKey, baseUpdatedAt = null, recovered, autosave = false, onAutosaveError }: ArtifactDocxEditorProps & { recovered: boolean }) {
  const colorMode = useThemeColorMode();
  const [documentBuffer] = useState(() => content.slice(0));
  const [documentId] = useState(() => `${Date.now()}:${++documentInstance}`);
  const [mode, setMode] = useState<EditorMode>("editing");
  const checkpointTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dirty = useRef(recovered);
  const checkpoint = useRef<() => Promise<void>>(async () => {});
  const checkpointWork = useRef<Promise<void>>(Promise.resolve());
  const checkpointed = useRef<{ revision: number; base: number | null } | null>(null);
  const [reviewer] = useState(() => {
    if (author) return author;
    try { return window.localStorage.getItem(AUTHOR_KEY) ?? ""; } catch { return ""; }
  });
  const editorRef = useRef<DocxEditorRef>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [commentsOpen, setCommentsOpen] = useState(false);
  const [changeCount, setChangeCount] = useState(0);
  const [reviewDecision, setReviewDecision] = useState<{ decision: "accept" | "reject"; ids: number[]; revision: number } | null>(null);
  const [missingFonts, setMissingFonts] = useState<string[]>([]);
  const fitPage = useDocxPageFit(containerRef, editorRef, commentsOpen);
  const onReviewClick = useDocxReviewCard(containerRef, editorRef);
  const recoveryFailed = useRef(false);
  const { executeToolCall } = useDocxAgentTools({ editorRef, author: "LegalWork AI" });
  const revision = useRef(0);
  const ready = useRef(false);
  const pendingSave = useRef<Promise<boolean> | null>(null);
  const serialization = useRef<Promise<ArrayBuffer | null> | null>(null);
  const historyStarted = useRef(false);
  const lastDocument = useRef<ReturnType<DocxEditorRef["getDocument"]>>(null);
  const latestSave = useRef<() => Promise<boolean>>(async () => false);
  const latestAutosaveError = useRef(onAutosaveError);
  latestAutosaveError.current = onAutosaveError;
  const [automaticSave] = useState(() => createDocumentAutosave({
    save: () => latestSave.current(),
    isDirty: () => dirty.current && ready.current,
    onError: (error) => latestAutosaveError.current?.(error instanceof Error ? error.message : t("artifact.save_failed")),
  }));

  const markDirty = useCallback(() => {
    if (readOnly || !ready.current) return;
    const view = editorRef.current?.getEditorRef()?.getView();
    if (view) setChangeCount(extractTrackedChanges(view.state).entries.length);
    revision.current += 1;
    dirty.current = true;
    onDirtyChange?.(true);
    automaticSave.changed();
    if (recoveryKey) {
      if (checkpointTimer.current) clearTimeout(checkpointTimer.current);
      checkpointTimer.current = setTimeout(() => { void checkpoint.current(); }, 1000);
    }
  }, [readOnly, onDirtyChange, recoveryKey, automaticSave]);

  // Ask before fetching a font the document needs and this machine lacks — the
  // one case office-fonts.css cannot cover locally. Runs once the editor has
  // rendered, so canRenderFont() sees the faces the document embedded.
  const askAboutFonts = useCallback(() => {
    void unresolvedDocumentFonts(documentBuffer)
      .then((families) => { if (families.length > 0) setMissingFonts(families); })
      .catch(() => {});
  }, [documentBuffer]);

  const fontsUnavailable = useCallback((families: string[]) => {
    // Say so rather than leaving a pressed button looking like it did nothing.
    // Remember the answer too, so the same dead end is not offered again — but
    // not when this machine was simply offline, where a later open can still
    // succeed.
    if (navigator.onLine !== false) rememberFontDecision(families, false);
    toast.error(t("docx.font_download_failed", { count: families.length, fonts: families.join(", ") }));
  }, []);

  const resolveFonts = useCallback((allowed: boolean) => {
    const families = missingFonts;
    setMissingFonts([]);
    if (!allowed) {
      rememberFontDecision(families, false);
      return;
    }
    void loadFontsFromGoogle(families)
      .then((failed) => {
        fitPage();
        rememberFontDecision(families.filter((family) => !failed.includes(family)), true);
        if (failed.length > 0) fontsUnavailable(failed);
      })
      .catch(() => fontsUnavailable(families));
  }, [missingFonts, fitPage, fontsUnavailable]);

  const checkDocument = useCallback(() => {
    const document = editorRef.current?.getDocument();
    if (!document || document === lastDocument.current) return;
    const hadDocument = lastDocument.current !== null;
    lastDocument.current = document;
    if (hadDocument) markDirty();
  }, [markDirty]);

  // The pinned adapter omits onChange for some header/footer and property-dialog
  // edits. Its immutable document reference covers those paths without serializing
  // or traversing a large contract on every keystroke. Check synchronously before save too.
  useEffect(() => {
    const timer = window.setInterval(checkDocument, 250);
    return () => window.clearInterval(timer);
  }, [checkDocument]);

  const getBuffer = useCallback(async () => {
    const serialize = async () => await editorRef.current?.save({ selective: false }) ?? null;
    const operation = serialization.current ? serialization.current.catch(() => null).then(serialize) : serialize();
    serialization.current = operation;
    try { return await operation; } finally { if (serialization.current === operation) serialization.current = null; }
  }, []);

  checkpoint.current = () => {
    const work = (async () => {
      if (!recoveryKey || !dirty.current || readOnly) return;
      const checkpointRevision = revision.current;
      if (checkpointed.current?.revision === checkpointRevision && checkpointed.current.base === baseUpdatedAt) return;
      try {
        const buffer = await getBuffer();
        if (!buffer || !dirty.current || checkpointRevision !== revision.current) return;
        await writeDocxRecovery({ key: recoveryKey, buffer, baseUpdatedAt, savedAt: Date.now() });
        checkpointed.current = { revision: checkpointRevision, base: baseUpdatedAt };
        recoveryFailed.current = false;
      } catch {
        if (!recoveryFailed.current) toast.error(t("docx.recovery_unavailable_save"));
        recoveryFailed.current = true;
      }
    })();
    checkpointWork.current = work;
    return work;
  };

  useLayoutEffect(() => {
    const onHidden = () => { if (document.visibilityState === "hidden") void checkpoint.current(); };
    const timer = setInterval(() => { void checkpoint.current(); }, 5000);
    document.addEventListener("visibilitychange", onHidden);
    return () => {
      document.removeEventListener("visibilitychange", onHidden);
      clearInterval(timer);
      if (checkpointTimer.current) clearTimeout(checkpointTimer.current);
      void checkpoint.current();
    };
  }, []);

  const save = useCallback((automatic = false): Promise<boolean> => {
    if (pendingSave.current) return pendingSave.current.then((saved) => saved && dirty.current ? save(automatic) : saved);
    if (readOnly || !onSave) return Promise.resolve(false);
    checkDocument();
    const savingRevision = revision.current;
    const operation = (async () => {
      const buffer = await getBuffer();
      if (!buffer) return false;
      if (recoveryKey && !historyStarted.current && !recovered) {
        await keepDocxVersion(recoveryKey, documentBuffer.slice(0)).catch(() => toast.error(t("docx.saved_no_history")));
        historyStarted.current = true;
      }
      await onSave(buffer);
      if (recoveryKey) void keepDocxVersion(recoveryKey, buffer.slice(0), automatic).catch(() => toast.error(t("docx.saved_no_history")));
      checkDocument();
      if (revision.current === savingRevision) {
        dirty.current = false;
        onDirtyChange?.(false);
        if (recoveryKey) await removeDocxRecovery(recoveryKey).catch(() => toast.error(t("docx.saved_recovery_not_cleared")));
      }
      automaticSave.saved();
      onAutosaveError?.(null);
      return true;
    })();
    pendingSave.current = operation.finally(() => { pendingSave.current = null; });
    return pendingSave.current;
  }, [readOnly, onSave, checkDocument, getBuffer, onDirtyChange, recoveryKey, automaticSave, onAutosaveError, recovered, documentBuffer]);
  latestSave.current = () => save(true);

  useEffect(() => {
    automaticSave.setEnabled(autosave);
    latestAutosaveError.current?.(null);
  }, [automaticSave, autosave]);

  useEffect(() => {
    automaticSave.setSuspended(readOnly || interactionLocked);
  }, [automaticSave, readOnly, interactionLocked]);

  useEffect(() => {
    const flush = () => { if (document.visibilityState === "hidden") void automaticSave.flush(); };
    document.addEventListener("visibilitychange", flush);
    return () => { automaticSave.setSuspended(true); document.removeEventListener("visibilitychange", flush); };
  }, [automaticSave]);

  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = { navigate: async (rawTarget) => {
      const target = documentNavigationTargetSchema.parse(rawTarget);
      if (target.kind !== "page") throw new Error("Word navigation requires a page number.");
      if (!ready.current) throw new Error("The document is still loading.");
      const pages = containerRef.current?.querySelectorAll<HTMLElement>(".layout-page");
      const page = pages?.[target.page - 1];
      if (!page) throw new Error(`Page ${target.page} is unavailable. The current layout has ${pages?.length ?? 0} pages.`);
      page.scrollIntoView({ block: "start", behavior: "instant" });
      return { page: target.page, pageCount: pages!.length };
    }, save, getBuffer, revision: () => { checkDocument(); return revision.current; }, isDirty: () => { checkDocument(); return dirty.current; },
      flushSave: async () => {
        if (pendingSave.current && !await pendingSave.current) return false;
        checkDocument();
        if (dirty.current && !await save()) return false;
        await checkpointWork.current;
        await drainDocxRecovery();
        return ready.current && !dirty.current;
      },
      drain: async () => {
        try { await pendingSave.current; } finally { await checkpointWork.current; await drainDocxRecovery(); }
      },
      executeAgentTool: async (toolName, args) => {
        if ((readOnly || interactionLocked) && !isDocumentReadTool("docx", toolName)) return { success: false, error: t("docx.read_only") };
        if (!ready.current) return { success: false, error: t("docx.editor_not_ready") };
        const isReviewDecision = REVIEW_TOOL_NAMES.has(toolName);
        let result: DocxEditorToolResult;
        if (toolName === "fill_template") {
          if (typeof args.paraId !== "string" || typeof args.placeholder !== "string" || !/^(?:\{\{[^{}]+\}\}|\[\[[^\[\]]+\]\]|\[[^\[\]]+\])$/.test(args.placeholder) || typeof args.value !== "string") {
            return { success: false, error: "Use an exact template placeholder, its paragraph ID and the replacement value." };
          }
          const view = editorRef.current?.getEditorRef()?.getView();
          if (!view) return { success: false, error: t("docx.editor_not_ready") };
          const existing = templateRevisionIds(view.state);
          result = flushEditorUpdate(() => executeToolCall("suggest_change", { paraId: args.paraId, search: args.placeholder, replaceWith: args.value }));
          if (result.success) {
            const normalized = normalizeDocxLineBreaks(view.state);
            if (normalized) flushEditorUpdate(() => view.dispatch(normalized));
            const accepted = flushEditorUpdate(() => acceptTemplateRevisions(view, existing));
            if (!accepted) return { success: false, error: "The replacement could not be finalized. Read the current draft before continuing." };
            result = { success: true, data: { placeholder: args.placeholder, value: args.value } };
          }
        } else if (toolName === "reply_comment") {
          if (!Number.isInteger(args.commentId) || typeof args.commentId !== "number" || args.commentId < 0 || typeof args.text !== "string" || !args.text.trim()) {
            return { success: false, error: "A valid comment ID and reply text are required." };
          }
          // Replies live in the editor's React comment state. Flush that update
          // before serializing, otherwise the save can omit the new reply.
          const commentId = args.commentId;
          const text = args.text;
          const id = flushEditorUpdate(() => editorRef.current?.replyToComment(commentId, text, "LegalWork AI"));
          result = id === null || id === undefined ? { success: false, error: "The comment no longer exists. Read the comments again." } : { success: true, data: { commentId: id, parentId: args.commentId } };
        } else if (isReviewDecision) {
          const changeIds = requestedChangeIds(args);
          if (!changeIds) {
            return { success: false, error: t("docx.change_ids_required") };
          }
          result = flushEditorUpdate(() => decideTrackedChanges(
            editorRef.current,
            toolName === "accept_changes" ? "accept" : "reject",
            changeIds,
          ));
        } else {
          result = isDocumentReadTool("docx", toolName) ? executeToolCall(toolName, args) : flushEditorUpdate(() => executeToolCall(toolName, args));
        }
        if (!result.success) return result;
        const mutatesDocument = toolName === "suggest_change" || toolName === "add_comment" || toolName === "reply_comment" || toolName === "fill_template" || isReviewDecision;
        if (!mutatesDocument) return result;
        const view = editorRef.current?.getEditorRef()?.getView();
        const normalized = view && normalizeDocxLineBreaks(view.state);
        if (normalized) flushEditorUpdate(() => view.dispatch(normalized));
        markDirty();
        const saved = await save();
        if (!saved) return { success: false, error: t("docx.changed_not_saved") };
        return { ...result, saved: true };
      },
    discardRecovery: async () => {
      await checkpointWork.current;
      if (recoveryKey) await removeDocxRecovery(recoveryKey);
      dirty.current = false;
      onDirtyChange?.(false);
    } };
    return () => { apiRef.current = null; };
  }, [apiRef, save, getBuffer, onDirtyChange, recoveryKey, executeToolCall, markDirty, readOnly, interactionLocked, checkDocument]);

  useControlActions([
    {
      id: "document.read_metadata", label: "Read document status and page count", sideEffect: "none",
      description: "Read the open DOCX name, revision, unsaved-edit status and rendered page count without serializing its text. pageCount is null while pagination is unavailable. Use for report delivery checks; wait for a stable revision/page count.",
      execute: () => {
        const pages = containerRef.current?.querySelectorAll(".layout-page").length ?? 0;
        return { name, documentId, draftRevision: revision.current, saved: !dirty.current,
          pageCount: ready.current && pages > 0 ? pages : null };
      },
    },
    {
      id: "document.read_draft", label: "Read the open document draft", sideEffect: "none",
      description: "Read the live DOCX, including unsaved edits, rendered page count, paragraph handles, comments and redlines. pageCount is null while pagination is unavailable. Use this instead of reading the older workspace file.",
      execute: async () => {
        const draftRevision = revision.current;
        const buffer = await getBuffer();
        if (!buffer) throw new Error(t("docx.still_loading"));
        const draft = await DocxReviewer.fromBuffer(buffer);
        if (draftRevision !== revision.current) throw new Error(t("docx.draft_changed_while_reading"));
        const pages = containerRef.current?.querySelectorAll(".layout-page").length ?? 0;
        return { name, documentId, draftRevision, pageCount: ready.current && pages > 0 ? pages : null,
          text: draft.getContentAsText(), comments: draft.getComments(), changes: draft.getChanges() };
      },
    },
    {
      id: "document.propose_change", label: "Propose a change in the open document", sideEffect: "mutation", disabled: readOnly || interactionLocked,
      description: "Apply and save a tracked proposal to the current draft. Requires name, documentId and draftRevision from document.read_draft. The lawyer reviews it with Accept/Reject. Saving does not accept the proposal.",
      requiresArgs: true,
      args: [{ name: "name", type: "string", required: true }, { name: "documentId", type: "string", required: true }, { name: "draftRevision", type: "number", required: true }, { name: "paraId", type: "string", required: true }, { name: "search", type: "string", required: true }, { name: "replaceWith", type: "string", required: true }],
      execute: async (args) => {
        if (readOnly || interactionLocked) throw new Error(t("docx.read_only"));
        if (!args || typeof args !== "object" || !("name" in args) || args.name !== name ||
          !("documentId" in args) || args.documentId !== documentId ||
          !("draftRevision" in args) || args.draftRevision !== revision.current ||
          !("paraId" in args) || typeof args.paraId !== "string" ||
          !("search" in args) || typeof args.search !== "string" ||
          !("replaceWith" in args) || typeof args.replaceWith !== "string") throw new Error(t("docx.read_draft_again"));
        const proposal = { paraId: args.paraId, search: args.search, replaceWith: args.replaceWith, author: "LegalWork AI" };
        const applied = flushEditorUpdate(() => editorRef.current?.proposeChange(proposal));
        if (!applied) throw new Error(t("docx.target_ambiguous"));
        const view = editorRef.current?.getEditorRef()?.getView();
        const normalized = view && normalizeDocxLineBreaks(view.state);
        if (normalized) flushEditorUpdate(() => view.dispatch(normalized));
        markDirty();
        if (!await save()) throw new Error(t("docx.changed_not_saved"));
        return { applied: true, saved: true, draftRevision: revision.current };
      },
    },
  ]);

  return (
    <div ref={containerRef} className="docx-host flex h-full min-h-0 min-w-0 w-full flex-col overflow-hidden" onClickCapture={onReviewClick} onKeyDownCapture={(event) => {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "s" || event.altKey) return;
      event.preventDefault();
      event.stopPropagation();
      if (readOnly || interactionLocked) return;
      void save().then((saved) => {
        if (!saved) toast.error(t("docx.save_failed_draft_open"));
      }).catch((error: unknown) => {
        toast.error(error instanceof Error ? error.message : t("docx.save_failed_draft_open"));
      });
    }}>
      {changeCount > 0 && <div className="flex flex-wrap items-center gap-2 border-b px-3 py-1" aria-label={t("docx.review_changes")}>
        <Button size="sm" variant="ghost" aria-pressed={commentsOpen} onClick={() => setCommentsOpen(!commentsOpen)}>{t("docx.review_changes")} ({changeCount})</Button>
        {!readOnly && (["accept", "reject"] satisfies Array<"accept" | "reject">).map(decision => <Button key={decision} size="sm" variant="ghost" disabled={interactionLocked} onClick={() => {
          const view = editorRef.current?.getEditorRef()?.getView();
          if (!view) return;
          const ids = extractTrackedChanges(view.state).entries.map(entry => Number(entry.revisionId)).filter(Number.isFinite);
          setReviewDecision({ decision, ids, revision: revision.current });
        }}>{t(decision === "accept" ? "docx.accept_all" : "docx.reject_all")}</Button>)}
      </div>}
      <div className="min-h-0 min-w-0 flex-1">
        <DocxEditor
          ref={editorRef}
          documentBuffer={documentBuffer}
          documentName={name}
          documentNameEditable={false}
          author={reviewer.trim() || "LegalWork"}
          readOnly={readOnly}
          mode={readOnly ? "viewing" : mode}
          onModeChange={setMode}
          commentsSidebarOpen={commentsOpen}
          onCommentsSidebarOpenChange={setCommentsOpen}
          onFontsLoaded={fitPage}
          colorMode={colorMode}
          showFileOpen={false}
          showHelpMenu
          showOutlineButton={false}
          showRuler={false}
          rulerUnit="cm"
          i18n={EDITOR_LABELS}
          className="h-full"
          onEditorViewReady={(view) => {
            const normalized = normalizeDocxLineBreaks(view.state);
            if (normalized) view.dispatch(normalized.setMeta("addToHistory", false));
            // Plugins may retain a dispatch callback after React unmounts the
            // editor. The pinned editor resets its teardown flag after destroy;
            // reject those late transactions before ProseMirror reads docView.
            const dispatch = view.props.dispatchTransaction;
            view.setProps({ dispatchTransaction(transaction) {
              if (view.isDestroyed) return;
              if (dispatch) dispatch.call(view, transaction);
              else view.updateState(view.state.apply(transaction));
            } });
            // Initial import/normalization emits document and comment callbacks.
            // Establish the baseline after that first render, before accepting edits.
            requestAnimationFrame(() => {
              if (view.isDestroyed || ready.current) return;
              lastDocument.current = editorRef.current?.getDocument() ?? null;
              ready.current = true;
              setChangeCount(extractTrackedChanges(view.state).entries.length);
              askAboutFonts();
              if (recovered) { dirty.current = true; onDirtyChange?.(true); automaticSave.changed(); }
            });
          }}
          onChange={(document) => { lastDocument.current = document; markDirty(); }}
          onCommentsChange={() => {
            // Loading the imported threads happens before the editor ref has a document.
            if (editorRef.current?.getDocument()) markDirty();
          }}
          onError={(error) => toast.error(error.message)}
        />
      </div>
      <ConfirmModal
        open={reviewDecision !== null}
        title={t(reviewDecision?.decision === "reject" ? "docx.reject_all" : "docx.accept_all")}
        message={t("docx.review_all_confirm")}
        confirmLabel={t(reviewDecision?.decision === "reject" ? "docx.reject_all" : "docx.accept_all")}
        cancelLabel={t("common.cancel")}
        onCancel={() => setReviewDecision(null)}
        onConfirm={() => {
          const pending = reviewDecision;
          setReviewDecision(null);
          if (!pending || readOnly || interactionLocked) return;
          if (pending.revision !== revision.current) { toast.error(t("docx.read_draft_again")); return; }
          const result = flushEditorUpdate(() => decideTrackedChanges(editorRef.current, pending.decision, pending.ids));
          if (!result.success) { toast.error(result.error); return; }
          markDirty();
          void save().then(saved => { if (!saved) toast.error(t("docx.changed_not_saved")); }).catch(error => toast.error(error instanceof Error ? error.message : t("docx.changed_not_saved")));
        }}
      />
      <ConfirmModal
        open={missingFonts.length > 0}
        title={t("docx.font_missing_title", { count: missingFonts.length })}
        message={t("docx.font_missing_body", { count: missingFonts.length, fonts: missingFonts.join(", ") })}
        confirmLabel={t("docx.font_missing_confirm", { count: missingFonts.length })}
        cancelLabel={t("docx.font_missing_cancel", { count: missingFonts.length })}
        confirmButtonVariant="secondary"
        onConfirm={() => resolveFonts(true)}
        onCancel={() => resolveFonts(false)}
      />
    </div>
  );
}
