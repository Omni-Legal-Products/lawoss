/** @jsxImportSource react */
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";

import { createClient, unwrap } from "@/app/lib/opencode";
import { toSessionTransportDirectory } from "@/app/lib/session-scope";
import { resolveWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";
import { workspaceSettingsRoute } from "@/react-app/shell/workspace-routes";

import { loadOkfConnection, type OkfConnection } from "../../okf/connection";
import { LawossLayout } from "../../shell/layout";
import { toConnectorRows, type ConnectorRow, type ConnectorStatusMap } from "./rows";

type Loaded = {
  workspace: RouteWorkspace;
  rows: ReturnType<typeof toConnectorRows>;
  /** Stav z opencode sa nepodarilo načítať — servery sa ukážu ako odpojené. */
  statusError: string | null;
};

type State =
  | { phase: "loading" }
  | { phase: "no-server" }
  | { phase: "no-workspace" }
  | { phase: "error"; message: string }
  | ({ phase: "ready" } & Loaded);

/** Tie isté volania ako settings: listMcp + mcp.status (connections/store.ts) a listSkills (extensions-store.ts). */
async function loadKonektory(connection: OkfConnection, workspace: RouteWorkspace): Promise<Loaded> {
  const client = connection.client;
  if (!client) throw new Error("Server LegalWork nebeží.");
  const [mcp, skills] = await Promise.all([
    client.listMcp(workspace.id),
    client.listSkills(workspace.id, { includeGlobal: true }),
  ]);
  let statuses: ConnectorStatusMap = {};
  let statusError: string | null = null;
  try {
    const endpoint = resolveWorkspaceEndpoint(workspace, { baseUrl: connection.baseUrl, token: connection.token });
    if (!endpoint) throw new Error("Workspace nie je dostupný.");
    const opencode = createClient(endpoint.opencodeBaseUrl, workspace.path || undefined, { token: endpoint.token, mode: "legalwork" });
    statuses = unwrap(await opencode.mcp.status({ directory: toSessionTransportDirectory(workspace.path) }));
  } catch (error) {
    statusError = error instanceof Error ? error.message : String(error);
  }
  return { workspace, rows: toConnectorRows(mcp.items, statuses, skills.items), statusError };
}

/**
 * Konektory — iba čítanie. Ukazuje, čo agent vo workspace skutočne vidí:
 * MCP servery so stavom a skills, z rovnakých dát ako Settings → Extensions.
 * Pripájanie, odpájanie a OAuth ostávajú v Settings; tu sú len odkazy.
 */
export function KonektoryPage() {
  const [state, setState] = useState<State>({ phase: "loading" });

  useEffect(() => {
    let cancelled = false;
    loadOkfConnection()
      .then(async (connection) => {
        if (!connection.client) return { phase: "no-server" } satisfies State;
        const workspace = connection.workspaces.find((item) => item.id === connection.activeWorkspaceId) ?? connection.workspaces[0];
        if (!workspace) return { phase: "no-workspace" } satisfies State;
        return { phase: "ready", ...(await loadKonektory(connection, workspace)) } satisfies State;
      })
      .catch((error: unknown): State => ({ phase: "error", message: error instanceof Error ? error.message : String(error) }))
      .then((next) => { if (!cancelled) setState(next); });
    return () => { cancelled = true; };
  }, []);

  const workspaceId = state.phase === "ready" ? state.workspace.id : null;
  const mcpSettings = workspaceId ? workspaceSettingsRoute(workspaceId, "extensions/mcp") : "/settings/extensions";
  const skillsSettings = workspaceId ? workspaceSettingsRoute(workspaceId, "extensions/skills") : "/settings/extensions";

  return (
    <LawossLayout>
      <h1 className="lw-h1">Konektory</h1>
      <p className="lw-lead">
        Čo agent vidí a čo smie použiť. Stav je ten istý ako v Settings → Extensions; tu sa iba číta — pripojiť,
        odpojiť alebo prihlásiť server sa dá tam.
      </p>

      {state.phase === "loading" ? <p className="lw-empty">Načítavam stav zo servera…</p> : null}
      {state.phase === "no-server" ? (
        <div className="lw-status warn">Server LegalWork nebeží alebo chýba token — stav konektorov sa nedá prečítať.</div>
      ) : null}
      {state.phase === "no-workspace" ? (
        <p className="lw-empty">Žiadny workspace. Pridajte priečinok cez „Add folder“ v bočnom paneli.</p>
      ) : null}
      {state.phase === "error" ? <div className="lw-status err">{state.message}</div> : null}

      {state.phase === "ready" ? (
        <>
          <Section
            title="MCP servery"
            meta={<>workspace {state.workspace.displayNameResolved || state.workspace.name}<Link to={mcpSettings}>Settings → Extensions</Link></>}
            rows={state.rows.servers}
            empty={<>Žiadny MCP server nie je nakonfigurovaný. Pripojiť sa dá v <Link to={mcpSettings}>Settings → Extensions</Link>.</>}
            action={{ label: "spravovať →", to: mcpSettings }}
          />
          {state.statusError ? (
            <div className="lw-status warn">Stav pripojenia z opencode sa nepodarilo načítať ({state.statusError}); servery sú zobrazené ako odpojené.</div>
          ) : null}
          <Section
            title="Skills"
            meta={<Link to={skillsSettings}>Settings → Skills</Link>}
            rows={state.rows.skills}
            empty={<>Žiadny skill. Pridať sa dá v <Link to={skillsSettings}>Settings → Skills</Link>.</>}
            action={{ label: "otvoriť →", to: skillsSettings }}
          />
        </>
      ) : null}

      <div className="lw-note">
        <span>
          Agent <b>nemá</b> nástroj na odoslanie ani podpis (ADR 0007 pravidlo 5).
        </span>
        <span>
          Táto stránka nič nemení — každý riadok vedie do Settings, kde sa server pripája, odpája alebo prihlasuje.
        </span>
      </div>
    </LawossLayout>
  );
}

function Section(props: {
  title: string;
  meta: React.ReactNode;
  rows: ConnectorRow[];
  empty: React.ReactNode;
  action: { label: string; to: string };
}) {
  return (
    <div className="lw-reg">
      <div className="lw-reg-h">
        <h2>{props.title}</h2>
        <span className="lw-meta">{props.meta}</span>
      </div>
      {props.rows.length === 0 ? <p className="lw-empty">{props.empty}</p> : null}
      {props.rows.map((row, index) => (
        <div key={row.key} className="lw-row lw-cols-con">
          <span className="lw-no">{index + 1}.</span>
          <span className="lw-t">
            {row.name}
            <small>{row.sub}</small>
            {row.error ? <small className="lw-hint-warn">{row.error}</small> : null}
          </span>
          <span className="lw-trust own">{row.scope}</span>
          <span className="lw-ref">{row.ref}</span>
          <span className={`lw-st ${row.tone}`}>{row.status}</span>
          <Link className="lw-go" to={props.action.to}>{props.action.label}</Link>
        </div>
      ))}
    </div>
  );
}
