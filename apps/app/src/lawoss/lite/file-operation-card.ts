/**
 * LAWOSS: karta nástroja `lawoss_files` (alfa 2, MČ 22. 10. 2026) – jedna karta na jednu žiadosť
 * o zmenu súborov s čitateľným rozsahom „pôvodná → nová“ / „Zmazať X“. Plán prichádza zo servera
 * v `metadata.lawossFiles` karty enginu (povolenie `edit`); technické údaje ostávajú v „Podrobnostiach“.
 *
 * Tlačidlo „Povoliť do konca konverzácie“: engine 1.18.29 si „always“ pamätá pre celý priečinok
 * klienta (všetky jeho chaty), nie pre konverzáciu. Preto sa neponúka, keď ho engine nevie uložiť
 * (`always: []`, napr. `lawoss_files`), ani pri karte `external_directory` – vlastné pripojené
 * priečinky odobrí plugin bez karty, takže karta je vždy na priečinok mimo tohto klienta.
 */
import { t } from "@/i18n";
import type { PendingPermission } from "@/app/types";

type Operation = "move" | "copy" | "create_folder" | "delete";
type PlannedChange = { operation: Operation; kind: "file" | "folder"; from?: string; to?: string; entries?: number };

function isOperation(value: unknown): value is Operation {
  return value === "move" || value === "copy" || value === "create_folder" || value === "delete";
}

function plannedChanges(metadata: Record<string, unknown>): PlannedChange[] | null {
  const raw = metadata.lawossFiles;
  if (!Array.isArray(raw) || raw.length === 0) return null;
  const changes: PlannedChange[] = [];
  for (const item of raw) {
    if (!item || typeof item !== "object") return null;
    const operation: unknown = Reflect.get(item, "operation"), kind: unknown = Reflect.get(item, "kind");
    const from: unknown = Reflect.get(item, "from"), to: unknown = Reflect.get(item, "to"), entries: unknown = Reflect.get(item, "entries");
    if (!isOperation(operation) || (kind !== "file" && kind !== "folder")) return null;
    changes.push({ operation, kind, ...(typeof from === "string" ? { from } : {}), ...(typeof to === "string" ? { to } : {}),
      ...(typeof entries === "number" ? { entries } : {}) });
  }
  return changes;
}

const parent = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

function line(change: PlannedChange): string {
  const from = change.from ?? "", to = change.to ?? "";
  if (change.operation === "move") return `${from} → ${to}`;
  if (change.operation === "copy") return t("lawoss.files.line_copy", undefined, { from, to });
  if (change.operation === "create_folder") return t("lawoss.files.line_create_folder", undefined, { path: to });
  return change.kind === "folder" && change.entries
    ? t("lawoss.files.line_delete_folder", undefined, { path: from, count: String(change.entries) })
    : t("lawoss.files.line_delete", undefined, { path: from });
}

function title(changes: PlannedChange[]): string {
  if (changes.length > 1) return t("lawoss.files.title_batch", undefined, { count: String(changes.length) });
  const [change] = changes;
  if (change.operation === "move") return t(parent(change.from ?? "") === parent(change.to ?? "") ? "lawoss.files.title_rename" : "lawoss.files.title_move");
  if (change.operation === "copy") return t("lawoss.files.title_copy");
  if (change.operation === "create_folder") return t("lawoss.files.title_create_folder");
  return t("lawoss.files.title_delete");
}

/** The card's readable content, or `null` when the request is not from `lawoss_files`. */
export function fileOperationCard(metadata: Record<string, unknown>): { title: string; message: string; scopeLabel: string; scopeValue: string } | null {
  const changes = plannedChanges(metadata);
  if (!changes) return null;
  return {
    title: title(changes),
    message: t(changes.some((change) => change.operation === "delete") ? "lawoss.files.message_delete" : "lawoss.files.message"),
    scopeLabel: t("lawoss.files.scope"),
    scopeValue: changes.map(line).join("\n"),
  };
}

/** Whether the card may offer "Allow for the conversation". */
export function offersRememberedApproval(permission: Pick<PendingPermission, "protocol" | "permission" | "always" | "host">): boolean {
  if (permission.protocol === "host") return !permission.host || permission.host.canRemember === true;
  if (permission.permission === "external_directory") return false;
  return !(Array.isArray(permission.always) && permission.always.length === 0);
}
