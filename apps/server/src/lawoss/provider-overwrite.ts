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
