/** @jsxImportSource react */
import { FileText, FolderSearch, FolderTree, RefreshCw, Download } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { LegalworkServerClient, LegalworkWorkspaceDirectoryEntry, LegalworkWorkspaceDirectoryList } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { IntakeCase } from "@legalwork/types/folder-intake";
import type { DocumentGenerationCallback } from "@/react-app/domains/session/panel/document-processing";
import { intakeCopy } from "./intake-copy";
import { IntakeAi } from "./intake-ai";
import { organizeFolderLink } from "./links";

const preferred = ["index.md", "_status.md", "status.md", "readme.md", "agents.md", "claude.md"];

export function summarizeFolder(listing: LegalworkWorkspaceDirectoryList) {
  const visible = listing.entries.filter(entry => !entry.name.startsWith(".") && !entry.name.startsWith("~$"));
  const files = visible.filter(entry => entry.kind === "file");
  const markdown = files.filter(entry => /\.md$/i.test(entry.name));
  const rank = (entry: LegalworkWorkspaceDirectoryEntry) => {
    const index = preferred.indexOf(entry.name.toLowerCase());
    return index < 0 ? preferred.length : index;
  };
  const documents = markdown.sort((a, b) => rank(a) - rank(b) || (b.updatedAt ?? 0) - (a.updatedAt ?? 0) || a.name.localeCompare(b.name)).slice(0, 4);
  return { files: files.length, folders: visible.length - files.length, markdown: markdown.length, documents };
}

export function ClientFolderPanel({ root, projectId, workspaceId, client, generate, onOpen, onRefresh }: {
  root: string; projectId: string; workspaceId: string; client: LegalworkServerClient; generate?: DocumentGenerationCallback;
  listing?: LegalworkWorkspaceDirectoryList; onOpen: (entry: LegalworkWorkspaceDirectoryEntry) => void; onRefresh: () => Promise<void>;
}) {
  const locale = useLocale(), label = intakeCopy[locale];
  const queries = useQueryClient();
  const key = ["client-folder-intake", client.baseUrl, workspaceId, root];
  const [busy, setBusy] = useState(false), [error, setError] = useState("");
  const [shown, setShown] = useState(25), [filter, setFilter] = useState("");
  const query = useQuery({ queryKey: key, queryFn: ({signal}) => client.clientFolderIntake(workspaceId, { action: "open" }, signal),
    retry: false, refetchOnWindowFocus: false, refetchInterval: q => q.state.data?.state === "scanning" ? 900 : false });
  const data = query.data;
  const notified = useRef("");
  useEffect(() => {
    if (data?.state === "ready" && notified.current !== data.run) {
      notified.current = data.run;
      void queries.invalidateQueries({ queryKey: ["okf-overview"] });
    }
  }, [data?.state, data?.run, queries]);
  const refresh = async () => {
    setBusy(true); setError("");
    try {
      await queries.cancelQueries({ queryKey: key });
      queries.setQueryData(key, await client.clientFolderIntake(workspaceId, { action: "refresh" }));
      await onRefresh();
    } catch(e) { setError(String(e)); } finally { setBusy(false); }
  };
  const save = async (cases: IntakeCase[]) => {
    if (!data) return;
    queries.setQueryData(key, await client.clientFolderIntake(workspaceId, { action: "save", run: data.run, cases }));
    await onRefresh();
  };
  const download = () => {
    if (!data) return;
    const lines = ["# " + (root.split(/[\\/]/u).pop() || label.files), "", "## " + label.cases, ...data.cases.map(c => "- " + c.title + " (" + c.source + ")" + (c.phase ? " · " + c.phase : "")), "", "## " + label.files, ...data.sources.map(f => "- " + f.path + " · " + (f.state === "indexed" ? label.indexed : f.state === "partial" ? label.partial : label.skipped) + (f.excerpt ? "\n  " + f.excerpt : ""))];
    const href = URL.createObjectURL(new Blob([lines.join("\n")], {type:"text/markdown;charset=utf-8"}));
    const a = document.createElement("a"); a.href = href; a.download = "PREHLAD-LAWOSS.md"; a.click(); setTimeout(() => URL.revokeObjectURL(href), 1000);
  };
  const [term, setTerm] = useState("");
  useEffect(() => { const timer = setTimeout(() => setTerm(filter.trim()), 250); return () => clearTimeout(timer); }, [filter]);
  const matches = useQuery({queryKey:["client-intake-search", ...key, data?.run, term], enabled: !!term && data?.state === "ready",
    queryFn: ({signal}) => client.searchClientFolderIntake(workspaceId, data!.run, term, signal), retry:false});
  const sources = term ? matches.data ?? [] : data?.sources ?? [];
  const highlights = data?.sources.filter(f => f.excerpt && !/(^|\/)(agents|claude|gemini|matter|spis|client|klient)\.md$/iu.test(f.path)).slice(0,3) ?? [];
  const scanning = !query.error && (!data || data.state === "scanning");
  return <section aria-label={t("lawoss.lite.folder_sources", locale)} className="space-y-4 rounded-xl border border-border/60 bg-card p-4">
    <header className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="flex items-center gap-2 text-sm font-semibold"><FolderSearch aria-hidden size={17} />{t("lawoss.lite.folder_sources", locale)}</h2>
      <Button variant="ghost" size="sm" disabled={busy || data?.state === "scanning"} onClick={() => void refresh()}><RefreshCw aria-hidden className={scanning ? "motion-safe:animate-spin" : ""}/>{t("lawoss.lite.folder_refresh", locale)}</Button>
    </header>
    <p className="break-all text-xs text-muted-foreground" title={root}>{root}</p>
    {scanning && <p role="status">{label.scan}… {data?.files || ""}</p>}
    {data && <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{([[label.files, data.files], [label.indexed, data.indexed], [label.partial, data.partial], [label.skipped, data.skipped]] as const).map(([name, count]) =>
      <div key={name} className="rounded-lg bg-muted/40 px-3 py-2"><div className="text-lg font-semibold tabular-nums">{count}</div><span className="text-xs text-muted-foreground">{name}</span></div>)}</div>}
    {data?.state === "ready" && <>
      <p className="text-sm">{data.cases.length ? label.cases + " · " + data.cases.length + " / " + label.saved + " · " + data.registered : label.empty}</p>
      {data.cases.length > data.registered && <Button size="sm" disabled={busy} onClick={async () => { setBusy(true); try { await save([]); } catch(e) { setError(String(e)); } finally { setBusy(false); } }}>{label.save} ({data.cases.length})</Button>}
      {!!data.suggestions.length && <div className="space-y-2"><h3 className="text-sm font-medium">{label.issues}</h3>{data.suggestions.map(c => <div key={c.source} className="flex flex-wrap items-center justify-between gap-2 rounded-lg border p-2 text-sm"><div className="min-w-0"><p>{c.title}</p><small className="break-all">{c.source}</small></div><Button size="sm" variant="outline" disabled={busy} onClick={async () => { setBusy(true); try { await save([c]); } catch(e) { setError(String(e)); } finally { setBusy(false); } }}>{label.save}</Button></div>)}</div>}
      {highlights.length > 0 && <div className="grid gap-2 sm:grid-cols-2">{highlights.map(f => <button key={f.path} className="min-w-0 rounded-lg border border-border/60 p-3 text-left hover:bg-muted/40" onClick={() => onOpen({path:f.path,name:f.path.split("/").at(-1)!,kind:"file"})}><span className="block truncate text-sm font-semibold">{f.path.split("/").at(-1)}</span><span className="mt-1 line-clamp-3 block text-xs leading-relaxed text-muted-foreground">{f.excerpt}</span></button>)}</div>}
      <details className="border-t border-border/50 pt-3 text-sm"><summary className="cursor-pointer font-medium">{label.detail} ({data.files})</summary>
        <input type="search" maxLength={200} className="my-2 w-full rounded border px-2 py-1" aria-label={label.files} placeholder={label.files} value={filter} onChange={e => {setFilter(e.target.value); setShown(25);}}/>
        {matches.error && <p role="alert">{matches.error.message}</p>}
        <ul className="max-h-64 overflow-auto">{sources.slice(0,shown).map(f => <li key={f.path} className="border-b border-border/40 py-2">
          <button className="flex items-start gap-2 text-left font-medium" onClick={() => onOpen({path:f.path, name:f.path.split("/").at(-1)!, kind:"file"})}><FileText size={15} className="mt-0.5 shrink-0"/><span className="break-all">{f.path}</span></button>
          <p className="mt-1 text-xs text-muted-foreground">{f.state === "indexed" ? label.indexed : f.state === "partial" ? label.partial : label.skipped}{f.excerpt && " · " + f.excerpt}</p></li>)}</ul>
        {sources.length > shown && <Button size="sm" variant="ghost" onClick={() => setShown(shown + 50)}>+ {Math.min(50, sources.length-shown)}</Button>}
      </details>
      <IntakeAi key={data.run} client={client} workspaceId={workspaceId} projectId={projectId} generate={generate} data={data} locale={locale} save={save}/>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" onClick={download}><Download/>{label.download}</Button>
        <Button size="sm" variant="ghost" nativeButton={false} render={<Link to={organizeFolderLink(root)}/>}><FolderTree/>{t("lawoss.lite.folder_organize",locale)}</Button></div>
    </>}
    {data?.issues.length ? <details className="text-xs"><summary>{label.issues} ({data.issues.length})</summary><ul>{data.issues.map((issue,i) => <li key={i}>{issue}</li>)}</ul></details> : null}
    {(error || query.error || data?.state === "failed") && <p role="alert" className="text-sm text-destructive">{label.error} · {error || query.error?.message || data?.issues.at(-1)}</p>}
  </section>;
}
