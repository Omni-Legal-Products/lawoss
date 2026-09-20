/** @jsxImportSource react */
import { useState, type ReactNode } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import { LawossLayout } from "../shell/layout";
import { activeWorkspace, useOkfConnection, useOkfOverview, type OkfReadResult } from "../okf/read-model";

type PageProps = { title: string; children: (data: OkfReadResult) => ReactNode };

/** Retry also reloads the desktop connection, which may be absent during startup. */
export function OkfPage({ title, children }: PageProps) {
  const [attempt, setAttempt] = useState(0);
  const cache = useQueryClient();
  return (
    <LawossLayout>
      <h1 className="lw-h1">{title}</h1>
      <OkfPageQuery key={attempt}>{children}</OkfPageQuery>
      <button type="button" className="lw-btn" onClick={() => {
        void cache.invalidateQueries({ queryKey: ["okf-overview"], refetchType: "none" });
        setAttempt((value) => value + 1);
      }}>Skúsiť znova</button>
    </LawossLayout>
  );
}

function OkfPageQuery({ children }: Pick<PageProps, "children">) {
  const { connection, error } = useOkfConnection();
  const workspace = activeWorkspace(connection);
  const query = useOkfOverview(connection, workspace);
  return <OkfPageState
    connection={connection === null ? "loading" : connection.client ? "ready" : "unavailable"}
    workspace={workspace ? workspace.displayNameResolved || workspace.name || workspace.path : null}
    error={error || query.error}
    data={query.data}
    loading={query.isFetching}
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
}) {
  if (props.error) return <div className="lw-status err" role="alert">Pamäť spisov sa nepodarilo načítať: {props.error instanceof Error ? props.error.message : String(props.error)}</div>;
  if (props.connection === "loading") return <p className="lw-lead" role="status">Načítavam pripojenie a pracovné priečinky…</p>;
  if (props.connection === "unavailable") return <div className="lw-status warn" role="alert">Server zatiaľ nie je dostupný. Keď sa spustí, skúste načítanie znova.</div>;
  if (props.workspace === null) return <p className="lw-empty">Nie je otvorený žiadny pracovný priečinok. <Link to="/welcome">Otvoriť pracovný priečinok</Link>.</p>;
  if (!props.data) return <p className="lw-lead" role="status">Načítavam pamäť spisov z priečinka „{props.workspace}“…</p>;
  if (props.data.matters.length > 0) return <>{props.loading ? <p role="status">Obnovujem načítanie…</p> : null}{props.children(props.data)}</>;
  if (props.data.problems.length || props.data.truncated) return <div className="lw-status err" role="alert">
    Pamäť sa nepodarilo úplne načítať. Z tohto výsledku sa nedá určiť, či priečinok obsahuje spisy.
    {props.data.problems.slice(0, 3).map((problem, index) => <p key={`${problem.path}/${index}`}>{problem.path || props.workspace}: {problem.message}</p>)}
  </div>;
  return <p className="lw-empty">V priečinku <b>{props.workspace}</b> zatiaľ nie sú spisy s pamäťou. <Link to="/experimenty/novy-spis">Založiť nový spis</Link>.</p>;
}
