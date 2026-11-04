/**
 * LAWOSS (#356): MCP servery len pre priečinky, ktoré sa naozaj používajú.
 *
 * Engine (OpenCode 1.18.29) vytvára stav MCP lenivo pre každý priečinok: prvá požiadavka, ktorá
 * siahne na MCP (`/mcp…`, zoznam príkazov, nástroje, odoslanie správy), spustí všetky nakonfigurované
 * MCP servery pre ten priečinok (`MCP.state` v `packages/opencode/src/mcp/index.ts`). Hromadné obnovy
 * a synchronizácie servera ich preto spúšťali pre každého klienta (24 klientov × 6 doplnkov = 150 procesov).
 *
 * Priečinok je „živý“, keď LAWOSS pre neho prvýkrát pošle požiadavku, ktorá MCP v engine spustí
 * (otvorený klient: stav konektorov, príkazy, chat; Konektory daného priečinka). Hromadné obnovy
 * a synchronizácie MCP robia len pre živé priečinky; ostatným engine inštanciu len zahodia, aby ďalšie
 * otvorenie načítalo aktuálnu konfiguráciu. Pri prvom použití sa priečinku doplnia runtime MCP
 * (`restore`), ktoré inak dostával pri štarte appky.
 */
import type { ServerConfig } from "../types.js";

type LiveState = { live: Set<string>; pending: Map<string, Promise<void>> };

const states = new WeakMap<ServerConfig, LiveState>();

function state(config: ServerConfig): LiveState {
  let current = states.get(config);
  if (!current) {
    current = { live: new Set(), pending: new Map() };
    states.set(config, current);
  }
  return current;
}

const SESSION_RUN = /^\/session\/[^/]+\/(?:message|prompt_async|command|shell|summarize|init)$/;

/**
 * Cesty enginu, ktorých obsluha v 1.18.29 siaha na `MCP.Service` priamo alebo cez `Command`,
 * `ToolRegistry` či `SessionPrompt`. Ostatné (zoznam rozhovorov, `/path`, `/session/status`,
 * `/instance/dispose`) inštanciu zostavia bez MCP.
 */
export function touchesEngineMcp(method: string, path: string): boolean {
  const verb = method.toUpperCase();
  if (path === "/mcp" || path.startsWith("/mcp/")) return true;
  if (verb === "GET" && (path === "/command" || path === "/experimental/resource")) return true;
  if (verb === "GET" && (path === "/experimental/tool" || path.startsWith("/experimental/tool/"))) return true;
  return verb === "POST" && SESSION_RUN.test(path);
}

export function isMcpLive(config: ServerConfig, workspaceId: string): boolean {
  return state(config).live.has(workspaceId);
}

/**
 * Prvé použitie MCP v priečinku: označí ho za živý a raz spustí `restore`. Súbežné volania čakajú
 * na ten istý `restore`, neskoršie už nečakajú. Zlyhanie `restore` priečinok nechá živý (engine
 * MCP aj tak spustí z konfigurácie a hromadné obnovy ho potom opravia).
 */
export function enterMcpUse(config: ServerConfig, workspaceId: string, restore: () => Promise<void>): Promise<void> {
  const current = state(config);
  const pending = current.pending.get(workspaceId);
  if (pending) return pending;
  if (current.live.has(workspaceId)) return Promise.resolve();
  current.live.add(workspaceId);
  const run = Promise.resolve()
    .then(restore)
    .catch(() => undefined)
    .finally(() => { current.pending.delete(workspaceId); });
  current.pending.set(workspaceId, run);
  return run;
}
