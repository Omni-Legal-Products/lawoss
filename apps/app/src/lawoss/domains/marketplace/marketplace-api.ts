/**
 * LAWOSS: klient routes `/lawoss/marketplace` (server `apps/server/src/lawoss/marketplace-routes.ts`).
 * Do `createLegalworkServerClient` sa pripája jedným riadkom (`lawossMarketplace`).
 */
import type { ImportedPlugin } from "../../../app/lib/extension-imports";

export type FileResolution = "keep" | "replace" | "backup";
export type FileChange = { path: string; title: string; state: "modified" | "missing" };
export type PluginUpdate = { pluginId: string; name: string; installed: string | null; available: string; path: string };
export type MarketplaceCheck =
  | { status: "ok"; release: { tag: string; sha: string; publishedAt: string | null; source: "release" | "tag"; plugins: Array<{ name: string; version: string; path: string }> } }
  | { status: "no_release" }
  | { status: "error"; message: string };

export type MarketplaceView = {
  global: ImportedPlugin[];
  globalChanges: Record<string, FileChange[]>;
  /** Doterajšie inštalácie len v tomto priečinku (pred inštaláciou pre všetkých klientov). */
  workspace: ImportedPlugin[];
  settings: { weeklyCheck: boolean; lastCheckedAt: number | null };
  check: MarketplaceCheck | null;
  updates: PluginUpdate[];
};

export type NeedsDecision = { status: "needs_decision"; changes: FileChange[] };
export type InstallOutcome = { status: "installed" | "already_installed"; item: ImportedPlugin };
export type UpdateOutcome = NeedsDecision | { status: "updated"; item: ImportedPlugin; backups: string[]; kept: string[] };
export type RemoveOutcome = NeedsDecision | { status: "removed"; item: ImportedPlugin; backups: string[] };
export type MoveOutcome = NeedsDecision | { status: "moved"; item: ImportedPlugin; backups: string[]; carried: string[] };
export type Resolutions = Readonly<Record<string, FileResolution>>;

type RequestInit = { method?: string; body?: unknown };
export type LawossRequest = <T>(path: string, init?: RequestInit) => Promise<T>;

const query = (workspaceId?: string | null) => (workspaceId ? `?workspaceId=${encodeURIComponent(workspaceId)}` : "");

export function lawossMarketplaceMethods(request: LawossRequest) {
  return {
    view: (workspaceId?: string | null) => request<MarketplaceView>(`/lawoss/marketplace${query(workspaceId)}`),
    check: (reason: "open" | "manual", workspaceId?: string | null) =>
      request<MarketplaceView>("/lawoss/marketplace/check", { method: "POST", body: { reason, workspaceId: workspaceId ?? null } }),
    setWeeklyCheck: (weeklyCheck: boolean) =>
      request<MarketplaceView["settings"]>("/lawoss/marketplace/settings", { method: "PUT", body: { weeklyCheck } }),
    install: (url: string) => request<InstallOutcome>("/lawoss/marketplace/plugins", { method: "POST", body: { url } }),
    update: (pluginId: string, resolutions: Resolutions = {}) =>
      request<UpdateOutcome>("/lawoss/marketplace/plugins/update", { method: "POST", body: { pluginId, resolutions } }),
    remove: (pluginId: string, resolutions: Resolutions = {}) =>
      request<RemoveOutcome>("/lawoss/marketplace/plugins/remove", { method: "POST", body: { pluginId, resolutions } }),
    move: (workspaceId: string, pluginId: string, url: string, resolutions: Resolutions = {}) =>
      request<MoveOutcome>("/lawoss/marketplace/plugins/move", { method: "POST", body: { workspaceId, pluginId, url, resolutions } }),
  };
}

export type LawossMarketplaceApi = ReturnType<typeof lawossMarketplaceMethods>;
