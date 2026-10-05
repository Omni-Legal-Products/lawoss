/**
 * Skill nainštalovaný do priečinka (`.opencode/skills/<meno>`) engine nevidí, kým si neobnoví
 * zoznam príkazov. Upstream to robí automatickým reloadom len na obrazovke rozhovoru; z pohľadov
 * LAWOSS (Klienti, Roztriedenie) sa preto prvá správa `/roztried-spis` skončila „Command not found“
 * (test so skutočným modelom 5. 10. 2026). Pred otvorením rozhovoru overíme, že engine skill vidí,
 * a ak nie, obnovíme ho tou istou cestou ako upstream (`reloadEngine`), no nikdy počas bežiacej úlohy.
 */
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { createClient } from "@/app/lib/opencode";
import { listCommands } from "@/app/lib/opencode-session";
import { toSessionTransportDirectory } from "@/app/lib/session-scope";
import { resolveWorkspaceEndpoint } from "@/app/lib/workspace-endpoint";
import { useSessionActivityStore, type SessionActivityStatus } from "@/react-app/domains/session/status/session-activity-store";
import type { RouteWorkspace } from "@/react-app/shell/route-workspaces";

export type SkillEngine = {
  /** Mená príkazov, ktoré engine pre priečinok práve pozná (skilly sú medzi nimi). */
  commandNames(): Promise<string[]>;
  /** Obnoví engine priečinka; preruší bežiace úlohy, preto len keď `busy()` je false. */
  reload(): Promise<void>;
  busy(): boolean;
};
export type SkillAvailability = "ready" | "reloaded" | "busy" | "missing";

const LIVE: readonly SessionActivityStatus[] = ["thinking", "responding", "compacting", "waiting"];
const wait = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** `ready` bez zásahu, `reloaded` po obnove, `busy` keď beží úloha (neobnovujeme), `missing` keď ani obnova nepomohla. */
export async function ensureSkillAvailable(engine: SkillEngine, name: string, options: { attempts?: number; delayMs?: number; sleep?: (ms: number) => Promise<void> } = {}): Promise<SkillAvailability> {
  const sleep = options.sleep ?? wait;
  if ((await engine.commandNames()).includes(name)) return "ready";
  if (engine.busy()) return "busy";
  await engine.reload();
  for (let attempt = 0; attempt < (options.attempts ?? 10); attempt++) {
    if ((await engine.commandNames()).includes(name)) return "reloaded";
    await sleep(options.delayMs ?? 500);
  }
  return "missing";
}

export const liveSessionActivity = (): boolean =>
  Object.values(useSessionActivityStore.getState().statusesByWorkspaceId).some((sessions) => Object.values(sessions).some((status) => LIVE.includes(status)));

/**
 * Po zápise skillov (onboarding, otvorenie klienta) obnoví engine priestoru, aby ich hneď videl.
 * Počas bežiacej úlohy nič nerobí; zmenu potom prevezme automatický reload upstreamu, keď je pokoj.
 */
export async function reloadAfterSkillWrites(client: Partial<Pick<LegalworkServerClient, "reloadEngine">>, workspaceId: string, written: readonly string[], busy: () => boolean = liveSessionActivity): Promise<boolean> {
  if (!written.length || !client.reloadEngine || busy()) return false;
  try { await client.reloadEngine(workspaceId); return true; }
  catch (error) { console.warn("[lawoss] engine reload after skill install failed", error); return false; }
}

/** Engine pracovného priestoru cez rovnaké spojenie ako rozhovory LAWOSS. */
export function workspaceSkillEngine(connection: { client: Pick<LegalworkServerClient, "reloadEngine"> | null; baseUrl: string; token: string }, workspace: RouteWorkspace): SkillEngine | null {
  const endpoint = resolveWorkspaceEndpoint(workspace, { baseUrl: connection.baseUrl, token: connection.token });
  if (!endpoint || !connection.client) return null;
  const directory = toSessionTransportDirectory(workspace.path) || undefined;
  const opencode = createClient(endpoint.opencodeBaseUrl, directory, { token: endpoint.token, mode: "legalwork" });
  const client = connection.client;
  return {
    commandNames: async () => (await listCommands(opencode, directory)).map((command) => command.name),
    reload: async () => { await client.reloadEngine(workspace.id); },
    busy: liveSessionActivity,
  };
}
