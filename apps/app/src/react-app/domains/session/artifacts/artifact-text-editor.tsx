/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { markdown } from "@codemirror/lang-markdown";
import { bracketMatching, foldGutter, foldKeymap, HighlightStyle, indentOnInput, LanguageSupport, syntaxHighlighting } from "@codemirror/language";
import { lintGutter, linter, lintKeymap, openLintPanel } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { Annotation, Compartment, EditorState } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { cn } from "@/lib/utils";
import { codeLanguage } from "./code-language";
import { codeDiagnostics, codeLanguageSupport, hasCodeDiagnostics } from "./code-editor-language";
import "./code-editor.css";

const externalUpdate = Annotation.define<boolean>();
const highlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.modifier], class: "lw-code-keyword" },
  { tag: [tags.string, tags.regexp], class: "lw-code-string" },
  { tag: [tags.number, tags.bool, tags.null], class: "lw-code-number" },
  { tag: [tags.comment, tags.meta], class: "lw-code-comment" },
  { tag: [tags.function(tags.variableName), tags.tagName], class: "lw-code-function" },
  { tag: [tags.typeName, tags.className, tags.attributeName], class: "lw-code-type" },
  { tag: tags.invalid, class: "lw-code-invalid" },
]);

type ArtifactTextEditorProps = {
  className?: string;
  value: string;
  language: "markdown" | "text";
  name?: string;
  readOnly?: boolean;
  onSave?: () => void;
  onChange: (value: string) => void;
};

export function ArtifactTextEditor(props: ArtifactTextEditorProps) {
  const rootRef = useRef<HTMLDivElement>(null);
  const viewRef = useRef<EditorView | null>(null);
  const latest = useRef(props);
  latest.current = props;
  const [position, setPosition] = useState({ line: 1, column: 1 });
  const [issues, setIssues] = useState<number | null>(null);
  const readOnlyCompartment = useRef(new Compartment());
  const languageName = codeLanguage(props.name ?? "");

  useEffect(() => {
    const root = rootRef.current;
    if (!root) return;
    let disposed = false;
    setIssues(null);
    const support = props.language === "markdown" ? markdown() : codeLanguageSupport(languageName);
    const language = support instanceof LanguageSupport ? support.language : support;
    const view = new EditorView({
      parent: root,
      state: EditorState.create({
        doc: latest.current.value,
        extensions: [
          readOnlyCompartment.current.of([EditorState.readOnly.of(Boolean(latest.current.readOnly)), EditorView.editable.of(!latest.current.readOnly)]),
          EditorView.contentAttributes.of({ "aria-label": t("code_editor.label", { name: props.name ?? t("code_editor.plain_text") }) }),
          lineNumbers(), history(), drawSelection(), highlightActiveLine(), highlightActiveLineGutter(),
          indentOnInput(), bracketMatching(), closeBrackets(), autocompletion(), foldGutter(), highlightSelectionMatches(),
          keymap.of([
            { key: "Mod-s", preventDefault: true, run: () => { if (!latest.current.readOnly) latest.current.onSave?.(); return true; } },
            ...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...foldKeymap, ...completionKeymap, ...lintKeymap, indentWithTab,
          ]),
          support ?? [], syntaxHighlighting(highlight),
          languageName ? [] : EditorView.lineWrapping,
          language && languageName && hasCodeDiagnostics(languageName) ? [
            lintGutter(),
            linter(editor => {
              const diagnostics = codeDiagnostics(editor.state.doc.toString(), languageName, language);
              if (!disposed) setIssues(diagnostics.length);
              return diagnostics;
            }),
          ] : [],
          EditorView.updateListener.of(update => {
            if (update.docChanged && !update.transactions.every(transaction => transaction.annotation(externalUpdate))) {
              latest.current.onChange(update.state.doc.toString());
            }
            if (update.docChanged || update.selectionSet) {
              const head = update.state.selection.main.head;
              const line = update.state.doc.lineAt(head);
              setPosition({ line: line.number, column: head - line.from + 1 });
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => { disposed = true; view.destroy(); viewRef.current = null; };
  }, [props.language, props.name, languageName]);

  useEffect(() => {
    viewRef.current?.dispatch({ effects: readOnlyCompartment.current.reconfigure([
      EditorState.readOnly.of(Boolean(props.readOnly)), EditorView.editable.of(!props.readOnly),
    ]) });
  }, [props.readOnly]);

  useEffect(() => {
    const view = viewRef.current;
    if (!view || view.state.doc.toString() === props.value) return;
    view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: props.value }, annotations: externalUpdate.of(true) });
  }, [props.value]);

  return <div className={cn("lw-code-editor flex h-full min-h-0 flex-col overflow-hidden", props.className)}>
    <div ref={rootRef} className="min-h-0 flex-1 overflow-hidden" />
    <div className="flex shrink-0 items-center gap-3 border-t border-border px-3 py-1 text-xs text-muted-foreground">
      <span>{languageName ?? (props.language === "markdown" ? "Markdown" : t("code_editor.plain_text"))}</span>
      {issues !== null && <Button size="sm" variant="ghost" className="h-6 px-1 text-xs" onClick={() => { if (viewRef.current) openLintPanel(viewRef.current); }}>
        {issues ? t("code_editor.issues", { count: issues }) : t("code_editor.syntax_ok")}
      </Button>}
      <span className="ms-auto tabular-nums">{t("code_editor.position", position)}</span>
      {props.readOnly && <span>{t("storage.read_only")}</span>}
    </div>
  </div>;
}
