import { useCallback, useEffect, useMemo, useRef } from "react";
import {
  MDXEditor, type MDXEditorMethods, UndoRedo, BoldItalicUnderlineToggles,
  BlockTypeSelect, ListsToggle, CreateLink, InsertImage, InsertTable,
  InsertCodeBlock, InsertThematicBreak, Separator, DiffSourceToggleWrapper,
  headingsPlugin, listsPlugin, quotePlugin, linkPlugin, linkDialogPlugin,
  imagePlugin, tablePlugin, thematicBreakPlugin, frontmatterPlugin,
  codeBlockPlugin, codeMirrorPlugin, diffSourcePlugin, toolbarPlugin, markdownShortcutPlugin,
  useCellValue, viewMode$,
} from "@mdxeditor/editor";
import "@mdxeditor/editor/style.css";
import "./markdown-editor.css";
import { t } from "@/i18n";
import { restorePristineMarkdown, type PristineMarkdown } from "@/lawoss/markdown/pristine";

/** LAWOSS (#90): reports the editor view mode, so Undo mapping stays out of source edits. */
function ViewModeProbe({ onMode }: { onMode: (mode: string) => void }) {
  const mode = useCellValue(viewMode$);
  useEffect(() => onMode(mode), [mode, onMode]);
  return null;
}

type Props = {
  value: string;
  baseline: string;
  readOnly?: boolean;
  onChange: (value: string) => void;
  imageUpload: (file: File) => Promise<string>;
  imagePreview: (source: string) => Promise<string>;
};

export function ArtifactMarkdownEditor({ value, baseline, readOnly = false, onChange, imageUpload, imagePreview }: Props) {
  const editor = useRef<MDXEditorMethods>(null);
  const initial = useRef(value);
  const lastValue = useRef(value);
  // LAWOSS (#90): original bytes and their canonical form, to map Undo back to the original.
  const pristine = useRef<PristineMarkdown | null>(value === baseline ? { source: value, normalized: value } : null);
  const viewMode = useRef("rich-text");
  const setViewMode = useCallback((mode: string) => { viewMode.current = mode; }, []);
  const plugins = useMemo(() => [
    // AutoLink runs after initial normalization and dirties untouched files containing bare URLs.
    // Existing Markdown links and explicit CreateLink actions remain available.
    headingsPlugin(), listsPlugin(), quotePlugin(), linkPlugin({ disableAutoLink: true }), linkDialogPlugin(),
    imagePlugin({ imageUploadHandler: imageUpload, imagePreviewHandler: imagePreview }),
    tablePlugin(), thematicBreakPlugin(), frontmatterPlugin(),
    codeBlockPlugin({ defaultCodeBlockLanguage: "txt" }),
    codeMirrorPlugin({ codeBlockLanguages: { txt: "Text", js: "JavaScript", ts: "TypeScript", json: "JSON", python: "Python", sql: "SQL", bash: "Shell", mermaid: "Mermaid" } }),
    diffSourcePlugin({ viewMode: "rich-text", diffMarkdown: baseline }),
    markdownShortcutPlugin(),
    toolbarPlugin({ toolbarContents: () => (<>
      <ViewModeProbe onMode={setViewMode} />
      <DiffSourceToggleWrapper>
        <UndoRedo /><Separator /><BlockTypeSelect /><Separator />
        <BoldItalicUnderlineToggles options={["Bold", "Italic"]} /><ListsToggle />
        <Separator /><CreateLink /><InsertImage /><InsertTable /><InsertCodeBlock /><InsertThematicBreak />
      </DiffSourceToggleWrapper>
    </>) }),
  ], [baseline, imageUpload, imagePreview, setViewMode]);

  useEffect(() => {
    if (value === lastValue.current) return;
    lastValue.current = value;
    editor.current?.setMarkdown(value);
  }, [value]);

  return <MDXEditor
    ref={editor}
    className="lw-markdown-editor"
    contentEditableClassName="lw-markdown-page"
    markdown={initial.current}
    trim={false}
    readOnly={readOnly}
    plugins={plugins}
    placeholder={t("artifact.start_writing")}
    onChange={(markdown, initialNormalize) => {
      // Opening a file must not rewrite its original whitespace or bullet style.
      if (initialNormalize) {
        if (pristine.current?.source === initial.current) pristine.current = { source: initial.current, normalized: markdown };
        return;
      }
      const next = restorePristineMarkdown(markdown, pristine.current, viewMode.current);
      lastValue.current = next;
      onChange(next);
    }}
  />;
}
