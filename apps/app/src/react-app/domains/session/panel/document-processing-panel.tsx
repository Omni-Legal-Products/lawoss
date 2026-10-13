/** @jsxImportSource react */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LegalworkServerClient, LawossOutputStatus } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { discoverDocumentSources, documentClientIdentity, documentCoverage, documentOutputState, freshDocumentSources, listAllDocuments, type DocumentGenerationCallback } from "./document-processing";

export type DocumentProcessingPanelProps = {
  client: LegalworkServerClient; workspaceId: string; projectId: string; workspaceRoot: string;
  folder: string; selectedPaths: string[]; onSelectPaths: (paths: string[]) => void;
  fileVersion: string; active: boolean; isRemote: boolean; onGenerate?: DocumentGenerationCallback;
};

export function DocumentProcessingPanel(props: DocumentProcessingPanelProps) {
  const locale = useLocale(), queryClient = useQueryClient();
  const language = locale === "cs" || locale === "sk" ? locale : "en";
  const [busy, setBusy] = React.useState(false), busyRef = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [readId, setReadId] = React.useState<string | null>(null);
  const [caseDirectory, setCaseDirectory] = React.useState("");
  const selection = [...props.selectedPaths].sort();
  const identity = [props.client.baseUrl, documentClientIdentity(props.client), props.workspaceId, props.workspaceRoot];
  const sourceKey = ["lawoss-documents", ...identity, selection, props.fileVersion];
  const sources = useQuery({
    queryKey: sourceKey,
    queryFn: async () => freshDocumentSources(props.client, props.workspaceId, selection, await listAllDocuments(props.client, props.workspaceId)),
    enabled: props.active && selection.length > 0,
    staleTime: 0, refetchInterval: props.active ? 2000 : false, refetchOnWindowFocus: "always",
  });
  const records = sources.data ?? [], roots = records.filter(r => !r.provenance.parentId);
  const rootIds = roots.map(r => r.id).sort();
  const outputs = useQuery({
    queryKey: ["lawoss-document-outputs", ...identity, rootIds, props.fileVersion],
    queryFn: async () => {
      const results: LawossOutputStatus[] = [];
      for (let offset: number | null = 0; offset !== null;) {
        const result = await props.client.listLawossOutputs(props.workspaceId, offset);
        results.push(...result.outputs);
        if (result.nextOffset !== null && result.nextOffset <= offset) throw new Error(t("documents.refresh_failed"));
        offset = result.nextOffset;
      }
      return results.filter(output => output.documentIds.length > 0 && output.documentIds.every(id => rootIds.includes(id)));
    },
    enabled: props.active && rootIds.length > 0,
    staleTime: 0, refetchInterval: props.active ? 2000 : false, refetchOnWindowFocus: "always",
  });
  const coverage = documentCoverage(records);
  const current = !sources.isFetching && !sources.isError && records.length > 0 && records.every(r => r.freshness === "current");
  const pendingSession = React.useRef<string | null>(null);
  const generationIdentity = JSON.stringify([identity, selection, caseDirectory, language, roots.map(r => [r.id, r.hash])]);
  const previousIdentity = React.useRef(generationIdentity);
  if (previousIdentity.current !== generationIdentity) { pendingSession.current = null; previousIdentity.current = generationIdentity; }
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["lawoss-documents", ...identity] }),
      queryClient.invalidateQueries({ queryKey: ["lawoss-document-outputs", ...identity] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-files", props.workspaceId] }),
    ]);
  };
  const action = async (run: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true; setBusy(true); setError(null);
    try { await run(); await refresh(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)); }
    finally { busyRef.current = false; setBusy(false); }
  };
  const prepare = (paths: string[]) => action(async () => {
    if (!paths.length) throw new Error(t("documents.no_sources"));
    if (paths.length > 20) throw new Error(t("documents.folder_limit"));
    props.onSelectPaths(paths);
    await props.client.prepareLawossDocuments(props.workspaceId, paths);
  });
  const [validationIssues, setValidationIssues] = React.useState<string[]>([]);
  const [failedValidation, setFailedValidation] = React.useState<Record<string, string | null | undefined>>({});
  const [preview, setPreview] = React.useState<{ id: string; hash: string; text: string } | null>(null);
  const previewRecord = records.find(r => r.id === preview?.id && r.hash === preview.hash && r.freshness === "current");
  return <section aria-label={t("documents.title")} className="max-h-[50%] shrink-0 overflow-auto border-b border-border px-3 py-2 text-xs">
    <p className="font-semibold">{t("documents.title")}</p>
    <p className="text-muted-foreground">{t("documents.selected", { count: selection.length })}</p>
    <div className="my-2 flex flex-wrap gap-1">
      <Button size="sm" variant="outline" disabled={busy || !selection.length} onClick={() => void prepare(selection)}>{t("documents.prepare")}</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void action(async () => {
        const paths = await discoverDocumentSources(props.client, props.workspaceId, props.folder);
        props.onSelectPaths(paths); await props.client.prepareLawossDocuments(props.workspaceId, paths);
      })}>{t("documents.prepare_folder")}</Button>
      <Button size="sm" variant="outline" disabled={busy} onClick={() => void action(refresh)}>{t("documents.refresh")}</Button>
    </div>
    <p className="text-muted-foreground">{t("documents.folder_note")}</p>
    {sources.isFetching ? <p role="status">{t("documents.checking")}</p> : null}
    {records.length ? <p>{t("documents.coverage", { sources: coverage.sources, readable: current ? coverage.readablePages : 0, pages: coverage.pages })} · {coverage.complete && current ? t("documents.complete") : t("documents.incomplete")}</p> : null}
    {records.map(record => <div key={record.id} className="my-1 rounded border border-border p-1.5">
      <p className="break-all">{record.path}{record.provenance.attachmentName ? ` → ${record.provenance.attachmentName}` : ""}</p>
      <p>{sources.isFetching ? t("documents.checking") : record.freshness === "current" ? t(`documents.status_${record.status}`) : t(`documents.${record.freshness}`)} · {current && record.freshness === "current" ? record.readablePages : 0}/{record.pageCount}</p>
      {record.issue ? <p className="break-words text-muted-foreground">{record.issue}</p> : null}
      {record.status === "preparing" || record.status === "uploaded" ? !record.provenance.parentId ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(async () => { await props.client.cancelLawossDocument(props.workspaceId, record.id); })}>{t("documents.cancel")}</Button> : null : <Button size="sm" variant="ghost" disabled={busy || !current} onClick={() => void action(async () => {
        let offset: number | null = 0, text = "";
        while (offset !== null) {
          const read = await props.client.readLawossDocument(props.workspaceId, record.id, offset);
          text += read.pages.map(page => `[${page.page ?? t("documents.text_source")}] ${page.text}`).join("\n");
          offset = read.nextOffset;
        }
        setReadId(record.id); setPreview({ id: record.id, hash: record.hash, text });
      })}>{t("documents.read")}</Button>}
    </div>)}
    {readId && previewRecord && current ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{preview?.text}</pre> : null}
    {!props.isRemote ? <label className="block">{t("documents.case_directory")}<input className="my-1 w-full rounded border border-border bg-background p-1" value={caseDirectory} onChange={event => setCaseDirectory(event.target.value)} placeholder={t("documents.root_directory")} /></label> : null}
    <Button size="sm" disabled={busy || !current || roots.length !== selection.length || !props.onGenerate} onClick={() => void action(async () => {
      // Verify again at click time; a persisted list or model message cannot authorize generation.
      const latest = await freshDocumentSources(props.client, props.workspaceId, selection, await listAllDocuments(props.client, props.workspaceId));
      if (latest.some(r => r.freshness !== "current") || latest.filter(r => !r.provenance.parentId).length !== selection.length) throw new Error(t("documents.sources_changed"));
      try {
        await props.onGenerate!({ projectId: props.projectId, caseDirectory, sources: latest, outputLanguage: language, retrySessionId: pendingSession.current });
        pendingSession.current = null;
      } catch (cause) {
        if (cause && typeof cause === "object" && "sessionId" in cause && typeof cause.sessionId === "string") pendingSession.current = cause.sessionId;
        throw cause;
      }
    })}>{pendingSession.current ? t("documents.retry_generation") : t("documents.generate")}</Button>
    <p className="mt-1 text-muted-foreground">{t("documents.not_legal_approval")}</p>
    {(outputs.data ?? []).map(output => <div key={output.path} className="mt-2 rounded border border-border p-1.5">
      <p className="break-all">{output.path}</p>
      <p>{outputs.isFetching || sources.isFetching ? t("documents.checking") : !current ? t("documents.output_invalid") : t(`documents.output_${!output.verified && failedValidation[output.path] !== undefined && failedValidation[output.path] === output.currentHash ? "invalid" : documentOutputState(output)}`)}</p>
      <Button size="sm" variant="outline" disabled={busy || !current || outputs.isFetching} onClick={() => void action(async () => {
        const result = await props.client.validateLawossDocuments(props.workspaceId, { paths: [output.path], documentIds: output.documentIds, outputLanguage: output.outputLanguage });
        setFailedValidation(previous => ({ ...previous, ...Object.fromEntries(result.outputs.map(item => [item.path, item.verified ? undefined : item.hash])) }));
        setValidationIssues(result.issues.map(issue => `${issue.path ?? output.path}: ${issue.message}`));
      })}>{t("documents.validate")}</Button>
    </div>)}
    {validationIssues.map((issue, i) => <p key={i} className="break-words text-destructive">{issue}</p>)}
    {error || sources.error || outputs.error ? <p role="alert" className="mt-1 break-words text-destructive">{error ?? String(sources.error ?? outputs.error)}</p> : null}
  </section>;
}
