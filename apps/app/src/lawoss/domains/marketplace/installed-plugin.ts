/**
 * LAWOSS: čo o nainštalovanom plugine zapísal server (`apps/server/src/lawoss/plugin-provenance.ts`):
 * repozitár, pripnutý SHA a verzia z `plugin.json`. Staršie inštalácie pôvod nemajú.
 * Porovnanie s katalógom je bez siete; pripravuje budúce aktualizácie z vydaní marketplace.
 */
import type { ImportedPlugin } from "../../../app/lib/extension-imports";
import type { MarketplaceEntry } from "./catalog";

export type InstalledProvenance = { repository: string; ref: string; version: string | null };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);

export function installedProvenance(plugin: ImportedPlugin): InstalledProvenance | null {
  const raw: unknown = Reflect.get(plugin, "provenance");
  if (!isRecord(raw) || !isRecord(raw.source)) return null;
  const { owner, repo, ref } = raw.source;
  if (typeof owner !== "string" || typeof repo !== "string" || typeof ref !== "string") return null;
  return { repository: `${owner}/${repo}`, ref, version: typeof raw.version === "string" ? raw.version : null };
}

/** `newer`: katalóg má inú verziu než nainštalovaná; `unknown`: inštalácia bez zapísaného pôvodu. */
export function catalogUpdateState(entry: MarketplaceEntry, plugin: ImportedPlugin): "current" | "newer" | "unknown" {
  const installed = installedProvenance(plugin);
  if (!installed?.version || !entry.version) return "unknown";
  return installed.version === entry.version ? "current" : "newer";
}
