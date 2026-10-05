/**
 * LAWOSS: kontrola aktualizácií LAWOSS Marketplace (rozhodnutie MČ 5. 10. 2026, ADR 0015 body 5 a 6).
 *
 * - Zdroj sú vydania (tagy) repozitára `Omni-Legal-Products/lawoss-marketplace`, nie `main`:
 *   `releases/latest`, bez vydania najvyšší tag `vX.Y.Z`; tag sa preloží na SHA a z neho sa
 *   prečíta `.claude-plugin/marketplace.json` (verzie a cesty pluginov).
 * - Kontrola beží pri otvorení LAWOSS Marketplace, tlačidlom „Skontrolovať aktualizácie“
 *   a automaticky raz za týždeň. Týždenná kontrola je jediná výnimka z pravidla „žiadna sieť
 *   bez akcie používateľa“: ide len na `api.github.com/repos/Omni-Legal-Products/lawoss-marketplace/…`
 *   a raw obsah toho istého repozitára, nikdy hneď pri štarte (rozhoduje uplynutý čas od
 *   poslednej kontroly, nie štart), dá sa vypnúť a sama nič neinštaluje.
 * - Stav (nastavenie, naposledy skontrolované, výsledok) je v `lawoss-marketplace.json`
 *   vedľa `runtime.sqlite`.
 *
 * Stráž `lawoss/scripts/check-no-eigenwelt.mjs` drží adresy a interval v tomto súbore.
 */
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

import type { ServerConfig } from "../types.js";

export const MARKETPLACE_OWNER = "Omni-Legal-Products";
export const MARKETPLACE_REPO = "lawoss-marketplace";
const DEFAULT_API_BASE = "https://api.github.com";
const DEFAULT_RAW_BASE = "https://raw.githubusercontent.com";

/** Raz za týždeň. */
export const WEEKLY_CHECK_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000;
/** Prvé vyhodnotenie až chvíľu po štarte servera, potom raz za hodinu (len porovnanie času, bez siete). */
const FIRST_EVALUATION_DELAY_MS = 10 * 60 * 1000;
const EVALUATION_PERIOD_MS = 60 * 60 * 1000;
/** Opakované otvorenie Marketplace v krátkom čase použije posledný výsledok (limit GitHub API). */
const OPEN_COOLDOWN_MS = 15 * 60 * 1000;

export type MarketplaceReleasePlugin = { name: string; version: string; path: string };
export type MarketplaceRelease = {
  tag: string;
  sha: string;
  publishedAt: string | null;
  /** `release`: GitHub Release; `tag`: tag bez vydania. */
  source: "release" | "tag";
  plugins: MarketplaceReleasePlugin[];
};
export type MarketplaceCheck =
  | { status: "ok"; release: MarketplaceRelease }
  | { status: "no_release" }
  | { status: "error"; message: string };

export type MarketplaceUpdateState = {
  weeklyCheck: boolean;
  /** Kedy server prvýkrát vyhodnotil týždennú kontrolu; od neho beží prvý týždeň. */
  anchorAt: number | null;
  lastCheckedAt: number | null;
  lastCheck: MarketplaceCheck | null;
};

export const DEFAULT_UPDATE_STATE: MarketplaceUpdateState = { weeklyCheck: true, anchorAt: null, lastCheckedAt: null, lastCheck: null };

type Fetch = (url: string, init?: RequestInit) => Promise<Response>;

const isRecord = (value: unknown): value is Record<string, unknown> =>
  Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value: unknown): string | null => (typeof value === "string" && value.trim() ? value.trim() : null);
const time = (value: unknown): number | null => (typeof value === "number" && Number.isFinite(value) ? value : null);

function apiBase(): string {
  return (process.env.LEGALWORK_GITHUB_API_BASE?.trim() || DEFAULT_API_BASE).replace(/\/+$/, "");
}

function rawBase(): string {
  return (process.env.LEGALWORK_GITHUB_RAW_BASE?.trim() || DEFAULT_RAW_BASE).replace(/\/+$/, "");
}

/** Jediné adresy, na ktoré tento modul siaha: API a raw obsah repozitára marketplace. */
export function marketplaceApiUrl(path: string): string {
  return `${apiBase()}/repos/${MARKETPLACE_OWNER}/${MARKETPLACE_REPO}/${path}`;
}

export function marketplaceRawUrl(sha: string, path: string): string {
  return `${rawBase()}/${MARKETPLACE_OWNER}/${MARKETPLACE_REPO}/${encodeURIComponent(sha)}/${path}`;
}

export function marketplacePluginUrl(sha: string, path: string): string {
  return `https://github.com/${MARKETPLACE_OWNER}/${MARKETPLACE_REPO}/tree/${sha}/${path}`;
}

const SEMVER_TAG = /^v?(\d+)\.(\d+)\.(\d+)$/;

/** Najvyšší tag v tvare `vX.Y.Z` (alebo `X.Y.Z`); iné tagy sa ignorujú. */
export function highestVersionTag(names: readonly string[]): string | null {
  const versions = names.flatMap((name) => {
    const match = SEMVER_TAG.exec(name);
    return match ? [{ name, parts: match.slice(1).map(Number) }] : [];
  });
  const compare = (a: number[], b: number[]) => {
    for (let index = 0; index < 3; index += 1) if ((a[index] ?? 0) !== (b[index] ?? 0)) return (a[index] ?? 0) - (b[index] ?? 0);
    return 0;
  };
  versions.sort((a, b) => compare(b.parts, a.parts));
  return versions[0]?.name ?? null;
}

async function getJson(fetchImpl: Fetch, url: string): Promise<{ status: number; body: unknown }> {
  const response = await fetchImpl(url, {
    headers: { Accept: "application/vnd.github+json", "User-Agent": "lawoss-marketplace-check" },
    signal: AbortSignal.timeout(20_000),
  });
  if (response.status === 404) return { status: 404, body: null };
  if (!response.ok) throw new Error(`GitHub ${response.status}: ${url}`);
  return { status: response.status, body: await response.json() };
}

/** Verzie a cesty pluginov z `.claude-plugin/marketplace.json` daného commitu. */
export function releasePlugins(manifest: unknown): MarketplaceReleasePlugin[] {
  const plugins = isRecord(manifest) && Array.isArray(manifest.plugins) ? manifest.plugins : [];
  return plugins.flatMap((plugin) => {
    if (!isRecord(plugin)) return [];
    const name = text(plugin.name);
    const version = text(plugin.version);
    const source = text(plugin.source);
    if (!name || !version || !source) return [];
    const path = source.replace(/^\.\//, "").replace(/\/+$/, "");
    return /^plugins\/[a-z0-9-]+$/.test(path) ? [{ name, version, path }] : [];
  });
}

/** Zistí posledné vydanie marketplace. Nič neinštaluje. */
export async function checkMarketplaceRelease(fetchImpl: Fetch = fetch): Promise<MarketplaceCheck> {
  try {
    let tag: string | null = null;
    let publishedAt: string | null = null;
    let source: MarketplaceRelease["source"] = "release";
    const latest = await getJson(fetchImpl, marketplaceApiUrl("releases/latest"));
    if (latest.status === 200 && isRecord(latest.body)) {
      tag = text(latest.body.tag_name);
      publishedAt = text(latest.body.published_at);
    }
    if (!tag) {
      source = "tag";
      const tags = await getJson(fetchImpl, marketplaceApiUrl("tags?per_page=100"));
      const names = Array.isArray(tags.body) ? tags.body.flatMap((item) => (isRecord(item) && text(item.name) ? [text(item.name)!] : [])) : [];
      tag = highestVersionTag(names);
    }
    if (!tag) return { status: "no_release" };
    const commit = await getJson(fetchImpl, marketplaceApiUrl(`commits/${encodeURIComponent(tag)}`));
    const sha = isRecord(commit.body) ? text(commit.body.sha) : null;
    if (!sha || !/^[a-f0-9]{40}$/.test(sha)) throw new Error(`Tag ${tag} has no commit`);
    const manifest = await fetchImpl(marketplaceRawUrl(sha, ".claude-plugin/marketplace.json"), {
      headers: { Accept: "text/plain", "User-Agent": "lawoss-marketplace-check" },
      signal: AbortSignal.timeout(20_000),
    });
    if (!manifest.ok) throw new Error(`GitHub ${manifest.status}: marketplace.json`);
    return { status: "ok", release: { tag, sha, publishedAt, source, plugins: releasePlugins(JSON.parse(await manifest.text())) } };
  } catch (error) {
    return { status: "error", message: error instanceof Error ? error.message : String(error) };
  }
}

// --- Stav ---------------------------------------------------------------------

export function marketplaceStatePath(config: Pick<ServerConfig, "configPath">): string {
  const override = process.env.LEGALWORK_RUNTIME_DB?.trim();
  if (override) return join(dirname(resolve(override)), "lawoss-marketplace.json");
  const configPath = config.configPath?.trim();
  return join(configPath ? dirname(configPath) : resolve(homedir(), ".config", "legalwork"), "lawoss-marketplace.json");
}

function readCheck(value: unknown): MarketplaceCheck | null {
  if (!isRecord(value)) return null;
  if (value.status === "no_release") return { status: "no_release" };
  if (value.status === "error") return { status: "error", message: text(value.message) ?? "" };
  if (value.status !== "ok" || !isRecord(value.release)) return null;
  const release = value.release;
  const tag = text(release.tag);
  const sha = text(release.sha);
  if (!tag || !sha) return null;
  return {
    status: "ok",
    release: {
      tag, sha, publishedAt: text(release.publishedAt), source: release.source === "tag" ? "tag" : "release",
      plugins: releasePlugins({ plugins: Array.isArray(release.plugins) ? release.plugins.map((plugin) => isRecord(plugin) ? { ...plugin, source: plugin.path } : plugin) : [] }),
    },
  };
}

export async function readUpdateState(path: string): Promise<MarketplaceUpdateState> {
  try {
    const raw: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!isRecord(raw)) return DEFAULT_UPDATE_STATE;
    return {
      weeklyCheck: raw.weeklyCheck !== false,
      anchorAt: time(raw.anchorAt),
      lastCheckedAt: time(raw.lastCheckedAt),
      lastCheck: readCheck(raw.lastCheck),
    };
  } catch {
    return DEFAULT_UPDATE_STATE;
  }
}

let writeChain: Promise<unknown> = Promise.resolve();

export async function updateUpdateState(path: string, change: (state: MarketplaceUpdateState) => MarketplaceUpdateState): Promise<MarketplaceUpdateState> {
  const run = writeChain.then(async () => {
    const next = change(await readUpdateState(path));
    await mkdir(dirname(path), { recursive: true });
    const temp = `${path}.${process.pid}.tmp`;
    await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, "utf8");
    await rename(temp, path);
    return next;
  });
  writeChain = run.catch(() => undefined);
  return run;
}

/** Týždenná kontrola je na rade, len keď je zapnutá a od poslednej kontroly (alebo prvého spustenia) uplynul týždeň. */
export function isWeeklyCheckDue(state: MarketplaceUpdateState, now: number): boolean {
  if (!state.weeklyCheck) return false;
  const since = state.lastCheckedAt ?? state.anchorAt;
  return since !== null && now - since >= WEEKLY_CHECK_INTERVAL_MS;
}

export type CheckReason = "open" | "manual" | "weekly";

/** Kontrola s uložením výsledku. Pri otvorení Marketplace krátko po poslednej kontrole vráti uložený stav. */
export async function runMarketplaceCheck(path: string, reason: CheckReason, options: { now?: () => number; fetchImpl?: Fetch } = {}): Promise<MarketplaceUpdateState> {
  const now = options.now ?? Date.now;
  const current = await readUpdateState(path);
  if (reason === "open" && current.lastCheckedAt !== null && now() - current.lastCheckedAt < OPEN_COOLDOWN_MS) return current;
  const result = await checkMarketplaceRelease(options.fetchImpl);
  return updateUpdateState(path, (state) => ({ ...state, lastCheckedAt: now(), lastCheck: result, anchorAt: state.anchorAt ?? now() }));
}

/** Jeden krok plánovača: prvýkrát len zapíše začiatok týždňa, inak skontroluje, ak uplynul týždeň. */
export async function weeklyTick(path: string, options: { now?: () => number; fetchImpl?: Fetch } = {}): Promise<"anchored" | "checked" | "idle"> {
  const now = options.now ?? Date.now;
  const state = await readUpdateState(path);
  if (state.anchorAt === null && state.lastCheckedAt === null) {
    await updateUpdateState(path, (current) => ({ ...current, anchorAt: current.anchorAt ?? now() }));
    return "anchored";
  }
  if (!isWeeklyCheckDue(state, now())) return "idle";
  await runMarketplaceCheck(path, "weekly", options);
  return "checked";
}

/** Plánovač týždennej kontroly v procese servera. Bez zapisovania (read-only) alebo s `LAWOSS_MARKETPLACE_WEEKLY_CHECK=0` nebeží. */
export function startWeeklyMarketplaceCheck(config: Pick<ServerConfig, "configPath" | "readOnly">): () => void {
  if (config.readOnly || process.env.LAWOSS_MARKETPLACE_WEEKLY_CHECK === "0") return () => undefined;
  const path = marketplaceStatePath(config);
  const tick = () => { void weeklyTick(path).catch(() => undefined); };
  let interval: ReturnType<typeof setInterval> | null = null;
  const first = setTimeout(() => {
    tick();
    interval = setInterval(tick, EVALUATION_PERIOD_MS);
    interval.unref?.();
  }, FIRST_EVALUATION_DELAY_MS);
  first.unref?.();
  return () => {
    clearTimeout(first);
    if (interval) clearInterval(interval);
  };
}
