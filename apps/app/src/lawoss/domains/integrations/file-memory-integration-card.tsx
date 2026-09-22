/** @jsxImportSource react */
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { LegalworkWorkspaceMemoryStatus } from "@/app/lib/legalwork-server";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { workspaceSettingsRoute } from "@/react-app/shell/workspace-routes";
import { checkMemoryProfile, loadMemoryProfile, previewMemoryProfile, saveMemoryProfile, MEMORY_PROFILE_PATH, type MemoryProfileClient, type MemoryProfileSnapshot, type WorkspaceMemoryProfile } from "../../okf/workspace-memory-profile";

type Props = { client: MemoryProfileClient | null; workspaceId: string | null; workspacePath: string; workspaceName: string; remote?: boolean };
const message = (error: unknown) => error instanceof Error ? error.message : String(error);

export function FileMemoryIntegrationCard(props: Props) {
  return <section className="space-y-4 rounded-xl border border-dls-border bg-dls-surface p-5" aria-label="Súborová pamäť spisu">
    <div><h3 className="text-lg font-semibold">Súborová pamäť spisu</h3><p className="text-sm text-muted-foreground">Pripojte existujúce súbory pamäte k vybranému spisu. Uloženie mapovania nevytvára kartu ani neudeľuje prístup.</p></div>
    {!props.client || !props.workspaceId || !props.workspacePath || props.remote ? <p>Vyberte pripojený lokálny workspace spisu. Vzdialený workspace tu nemožno upravovať.</p>
      : <MemoryProfileLoader key={`${props.workspaceId}:${props.workspacePath}`} client={props.client} workspaceId={props.workspaceId} workspacePath={props.workspacePath} workspaceName={props.workspaceName} />}
  </section>;
}
function MemoryProfileLoader({ client, workspaceId, workspacePath, workspaceName }: Required<Omit<Props, "remote" | "client" | "workspaceId">> & { client: MemoryProfileClient; workspaceId: string }) {
  const [loaded, setLoaded] = useState<{ snapshot: MemoryProfileSnapshot; writable: boolean } | null>(null);
  const [error, setError] = useState("");
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let cancelled = false; setLoaded(null); setError("");
    Promise.all([loadMemoryProfile(client, workspaceId), client.capabilities()]).then(([snapshot, capabilities]) => {
      if (!cancelled) setLoaded({ snapshot, writable: capabilities.config.write });
    }).catch((failure: unknown) => { if (!cancelled) setError(message(failure)); });
    return () => { cancelled = true; };
  }, [client, workspaceId, reload]);
  return <>
    <p className="break-all text-sm">{workspaceName} · {workspacePath}</p>
    {error ? <div role="alert"><p>{error}</p><Button variant="outline" onClick={() => setReload(v => v + 1)}>Načítať znova</Button></div>
      : loaded ? <MemoryProfileEditor key={reload} client={client} workspaceId={workspaceId} initial={loaded.snapshot} writable={loaded.writable} onReload={() => setReload(v => v + 1)} />
        : <p role="status">Načítavam profil pamäte…</p>}
  </>;
}

export function MemoryProfileEditor({ client, workspaceId, initial, writable, onReload }: { client: MemoryProfileClient; workspaceId: string; initial: MemoryProfileSnapshot; writable: boolean; onReload: () => void }) {
  const [snapshot, setSnapshot] = useState(initial);
  const [draft, setDraft] = useState(initial.profile);
  const [status, setStatus] = useState<LegalworkWorkspaceMemoryStatus | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const pending = useRef(false);
  const dirty = JSON.stringify(draft) !== JSON.stringify(snapshot.profile) || snapshot.content === null;
  let preview = "", validation = "";
  try { preview = previewMemoryProfile(draft); } catch (failure) { validation = message(failure); }
  async function run(save: boolean) {
    if (pending.current || save && (!writable || validation)) return;
    pending.current = true; setBusy(true); setError(""); setNotice(""); setStatus(null);
    try {
      if (save) {
        const next = await saveMemoryProfile(client, workspaceId, snapshot, draft);
        setSnapshot(next); setDraft(next.profile);
        setNotice("Mapovanie uložené. Spustite kontrolu súborov a oprávnení.");
      } else setStatus(await checkMemoryProfile(client, workspaceId, snapshot));
    } catch (failure) { setError(message(failure)); }
    finally { pending.current = false; setBusy(false); }
  }
  return <div className="space-y-4">
    <p className="break-all text-xs text-muted-foreground">{MEMORY_PROFILE_PATH} · {snapshot.content === null ? "nové mapovanie existujúcich súborov" : "načítaný profil"}</p>
    {!writable ? <p role="status">Toto pripojenie povoľuje iba čítanie. Uloženie je zablokované.</p> : null}
    <fieldset disabled={!writable || busy} className="space-y-4">
      <label className="block space-y-1">Identita spisu<Input value={draft.matterId} onChange={e => setDraft({ ...draft, matterId: e.target.value })} /></label>
      <h4 className="font-medium">Korene mapované profilom</h4>
      {draft.roots.map((root, index) => <div key={index} className="grid gap-2 sm:grid-cols-2">
        <label>ID koreňa {index + 1}<Input value={root.id} onChange={e => setDraft({ ...draft, roots: draft.roots.map((r, i) => i === index ? { ...r, id: e.target.value } : r) })} /></label>
        <label>Cesta koreňa {index + 1}<Input value={root.path} onChange={e => setDraft({ ...draft, roots: draft.roots.map((r, i) => i === index ? { ...r, path: e.target.value } : r) })} /></label>
        <Button variant="outline" onClick={() => setDraft({ ...draft, roots: draft.roots.filter((_, i) => i !== index) })}>Odstrániť koreň {index + 1}</Button>
      </div>)}
      <Button variant="outline" onClick={() => setDraft({ ...draft, roots: [...draft.roots, { id: "", path: "" }] })}>Pridať koreň</Button>
      <h4 className="font-medium">Existujúce súbory</h4>
      {draft.sources.map((source, index) => <SourceFields key={index} source={source} index={index} roots={draft.roots} change={value => setDraft({ ...draft, sources: draft.sources.map((s, i) => i === index ? value : s) })} remove={() => setDraft({ ...draft, sources: draft.sources.filter((_, i) => i !== index) })} />)}
      <Button variant="outline" onClick={() => setDraft({ ...draft, sources: [...draft.sources, { id: "", root: draft.roots[0]?.id ?? "", path: "", role: "evidence", required: false, writable: false }] })}>Pridať súbor</Button>
    </fieldset>
    <p role="status">{validation ? `Neplatné mapovanie: ${validation}` : "Štruktúra profilu je platná. Dostupnosť súborov a oprávnenia overí až kontrola uloženého profilu."}</p>
    <details><summary className="cursor-pointer font-medium">Náhľad JSON a zmien</summary>
      <div className="grid gap-3 lg:grid-cols-2"><div><p>Pred uložením</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{snapshot.content ?? "Profil zatiaľ neexistuje."}</pre></div><div><p>Po uložení</p><pre className="max-h-72 overflow-auto whitespace-pre-wrap break-all text-xs">{preview || JSON.stringify(draft, null, 2)}</pre></div></div>
    </details>
    <div className="flex flex-wrap gap-2">
      <Button disabled={!writable || busy || !dirty || Boolean(validation)} onClick={() => void run(true)}>Uložiť mapovanie</Button>
      <Button variant="outline" disabled={busy || snapshot.content === null} onClick={() => void run(false)}>Kontrola uloženého profilu</Button>
      <Button variant="outline" disabled={busy} onClick={onReload}>Zahodiť úpravy a načítať znova</Button>
    </div>
    {notice ? <p role="status">{notice}</p> : null}{error ? <p role="alert">{error} Pri konflikte načítajte profil znova; zmeny sa neprepíšu vynútene.</p> : null}
    <MemoryPreflight status={status} dirty={dirty} />
    <Link className="text-sm underline" to={workspaceSettingsRoute(workspaceId, "permissions")}>Spravovať oprávnenia priečinkov</Link>
  </div>;
}
function SourceFields({ source, index, roots, change, remove }: { source: WorkspaceMemoryProfile["sources"][number]; index: number; roots: WorkspaceMemoryProfile["roots"]; change: (value: WorkspaceMemoryProfile["sources"][number]) => void; remove: () => void }) {
  const roles: WorkspaceMemoryProfile["sources"][number]["role"][] = ["case_memory", "case_card", "work_note", "task_log", "rules", "lessons", "source_index", "evidence"];
  return <div className="space-y-2 rounded-lg border p-3"><p className="text-sm font-medium">Súbor {index + 1}</p><div className="grid gap-2 sm:grid-cols-2">
    <label>ID zdroja<Input value={source.id} onChange={e => change({ ...source, id: e.target.value })} /></label>
    <label>Koreň zdroja<select className="h-9 w-full rounded-md border bg-background px-2" value={source.root} onChange={e => change({ ...source, root: e.target.value })}><option value="">Vyberte koreň</option>{!roots.some(r => r.id === source.root) && source.root ? <option value={source.root}>Chýba: {source.root}</option> : null}{roots.map((r, i) => <option key={i} value={r.id}>{r.id || "Bez ID"}</option>)}</select></label>
    <label>Cesta súboru voči koreňu<Input value={source.path} onChange={e => change({ ...source, path: e.target.value })} /></label>
    <label>Rola<select className="h-9 w-full rounded-md border bg-background px-2" value={source.role} onChange={e => { const role = roles.find(r => r === e.target.value); if (role) change({ ...source, role }); }}>{roles.map(role => <option key={role} value={role}>{role}</option>)}</select></label>
  </div><label className="block">Identifikačné kotvy (jedna na riadok)<Textarea value={source.anchors?.join("\n") ?? ""} onChange={e => change({ ...source, anchors: e.target.value === "" ? [] : e.target.value.split("\n") })} /></label>
    <div className="flex flex-wrap gap-4"><label><input type="checkbox" checked={source.required} onChange={e => change({ ...source, required: e.target.checked })} /> Povinný</label><label><input type="checkbox" checked={source.writable} onChange={e => change({ ...source, writable: e.target.checked })} /> Zapisovateľný</label><Button variant="outline" onClick={remove}>Odstrániť súbor</Button></div>
  </div>;
}
export function MemoryPreflight({ status, dirty }: { status: LegalworkWorkspaceMemoryStatus | null; dirty: boolean }) {
  return <div className="space-y-2 rounded-lg border p-3">
    <h4 className="font-medium">Kontrola súborov a hostiteľské oprávnenia</h4>
    <p role="status">{dirty ? "Neuložený návrh nie je overený. Kontrola sa týka iba uloženého profilu." : !status ? "Uložený profil ešte nebol overený." : status.complete ? "Pamäť je pripravená podľa poslednej kontroly." : "Pamäť nie je úplná."}</p>
    {status ? <><p className="text-xs">Kontrola: {status.loadedAt} · identita: {status.matterId ?? "neznáma"}</p>
      <p>Hostiteľom povolené externé korene (runtime):</p>{status.grants.folders.length ? <ul>{status.grants.folders.map(path => <li className="break-all" key={path}>{path}</li>)}</ul> : <p>Žiadne externé korene nie sú povolené.</p>}
      {status.grants.hiddenCount > 0 ? <p role="alert">Vlastné alebo zamietavé pravidlá blokujú externú pamäť. Skontrolujte oprávnenia.</p> : null}
      <ul>{status.sources.map(source => <li key={source.id}>{source.id} · {source.root} · {source.status === "loaded" ? "načítaný" : source.status === "missing" ? "chýba" : "chyba"}{source.required ? " · povinný" : ""}</li>)}</ul>
      <ul>{status.problems.map((problem, i) => <li key={i}>{problem.sourceId ? `${problem.sourceId}: ` : ""}{problem.code} — {problem.message}</li>)}</ul>
    </> : <p className="text-sm">Oprávnenia sa načítajú zo servera pri kontrole. Cesta v profile sama osebe prístup neudeľuje.</p>}
  </div>;
}
