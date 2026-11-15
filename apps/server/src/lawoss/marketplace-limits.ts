/**
 * LAWOSS (#420, #421): limity veľkosti textových prostriedkov Node doplnku.
 *
 * Katalóg LAWOSS Marketplace dodáva runtime registrov ako jeden súbor zbalený cez esbuild,
 * aby sa spustil bez `npm ci` (kancelárie za firewallom, ktorý rozbaľuje TLS, ho nespustia).
 * Takéto súbory majú 1–7 MB, preto pre doplnok z dôveryhodného zdroja platí vyšší limit.
 *
 * Dôveryhodný zdroj je repozitár LAWOSS Marketplace, koreň `plugins/<názov>/` a commit, ktorému
 * verí appka sama: commit pribaleného katalógu (`BUNDLED_MARKETPLACE_REF`) alebo SHA vydania, ktoré
 * vyriešila vlastná kontrola aktualizácií servera (`trustedReleaseRefs`). Samotný 40-hex SHA
 * v repozitári organizácie nestačí: GitHub vydá pod `git/trees/<sha>` a raw adresou rodiča aj commit,
 * ktorý existuje len vo forku, a URL inštalácie prichádza v tele požiadavky.
 * Každý iný import z GitHubu ostáva pri pôvodných limitoch upstream (1 MiB a 8 MiB).
 * Zoznam povolených mien, 128 súborov a odmietnutie binárnych súborov ostávajú v importéri.
 */
import { ApiError } from "../errors.js";
import { BUNDLED_MARKETPLACE_REF } from "./marketplace-bundled-ref.js";
import { MARKETPLACE_OWNER, MARKETPLACE_REPO, type MarketplaceUpdateState } from "./marketplace-updates.js";
import { PluginSourceTooLargeError } from "./plugin-source-fetch.js";

const MIB = 1024 * 1024;

export type PluginResourceLimits = { fileBytes: number; totalBytes: number };

export const GENERIC_PLUGIN_RESOURCE_LIMITS: PluginResourceLimits = { fileBytes: 1 * MIB, totalBytes: 8 * MIB };
export const MARKETPLACE_PLUGIN_RESOURCE_LIMITS: PluginResourceLimits = { fileBytes: 8 * MIB, totalBytes: 24 * MIB };

const PINNED_COMMIT = /^[a-f0-9]{40}$/;
const PLUGIN_ROOT = /^plugins\/[a-z0-9-]+\/$/;

/** SHA posledného vydania marketplace, ktoré server sám zistil (`marketplace-updates.ts`); nikdy z požiadavky. */
export function trustedReleaseRefs(state: Pick<MarketplaceUpdateState, "lastCheck">): string[] {
  const sha = state.lastCheck?.status === "ok" ? state.lastCheck.release.sha : null;
  return sha && PINNED_COMMIT.test(sha) ? [sha] : [];
}

/** Je to doplnok z LAWOSS Marketplace na commite, ktorému appka verí? Rozhoduje vyriešený zdroj, nie text URL. */
export function isTrustedMarketplaceSource(
  source: { owner: string; repo: string },
  ref: string,
  root: string,
  trustedRefs: readonly string[] = [],
): boolean {
  if (source.owner !== MARKETPLACE_OWNER || source.repo !== MARKETPLACE_REPO) return false;
  if (!PINNED_COMMIT.test(ref) || !PLUGIN_ROOT.test(root)) return false;
  return ref === BUNDLED_MARKETPLACE_REF || trustedRefs.includes(ref);
}

export function pluginResourceLimits(
  source: { owner: string; repo: string },
  ref: string,
  root: string,
  trustedRefs: readonly string[] = [],
): PluginResourceLimits {
  return isTrustedMarketplaceSource(source, ref, root, trustedRefs) ? MARKETPLACE_PLUGIN_RESOURCE_LIMITS : GENERIC_PLUGIN_RESOURCE_LIMITS;
}

/** „1 MiB“, „8 MiB“, „24 MiB“: pôvodné texty chýb upstream ostanú pri všeobecnom zdroji rovnaké. */
export function formatMiB(bytes: number): string {
  return `${Math.round((bytes / MIB) * 100) / 100} MiB`;
}

const fileTooLarge = (limits: PluginResourceLimits) =>
  new ApiError(400, "unsupported_plugin_resources", `Plugin resource is binary or exceeds ${formatMiB(limits.fileBytes)}`);
const totalTooLarge = (limits: PluginResourceLimits) =>
  new ApiError(400, "unsupported_plugin_resources", `Plugin resources exceed ${formatMiB(limits.totalBytes)}`);

export type PluginResourceEntry = { path: string; size: number | null };

/** Odmietnutie podľa veľkostí zo stromu GitHubu, skôr než sa stiahne čokoľvek. Neznáma veľkosť ostáva na strážach počas sťahovania. */
export function assertDeclaredResourceSizes(entries: readonly PluginResourceEntry[], limits: PluginResourceLimits): void {
  if (entries.some((entry) => entry.size !== null && entry.size > limits.fileBytes)) throw fileTooLarge(limits);
  if (entries.reduce((bytes, entry) => bytes + (entry.size ?? 0), 0) > limits.totalBytes) throw totalTooLarge(limits);
}

export type FetchResourceText<T> = (entry: T, options: { maxBytes: number; signal: AbortSignal }) => Promise<string>;

/**
 * Stiahne prostriedky balíka najviac `concurrency` naraz so spoločným počítadlom bajtov. Každé
 * sťahovanie dostane strop `min(limit súboru, zvyšok celkového limitu)`; prvé porušenie (alebo iná
 * chyba) zruší ostatné sťahovania a nové sa už nezačnú. Celkový súčet sa pripočíta po dokončení
 * súboru, takže v pamäti je naraz najviac celkový limit plus `concurrency` × limit súboru.
 */
export async function downloadPluginResources<T extends PluginResourceEntry>(
  entries: readonly T[],
  limits: PluginResourceLimits,
  fetchText: FetchResourceText<T>,
  concurrency = 6,
): Promise<Array<T & { content: string }>> {
  assertDeclaredResourceSizes(entries, limits);
  const controller = new AbortController();
  const results: Array<T & { content: string }> = new Array(entries.length);
  let next = 0;
  let total = 0;
  let failure: { error: unknown } | null = null;
  const fail = (error: unknown) => {
    if (failure) return;
    failure = { error };
    controller.abort(error);
  };
  const download = async (entry: T): Promise<T & { content: string }> => {
    const remaining = limits.totalBytes - total;
    const maxBytes = Math.min(limits.fileBytes, remaining);
    const content = await fetchText(entry, { maxBytes, signal: controller.signal }).catch((error: unknown) => {
      if (error instanceof PluginSourceTooLargeError) throw maxBytes < limits.fileBytes ? totalTooLarge(limits) : fileTooLarge(limits);
      throw error;
    });
    const bytes = Buffer.byteLength(content);
    if (content.includes("\0") || bytes > limits.fileBytes) throw fileTooLarge(limits);
    total += bytes;
    if (total > limits.totalBytes) throw totalTooLarge(limits);
    return { ...entry, content };
  };
  const worker = async () => {
    while (!failure && next < entries.length) {
      const index = next++;
      try {
        results[index] = await download(entries[index]!);
      } catch (error) {
        fail(error);
      }
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, entries.length) }, worker));
  if (failure !== null) throw (failure as { error: unknown }).error;
  return results;
}
