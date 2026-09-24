/** @jsxImportSource react */
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import type { MatterTextKey } from "../i18n/matters";
import { LawossLayout } from "../shell/layout";
import { activeWorkspace, useOkfConnection, useOkfOverview, type OkfReadResult } from "../okf/read-model";

/** Subscribe each UI island; translating never changes the underlying matter data. */
export function useMatterText() {
  const locale = useLocale();
  const text = (key: MatterTextKey, params?: Record<string, string | number>): string =>
    t(`lawoss.matters.${key}`, locale, params);
  return { locale, text };
}

/** Caller-supplied state copy (lite); defaults to `lawoss.matters.*`. */
export type StateText = (key: MatterTextKey, params?: Record<string, string | number>) => string;
/** Which workspace the page reads; lite passes `officeWorkspace`, pro keeps the active one. */
type PickWorkspace = typeof activeWorkspace;
/** `rawProblems: false` (lite) hides per-file read errors — they carry internal names like "Workspace not found". */
type PageProps = { title: string; children: (data: OkfReadResult) => ReactNode; stateText?: StateText; pickWorkspace?: PickWorkspace; rawProblems?: boolean };

/** Retry also reloads the desktop connection, which may be absent during startup. */
export function OkfPage({ title, children, stateText, pickWorkspace, rawProblems }: PageProps) {
  const text = useMatterText().text;
  const label = stateText ?? text;
  const [attempt, setAttempt] = useState(0);
  const cache = useQueryClient();
  return (
    <LawossLayout>
      <h1 className="lw-h1">{title}</h1>
      <OkfPageQuery key={attempt} stateText={stateText} pickWorkspace={pickWorkspace} rawProblems={rawProblems}>{children}</OkfPageQuery>
      <button type="button" className="lw-btn" onClick={() => {
        void cache.invalidateQueries({ queryKey: ["okf-overview"], refetchType: "none" });
        setAttempt((value) => value + 1);
      }}>{label("retry")}</button>
    </LawossLayout>
  );
}

function OkfPageQuery({ children, stateText, pickWorkspace = activeWorkspace, rawProblems }: Pick<PageProps, "children" | "stateText" | "pickWorkspace" | "rawProblems">) {
  const { connection, error } = useOkfConnection();
  const workspace = pickWorkspace(connection);
  const query = useOkfOverview(connection, workspace);
  return <OkfPageState
    connection={connection === null ? "loading" : connection.client ? "ready" : "unavailable"}
    workspace={workspace ? workspace.displayNameResolved || workspace.name || workspace.path : null}
    error={error || query.error}
    data={query.data}
    loading={query.isFetching}
    stateText={stateText}
    rawProblems={rawProblems}
  >{children}</OkfPageState>;
}

/** Keep empty memory distinct from failed or incomplete reads. */
export function OkfPageState(props: {
  connection: "loading" | "ready" | "unavailable";
  workspace: string | null;
  error: unknown;
  data: OkfReadResult | undefined;
  loading: boolean;
  children: (data: OkfReadResult) => ReactNode;
  stateText?: StateText;
  rawProblems?: boolean;
}) {
  const matterText = useMatterText().text;
  const text = props.stateText ?? matterText;
  if (props.error) return <div className="lw-status err" role="alert">{text("memoryError", { error: props.error instanceof Error ? props.error.message : String(props.error) })}</div>;
  if (props.connection === "loading") return <p className="lw-lead" role="status">{text("connectionLoading")}</p>;
  if (props.connection === "unavailable") return <div className="lw-status warn" role="alert">{text("serverUnavailable")}</div>;
  if (props.workspace === null) return <p className="lw-empty">{text("noWorkspace")} <Link to="/welcome">{text("openWorkspace")}</Link>.</p>;
  if (!props.data) return <p className="lw-lead" role="status">{text("memoryLoading", { workspace: props.workspace })}</p>;
  // Lite: část souborů nešla načíst, ale věci ano — bez upozornění by Dnes tvrdilo „žádné lhůty“ (review PR #100, 6).
  const partial = props.rawProblems === false && (props.data.problems.length > 0 || props.data.truncated);
  if (props.data.matters.length > 0) return <>
    {props.loading ? <p role="status">{text("refreshing")}</p> : null}
    {partial ? <div className="lw-status warn" role="alert">{text("partialRead")}</div> : null}
    {props.children(props.data)}
  </>;
  if (props.data.problems.length || props.data.truncated) return <div className="lw-status err" role="alert">
    {text("incompleteRead")}
    {props.rawProblems !== false && props.data.problems.slice(0, 3).map((problem, index) => <p key={`${problem.path}/${index}`}>{problem.path || props.workspace}: {problem.message}</p>)}
  </div>;
  return <p className="lw-empty">{text("noMatterMemory", { workspace: props.workspace })} <Link to="/experimenty/novy-spis">{text("newMatter")}</Link>.</p>;
}
