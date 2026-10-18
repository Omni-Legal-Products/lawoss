import { useRef, useState } from "react";
import { ChevronDown, MessageSquare, MessageSquarePlus } from "lucide-react";
import type { WorkspaceSessionGroup } from "@/app/types";
import { getDisplaySessionTitle } from "@/app/lib/session-title";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";

export type WikiChatHistoryProps = { group?: WorkspaceSessionGroup; selectedSessionId?: string | null; onOpen: (id: string) => void };
export function WikiChatHistory({ group, selectedSessionId, onOpen, stateKey, onNewChat, busy }: WikiChatHistoryProps & { stateKey: string; onNewChat: () => void; busy: boolean }) {
  const [expanded, setExpanded] = useState(true);
  const [search, setSearch] = useState("");
  const section = useRef<HTMLElement>(null);
  const drag = useRef<{ y: number; height: number } | null>(null);
  const storageKey = `legalwork.wiki.chats.height.${stateKey}`;
  const [height, setHeight] = useState<number | null>(() => {
    try { const saved = Number(localStorage.getItem(storageKey)); return Number.isFinite(saved) && saved > 0 ? saved : null; } catch { return null; }
  });
  const resize = (value: number) => {
    const next = Math.max(minimumHeight, Math.min(value, (section.current?.parentElement?.clientHeight ?? 600) * 0.6));
    setHeight(next);
    try { localStorage.setItem(storageKey, String(next)); } catch { /* Resizing also works without storage. */ }
  };
  const sessions = (group?.sessions ?? []).filter(session => !session.parentID && !session.time?.archived);
  const visible = sessions.filter(session => getDisplaySessionTitle(session.title).toLocaleLowerCase().includes(search.toLocaleLowerCase())).sort((a, b) => (b.time?.updated ?? 0) - (a.time?.updated ?? 0));
  const showSearch = sessions.length > 5 || Boolean(search);
  const minimumHeight = 54 + 36 + (showSearch ? 40 : 0);
  const defaultHeight = 54 + Math.max(1, Math.min(3, sessions.length)) * 36 + (showSearch ? 40 : 0);
  const displayHeight = Math.max(minimumHeight, height ?? defaultHeight);
  return <section ref={section} className="relative flex max-h-[60%] shrink-0 flex-col border-t p-2" style={{ height: expanded ? displayHeight : undefined, minHeight: expanded ? minimumHeight : undefined }} aria-label={t("wiki.chats")}>
    {expanded && <div role="separator" tabIndex={0} aria-orientation="horizontal" aria-label={t("wiki.resize_chats")} aria-valuemin={minimumHeight} aria-valuemax={Math.round(Math.max(minimumHeight, (section.current?.parentElement?.clientHeight ?? 600) * 0.6))} aria-valuenow={Math.round(displayHeight)} className="absolute -top-1 inset-x-0 z-10 h-2 cursor-row-resize touch-none hover:bg-primary/20 focus-visible:bg-primary/20"
      onPointerDown={event => { drag.current = { y: event.clientY, height: section.current?.clientHeight ?? defaultHeight }; event.currentTarget.setPointerCapture(event.pointerId); event.preventDefault(); }}
      onPointerMove={event => { if (drag.current) resize(drag.current.height + drag.current.y - event.clientY); }}
      onPointerUp={event => { drag.current = null; event.currentTarget.releasePointerCapture(event.pointerId); }} onPointerCancel={() => { drag.current = null; }}
      onDoubleClick={() => { setHeight(null); try { localStorage.removeItem(storageKey); } catch { /* Optional preference. */ } }}
      onKeyDown={event => { if (event.key === "ArrowUp" || event.key === "ArrowDown") { event.preventDefault(); resize((section.current?.clientHeight ?? defaultHeight) + (event.key === "ArrowUp" ? 36 : -36)); } }} />}
    <div className="flex shrink-0 items-center gap-1"><button className="wiki-nav-row flex-1" aria-expanded={expanded} onClick={() => setExpanded(value => !value)}><MessageSquare size={15} /><span className="flex-1 text-left">{t("wiki.chats")}{group?.status === "ready" || sessions.length ? ` · ${sessions.length}` : ""}</span><ChevronDown size={14} className={expanded ? "rotate-180" : ""} /></button><Button size="icon-sm" variant="ghost" disabled={busy} title={t("session.new_task")} aria-label={t("session.new_task")} onClick={onNewChat}><MessageSquarePlus size={16} /></Button></div>
    {expanded && <>
      {showSearch && <Input type="search" className="my-1 h-8 shrink-0" value={search} onChange={event => setSearch(event.target.value)} placeholder={t("wiki.search_chats")} aria-label={t("wiki.search_chats")} />}
      <div className="min-h-0 flex-1 overflow-y-auto">
        {visible.map(session => <button key={session.id} className="wiki-nav-row w-full text-left aria-[current=true]:bg-accent" aria-current={session.id === selectedSessionId} onClick={() => onOpen(session.id)} title={getDisplaySessionTitle(session.title)}><span className="truncate">{getDisplaySessionTitle(session.title)}</span></button>)}
        {!visible.length && <p className="px-2 py-2 text-xs text-muted-foreground">{group?.status === "error" ? group.error : group?.status === "loading" || !group ? t("wiki.loading") : search ? <>{t("wiki.no_matching_chats")} <button className="underline underline-offset-2" onClick={() => setSearch("")}>{t("wiki.clear_chat_search")}</button></> : t("wiki.no_chats")}</p>}
      </div>
    </>}
  </section>;
}
