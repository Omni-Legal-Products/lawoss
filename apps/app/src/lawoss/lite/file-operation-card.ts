/**
 * LAWOSS: karta nástroja `lawoss_files` (alfa 2, MČ 22. 10. 2026) – jedna karta na jednu žiadosť
 * o zmenu súborov s čitateľným rozsahom „pôvodná → nová“ / „Do Koša: X“. Plán prichádza zo servera
 * v `metadata.lawossFiles` karty enginu (povolenie `lawoss_file_change`). „Podrobnosti“ ukazujú tie isté zmeny
 * čitateľne (sloveso, pôvodná → nová, počty položiek, dôvod), nie surový JSON (P6, N-A3-6). Názvy prichádzajú
 * zo servera s viditeľne escapovanými riadiacimi znakmi.
 *
 * Tlačidlo „Povoliť do konca konverzácie“: engine 1.18.29 si „always“ pamätá pre celý priečinok
 * klienta (všetky jeho chaty, do reštartu), nie pre konverzáciu. Preto sa neponúka pri natívnej
 * karte úprav (`edit`), pri `external_directory` (vlastné pripojené priečinky odobrí plugin bez karty,
 * takže karta je vždy na priečinok mimo klienta), keď engine nemá čo uložiť (`always: []`, napr.
 * `lawoss_files`) ani pri karte príkazu, ktorá pokrýva celý počítač (server ju nepamätá).
 */
import { t } from "@/i18n";
import type { PendingPermission } from "@/app/types";

type Operation = "move" | "copy" | "create_folder" | "delete";
type PlannedChange = { operation: Operation; kind: "file" | "folder"; from?: string; to?: string; entries?: number; entriesCapped?: boolean; similar?: string[] };

/** Same bound as the server's folder survey (lawoss/file-operations.ts FOLDER_SURVEY_LIMIT). */
const SURVEY_LIMIT = 1000;

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
    const from: unknown = Reflect.get(item, "from"), to: unknown = Reflect.get(item, "to");
    const entries: unknown = Reflect.get(item, "entries"), capped: unknown = Reflect.get(item, "entriesCapped"), listed: unknown = Reflect.get(item, "similar");
    if (!isOperation(operation) || (kind !== "file" && kind !== "folder")) return null;
    const similar = Array.isArray(listed) ? listed.filter((name): name is string => typeof name === "string") : [];
    changes.push({ operation, kind, ...(typeof from === "string" ? { from } : {}), ...(typeof to === "string" ? { to } : {}),
      ...(typeof entries === "number" ? { entries } : {}), ...(capped === true ? { entriesCapped: true } : {}), ...(similar.length ? { similar } : {}) });
  }
  return changes;
}

const parent = (path: string) => path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";

function trashLine(change: PlannedChange, path: string): string {
  if (change.kind !== "folder") return t("lawoss.files.line_trash", undefined, { path });
  if (change.entriesCapped) return t("lawoss.files.line_trash_folder_large", undefined, { path, limit: String(SURVEY_LIMIT) });
  if (!change.entries) return t("lawoss.files.line_trash_folder_empty", undefined, { path });
  return t("lawoss.files.line_trash_folder", { path, count: change.entries });
}

function line(change: PlannedChange): string {
  const from = change.from ?? "", to = change.to ?? "";
  if (change.operation === "move") return `${from} → ${to}`;
  if (change.operation === "copy") return t("lawoss.files.line_copy", undefined, { from, to });
  if (change.operation === "create_folder") return t("lawoss.files.line_create_folder", undefined, { path: to });
  return trashLine(change, from);
}

const renamed = (change: PlannedChange) => parent(change.from ?? "") === parent(change.to ?? "");

/** One full line per change for "Details": an explicit verb, both paths, and folder item counts. */
function detailLine(change: PlannedChange): string {
  const from = change.from ?? "", to = change.to ?? "";
  if (change.operation === "move") return t(renamed(change) ? "lawoss.files.line_rename" : "lawoss.files.line_move", undefined, { from, to });
  if (change.operation === "copy" && change.kind === "folder" && change.entries !== undefined)
    return change.entriesCapped
      ? t("lawoss.files.line_copy_folder_large", undefined, { from, to, limit: String(SURVEY_LIMIT) })
      : t("lawoss.files.line_copy_folder", { from, to, count: change.entries });
  return line(change);
}

function title(changes: PlannedChange[]): string {
  if (changes.length > 1) return t("lawoss.files.title_batch", { count: changes.length });
  const [change] = changes;
  if (change.operation === "move") return t(renamed(change) ? "lawoss.files.title_rename" : "lawoss.files.title_move");
  if (change.operation === "copy") return t("lawoss.files.title_copy");
  if (change.operation === "create_folder") return t("lawoss.files.title_create_folder");
  return t("lawoss.files.title_trash");
}

/**
 * N-A5-1 (test 25. 10. 2026): the card showed `Podklady.pdf`, the lawyer had asked for `podklad.pdf`. A similar name
 * next to the item deleted or moved is named right under the change, so the lawyer sees which one goes.
 */
function warnings(change: PlannedChange): string[] {
  return change.similar?.length ? [t("lawoss.files.similar_warning", undefined, { path: change.from ?? "", names: change.similar.join(", ") })] : [];
}

/** The card's readable content, or `null` when the request is not from `lawoss_files`. */
export type FileOperationDetails = { reason: string | null; lines: string[] };

export function fileOperationCard(metadata: Record<string, unknown>): { title: string; message: string; permissionLabel: string; scopeLabel: string; scopeValue: string; details: FileOperationDetails } | null {
  const changes = plannedChanges(metadata);
  if (!changes) return null;
  const reason = typeof metadata.description === "string" && metadata.description.trim() ? t("lawoss.files.reason", undefined, { text: metadata.description.trim() }) : null;
  return {
    details: { reason, lines: changes.flatMap((change) => [detailLine(change), ...warnings(change)]) },
    title: title(changes),
    message: t(changes.some((change) => change.operation === "delete") ? "lawoss.files.message_trash" : "lawoss.files.message"),
    permissionLabel: t("lawoss.files.permission_label"),
    scopeLabel: t("lawoss.files.scope"),
    scopeValue: changes.flatMap((change) => [line(change), ...warnings(change)]).join("\n"),
  };
}

/** Whether the card may offer "Allow for the conversation". */
export function offersRememberedApproval(permission: Pick<PendingPermission, "protocol" | "permission" | "always" | "host">): boolean {
  if (permission.protocol === "host") return !permission.host || (permission.host.canRemember === true && permission.host.hostWide !== true);
  if (permission.permission === "external_directory" || permission.permission === "edit") return false;
  return !(Array.isArray(permission.always) && permission.always.length === 0);
}

/**
 * Texts of the "remember" choice by card type. The engine remembers `always` per client folder (instance)
 * until reload; only host cards remember per chat (`approvals.ts`, rememberKey with sessionID).
 */
export function rememberedApprovalKeys(permission: Pick<PendingPermission, "protocol">): { label: string; hint: string } {
  return permission.protocol === "host"
    ? { label: "session.allow_for_session", hint: "session.permission_decision_hint" }
    : { label: "lawoss.permission.allow_for_client", hint: "lawoss.permission.decision_hint_client" };
}
