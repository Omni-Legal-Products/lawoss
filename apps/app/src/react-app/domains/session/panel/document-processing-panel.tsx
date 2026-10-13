import { documentExecutionDirectory } from "./native-document-preflight";
import { documentGenerationKey, getDocumentGeneration, isDocumentGenerationActive, reconcileDocumentGeneration, readDocumentGenerationSnapshot, isDocumentGenerationSnapshotCurrent, subscribeDocumentGenerations } from "./document-generation-lifecycle";
/** @jsxImportSource react */
import * as React from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import type { LegalworkServerClient, LawossOutputStatus } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { discoverDocumentSources, readDocumentWorkingDirectory, persistDocumentWorkingDirectory, documentClientIdentity, documentCoverage, documentOutputState, freshDocumentSources, listAllDocuments, type DocumentGenerationCallback, type FreshDocument } from "./document-processing";

export type DocumentProcessingPanelProps = {
  client: LegalworkServerClient; workspaceId: string; projectId: string; workspaceRoot: string;
  folder: string; selectedPaths: string[]; onSelectPaths: (paths: string[]) => void;
  fileVersion: string; active: boolean; isRemote: boolean; onGenerate?: DocumentGenerationCallback;
};

export function DocumentProcessingPanel(props: DocumentProcessingPanelProps) {
  const locale = useLocale();
  const queryClient = useQueryClient();
  const language = locale === "cs" || locale === "sk" ? locale : "en";
  const [busy, setBusy] = React.useState(false);
  const busyRef = React.useRef(false);
  const [error, setError] = React.useState<string | null>(null);
  const [readId, setReadId] = React.useState<string | null>(null);
  const projectKey = JSON.stringify([props.client.baseUrl, props.workspaceId, props.workspaceRoot]);
  const [caseDirectory, setCaseDirectory] = React.useState(() => props.isRemote ? "" : readDocumentWorkingDirectory(projectKey));
  const selection = [...props.selectedPaths].sort();
  const identity = [props.client.baseUrl, documentClientIdentity(props.client), props.workspaceId, props.workspaceRoot];
  const sourceKey = ["lawoss-documents", ...identity, selection, props.fileVersion];
  const sources = useQuery({
    queryKey: sourceKey,
    queryFn: async () => freshDocumentSources(props.client, props.workspaceId, selection, await listAllDocuments(props.client, props.workspaceId)),
    enabled: props.active && selection.length > 0,
    staleTime: 0, refetchInterval: props.active ? 2000 : false, refetchOnWindowFocus: "always",
  });
  const records = sources.data ?? [];
  const roots = records.filter(record => !record.provenance.parentId);
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
  const missingPaths = selection.filter(path => !roots.some(record => record.path === path));
  const coverage = documentCoverage(records, selection);
  const readsCurrent = !sources.isFetching && !sources.isError && records.length > 0 && records.every(record => record.freshness === "current");
  const current = missingPaths.length === 0 && readsCurrent;
  let generationDirectory: string;
  try {
    generationDirectory = documentExecutionDirectory(props.workspaceRoot, caseDirectory, props.isRemote).directory;
  } catch {
    generationDirectory = "";
  }
  const generationKey = documentGenerationKey({
    projectId: props.projectId,
    baseUrl: props.client.baseUrl,
    workspaceId: props.workspaceId,
    root: props.workspaceRoot,
    directory: generationDirectory,
  }, language, records);
  const binding = React.useSyncExternalStore(
    subscribeDocumentGenerations,
    () => getDocumentGeneration(generationKey),
    () => getDocumentGeneration(generationKey),
  );
  const lifecycle = useQuery({
    queryKey: ["lawoss-document-generation", ...identity, binding?.sessionId, binding?.startedAt],
    queryFn: () => readDocumentGenerationSnapshot(generationKey, async () => (await props.client.getSessionSnapshot(props.workspaceId, binding!.sessionId, { limit: 20 })).item),
    enabled: props.active && Boolean(binding),
    staleTime: 0,
    refetchInterval: props.active && binding ? 2000 : false,
    refetchOnWindowFocus: "always",
  });
  React.useEffect(() => {
    if (lifecycle.data && !lifecycle.isError && !lifecycle.isFetching) {
      reconcileDocumentGeneration(generationKey, lifecycle.data);
    }
  }, [generationKey, lifecycle.data, lifecycle.isError, lifecycle.isFetching]);
  const nativeSnapshotActive = !lifecycle.isError && Boolean(lifecycle.data && isDocumentGenerationSnapshotCurrent(binding, lifecycle.data)) && (lifecycle.data?.snapshot.status.type === "busy" || lifecycle.data?.snapshot.status.type === "retry");
  const generationActive = isDocumentGenerationActive(binding) || nativeSnapshotActive;
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["lawoss-documents", ...identity] }),
      queryClient.invalidateQueries({ queryKey: ["lawoss-document-outputs", ...identity] }),
      queryClient.invalidateQueries({ queryKey: ["workspace-files", props.workspaceId] }),
    ]);
  };
  const action = async (run: () => Promise<void>) => {
    if (busyRef.current) return;
    busyRef.current = true;
    setBusy(true);
    setError(null);
    try {
      await run();
      await refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
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
  const generate = (newGeneration: boolean) => action(async () => {
    const latest = await freshDocumentSources(props.client, props.workspaceId, selection, await listAllDocuments(props.client, props.workspaceId));
    const exactOriginalCoverage = selection.every(path => latest.some(record => !record.provenance.parentId && record.path === path));
    if (!exactOriginalCoverage || latest.some(record => record.freshness !== "current")) {
      throw new Error(t("documents.sources_changed"));
    }
    await props.onGenerate!({ projectId: props.projectId, caseDirectory, sources: latest, outputLanguage: language, newGeneration });
  });
  const sourceStatusLabel = (record: FreshDocument) => {
    if (sources.isFetching) return t("documents.checking");
    if (record.freshness !== "current") return t(`documents.${record.freshness}`);
    return t(`documents.status_${record.status}`);
  };
  const preparationActive = (record: FreshDocument) => record.status === "preparing" || record.status === "uploaded";
  const canCancelPreparation = (record: FreshDocument) => preparationActive(record) && !record.provenance.parentId;
  const readSource = (record: FreshDocument) => action(async () => {
    let offset: number | null = 0;
    let text = "";
    while (offset !== null) {
      const read = await props.client.readLawossDocument(props.workspaceId, record.id, offset);
      text += read.pages.map(page => `[${page.page ?? t("documents.text_source")}] ${page.text}`).join("\n");
      offset = read.nextOffset;
    }
    setReadId(record.id);
    setPreview({ id: record.id, hash: record.hash, text });
  });
  const validateOutput = (output: LawossOutputStatus) => action(async () => {
    const result = await props.client.validateLawossDocuments(props.workspaceId, {
      paths: [output.path],
      documentIds: output.documentIds,
      outputLanguage: output.outputLanguage,
    });
    setFailedValidation(previous => ({ ...previous, ...Object.fromEntries(result.outputs.map(item => [item.path, item.verified ? undefined : item.hash])) }));
    setValidationIssues(result.issues.map(issue => `${issue.path ?? output.path}: ${issue.message}`));
  });
  const outputStatusLabel = (output: LawossOutputStatus) => {
    if (outputs.isError) return t("documents.output_unavailable");
    if (outputs.isFetching || sources.isFetching) return t("documents.checking");
    if (!current) return t("documents.output_invalid");
    const failedCurrentValidation = !output.verified && failedValidation[output.path] !== undefined && failedValidation[output.path] === output.currentHash;
    return t(`documents.output_${failedCurrentValidation ? "invalid" : documentOutputState(output)}`);
  };
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
    {records.length ? <p>{t("documents.coverage", { sources: coverage.sources, readable: readsCurrent ? coverage.readablePages : 0, pages: coverage.pages })} · {coverage.complete && current ? t("documents.complete") : t("documents.incomplete")}</p> : null}
    {missingPaths.map(path => <div key={path} className="my-1 rounded border border-border p-1.5">
      <p className="break-all">{path}</p>
      <p>{t("documents.status_missing")}</p>
    </div>)}
    {records.map(record => <div key={record.id} className="my-1 rounded border border-border p-1.5">
      <p className="break-all">{record.path}{record.provenance.attachmentName ? ` → ${record.provenance.attachmentName}` : ""}</p>
      <p>{sourceStatusLabel(record)} · {readsCurrent && record.freshness === "current" ? record.readablePages : 0}/{record.pageCount}</p>
      {record.issue ? <p className="break-words text-muted-foreground">{record.issue}</p> : null}
      {canCancelPreparation(record) ? <Button size="sm" variant="ghost" disabled={busy} onClick={() => void action(async () => {
        await props.client.cancelLawossDocument(props.workspaceId, record.id);
      })}>{t("documents.cancel")}</Button> : !preparationActive(record) ? <Button size="sm" variant="ghost" disabled={busy || !current} onClick={() => void readSource(record)}>
        {t("documents.read")}
      </Button> : null}
    </div>)}
    {readId && previewRecord && current ? <pre className="max-h-40 overflow-auto whitespace-pre-wrap break-words">{preview?.text}</pre> : null}
    {!props.isRemote ? <label className="block">{t("documents.case_directory")}<input className="my-1 w-full rounded border border-border bg-background p-1" value={caseDirectory} onChange={event => {
      setCaseDirectory(event.target.value);
      persistDocumentWorkingDirectory(projectKey, event.target.value);
    }} placeholder={t("documents.root_directory")} /></label> : null}
    <Button size="sm" disabled={busy || !current || generationActive || lifecycle.isError || !props.onGenerate} onClick={() => void generate(binding?.phase === "completed")}>
      {binding?.phase === "error" ? t("documents.retry_generation") : binding?.phase === "completed" ? t("documents.new_generation") : t("documents.generate")}
    </Button>
    {generationActive ? <p role="status">{t("documents.run_active")}</p> : null}
    {binding?.phase === "completed" ? <p>{t("documents.run_completed")}</p> : null}
    {binding?.error ? <p role="alert" className="break-words text-destructive">{t("documents.send_failed", { message: binding.error })}</p> : null}
    <p className="mt-1 text-muted-foreground">{t("documents.not_legal_approval")}</p>
    {(outputs.data ?? []).map(output => <div key={output.path} className="mt-2 rounded border border-border p-1.5">
      <p className="break-all">{output.path}</p>
      <p>{outputStatusLabel(output)}</p>
      <Button size="sm" variant="outline" disabled={busy || !current || outputs.isFetching || outputs.isError} onClick={() => void validateOutput(output)}>
        {t("documents.validate")}
      </Button>
    </div>)}
    {validationIssues.map((issue, i) => <p key={i} className="break-words text-destructive">{issue}</p>)}
    {error || sources.error || outputs.error || lifecycle.error ? <p role="alert" className="mt-1 break-words text-destructive">{error ?? String(sources.error ?? outputs.error ?? lifecycle.error)}</p> : null}
  </section>;
}
