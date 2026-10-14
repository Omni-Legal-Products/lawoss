import { createContext, useContext, useId, useRef, useState } from "react";
import { activeEditor$, linkDialogState$, updateLink$, useCellValues, usePublisher, type EditLinkDialog } from "@mdxeditor/editor";
import { Link, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { t } from "@/i18n";
import { ArtifactIcon } from "../session/artifacts/artifact-icon";
import { classifyOpenTarget } from "../session/artifacts/open-target";

export type WikiLinkTarget = { path: string; title: string };
export const WikiLinkTargetsContext = createContext<WikiLinkTarget[]>([]);

export function WikiLinkDialog() {
  const [state] = useCellValues(linkDialogState$);
  // Ordinary link clicks navigate. Editing is explicit through the link button or Cmd/Ctrl+K.
  return state.type === "edit" ? <WikiLinkForm state={state} /> : <></>;
}

function WikiLinkForm({ state }: { state: EditLinkDialog }) {
  const targets = useContext(WikiLinkTargetsContext);
  const [editor] = useCellValues(activeEditor$);
  const changeState = usePublisher(linkDialogState$);
  const update = usePublisher(updateLink$);
  const id = useId();
  const input = useRef<HTMLInputElement>(null);
  const [search, setSearch] = useState(/^https?:|^mailto:|^tel:/i.test(state.url) ? state.url : "");
  const [text, setText] = useState(state.text);
  const [selected, setSelected] = useState(0);
  const query = search.trim().toLocaleLowerCase();
  const matches = targets.filter(target => `${target.title} ${target.path}`.toLocaleLowerCase().includes(query)).slice(0, 60);
  const external = /^(?:https?:\/\/|mailto:|tel:)\S+$/i.test(search.trim());
  const close = () => { changeState({ type: "inactive" }); editor?.focus(); };
  const insert = (url: string, label: string) => {
    update({ url, text: state.withAnchorText ? text.trim() || label : undefined, title: state.title });
    close();
  };
  const choose = (target: WikiLinkTarget) => insert(`#wiki:${encodeURIComponent(target.path)}`, target.title);
  return <Dialog open onOpenChange={open => { if (!open) close(); }}>
    <DialogContent initialFocus={input} finalFocus={false} className="sm:max-w-lg gap-4">
      <DialogHeader><DialogTitle>{t("wiki.link.title")}</DialogTitle><DialogDescription>{t("wiki.link.description")}</DialogDescription></DialogHeader>
      <form className="grid min-w-0 gap-4" onSubmit={event => { event.preventDefault(); if (external) insert(search.trim(), search.trim()); else if (matches[selected]) choose(matches[selected]); }}>
        <div className="relative">
          <Search className="absolute left-3 top-3 size-4 text-muted-foreground" />
          <Input ref={input} aria-label={t("wiki.link.search")} placeholder={t("wiki.link.search")} className="pl-9" value={search} onChange={event => { setSearch(event.target.value); setSelected(0); }} onKeyDown={event => {
            if (event.key !== "ArrowDown" && event.key !== "ArrowUp") return;
            event.preventDefault();
            setSelected(index => Math.max(0, Math.min(matches.length - 1, index + (event.key === "ArrowDown" ? 1 : -1))));
          }} />
        </div>
        {!external && <div className="max-h-64 overflow-y-auto -mx-1" aria-label={t("wiki.link.results")}>
          {matches.map((target, index) => <button type="button" key={target.path} aria-label={`${target.title}, ${target.path}`} className={`flex w-full items-center gap-3 rounded-lg px-3 py-2 text-left hover:bg-accent ${index === selected ? "bg-accent" : ""}`} onMouseEnter={() => setSelected(index)} onClick={() => choose(target)} ref={element => { if (index === selected) element?.scrollIntoView({ block: "nearest" }); }}>
            <ArtifactIcon type={classifyOpenTarget(target.path, "file")} className="size-5 shrink-0" />
            <span className="min-w-0"><span className="block truncate text-sm font-medium">{target.title}</span><span className="block truncate text-xs text-muted-foreground">{target.path}</span></span>
          </button>)}
          {!matches.length && <p className="px-3 py-6 text-sm text-muted-foreground">{t("wiki.link.empty")}</p>}
        </div>}
        {state.withAnchorText && <div className="grid gap-2"><label htmlFor={`${id}-text`} className="text-xs text-muted-foreground">{t("wiki.link.text")}</label><Input id={`${id}-text`} value={text} onChange={event => setText(event.target.value)} placeholder={t("wiki.link.text_placeholder")} /></div>}
        <DialogFooter><Button type="button" variant="ghost" onClick={close}>{t("common.cancel")}</Button><Button type="submit" disabled={!external && !matches.length}><Link />{t("wiki.link.insert")}</Button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}
