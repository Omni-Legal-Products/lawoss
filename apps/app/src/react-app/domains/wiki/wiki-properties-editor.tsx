import { useId, useMemo, useRef, useState } from "react";
import { AlignLeft, Braces, CalendarDays, CheckSquare2, ChevronDown, Hash, Link2, List, Plus, Tags, X } from "lucide-react";
import type { WikiPage } from "@legalwork/types/wiki";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Popover, PopoverContent, PopoverTitle, PopoverTrigger } from "@/components/ui/popover";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { t } from "@/i18n";
import { setWikiProperty, wikiPageRelations, wikiPropertyFields, wikiPropertyType, type WikiPropertyScalar, type WikiPropertyType, type WikiPropertyValue } from "./wiki-properties";
import { WikiPagePropertyPicker } from "./wiki-page-property-picker";
import { WikiPropertyValue as PropertyValue } from "./wiki-property-value";

export type WikiPropertiesEditorProps = { readOnly?: boolean; content: string; pages: WikiPage[]; path: string; onChange: (content: string) => void; onSource: () => void; onOpen: (path: string) => void };
const propertyKinds: WikiPropertyType[] = ["text", "number", "boolean", "date", "list", "page", "pages"];

function PropertyIcon({ kind, name }: { kind: WikiPropertyType | "complex"; name: string }) {
  const Icon = kind === "complex" ? Braces : kind === "boolean" ? CheckSquare2 : kind === "number" ? Hash : kind === "date" ? CalendarDays : kind === "page" || kind === "pages" ? Link2 : kind === "list" ? name === "tags" ? Tags : List : AlignLeft;
  return <Icon size={15} strokeWidth={1.6} aria-hidden="true" />;
}

function PropertyInput({ name, value, suggestions, compact, onCommit }: {
  name: string; value: WikiPropertyScalar; suggestions?: string[]; compact?: boolean; onCommit: (value: WikiPropertyScalar) => void;
}) {
  const id = useId();
  const text = value == null ? "" : String(value);
  const [draft, setDraft] = useState(text);
  const cancelled = useRef(false);
  const kind = wikiPropertyType(value);
  if (typeof value === "boolean") return <input aria-label={name} type="checkbox" checked={value} onChange={event => onCommit(event.target.checked)} className="wiki-property-checkbox" />;
  const commit = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    if (draft === text) return;
    if (typeof value === "number") {
      if (!draft.trim() || !Number.isFinite(Number(draft))) { setDraft(text); return; }
      onCommit(Number(draft));
    } else onCommit(draft);
  };
  return <><input aria-label={name} className="wiki-property-input" type={kind === "number" ? "number" : kind === "date" ? "date" : "text"} step={kind === "number" ? "any" : undefined} list={suggestions?.length && kind === "text" ? id : undefined} placeholder={t("wiki.property_empty")} style={compact && kind !== "date" ? { width: `calc(${Math.max(2, draft.length || t("wiki.property_empty").length)}ch + 14px)` } : undefined} value={draft} onChange={event => setDraft(event.target.value)} onBlur={commit} onKeyDown={event => {
    if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); }
    if (event.key === "Escape") { cancelled.current = true; setDraft(text); event.currentTarget.blur(); }
  }} />{suggestions?.length ? <datalist id={id}>{suggestions.map(option => <option key={option} value={option} />)}</datalist> : null}</>;
}

function PropertyList({ name, values, onCommit }: { name: string; values: WikiPropertyScalar[]; onCommit: (values: WikiPropertyScalar[]) => void }) {
  const [draft, setDraft] = useState("");
  const cancelled = useRef(false);
  const add = () => {
    if (cancelled.current) { cancelled.current = false; return; }
    if (!draft.trim()) return;
    onCommit([...values, draft.trim()]);
    setDraft("");
  };
  return <div className="wiki-property-list">
    {values.map((value, index) => <span className="wiki-property-chip" key={JSON.stringify([index, value])}>
      <PropertyInput compact name={`${name} ${index + 1}`} value={value} onCommit={next => onCommit(values.map((item, i) => i === index ? next : item))} />
      <button type="button" className="wiki-property-remove" aria-label={`${t("common.remove")}: ${value ?? t("wiki.property_empty")}`} onClick={() => onCommit(values.filter((_, i) => i !== index))}><X size={12} /></button>
    </span>)}
    <input className="wiki-property-input wiki-property-list-add" aria-label={`${t("wiki.property_add_value")}: ${name}`} placeholder={t("wiki.property_add_value")} value={draft} onChange={event => setDraft(event.target.value)} onBlur={add} onKeyDown={event => {
      if (event.key === "Enter") { event.preventDefault(); add(); }
      if (event.key === "Escape") { cancelled.current = true; setDraft(""); event.currentTarget.blur(); }
    }} />
  </div>;
}

export function WikiPropertiesEditor(props: WikiPropertiesEditorProps) {
  const propertyLabels: Record<WikiPropertyType, string> = {
    text: t("wiki.property_text"),
    number: t("wiki.property_number"),
    boolean: t("wiki.property_boolean"),
    date: t("wiki.property_date"),
    list: t("wiki.property_list"),
    page: t("wiki.property_page"),
    pages: t("wiki.property_pages"),
  };
  const heading = useId();
  const nameId = useId();
  const typeId = useId();
  const parsed = useMemo(() => wikiPropertyFields(props.content), [props.content]);
  const content = useRef(props.content);
  content.current = props.content;
  const [expanded, setExpanded] = useState(false);
  const [adding, setAdding] = useState(false);
  const [name, setName] = useState("");
  const [kind, setKind] = useState<WikiPropertyType>("text");
  const [newRelation, setNewRelation] = useState<string | string[] | null>(null);
  const [relationKinds, setRelationKinds] = useState<Record<string, "page" | "pages">>({});
  const [error, setError] = useState<string | null>(null);
  const suggestions = useMemo(() => {
    const result = new Map<string, Set<string>>();
    for (const page of props.pages) for (const [key, value] of Object.entries(page.properties)) {
      if (typeof value !== "string") continue;
      const values = result.get(key) ?? new Set<string>();
      if (values.size < 100) values.add(value);
      result.set(key, values);
    }
    return result;
  }, [props.pages]);
  const update = (key: string, value: WikiPropertyValue) => {
    try { content.current = setWikiProperty(content.current, key, value); props.onChange(content.current); setError(null); return true; }
    catch (error) { setError(error instanceof Error ? error.message : String(error)); return false; }
  };
  const fields = parsed.fields.filter(field => field.key !== "title");
  const compact = fields.filter(field => !["id", "demo_fixture", "synthetic"].includes(field.key) && !field.key.endsWith("_id")).slice(0, 4);
  const visible = expanded ? fields : compact;
  return <section className="wiki-properties wiki-properties-editor" aria-labelledby={heading}>
    <h2 id={heading} className="sr-only">{t("wiki.properties")}</h2>
    {parsed.error ? <div className="wiki-property-error">{t("wiki.properties_invalid")}{!props.readOnly && <Button type="button" variant="ghost" size="sm" onClick={props.onSource}>{t("wiki.edit_source")}</Button>}</div> : <>
      <div className="wiki-property-rows">{visible.map(field => {
        const relationKey = `${props.path}\0${field.key}`;
        const fieldKind = field.editable ? relationKinds[relationKey] ?? wikiPropertyType(field.value) : "complex";
        const relationValue = wikiPageRelations(field.value) ? field.value : null;
        return <div key={field.key} className="wiki-property-row" data-property-type={fieldKind}>
          <div className="wiki-property-name" title={field.key}><PropertyIcon kind={fieldKind} name={field.key} /><span>{field.key.replace(/_/g, " ")}</span></div>
          <div className="wiki-property-value">{props.readOnly ? field.editable ? <PropertyValue value={field.value} pages={props.pages} fromPath={props.path} onOpen={props.onOpen} /> : <code className="break-words text-xs">{field.source}</code> : !field.editable ? <button type="button" className="wiki-property-source" onClick={props.onSource} title={field.source}>{t("wiki.edit_source")}</button>
            : fieldKind === "page" || fieldKind === "pages" ? <WikiPagePropertyPicker name={field.key} value={relationValue} multiple={fieldKind === "pages"} pages={props.pages} path={props.path} onOpen={props.onOpen} onChange={value => { setRelationKinds(current => ({ ...current, [relationKey]: fieldKind })); update(field.key, value); }} />
            : Array.isArray(field.value) ? <PropertyList name={field.key} values={field.value} onCommit={values => update(field.key, values)} />
            : <PropertyInput key={JSON.stringify([field.key, field.value])} name={field.key} value={field.value} suggestions={[...(suggestions.get(field.key) ?? [])]} onCommit={value => update(field.key, value)} />}
          </div>
        </div>;
      })}</div>
      <div className="wiki-property-actions">
      {fields.length > compact.length && <button type="button" className="wiki-property-expand" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><ChevronDown size={14} />{expanded ? t("wiki.properties_show_less") : t("wiki.properties_show_all", { count: fields.length })}</button>}
      {!props.readOnly && <Popover open={adding} onOpenChange={open => {
        setAdding(open);
        if (open) { setName(""); setKind("text"); setNewRelation(null); setError(null); }
      }}>
        <PopoverTrigger render={<button type="button" className="wiki-property-add" />}><Plus size={15} strokeWidth={1.6} />{t("wiki.add_property")}</PopoverTrigger>
        <PopoverContent align="start" sideOffset={8} className="w-[min(320px,calc(100vw-32px))] gap-0 rounded-xl bg-popover p-0 shadow-lg">
          <form className="flex flex-col gap-4 p-4" onSubmit={event => {
        event.preventDefault();
        if (!name.trim() || parsed.fields.some(field => field.key === name.trim())) return;
        const value = kind === "number" ? 0 : kind === "boolean" ? false : kind === "date" ? new Date().toISOString().slice(0, 10) : kind === "list" ? [] : kind === "page" || kind === "pages" ? newRelation : "";
        if (update(name.trim(), value)) {
          if (kind === "page" || kind === "pages") setRelationKinds(current => ({ ...current, [`${props.path}\0${name.trim()}`]: kind }));
          setName(""); setNewRelation(kind === "pages" ? [] : null); setAdding(false);
        }
          }}>
            <PopoverTitle className="text-sm font-medium">{t("wiki.add_property")}</PopoverTitle>
            <div className="grid gap-1.5">
              <label htmlFor={nameId} className="text-xs text-muted-foreground">{t("wiki.property_name")}</label>
              <Input id={nameId} autoFocus autoComplete="off" placeholder={t("wiki.property_name")} className="h-9 rounded-lg text-sm" value={name} onChange={event => setName(event.target.value)} />
            </div>
            <div className="grid gap-1.5">
              <label htmlFor={typeId} className="text-xs text-muted-foreground">{t("wiki.property_type")}</label>
              <Select value={kind} items={propertyKinds.map(value => ({ value, label: propertyLabels[value] }))} onValueChange={value => { if (value) { setKind(value); setNewRelation(value === "pages" ? [] : null); } }}>
                <SelectTrigger id={typeId} className="w-full gap-2 rounded-lg bg-background"><PropertyIcon kind={kind} name={name} /><SelectValue /></SelectTrigger>
                <SelectContent align="start" className="rounded-xl p-1">
                  {propertyKinds.map(value => <SelectItem key={value} value={value} className="rounded-lg py-2 text-sm font-normal"><PropertyIcon kind={value} name={name} />{propertyLabels[value]}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            {(kind === "page" || kind === "pages") && <WikiPagePropertyPicker name={name || t("wiki.property_name")} value={newRelation} multiple={kind === "pages"} pages={props.pages} path={props.path} onOpen={props.onOpen} onChange={setNewRelation} />}
            {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button size="sm" variant="ghost" type="button" onClick={() => setAdding(false)}>{t("common.cancel")}</Button>
              <Button size="sm" type="submit" disabled={!name.trim() || parsed.fields.some(field => field.key === name.trim())}>{t("wiki.add_property")}</Button>
            </div>
          </form>
        </PopoverContent>
      </Popover>}
      </div>
    </>}{error && !adding && <div role="alert" className="wiki-property-error"><span>{error}</span><Button type="button" size="sm" variant="ghost" onClick={props.onSource}>{t("wiki.edit_source")}</Button></div>}
  </section>;
}
