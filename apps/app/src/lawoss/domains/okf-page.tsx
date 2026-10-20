import { DiagnosticMessage, diagnosticText } from "../i18n/diagnostic-message";
/** @jsxImportSource react */
import { useMemo, useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link, Navigate } from "react-router-dom";
import { useOptionalLocal } from "@/react-app/kernel/local-provider";
import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import type { MatterTextKey } from "../i18n/matters";
import { LawossLayout } from "../shell/layout";
import { activeWorkspace, useOkfConnection, useOkfOverview, useOkfScope, type OkfReadResult, type OkfScope } from "../okf/read-model";
import type { CockpitParty } from "../../../../../lawoss/okf/cockpit";
import { ENABLE_OKF_ROUTE, useOkfChoice } from "./onboarding/entry-actions";
import { PracticeCoverage } from "../okf/practice-coverage";
import { NEW_MATTER_PATH } from "../lite/links";
import { unavailableWorkspace } from "../okf/missing-folder";
import { MissingFolder } from "./missing-folder";
import "../lite/pages/okf-glass.css";

/** Subscribe each UI island; translating never changes the underlying matter data. */
export function useMatterText() {
  const locale = useLocale();
  const text = (key: MatterTextKey, params?: Record<string, string | number>): string =>
    t(`lawoss.matters.${key}`, locale, params);
  return { locale, text };
}

/** Caller-supplied state copy (lite); defaults to `lawoss.matters.*`. */
export type StateText = (key: MatterTextKey, params?: Record<string, string | number>) => string;
/** Which workspace anchors the page; lite passes `officeWorkspace`, pro keeps the active one. Inside a practice both read every client (N1). */
type PickWorkspace = typeof activeWorkspace;
/** `rawProblems: false` (lite) hides per-file read errors - they carry internal names like "Workspace not found". */
/** Kedy sa pamäť naposledy overila a kedy sa jej obsah naozaj zmenil (indikátor živosti). */
export type OkfPageMeta = { checkedAt: number; changedAt: number; failed?: boolean };
/** Kedy má stránka čo ukázať; predvolene keď sú veci (Klienti ukážu aj klientov bez vecí). */
type HasContent = (data: OkfReadResult) => boolean;
const hasMatters: HasContent = (data) => data.matters.length > 0;
/** `noWorkspace`: obsah stránky, keď ešte nie je pripojený žiaden priečinok (napr. Klienti po „Začať nanovo“). */
type PageProps = { title?: string; notice?: ReactNode; children: (data: OkfReadResult, meta: OkfPageMeta, scope: OkfScope | null) => ReactNode; stateText?: StateText; pickWorkspace?: PickWorkspace; rawProblems?: boolean; hasContent?: HasContent; noWorkspace?: ReactNode };

/** Retry also reloads the desktop connection, which may be absent during startup. */
export function OkfPage({ title, notice, children, stateText, pickWorkspace, rawProblems, hasContent, noWorkspace }: PageProps) {
  const text = useMatterText().text;
  const label = stateText ?? text;
  const [attempt, setAttempt] = useState(0);
  const cache = useQueryClient();
  return (
    <LawossLayout>
      {title ? <h1 className="lw-h1">{title}</h1> : null}
      <OkfPageQuery key={attempt} notice={notice} stateText={stateText} pickWorkspace={pickWorkspace} rawProblems={rawProblems} hasContent={hasContent} noWorkspace={noWorkspace} retry={<button type="button" className="lw-btn" onClick={() => {
        void cache.invalidateQueries({ queryKey: ["okf-overview"], refetchType: "none" });
        void cache.invalidateQueries({ queryKey: ["okf-practice-root"] });
        setAttempt((value) => value + 1);
      }}>{label("retry")}</button>}>{children}</OkfPageQuery>
    </LawossLayout>
  );
}

function OkfPageQuery({ children, notice, stateText, pickWorkspace = activeWorkspace, rawProblems, hasContent, noWorkspace, retry }: Pick<PageProps, "children" | "notice" | "stateText" | "pickWorkspace" | "rawProblems" | "hasContent" | "noWorkspace"> & { retry: ReactNode }) {
  const text = useMatterText().text;
  const { connection, error } = useOkfConnection();
  const workspace = pickWorkspace(connection);
  const resolution = useOkfScope(connection, workspace);
  const { scope, pending } = resolution;
  const query = useOkfOverview(connection, scope);
  // Prvé spustenie: Lite začína na „Dnes", ktoré si chráni trasu, takže upstream presmerovanie na
  // onboarding by sa nespustilo. Rovnaké pravidlo ako upstream: žiaden workspace a onboarding nedokončený.
  const local = useOptionalLocal();
  const firstRun = Boolean(connection?.client && local) && workspace === null && !local?.prefs.hasCompletedOnboarding;
  // Zdieľanie štruktúry v react-query drží rovnaký objekt, kým sa obsah nezmení; nový objekt = nový zápis.
  const changedAt = useMemo(() => query.dataUpdatedAt, [query.data?.inputs, query.data?.clients]);
  // Bez OKF nie je z čoho skladať prehľady: prázdna stránka to povie a ponúkne zapnutie, nie „žiadne veci“.
  // Len skutočne prečítaný stav: nečitateľný stav pri štarte nesmie tvrdiť, že OKF je vypnuté.
  const okfChoice = useOkfChoice(false);
  // Priečinok priestoru na disku chýba (404 `project_folder_unavailable`): veta s menom priečinka a cesta ďalej.
  const missing = connection ? unavailableWorkspace(connection.workspaces, query.data, query.error, workspace) : null;
  return <OkfPageState
    missingFolder={connection && missing ? <MissingFolder connection={connection} missing={missing} /> : null}
    okfOff={okfChoice.known && okfChoice.offered === true}
    meta={{ checkedAt: query.dataUpdatedAt, changedAt, failed: query.isRefetchError }}
    firstRun={firstRun}
    connection={connection === null ? "loading" : connection.client ? "ready" : "unavailable"}
    workspace={workspace ? workspace.displayNameResolved || workspace.name || workspace.path : null}
    // Zlyhané obnovenie na pozadí nezahodí stránku: ostanú posledné údaje a indikátor povie, z kedy sú.
    error={error || (resolution.state === "unavailable" ? resolution.message ?? text("incompleteRead") : null) || (query.data ? null : query.error)}
    data={scope ? query.data : undefined}
    scope={scope}
    excludedWorkspaceIds={resolution.excludedWorkspaceIds}
    // Tiché obnovenie na pozadí nič neohlasuje; stav „obnovujem" len pri prvom alebo vyžiadanom čítaní.
    loading={pending || (query.isFetching && !query.isRefetching)}
    stateText={stateText}
    rawProblems={rawProblems}
    hasContent={hasContent}
    noWorkspace={noWorkspace}
    retry={retry}
    notice={notice}
  >{children}</OkfPageState>;
}

/** Keep empty memory distinct from failed or incomplete reads. */
export function OkfPageState(props: {
  connection: "loading" | "ready" | "unavailable";
  workspace: string | null;
  error: unknown;
  data: OkfReadResult | undefined;
  /** Rozsah, z ktorého sú `data`; deti ním prekladajú cestu veci na priečinok klienta. */
  scope?: OkfScope | null;
  excludedWorkspaceIds?: readonly string[];
  loading: boolean;
  children: (data: OkfReadResult, meta: OkfPageMeta, scope: OkfScope | null) => ReactNode;
  stateText?: StateText;
  rawProblems?: boolean;
  /** Shown with every state except loaded matters, so a working page is not followed by a stray retry. */
  retry?: ReactNode;
  meta?: OkfPageMeta;
  /** Žiaden workspace a nedokončený onboarding: namiesto prázdnej stránky otvoriť onboarding. */
  firstRun?: boolean;
  /** OKF nie je zapnuté: prázdna pamäť je očakávaná, stránka ponúkne zapnutie. */
  okfOff?: boolean;
  hasContent?: HasContent;
  /** Neblokujúce upozornenie nad každým stavom okrem presmerovania (napr. nedokončené nastavenie, #96). */
  notice?: ReactNode;
  /** Priečinok priestoru chýba: nahradí všeobecnú chybu čítania; pri čiastočne načítanej praxi stojí nad obsahom spolu s upozornením na neúplné čítanie. */
  missingFolder?: ReactNode;
  /** Obsah namiesto „žiadny priečinok“ (stránka Klienti ponúkne „Pridať klienta“, rozhodnutie 19. 10. 2026). */
  noWorkspace?: ReactNode;
}) {
  const { text: matterText, locale } = useMatterText();
  const node = <>{props.workspace === null && props.firstRun ? null : props.notice}{okfStateNode(props, props.stateText ?? matterText, locale)}</>;
  // „Skúsiť znova“ len tam, kde sa čaká alebo zlyhalo; pri načítaných veciach, prázdnej pamäti a bez priečinka nie je čo opakovať.
  const settled = !props.error && props.connection === "ready" && (props.workspace === null || Boolean(props.data && ((props.hasContent ?? hasMatters)(props.data) || !(props.data.problems.length || props.data.truncated))));
  return <>
    {props.data ? <PracticeCoverage data={props.data} scope={props.scope ?? null} failed={props.meta?.failed} excludedWorkspaceIds={props.excludedWorkspaceIds} /> : null}
    {settled ? node : <>{node}{props.retry}</>}
  </>;
}

function okfStateNode(props: Parameters<typeof OkfPageState>[0], text: StateText, locale: Language): ReactNode {
  const missingOnly = props.missingFolder && !(props.data && (props.hasContent ?? hasMatters)(props.data));
  if (missingOnly) return props.missingFolder;
  if (props.error) return <div className="lw-status err" role="alert"><DiagnosticMessage value={props.error} fallback={text("memoryError", { error: diagnosticText(props.error, locale) })} /></div>;
  if (props.connection === "loading") return <OkfSkeleton label={text("connectionLoading")} />;
  if (props.connection === "unavailable") return <div className="lw-status warn" role="alert">{text("serverUnavailable")}</div>;
  if (props.workspace === null && props.firstRun) return <Navigate to="/welcome" replace />;
  if (props.workspace === null && props.noWorkspace) return props.noWorkspace;
  if (props.workspace === null) return <p className="lw-empty">{text("noWorkspace")} <Link to="/welcome">{text("openWorkspace")}</Link>.</p>;
  if (!props.data) return <OkfSkeleton label={text("memoryLoading", { workspace: props.workspace })} />;
  // Lite: část souborů nešla načíst, ale věci ano - bez upozornění by Dnes tvrdilo „žádné lhůty“ (review PR #100, 6).
  const partial = (props.data.coverage && props.data.coverage.status !== "complete") || props.meta?.failed || (props.rawProblems === false && (props.data.problems.length > 0 || props.data.truncated));
  if ((props.hasContent ?? hasMatters)(props.data)) return <>
    {props.loading ? <p role="status">{text("refreshing")}</p> : null}
    {props.missingFolder}
    {partial ? <div className="lw-status warn" role="alert">{text("partialRead")}</div> : null}
    {props.children(props.data, props.meta ?? { checkedAt: 0, changedAt: 0 }, props.scope ?? null)}
  </>;
  if (props.data.problems.length || props.data.truncated) return <div className="lw-status err" role="alert">
    {text("incompleteRead")}
    {props.rawProblems !== false && props.data.problems.slice(0, 3).map((problem, index) => <p key={`${problem.path}/${index}`}>{problem.path || props.workspace}: <DiagnosticMessage value={problem} /></p>)}
  </div>;
  if (props.okfOff) return <div className="lw-empty" data-lawoss-empty="off">
    <p>{text("okfOff")}</p>
    <Link className="lw-btn" to={ENABLE_OKF_ROUTE}>{text("turnOnOkf")}</Link>
  </div>;
  // Rovnaká cesta k novej veci ako v bočnom paneli.
  return <p className="lw-empty">{text("noMatterMemory", { workspace: props.workspace })} <Link to={NEW_MATTER_PATH}>{text("newMatter")}</Link>.</p>;
}

/** Kostra namiesto holého textu: obrys úvodu, pásu a panelov, kým sa pamäť načíta. */
function OkfSkeleton({ label }: { label: string }) {
  return <div className="lw-mem-loading" role="status">
    <p className="lw-lead">{label}</p>
    <div className="lw-mem-skeleton" aria-hidden>
      <span className="is-title" /><span className="is-line" /><span className="is-strip" />
      <span className="is-panel" /><span className="is-panel" />
    </div>
  </div>;
}

/** Zapojené subjekty veci (Lite aj Pro); bez nich sa sekcia neukáže. Meno a rola ostávajú ako v zázname. */
export function MatterParties({ parties }: { parties: readonly CockpitParty[] }) {
  const { text } = useMatterText();
  if (parties.length === 0) return null;
  return <div className="lw-reg" data-lawoss-parties>
    <div className="lw-reg-h"><h2>{text("parties")}</h2></div>
    {parties.map((p, i) => (
      <div key={`${p.file}/${p.recordId}/${i}`} className="lw-row lw-cols-leh">
        <span className="lw-no">{i + 1}.</span>
        <span className="lw-d">{p.role ?? "-"}</span>
        <span className="lw-t">{p.name}{p.contact ? <small>{p.contact}</small> : null}</span>
        <span className="lw-ref" title={p.file}>{p.recordId}</span>
        <span className="lw-st" />
      </div>
    ))}
  </div>;
}
