import { lazy, Suspense, useCallback, useDeferredValue, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Search, SlidersHorizontal, X } from "lucide-react";
import type { WikiGraphData, WikiPage } from "@legalwork/types/wiki";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { wikiGraph } from "./wiki-model";
import { applyWikiGraphResponse, defaultGraphFilter, filterWikiGraph, indexWikiGraph, type WikiGraphFilter } from "./wiki-graph-data";
import { readGraphPreferences, saveGraphPreferences, type WikiGraphCamera } from "./wiki-graph-state";
import "./wiki-graph.css";

const WikiGraphCanvas = lazy(() => import("./wiki-graph-canvas"));
type Props = { pages: WikiPage[]; focus: string | null; onOpen: (path: string) => void; client?: LegalworkServerClient | null; wikiId?: string; serverUrl?: string };

export function WikiGraphPane(props: Props) {
  const key = `${props.serverUrl ?? "local"}:${props.wikiId ?? "wiki"}`;
  return <WikiGraphWorkspace {...props} storageKey={key} key={key} />;
}

function WikiGraphWorkspace(props: Props & { storageKey: string }) {
  const preferences = useMemo(() => readGraphPreferences(props.storageKey), [props.storageKey]);
  const [filter, setFilter] = useState(preferences.filter);
  const [settings, setSettings] = useState(false);
  const [search, setSearch] = useState("");
  const [focused, setFocused] = useState<string | null>(null);
  const deferredSearch = useDeferredValue(search.trim().toLocaleLowerCase());
  const deferredFilter = useDeferredValue(filter);
  const saved = useRef(preferences);
  const queryClient = useQueryClient();
  const queryKey = ["wiki-graph", props.serverUrl, props.wikiId];
  const query = useQuery({
    queryKey,
    enabled: Boolean(props.client && props.wikiId),
    queryFn: async () => {
      if (!props.client || !props.wikiId) throw new Error(t("wiki.offline"));
      const previous = queryClient.getQueryData<WikiGraphData>(queryKey);
      const response = await props.client.wikiGraph(props.wikiId, previous?.revision);
      try { return applyWikiGraphResponse(previous, response); }
      catch { return applyWikiGraphResponse(undefined, await props.client.wikiGraph(props.wikiId)); }
    },
    refetchInterval: 5_000,
    retry: false,
    // Large graph arrays are already reconciled by revision, do not deep-walk them on every unchanged poll.
    structuralSharing: false,
  });
  const fallback = useMemo<WikiGraphData>(() => {
    if (props.client && props.wikiId) return { revision: "loading", nodes: [], edges: [] };
    const graph = wikiGraph(props.pages, null);
    return {
      revision: "local",
      nodes: graph.pages.map((page) => ({ id: page.path, path: page.path, title: page.title, type: page.type })),
      edges: graph.edges.map((edge) => ({ id: JSON.stringify([edge.from, edge.to, edge.label]), source: edge.from, target: edge.to, relation: edge.label })),
    };
  }, [props.client, props.wikiId, props.pages]);
  const data = query.data ?? fallback;
  const index = useMemo(() => indexWikiGraph(data), [data]);
  const visible = useMemo(() => filterWikiGraph(index, deferredFilter, props.focus), [index, deferredFilter, props.focus]);
  const types = useMemo(() => [...new Set(data.nodes.map((node) => node.type))].sort(), [data]);
  const folders = useMemo(() => [...new Set(data.nodes.flatMap((node) => node.path.includes("/") ? [node.path.split("/")[0]] : []))].sort(), [data]);
  const matches = useMemo(() => {
    if (!deferredSearch) return [];
    const words = deferredSearch.split(/\s+/);
    const found = [];
    for (const node of visible.nodes) {
      if (words.every((word) => `${node.title} ${node.path}`.toLocaleLowerCase().includes(word))) found.push(node);
      if (found.length >= 15) break;
    }
    return found;
  }, [visible, deferredSearch]);
  const updateFilter = (patch: Partial<WikiGraphFilter>) => {
    const next = { ...filter, ...patch };
    setFilter(next);
    saved.current = { ...saved.current, filter: next };
    saveGraphPreferences(props.storageKey, saved.current);
  };
  const saveCamera = useCallback((camera: WikiGraphCamera) => {
    saved.current = { ...saved.current, camera };
    saveGraphPreferences(props.storageKey, saved.current);
  }, [props.storageKey]);

  return <div className="wiki-graph-workspace">
    <div className="wiki-graph-toolbar">
      <div className="wiki-graph-finder"><Search className="size-4" aria-hidden="true" /><input value={search} placeholder={t("wiki.graph_search")} aria-label={t("wiki.graph_search")} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => {
        if (event.key === "Escape") setSearch("");
        if (event.key === "Enter" && matches[0]) { setFocused(matches[0].id); setSearch(""); }
      }} />{search ? <button type="button" aria-label={t("wiki.graph_reset_filters")} onClick={() => setSearch("")}><X className="size-3.5" /></button> : null}
        {search ? <div className="wiki-graph-find-results" role="list" aria-label={t("wiki.graph_search")}>{matches.length ? matches.map((node) => <div key={node.id} role="listitem"><button type="button" onClick={() => { setFocused(node.id); setSearch(""); }} title={t("wiki.graph_focus")}><strong>{node.title}</strong><span>{node.path}</span></button><button type="button" className="wiki-graph-result-open" onClick={() => props.onOpen(node.path)}>{t("wiki.graph_open")}</button></div>) : <p>{t("wiki.graph_no_matches")}</p>}</div> : null}
      </div>
      <span className="wiki-graph-count">{t("wiki.graph_visible", { visible: visible.nodes.length, total: data.nodes.length })}</span>
      <Button variant={settings ? "secondary" : "ghost"} size="icon-sm" aria-label={t("wiki.graph_filters")} title={t("wiki.graph_filters")} aria-expanded={settings} onClick={() => setSettings(!settings)}><SlidersHorizontal /></Button>
    </div>
    <div className="wiki-graph-body">
      {settings ? <div className="wiki-graph-settings">
        <input value={filter.query} placeholder={t("wiki.graph_filter_pages")} aria-label={t("wiki.graph_filter_pages")} onChange={(event) => updateFilter({ query: event.target.value })} />
        <select value={filter.type} aria-label={t("wiki.graph_all_types")} onChange={(event) => updateFilter({ type: event.target.value })}><option value="">{t("wiki.graph_all_types")}</option>{types.map((type) => <option key={type} value={type}>{type}</option>)}</select>
        <select value={filter.folder} aria-label={t("wiki.graph_all_folders")} onChange={(event) => updateFilter({ folder: event.target.value })}><option value="">{t("wiki.graph_all_folders")}</option>{folders.map((folder) => <option key={folder} value={folder}>{folder}</option>)}</select>
        <label><input type="checkbox" checked={filter.local} disabled={!props.focus} onChange={(event) => updateFilter({ local: event.target.checked })} />{t("wiki.graph_local")}</label>
        {filter.local && props.focus ? <label className="wiki-graph-depth">{t("wiki.graph_depth")}<input type="range" min="1" max="5" value={filter.depth} onChange={(event) => updateFilter({ depth: Number(event.target.value) })} /><span>{filter.depth}</span></label> : null}
        <label><input type="checkbox" checked={filter.orphans} onChange={(event) => updateFilter({ orphans: event.target.checked })} />{t("wiki.graph_orphans")}</label>
        <Button variant="ghost" size="sm" onClick={() => updateFilter(defaultGraphFilter)}>{t("wiki.graph_reset_filters")}</Button>
      </div> : null}
      {query.error ? <div className="wiki-graph-empty" role="alert"><p>{query.error instanceof Error ? query.error.message : t("wiki.offline")}</p><Button variant="outline" onClick={() => void query.refetch()}>{t("wiki.retry")}</Button></div>
        : query.isLoading && props.client ? <div className="wiki-graph-empty">{t("wiki.loading")}</div>
          : visible.nodes.length === 0 ? <div className="wiki-graph-empty"><p>{data.nodes.length ? t("wiki.graph_no_matches") : t("wiki.graph_empty")}</p><p>{data.nodes.length ? t("wiki.graph_reset_filters") : t("wiki.graph_empty_hint")}</p></div>
            : <Suspense fallback={<div className="wiki-graph-empty">{t("wiki.loading")}</div>}><WikiGraphCanvas gpu={data.nodes.length > 5_000} data={visible} storageKey={props.storageKey} camera={preferences.camera} focused={focused} onOpen={props.onOpen} onCamera={saveCamera} /></Suspense>}
    </div>
  </div>;
}
