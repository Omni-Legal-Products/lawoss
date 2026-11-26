/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import type { FolderIntake, IntakeCase } from "@legalwork/types/folder-intake";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import type { Language } from "@/i18n";
import { freshDocumentSources, listAllDocuments, type DocumentGenerationCallback } from "@/react-app/domains/session/panel/document-processing";
import { intakeCopy } from "./intake-copy";

export function readIntakeAnswer(snapshot: Awaited<ReturnType<LegalworkServerClient["getSessionSnapshot"]>>["item"], paths: string[]): IntakeCase[] | undefined {
  const turn = snapshot.messages.filter(m => m.info.role === "assistant" && !m.info.summary).at(-1);
  if (turn?.info.role !== "assistant") return;
  if (turn.info.error) throw new Error(JSON.stringify(turn.info.error));
  if (!turn.info.time.completed || !turn.info.finish || ["tool-calls", "unknown"].includes(turn.info.finish)) return;
  const text = turn.parts.flatMap(p => p.type === "text" ? [p.text] : []).join("").trim().replace(/^```(?:json)?\s*|\s*```$/giu, "");
  const values: unknown = JSON.parse(text);
  if (!Array.isArray(values) || values.length > 100) throw new Error("Invalid case list.");
  return values.map(v => {
    if (!v || typeof v.title !== "string" || !v.title.trim() || typeof v.source !== "string" || !paths.includes(v.source)) throw new Error("Invalid case source.");
    return { title: v.title, source: v.source, ...(typeof v.phase === "string" && { phase: v.phase }), ...(typeof v.next_step === "string" && { next_step: v.next_step }) };
  });
}

export function IntakeAi({ client, workspaceId, projectId, data, generate, locale, save }: {
  client: LegalworkServerClient; workspaceId: string; projectId: string; data: FolderIntake; locale: Language;
  generate?: DocumentGenerationCallback; save: (cases: IntakeCase[]) => Promise<void>;
}) {
  const current = useRef<AbortController | null>(null);
  useEffect(() => () => current.current?.abort(), [workspaceId, projectId, data.run]);
  const label = intakeCopy[locale];
  const model = generate?.model;
  const [open, setOpen] = useState(false);
  const [paths, select] = useState<string[]>([]);
  const [profile, setProfile] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const key = JSON.stringify(["lawoss-intake", client.baseUrl, workspaceId, projectId]);
  const [binding, bind] = useState<{ session: string; paths: string[]; hashes: (string | undefined)[]; started?: number } | null>(() => {
    try { return JSON.parse(sessionStorage.getItem(key) || "null"); } catch { return null; }
  });
  useEffect(() => { if (binding) setOpen(true); }, [binding]);
  const profiles = useQuery({ queryKey: ["intake-profiles", key, model], enabled: !!model && open,
    queryFn: () => client.listLawossDocumentProfiles(workspaceId, { providerId: model!.providerID, modelId: model!.modelID, caseDirectory: "" }), retry: false });
  const answer = useQuery({ queryKey: ["intake-answer", key, binding?.session], enabled: !!binding, retry: false,
    queryFn: async ({signal}) => {
      if (binding?.started && Date.now() - binding.started > 30 * 60_000) throw new Error(label.issues);
      const snapshot = (await client.getSessionSnapshot(workspaceId, binding!.session, { limit: 100, signal })).item;
      return readIntakeAnswer(snapshot, binding!.paths) ?? null;
    }, refetchInterval: q => q.state.data == null && !q.state.error ? 1800 : false });
  const [accepted, setAccepted] = useState(false);
  const run = async () => {
    if (!generate || busy) return;
    const controller = new AbortController();
    current.current?.abort();
    current.current = controller;
    setBusy(true); setError("");
    try {
      for (let i = 0; i < paths.length; i += 10) { controller.signal.throwIfAborted(); await client.prepareLawossDocuments(workspaceId, paths.slice(i, i + 10)); }
      const until = Date.now() + 300_000;
      let records = await listAllDocuments(client, workspaceId);
      while (records.some(r => paths.includes(r.provenance.sourcePath) && ["uploaded", "preparing"].includes(r.status))) {
        controller.signal.throwIfAborted();
        if (Date.now() > until) throw new Error(label.preparing);
        await new Promise(r => setTimeout(r, 800)); records = await listAllDocuments(client, workspaceId);
      }
      const sources = await freshDocumentSources(client, workspaceId, paths, records);
      if (!paths.every(path => sources.some(s => s.path === path && s.hash === data.sources.find(f => f.path === path)?.hash)) ||
          sources.some(s => s.freshness !== "current" || s.status !== "readable")) throw new Error(label.issues);
      controller.signal.throwIfAborted();
      const session = await generate({ projectId, caseDirectory: "", outputLanguage: locale === "de" ? "en" : locale, sources, profileId: profile, purpose: "folder-intake", newGeneration: true });
      const next = { session, paths, started: Date.now(), hashes: paths.map(path => data.sources.find(f => f.path === path)?.hash) };
      sessionStorage.setItem(key, JSON.stringify(next)); bind(next); setAccepted(false);
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); } finally { setBusy(false); }
  };
  const working = busy || Boolean(binding && answer.data == null && !answer.error);
  const available = profiles.data?.syntheticReviewAvailable || profiles.data?.profiles.some(p => p.id === profile);
  return <details open={open} onToggle={e => setOpen(e.currentTarget.open)} className="text-sm">
    <summary className="cursor-pointer font-medium">{label.analyze}</summary>
    {open && <div className="mt-3 space-y-3">
      {model ? <><p>{label.model} · {model.providerID} / {model.modelID}</p><fieldset disabled={working}><legend>{label.choose}</legend>
        <div className="mt-2 max-h-40 overflow-auto">{data.sources.filter(f => f.hash && f.state !== "unreadable").map(f => <label key={f.path} className="flex items-start gap-2 py-1"><input type="checkbox" checked={paths.includes(f.path)} onChange={e => select(e.target.checked ? [...paths, f.path] : paths.filter(p => p !== f.path))}/><span className="break-all">{f.path}</span></label>)}</div></fieldset>
        {!!profiles.data?.profiles.length && <label>{label.profile} <select value={profile} onChange={e => setProfile(e.target.value)}><option value="">…</option>{profiles.data.profiles.map(p => <option key={p.id} value={p.id}>{p.legalProfileId} · {p.scope.matterId}</option>)}</select></label>}
        {(profiles.data && !available || profiles.isError) && <p>{profiles.error?.message || label.noProfile}</p>}
        <Button size="sm" disabled={working || !paths.length || !available} onClick={() => void run()}>{label.start}</Button></> : <p>{label.noModel}</p>}
      {working && <p role="status">{busy ? label.preparing : label.running}</p>}
      {answer.data && !accepted && (answer.data.length ? <div><ul>{answer.data.map(c => <li key={c.title + c.source}>{c.title} · {c.source}</li>)}</ul>
        <Button disabled={busy || binding?.paths.some((p,i) => data.sources.find(f => f.path === p)?.hash !== binding.hashes[i])} onClick={async () => { setBusy(true); try { await save(answer.data!); setAccepted(true); sessionStorage.removeItem(key); bind(null); } catch(e) { setError(String(e)); } finally { setBusy(false); } }}>{label.preview}</Button></div> : <p>{label.noCases}</p>)}
      {(error || answer.error) && <p role="alert">{error || answer.error?.message}</p>}
    </div>}
  </details>;
}
