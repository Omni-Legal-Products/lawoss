import { useMemo, useRef, useState, type ReactNode } from "react";
import { t } from "@/i18n";
import { setWikiPageHeading, wikiPageHeading } from "./wiki-page-heading";
import { WikiPropertiesEditor, type WikiPropertiesEditorProps } from "./wiki-properties-editor";

function EditableTitle({ title, onCommit }: { title: string; onCommit: (title: string) => void }) {
  const [draft, setDraft] = useState(title);
  const cancelled = useRef(false);
  return <textarea className="wiki-page-title-input" aria-label={t("wiki.page_title")} rows={1} value={draft} onChange={event => setDraft(event.target.value.replace(/[\r\n]/g, " "))} onBlur={() => {
    if (cancelled.current) { cancelled.current = false; return; }
    if (draft.trim()) onCommit(draft.trim()); else setDraft(title);
  }} onKeyDown={event => {
    if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
    if (event.key === "Escape") { cancelled.current = true; setDraft(title); event.currentTarget.blur(); }
  }} />;
}

export function WikiPageHeader(props: WikiPropertiesEditorProps & { fallbackTitle: string; toolbarRef?: (element: HTMLDivElement | null) => void; navigation?: ReactNode }) {
  const heading = useMemo(() => wikiPageHeading(props.content, props.fallbackTitle), [props.content, props.fallbackTitle]);
  return <header className="wiki-page-header" data-leading-heading={Boolean(heading.heading)}>
    {props.navigation}
    <div className="wiki-page-title-row">
      <h1 className="wiki-page-title">{props.readOnly ? heading.title : <EditableTitle key={heading.title} title={heading.title} onCommit={title => props.onChange(setWikiPageHeading(props.content, title))} />}</h1>
      {!props.readOnly && <div ref={props.toolbarRef} className="wiki-page-options" />}
    </div>
    <WikiPropertiesEditor {...props} />
  </header>;
}
