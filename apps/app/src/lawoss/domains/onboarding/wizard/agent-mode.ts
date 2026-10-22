/**
 * Režim agenta pre krok „Ako agent pracuje“ a súhrn „Pripravené“ (C1). Číta a zapisuje len existujúce
 * nastavenia cez existujúce API: YOLO (`/lawoss/yolo`, yolo-mode.tsx) a globálne oprávnenia nástrojov
 * (`getConfig`/`patchConfig`, rovnaké pomocné funkcie ako Nastavenia → Bezpečnosť). Predvolenia nemení:
 * nenastavené `edit`/`bash` sa berú ako pýtanie (predvolenie servera z úlohy A1); zápis „ask“ nastane len
 * na výslovnú voľbu advokáta, keď je zmena súborov nastavená na „allow“.
 */
import { useCallback, useEffect, useState } from "react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import {
  applyPermissionPatch,
  applyQuickToggle,
  parseToolPermissions,
  readPermissionRecord,
  serializeToolPermissionsPatch,
  type ToolPermissionsModel,
} from "@/react-app/domains/settings/panels/tool-permissions-config";
import { loadYoloMode, publishYoloMode, saveYoloMode, type YoloMode } from "../../yolo/yolo-mode";

export type AgentModeApi = Partial<Pick<LegalworkServerClient, "lawossYolo" | "setLawossYolo" | "getConfig" | "patchConfig" | "listWorkspaces" | "reloadEngine" | "canApprove">>;

/** Zmeny súborov: pýta sa (aj nenastavené, predvolenie A1), bez pýtania, alebo sa nedá zistiť. */
export type EditsMode = "ask" | "allow" | "unknown";

export type AgentState = {
  yolo: YoloMode | null;
  edits: EditsMode;
  /** Pracovný priečinok, cez ktorý sa číta a zapisuje globálna konfigurácia (transport, nie rozsah). */
  workspaceId?: string;
  permission?: Record<string, unknown>;
  loading: boolean;
};

export function editsMode(model: ToolPermissionsModel): Exclude<EditsMode, "unknown"> {
  return model.edit.action === "allow" || model.bash.action === "allow" ? "allow" : "ask";
}

/** Výsledný režim pre súhrn: YOLO má prednosť, potom pravidlá zmien. */
export type AgentSummary = "ask" | "yolo" | "allow" | "unknown";

export function agentSummary(state: Pick<AgentState, "yolo" | "edits">): AgentSummary {
  if (state.yolo?.enabled) return "yolo";
  if (state.edits === "allow") return "allow";
  if (state.edits === "ask") return "ask";
  return "unknown";
}

async function activeWorkspaceId(api: AgentModeApi): Promise<string | undefined> {
  if (!api.listWorkspaces) return undefined;
  const list = await api.listWorkspaces();
  return list.activeId ?? list.items.find((item) => item.workspaceType !== "remote")?.id;
}

/** Načíta YOLO a pravidlá zmien; každá časť zlyhá samostatne (neznámy stav, nie chyba kroku). */
export async function loadAgentState(api: AgentModeApi): Promise<Omit<AgentState, "loading">> {
  const yolo = api.lawossYolo ? await loadYoloMode({ lawossYolo: api.lawossYolo }).catch(() => null) : null;
  if (yolo) publishYoloMode(yolo);
  try {
    const workspaceId = await activeWorkspaceId(api);
    if (!workspaceId || !api.getConfig) return { yolo, edits: "unknown" };
    const config = await api.getConfig(workspaceId);
    const permission = readPermissionRecord(config.opencode);
    return { yolo, edits: editsMode(parseToolPermissions(permission)), workspaceId, permission };
  } catch {
    return { yolo, edits: "unknown" };
  }
}

/** Pravidlá zmien „pýtať sa“ pre úpravy aj príkazy, ostatné nástroje bez zmeny. */
export function askPatch(permission: Record<string, unknown>): Record<string, unknown> {
  const model = applyQuickToggle(applyQuickToggle(parseToolPermissions(permission), "ask_before_edit", true), "ask_before_shell", true);
  return serializeToolPermissionsPatch(model, permission);
}

/** Bežiaci engine si nové pravidlá prevezme po prestavaní konfigurácie (ako Nastavenia); zlyhanie nevadí. */
async function reload(api: AgentModeApi, workspaceId: string | undefined): Promise<void> {
  if (!workspaceId || !api.reloadEngine) return;
  await api.reloadEngine(workspaceId).catch((reason: unknown) => console.warn("[lawoss] onboarding engine reload", reason));
}

export function useAgentMode(api: AgentModeApi, active: boolean) {
  const [state, setState] = useState<AgentState>({ yolo: null, edits: "unknown", loading: true });
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));
    void loadAgentState(api).then((next) => { if (!cancelled) setState({ ...next, loading: false }); });
    return () => { cancelled = true; };
  }, [api, active]);
  const run = useCallback(async (work: () => Promise<Partial<AgentState>>) => {
    setSaving(true);
    setFailed(false);
    try {
      const patch = await work();
      setState((current) => ({ ...current, ...patch }));
    } catch (reason) {
      console.warn("[lawoss] onboarding agent mode", reason);
      setFailed(true);
    } finally {
      setSaving(false);
    }
  }, []);
  const setYolo = (enabled: boolean) => run(async () => {
    if (!api.setLawossYolo) throw new Error("yolo_unavailable");
    const yolo = await saveYoloMode({ setLawossYolo: api.setLawossYolo }, enabled);
    publishYoloMode(yolo);
    await reload(api, state.workspaceId);
    return { yolo };
  });
  const askBeforeChanges = () => run(async () => {
    if (!api.patchConfig || !state.workspaceId || !state.permission) throw new Error("permissions_unavailable");
    const patch = askPatch(state.permission);
    await api.patchConfig(state.workspaceId, { opencode: { permission: patch } });
    await reload(api, state.workspaceId);
    return { edits: "ask", permission: applyPermissionPatch(state.permission, patch) };
  });
  return { state, saving, failed, setYolo, askBeforeChanges, canWrite: Boolean(api.canApprove) };
}
