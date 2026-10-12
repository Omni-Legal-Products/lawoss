/**
 * LAWOSS: vlastní poskytovatelia AI sú globálni. Ak má iný klient blok s rovnakým id a iným
 * obsahom, server odpovie 409 `provider_conflict` a nezapíše nič; uloženie prebehne až po
 * výslovnom potvrdení (`confirmProviderOverwrite`). Rozhodnutie MČ 12. 10. 2026, review VŘ k #136.
 */
import { t } from "@/i18n";

export type ProviderOverwriteConflict = {
  providerId: string;
  workspaces: { id: string; name: string }[];
};

type PendingConfirm = { conflicts: ProviderOverwriteConflict[]; resolve: (confirmed: boolean) => void };

let pending: PendingConfirm | null = null;
let hosts = 0;
const listeners = new Set<() => void>();
const emit = () => listeners.forEach((listener) => listener());

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function parseConflict(value: unknown): ProviderOverwriteConflict | null {
  if (!isRecord(value) || typeof value.providerId !== "string" || !Array.isArray(value.workspaces)) return null;
  const workspaces = value.workspaces.flatMap((item) =>
    isRecord(item) && typeof item.id === "string" && typeof item.name === "string" ? [{ id: item.id, name: item.name }] : [],
  );
  return { providerId: value.providerId, workspaces };
}

/** Konflikty z chyby 409 `provider_conflict`; pri inej chybe null. */
export function providerOverwriteConflictsFrom(error: unknown): ProviderOverwriteConflict[] | null {
  if (!isRecord(error)) return null;
  const { status, code, details } = error;
  if (status !== 409 || code !== "provider_conflict" || !isRecord(details) || !Array.isArray(details.providerConflicts)) return null;
  const conflicts = details.providerConflicts.flatMap((item) => parseConflict(item) ?? []);
  return conflicts.length ? conflicts : null;
}

export function providerOverwriteMessage(conflicts: readonly ProviderOverwriteConflict[]): string {
  return conflicts
    .map((conflict) => `${t("lawoss.integrations.providerOverwrite.description", { provider: conflict.providerId })}\n${conflict.workspaces.map((workspace) => `• ${workspace.name}`).join("\n")}`)
    .join("\n\n");
}

/** Otvorí potvrdenie v ProviderOverwriteConfirmHost; bez hostiteľa použije natívne okno. */
export function requestProviderOverwriteConfirm(conflicts: ProviderOverwriteConflict[]): Promise<boolean> {
  if (!hosts) {
    return Promise.resolve(typeof window !== "undefined" && window.confirm(`${t("lawoss.integrations.providerOverwrite.title")}\n\n${providerOverwriteMessage(conflicts)}`));
  }
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { conflicts, resolve };
    emit();
  });
}

export function settleProviderOverwriteConfirm(confirmed: boolean): void {
  const current = pending;
  pending = null;
  emit();
  current?.resolve(confirmed);
}

export const providerOverwriteConfirmStore = {
  subscribe(listener: () => void) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  },
  snapshot: (): ProviderOverwriteConflict[] | null => pending?.conflicts ?? null,
  attachHost() {
    hosts += 1;
    return () => {
      hosts -= 1;
      if (!hosts) settleProviderOverwriteConfirm(false);
    };
  },
};

/**
 * Zapíše zmenu poskytovateľa; pri konflikte s iným klientom sa najprv opýta a po potvrdení
 * pošle požiadavku znova s `confirmProviderOverwrite`. Zrušenie skončí chybou, nič sa nezapíše.
 */
export async function patchProviderConfirmingOverwrite<T>(
  patch: (confirmProviderOverwrite: boolean) => Promise<T>,
  confirm: (conflicts: ProviderOverwriteConflict[]) => Promise<boolean> = requestProviderOverwriteConfirm,
): Promise<T> {
  try {
    return await patch(false);
  } catch (error) {
    const conflicts = providerOverwriteConflictsFrom(error);
    if (!conflicts) throw error;
    if (!(await confirm(conflicts))) throw new Error(t("lawoss.integrations.providerOverwrite.cancelled"));
    return await patch(true);
  }
}
