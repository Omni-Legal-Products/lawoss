/**
 * LAWOSS: vlastní poskytovatelia AI sú globálni. Ak má iný klient blok s rovnakým id a iným
 * obsahom, server odpovie 409 `provider_conflict` a nezapíše nič; uloženie prebehne až po
 * výslovnom potvrdení (`confirmProviderOverwrite`). Rozhodnutie MČ 12. 10. 2026, review VŘ k #136.
 */
import { t } from "@/i18n";

export type ProviderOverwriteConflict = {
  providerId: string;
  workspaces: { id: string; name: string }[];
  /** `endpoint_change`: klienti by po uložení posielali dáta na inú adresu servera (MČ 13. 10. 2026). */
  reason?: "endpoint_change";
};

/** `save` pri zápise poskytovateľa, `remove` pri odpojení (`null`); líši sa text potvrdenia. */
export type ProviderOverwriteMode = "save" | "remove";

export type ProviderOverwriteRequest = { conflicts: ProviderOverwriteConflict[]; mode: ProviderOverwriteMode };

type PendingConfirm = ProviderOverwriteRequest & { resolve: (confirmed: boolean) => void };

const copyKeys = {
  save: {
    title: "lawoss.integrations.providerOverwrite.title",
    description: "lawoss.integrations.providerOverwrite.description",
    confirm: "lawoss.integrations.providerOverwrite.confirm",
    cancelled: "lawoss.integrations.providerOverwrite.cancelled",
  },
  remove: {
    title: "lawoss.integrations.providerOverwrite.removeTitle",
    description: "lawoss.integrations.providerOverwrite.removeDescription",
    confirm: "lawoss.integrations.providerOverwrite.removeConfirm",
    cancelled: "lawoss.integrations.providerOverwrite.removeCancelled",
  },
} as const;

const endpointKeys = {
  title: "lawoss.integrations.providerOverwrite.endpointTitle",
  description: "lawoss.integrations.providerOverwrite.endpointDescription",
} as const;

/** Pri zmene adresy servera (`endpoint_change`) a uložení hovorí text o novej adrese, nie o odlišnom nastavení. */
export function providerOverwriteCopy(mode: ProviderOverwriteMode, providerId = "", endpointChange = false) {
  const keys = copyKeys[mode];
  const endpoint = endpointChange && mode === "save";
  return {
    title: t(endpoint ? endpointKeys.title : keys.title),
    description: t(endpoint ? endpointKeys.description : keys.description, { provider: providerId }),
    cancel: t("lawoss.integrations.providerOverwrite.cancel"),
    confirm: t(keys.confirm),
    cancelled: t(keys.cancelled),
  };
}

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
  return { providerId: value.providerId, workspaces, ...(value.reason === "endpoint_change" ? { reason: "endpoint_change" as const } : {}) };
}

/** Konflikty z chyby 409 `provider_conflict`; pri inej chybe null. */
export function providerOverwriteConflictsFrom(error: unknown): ProviderOverwriteConflict[] | null {
  if (!isRecord(error)) return null;
  const { status, code, details } = error;
  if (status !== 409 || code !== "provider_conflict" || !isRecord(details) || !Array.isArray(details.providerConflicts)) return null;
  const conflicts = details.providerConflicts.flatMap((item) => parseConflict(item) ?? []);
  return conflicts.length ? conflicts : null;
}

export const hasEndpointChange = (conflicts: readonly ProviderOverwriteConflict[]) => conflicts.some((conflict) => conflict.reason === "endpoint_change");

export function providerOverwriteMessage(conflicts: readonly ProviderOverwriteConflict[], mode: ProviderOverwriteMode): string {
  return conflicts
    .map((conflict) => `${providerOverwriteCopy(mode, conflict.providerId, conflict.reason === "endpoint_change").description}\n${conflict.workspaces.map((workspace) => `• ${workspace.name}`).join("\n")}`)
    .join("\n\n");
}

/** Otvorí potvrdenie v ProviderOverwriteConfirmHost; bez hostiteľa použije natívne okno. */
export function requestProviderOverwriteConfirm({ conflicts, mode }: ProviderOverwriteRequest): Promise<boolean> {
  if (!hosts) {
    return Promise.resolve(typeof window !== "undefined" && window.confirm(`${providerOverwriteCopy(mode, "", hasEndpointChange(conflicts)).title}\n\n${providerOverwriteMessage(conflicts, mode)}`));
  }
  pending?.resolve(false);
  return new Promise((resolve) => {
    pending = { conflicts, mode, resolve };
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
  snapshot: (): ProviderOverwriteRequest | null => pending,
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
  options: { mode?: ProviderOverwriteMode; confirm?: (request: ProviderOverwriteRequest) => Promise<boolean> } = {},
): Promise<T> {
  const mode = options.mode ?? "save";
  try {
    return await patch(false);
  } catch (error) {
    const conflicts = providerOverwriteConflictsFrom(error);
    if (!conflicts) throw error;
    if (!(await (options.confirm ?? requestProviderOverwriteConfirm)({ conflicts, mode }))) {
      throw new Error(providerOverwriteCopy(mode).cancelled);
    }
    return await patch(true);
  }
}
