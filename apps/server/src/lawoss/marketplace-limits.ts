/**
 * LAWOSS (#420, #421): limity veľkosti textových prostriedkov Node doplnku.
 *
 * Katalóg LAWOSS Marketplace dodáva runtime registrov ako jeden súbor zbalený cez esbuild,
 * aby sa spustil bez `npm ci` (kancelárie za firewallom, ktorý rozbaľuje TLS, ho nespustia).
 * Takéto súbory majú 1–7 MB, preto pre doplnok z dôveryhodného zdroja platí vyšší limit.
 * Dôveryhodný zdroj je presne repozitár LAWOSS Marketplace, pripnutý commit (40 hex znakov)
 * a koreň doplnku `plugins/<názov>/` (rovnaký tvar ako `assertMarketplaceUrl`).
 * Každý iný import z GitHubu ostáva pri pôvodných limitoch upstream (1 MiB a 8 MiB).
 * Meniť sa len limity; zoznam povolených mien, 128 súborov a odmietnutie binárnych súborov
 * ostávajú v importéri bez zmeny.
 */
import { MARKETPLACE_OWNER, MARKETPLACE_REPO } from "./marketplace-updates.js";

const MIB = 1024 * 1024;

export type PluginResourceLimits = { fileBytes: number; totalBytes: number };

export const GENERIC_PLUGIN_RESOURCE_LIMITS: PluginResourceLimits = { fileBytes: 1 * MIB, totalBytes: 8 * MIB };
export const MARKETPLACE_PLUGIN_RESOURCE_LIMITS: PluginResourceLimits = { fileBytes: 8 * MIB, totalBytes: 24 * MIB };

const PINNED_COMMIT = /^[a-f0-9]{40}$/;
const PLUGIN_ROOT = /^plugins\/[a-z0-9-]+\/$/;

/** Je to doplnok z LAWOSS Marketplace na pripnutom commite? Rozhoduje vyriešený zdroj, nie text URL. */
export function isPinnedMarketplaceSource(source: { owner: string; repo: string }, ref: string, root: string): boolean {
  return source.owner === MARKETPLACE_OWNER && source.repo === MARKETPLACE_REPO && PINNED_COMMIT.test(ref) && PLUGIN_ROOT.test(root);
}

export function pluginResourceLimits(source: { owner: string; repo: string }, ref: string, root: string): PluginResourceLimits {
  return isPinnedMarketplaceSource(source, ref, root) ? MARKETPLACE_PLUGIN_RESOURCE_LIMITS : GENERIC_PLUGIN_RESOURCE_LIMITS;
}

/** „1 MiB“, „8 MiB“, „24 MiB“: pôvodné texty chýb upstream ostanú pri všeobecnom zdroji rovnaké. */
export function formatMiB(bytes: number): string {
  return `${Math.round((bytes / MIB) * 100) / 100} MiB`;
}
