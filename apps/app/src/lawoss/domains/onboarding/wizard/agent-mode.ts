/**
 * Režim agenta pre krok „Ako agent pracuje“ a súhrn „Pripravené“ (C1). Číta a zapisuje len existujúce
 * nastavenia cez existujúce API: YOLO (`/lawoss/yolo`, yolo-mode.tsx) a globálne oprávnenia nástrojov
 * (`getConfig`/`patchConfig`, rovnaké pomocné funkcie ako Nastavenia → Bezpečnosť). Predvolenia nemení:
 * nenastavené `edit`/`bash` sa berú ako pýtanie (predvolenie servera z úlohy A1); zápis „ask“ nastane len
 * na výslovnú voľbu advokáta, keď je zmena súborov nastavená na „allow“.
 *
 * Stav je účinný stav vrátane firemnej politiky `tools.permissions` (ako ho ukazuje natívny panel cez
 * `withFirmPermissions`); firma „spravuje zmeny“ len vtedy, keď má pravidlo pre `edit`, `bash` alebo
 * `lawoss_file_change`, nie pre iné nástroje.
 */
import { useCallback, useEffect, useState } from "react";
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import {
  applyPermissionPatch,
  applyQuickToggle,
  parseToolPermissions,
  readPermissionRecord,
  serializeToolPermissionsPatch,
  withFirmPermissions,
  type PermissionAction,
  type ToolPermissionsModel,
} from "@/react-app/domains/settings/panels/tool-permissions-config";
import { loadYoloMode, publishYoloMode, saveYoloMode, type YoloMode } from "../../yolo/yolo-mode";

export type AgentModeApi = Partial<Pick<LegalworkServerClient, "lawossYolo" | "setLawossYolo" | "getConfig" | "patchConfig" | "listWorkspaces" | "reloadEngine" | "canApprove">>;

/** Firemné pravidlá `tools.permissions` (položka natívneho `useOrgPolicy`), alebo žiadne. */
export type FirmPermissions = {
  mode: "enforced" | "default";
  locked: boolean;
  value: Partial<Record<string, PermissionAction | Record<string, PermissionAction>>>;
} | null;

/** Nástroje, ktorých pravidlo rozhoduje o pýtaní pred zmenou súborov (A1: `lawoss_file_change`). */
export const CHANGE_TOOLS = ["edit", "bash", "lawoss_file_change"] as const;

/** Zmeny súborov: pýta sa (aj nenastavené, predvolenie A1), bez pýtania, alebo sa nedá zistiť. */
export type EditsMode = "ask" | "allow" | "unknown";

/** Čo smie krok so pravidlami zmien: zapísať sám, len cez uvoľnenie firemného pravidla, alebo nič (zámok). */
export type FirmControl = "own" | "firm" | "locked";

export type AgentState = {
  yolo: YoloMode | null;
  edits: EditsMode;
  /** Pracovný priečinok, cez ktorý sa číta a zapisuje globálna konfigurácia (transport, nie rozsah). */
  workspaceId?: string;
  /** Vlastné pravidlá advokáta (bez firmy); zápis ich mení rovnako ako natívny panel. */
  permission?: Record<string, unknown>;
  loading: boolean;
};

export function editsMode(model: ToolPermissionsModel): Exclude<EditsMode, "unknown"> {
  return model.edit.action === "allow" || model.bash.action === "allow" ? "allow" : "ask";
}

/** Účinný režim zmien: vlastné pravidlá s firemnými navrch (rovnako ako Nastavenia → Bezpečnosť). */
export function effectiveEdits(permission: Record<string, unknown>, firm: FirmPermissions): Exclude<EditsMode, "unknown"> {
  return editsMode(parseToolPermissions(firm ? withFirmPermissions(permission, firm) : permission));
}

/** Firma spravuje zmeny súborov len pravidlom pre `edit`, `bash` alebo `lawoss_file_change`. */
export function firmControl(firm: FirmPermissions): FirmControl {
  if (!firm || !CHANGE_TOOLS.some((tool) => firm.value[tool] !== undefined)) return "own";
  return firm.locked ? "locked" : "firm";
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

/** Načíta YOLO a vlastné pravidlá zmien; každá časť zlyhá samostatne (neznámy stav, nie chyba kroku). */
export async function loadAgentState(api: AgentModeApi, firm: FirmPermissions = null): Promise<Omit<AgentState, "loading">> {
  const yolo = api.lawossYolo ? await loadYoloMode({ lawossYolo: api.lawossYolo }).catch(() => null) : null;
  if (yolo) publishYoloMode(yolo);
  try {
    const workspaceId = await activeWorkspaceId(api);
    if (!workspaceId || !api.getConfig) return { yolo, edits: "unknown" };
    const config = await api.getConfig(workspaceId);
    const permission = readPermissionRecord(config.opencode);
    return { yolo, edits: effectiveEdits(permission, firm), workspaceId, permission };
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

export type AgentModeDeps = {
  /** Uvoľnenie firemného pravidla pred zápisom (natívne `changeOrgPolicySetting`); vráti, či sa pokračovalo. */
  releaseFirm?: (change: () => Promise<void>) => Promise<boolean>;
};

/**
 * Akcie režimu bez Reactu (testovateľné s falošným API): zapnutie/vypnutie YOLO a „pýtať sa pred zmenou“.
 * Pravidlo, ktoré spravuje firma, sa mení len cez `releaseFirm` (rovnako ako natívny panel); zámok nič nezapíše.
 */
export function agentActions(api: AgentModeApi, firm: FirmPermissions, deps: AgentModeDeps = {}) {
  const setYolo = async (state: AgentState, enabled: boolean): Promise<Partial<AgentState>> => {
    if (!api.setLawossYolo) throw new Error("yolo_unavailable");
    const yolo = await saveYoloMode({ setLawossYolo: api.setLawossYolo }, enabled);
    publishYoloMode(yolo);
    await reload(api, state.workspaceId);
    return { yolo };
  };
  const askBeforeChanges = async (state: AgentState): Promise<Partial<AgentState>> => {
    const { workspaceId, permission } = state;
    if (!api.patchConfig || !workspaceId || !permission) throw new Error("permissions_unavailable");
    const control = firmControl(firm);
    if (control === "locked") throw new Error("permissions_locked");
    const patch = askPatch(permission);
    const write = async () => {
      await api.patchConfig?.(workspaceId, { opencode: { permission: patch } });
      await reload(api, workspaceId);
    };
    if (control === "firm") {
      if (!deps.releaseFirm || !(await deps.releaseFirm(write))) return {};
      // Po uvoľnení firemného pravidla platí vlastné „ask“.
      const next = applyPermissionPatch(permission, patch);
      return { edits: effectiveEdits(next, null), permission: next };
    }
    await write();
    const next = applyPermissionPatch(permission, patch);
    return { edits: effectiveEdits(next, firm), permission: next };
  };
  return { setYolo, askBeforeChanges };
}

export function useAgentMode(api: AgentModeApi, active: boolean, firm: FirmPermissions = null, deps: AgentModeDeps = {}) {
  const [state, setState] = useState<AgentState>({ yolo: null, edits: "unknown", loading: true });
  const [saving, setSaving] = useState(false);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!active) return;
    let cancelled = false;
    setState((current) => ({ ...current, loading: true }));
    void loadAgentState(api, firm).then((next) => { if (!cancelled) setState({ ...next, loading: false }); });
    return () => { cancelled = true; };
  }, [api, active, firm]);
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
  const actions = agentActions(api, firm, deps);
  return {
    state,
    saving,
    failed,
    control: firmControl(firm),
    setYolo: (enabled: boolean) => run(() => actions.setYolo(state, enabled)),
    askBeforeChanges: () => run(() => actions.askBeforeChanges(state)),
    canWrite: Boolean(api.canApprove),
  };
}
