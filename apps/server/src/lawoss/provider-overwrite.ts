/**
 * LAWOSS: vlastní poskytovatelia AI sú globálni (GLOBAL_PROVIDERS_ID), ale starší stav môže mať
 * blok s rovnakým id v riadku iného priečinka (klienta). Úprava v jednom klientovi by ho zmazala
 * a ten klient by začal používať cudzí endpoint. Rozdielny blok sa preto prepíše až po výslovnom
 * potvrdení (rozhodnutie MČ 12. 10. 2026, review VŘ k #136, bod 3).
 */
import { isDeepStrictEqual } from "node:util";

export type LegacyProviderRow = {
  id: string;
  name: string;
  /** Poskytovatelia uložení v riadku priečinka (starý stav pred globálnym riadkom). */
  providers: Record<string, unknown>;
};

export type ProviderOverwriteConflict = {
  providerId: string;
  workspaces: { id: string; name: string }[];
  /** `endpoint_change`: klienti by po uložení posielali dáta na inú adresu servera. */
  reason?: "endpoint_change";
};

/**
 * Bloky iných priečinkov, ktoré by úprava prepísala alebo zmazala a ktoré sa líšia od nového bloku
 * aj od bloku, ktorý doteraz platil v upravovanom priečinku. Zhodné bloky nie sú konflikt.
 */
export function providerOverwriteConflicts(input: {
  workspaceId: string;
  update: Record<string, unknown>;
  /** Blok platný v upravovanom priečinku pred úpravou (jeho starý blok, inak globálny). */
  previous: Record<string, unknown>;
  rows: readonly LegacyProviderRow[];
}): ProviderOverwriteConflict[] {
  const conflicts: ProviderOverwriteConflict[] = [];
  for (const [providerId, next] of Object.entries(input.update)) {
    const workspaces = input.rows
      .filter((row) => row.id !== input.workspaceId && Object.hasOwn(row.providers, providerId))
      .filter((row) => {
        const block = row.providers[providerId];
        return !isDeepStrictEqual(block, next) && !isDeepStrictEqual(block, input.previous[providerId]);
      })
      .map((row) => ({ id: row.id, name: row.name }));
    if (workspaces.length) conflicts.push({ providerId, workspaces });
  }
  return conflicts;
}

/** Adresa servera poskytovateľa (protokol, hostiteľ, port); bez `baseURL` platí predvolená adresa poskytovateľa. */
export function providerEndpoint(block: unknown): string {
  const options = typeof block === "object" && block !== null && "options" in block ? block.options : undefined;
  const baseURL = typeof options === "object" && options !== null && "baseURL" in options ? options.baseURL : undefined;
  if (typeof baseURL !== "string" || !baseURL.trim()) return "";
  try { return new URL(baseURL.trim()).origin.toLowerCase(); } catch { return baseURL.trim().toLowerCase(); }
}

/** Domovský priestor appky (`lawoss-domov`) nemá klientske dáta a advokát ho nevidí. */
const isHomeWorkspace = (path: string | undefined) => (path ?? "").split(/[\\/]+/).filter(Boolean).at(-1) === "lawoss-domov";

/**
 * Klienti, ktorí by po úprave globálneho poskytovateľa posielali dáta na inú adresu servera, aj keď majú
 * rovnaký starý blok alebo len globálny. Zmena adresy vyžaduje potvrdenie vždy (rozhodnutie MČ 13. 10. 2026,
 * review VŘ k #136: lokálny model sa nesmie potichu zmeniť na vzdialený). Nový poskytovateľ, ktorého klient
 * doteraz nemal, ani odpojenie (`null`) nie sú zmena adresy.
 */
export function endpointChangeConflicts(input: {
  workspaceId: string;
  update: Record<string, unknown>;
  globalProviders: Record<string, unknown>;
  workspaces: readonly (LegacyProviderRow & { path?: string })[];
}): ProviderOverwriteConflict[] {
  const conflicts: ProviderOverwriteConflict[] = [];
  for (const [providerId, next] of Object.entries(input.update)) {
    if (next === null || typeof next !== "object") continue;
    const workspaces = input.workspaces
      .filter((row) => row.id !== input.workspaceId && !isHomeWorkspace(row.path))
      .filter((row) => {
        const effective = Object.hasOwn(row.providers, providerId) ? row.providers[providerId] : input.globalProviders[providerId];
        return effective !== undefined && effective !== null && providerEndpoint(effective) !== providerEndpoint(next);
      })
      .map((row) => ({ id: row.id, name: row.name }));
    if (workspaces.length) conflicts.push({ providerId, workspaces, reason: "endpoint_change" });
  }
  return conflicts;
}

/** Zlúči konflikty podľa poskytovateľa; zmena adresy má prednosť pri texte potvrdenia. */
export function mergeProviderConflicts(...lists: ProviderOverwriteConflict[][]): ProviderOverwriteConflict[] {
  const merged = new Map<string, ProviderOverwriteConflict>();
  for (const conflict of lists.flat()) {
    const current = merged.get(conflict.providerId);
    if (!current) { merged.set(conflict.providerId, { ...conflict, workspaces: [...conflict.workspaces] }); continue; }
    for (const workspace of conflict.workspaces) if (!current.workspaces.some((item) => item.id === workspace.id)) current.workspaces.push(workspace);
    if (conflict.reason === "endpoint_change") current.reason = "endpoint_change";
  }
  return [...merged.values()];
}
