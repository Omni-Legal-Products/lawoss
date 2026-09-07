/** @jsxImportSource react */
import { type RefObject, useCallback, useEffect, useRef, useState, useSyncExternalStore } from "react";
import { DocxEditor, type DocxEditorRef } from "@eigenpal/docx-editor-react";
import "@eigenpal/docx-editor-react/styles.css";

import { getInitialThemeMode, subscribeToTheme, type ThemeMode } from "@/app/theme";
import { normalizeDocumentAuthor, readStoredDocumentAuthor } from "@/app/lib/document-author";

export type DocxEditorApi = {
  /** Serialize the current document and persist it via `onSave`. Returns true on write. */
  save: () => Promise<boolean>;
};

type ArtifactDocxEditorProps = {
  name: string;
  /** The loaded .docx bytes. Captured once on mount; later changes do not reload the editor. */
  content: ArrayBuffer;
  /** Author name stamped on comments and tracked changes. */
  author?: string;
  /** Read-only (remote workspaces / non-file targets): renders in Word-style viewing mode. */
  readOnly?: boolean;
  /** Persists serialized .docx bytes to the workspace. */
  onSave?: (buffer: ArrayBuffer) => void | Promise<void>;
  /** The panel sets this so its header "Save" button can drive the editor. */
  apiRef?: RefObject<DocxEditorApi | null>;
};

// US-Letter page width in CSS px at 100% (8.5in × 96dpi). Fallback before the real
// page (A4/Letter/custom) can be measured.
const FALLBACK_PAGE_WIDTH = 816;
// Visible breathing room on each side of the page; the zoom-to-fit shrinks the page
// by 2× this so it sits centered inside the panel with that gutter.
const PAGE_GUTTER = 12;
const PAGE_MARGIN = PAGE_GUTTER * 2;

// The editor's pages-track has a hard `min-width` (≈944px, the document's design width),
// so in the narrow artifact panel it overflows and the page sits off-center with a
// horizontal scrollbar. Collapse the track to the panel width and center the page.
// Target both the React (`docx-editor__scroll-container`) and Vue
// (`docx-editor-vue__pages-viewport`) class names so this always lands.
const DOCX_FIT_CSS = `
.ep-root .docx-editor__scroll-container,
.ep-root .docx-editor-vue__pages-viewport { overflow-x: hidden !important; }
.ep-root .docx-editor__scroll-container > *,
.ep-root .docx-editor-vue__pages-viewport > * {
  min-width: 0 !important;
  max-width: 100% !important;
  width: 100% !important;
  box-sizing: border-box !important;
  justify-content: center !important;
}
/* Every wrapper between the scroll container and the actual page (.layout-page) must
   span the full width, and the page itself must center — otherwise an inner wrapper is
   pinned narrow and the page is pushed left / clipped. */
.ep-root .docx-editor__scroll-container :has(.layout-page) {
  min-width: 0 !important;
  max-width: 100% !important;
  width: 100% !important;
}
.ep-root .paged-editor__pages { align-items: center !important; justify-content: center !important; }
/* The zoom is a CSS scale and the editor's own centering is off for redline layouts, so
   the page ends up shifted. We measure the real offset in JS and correct it with this
   variable (set on our container, inherited here). The important flag survives re-renders. */
.ep-root .layout-page {
  margin-left: auto !important;
  margin-right: auto !important;
  transform: translateX(var(--docx-center-x, 0px)) !important;
}
/* Comments and tracked-change cards live in a right-side sidebar that reserves its
   width even when the individual cards are hidden, pushing the page off-center in the
   panel. Collapse the whole sidebar so the page uses the full width. The redlines and
   comment markers stay inline in the document text. */
.ep-root .docx-unified-sidebar,
.ep-root .docx-comments-sidebar,
.ep-root .docx-comment-margin-markers,
.ep-root .docx-tracked-change-card { display: none !important; }
`;

function useThemeColorMode(): ThemeMode {
  return useSyncExternalStore(subscribeToTheme, getInitialThemeMode, getInitialThemeMode);
}

/**
 * In-artifact DOCX viewer/editor backed by @eigenpal/docx-editor-react (Apache-2.0).
 * Renders the real OOXML package (pagination, tables, tracked changes), scales the
 * page to the panel width, and persists edits through the panel's Save button.
 */
export function ArtifactDocxEditor({ name, content, author, readOnly = false, onSave, apiRef }: ArtifactDocxEditorProps) {
  const colorMode = useThemeColorMode();
  const resolvedAuthor = author ? normalizeDocumentAuthor(author) : readStoredDocumentAuthor();
  // Capture a private copy of the bytes once: the editor may detach the buffer while
  // parsing, and a save must not reload (and reset) the view. The parent remounts this
  // component (key={target.id}) when the artifact changes.
  const [documentBuffer] = useState(() => content.slice(0));
  // Default the comments column CLOSED so a redline doc gets the full panel width (the
  // open column was squeezing the page). Still toggleable; the fit re-runs when it opens.
  const [commentsSidebarOpen, setCommentsSidebarOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const editorRef = useRef<DocxEditorRef>(null);

  const pagesViewport = () =>
    containerRef.current?.querySelector(
      ".docx-editor__scroll-container, .docx-editor-vue__pages-viewport",
    ) as HTMLElement | null;

  const fitToWidth = useCallback(() => {
    const editor = editorRef.current;
    if (!editor) return;
    // Measure the actual PAGES viewport, not the whole editor: a redline doc shows a
    // comments column on the right that eats horizontal space. Using the viewport width
    // makes the page fit what's actually left for it. Fall back to the wrapper width.
    const viewport = pagesViewport();
    const areaWidth = viewport?.clientWidth ?? containerRef.current?.clientWidth ?? 0;
    const available = areaWidth - PAGE_MARGIN;
    if (available <= 0) return;

    const zoom = editor.getZoom() || 1;
    // Measure the real page element (.layout-page) and divide out the zoom to get its
    // true width (A4/Letter/custom). This is the one reliable page node — not the track
    // and not a table cell. Fall back to Letter width if it isn't rendered yet.
    let naturalWidth = FALLBACK_PAGE_WIDTH;
    const page = containerRef.current?.querySelector(".layout-page") as HTMLElement | null;
    if (page) {
      const measured = page.getBoundingClientRect().width / zoom;
      if (measured > 200) naturalWidth = measured;
    }

    const target = Math.max(0.2, Math.min(1, available / naturalWidth));
    if (Math.abs(target - zoom) > 0.005) editor.setZoom(target);
  }, []);

  // Measure the page's real left/right gap and correct the horizontal offset via a CSS
  // variable (the editor's own centering is off for redline layouts). Reset to 0 first so
  // we measure the true position, not the previously-corrected one.
  const centerPage = useCallback(() => {
    const container = containerRef.current;
    const sc = pagesViewport();
    const page = container?.querySelector(".layout-page") as HTMLElement | null;
    const editor = editorRef.current;
    if (!container || !sc || !page || !editor) return;
    container.style.setProperty("--docx-center-x", "0px");
    const scR = sc.getBoundingClientRect();
    const pr = page.getBoundingClientRect();
    const correction = ((scR.right - pr.right) - (pr.left - scR.left)) / 2;
    const zoom = editor.getZoom() || 1; // .layout-page is scaled by the zoom ancestor
    container.style.setProperty("--docx-center-x", Math.abs(correction) > 1.5 ? `${correction / zoom}px` : "0px");
  }, []);

  const applyFit = useCallback(() => {
    fitToWidth();
    requestAnimationFrame(centerPage);
  }, [fitToWidth, centerPage]);

  // Re-fit on resize of the panel AND the pages viewport (it shrinks when the comments
  // column opens), plus a few times on mount to catch late layout.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || typeof ResizeObserver === "undefined") return;
    let raf = 0;
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(applyFit);
    });
    observer.observe(container);
    let tries = 0;
    const attachViewport = () => {
      const viewport = pagesViewport();
      if (viewport) {
        observer.observe(viewport);
        applyFit();
      } else if (tries++ < 25) {
        window.setTimeout(attachViewport, 150);
      }
    };
    attachViewport();
    const timers = [150, 450, 900, 1500].map((ms) => window.setTimeout(applyFit, ms));
    return () => {
      observer.disconnect();
      cancelAnimationFrame(raf);
      timers.forEach((t) => window.clearTimeout(t));
    };
  }, [applyFit]);

  // Expose an explicit save to the panel header. `save()` returns the serialized bytes,
  // which we persist directly (not relying on the editor's internal onSave wiring).
  useEffect(() => {
    if (!apiRef) return;
    apiRef.current = {
      save: async () => {
        const buffer = await editorRef.current?.save({ selective: false });
        if (!buffer || !onSave) return false;
        await onSave(buffer);
        return true;
      },
    };
    return () => {
      if (apiRef.current) apiRef.current = null;
    };
  }, [apiRef, onSave]);

  return (
    <div ref={containerRef} className="h-full min-h-0 w-full overflow-hidden">
      <style>{DOCX_FIT_CSS}</style>
      <DocxEditor
        ref={editorRef}
        documentBuffer={documentBuffer}
        documentName={name}
        documentNameEditable={false}
        author={resolvedAuthor}
        mode={readOnly ? "viewing" : "editing"}
        colorMode={colorMode}
        showFileOpen={false}
        showHelpMenu={false}
        showOutlineButton={false}
        commentsSidebarOpen={commentsSidebarOpen}
        onCommentsSidebarOpenChange={setCommentsSidebarOpen}
        className="h-full"
        onFontsLoaded={applyFit}
      />
    </div>
  );
}
