/**
 * LAWOSS: text, ktorý model dostane po `lawoss_files` (P6, test 24. 10. 2026, N-A3-6). Výsledok servera
 * hlási Kôš len strojovo (`trash: "system"`), preto agent po presune na NAS nepovedal, že originály sú
 * v Koši. K výsledku sa pridá `report`: obyčajné vety, ktoré má agent advokátovi odovzdať. Sémantiku
 * operácií nemení; vety vznikajú len z toho, čo server ohlásil ako vykonané. Bez závislostí (len typy),
 * aby pomocný modul prešiel strážou importov pluginov.
 */

/** Rule for the model in the tool's fixed system text: say where originals went, propose another name on a clash. */
export const FILE_REPORT_RULE = "When the lawoss_files result has a report, pass it on to the user in plain words: if an original went to the Trash, say so (for example \"The originals are in the Trash\"). If a target name already exists, nothing was overwritten: propose a different name to the user, for example with the date or \"(2)\" added, and use it only after the user agrees.";

type Result = { operation: string; kind?: string; from?: string; to?: string; status: string; trash?: string };

const text = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;

function resultOf(entry: unknown): Result | null {
  if (!entry || typeof entry !== "object") return null;
  const operation = text(Reflect.get(entry, "operation")), status = text(Reflect.get(entry, "status"));
  if (!operation || !status) return null;
  const kind = text(Reflect.get(entry, "kind")), from = text(Reflect.get(entry, "from")), to = text(Reflect.get(entry, "to")), trash = text(Reflect.get(entry, "trash"));
  return { operation, status, ...(kind ? { kind } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(trash ? { trash } : {}) };
}

const item = (kind: string | undefined) => kind === "folder" ? "folder" : "file";

function trashPlace(trash: string): string {
  return trash === "system"
    ? "in the Trash, where the user can restore it"
    : `in the recovery folder ${trash} inside the client's folder (the system Trash is not available there), where the user can restore it`;
}

function sentence(value: Result): string | null {
  if (value.status !== "done" || !value.trash) return null;
  if (value.operation === "move")
    return `${value.from ?? ""} → ${value.to ?? ""}: the ${item(value.kind)} went to another drive. It was copied there, the copy was checked, and the original is now ${trashPlace(value.trash)}. Tell the user plainly that the original is ${value.trash === "system" ? "in the Trash" : "in that recovery folder"}.`;
  if (value.operation === "delete") return `${value.from ?? ""}: the ${item(value.kind)} is now ${trashPlace(value.trash)}.`;
  return null;
}

/** Sentences for the user from the applied results; empty when nothing went to the Trash and everything was done. */
export function fileOperationReport(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const results: unknown = Reflect.get(raw, "results");
  if (!Array.isArray(results)) return [];
  const lines = results.flatMap((entry) => { const value = resultOf(entry); const line = value ? sentence(value) : null; return line ? [line] : []; });
  if (Reflect.get(raw, "complete") === false) lines.push("Not every change was made: tell the user only about the changes with status done, and say which ones were not made and why.");
  return lines;
}

/** What the tool returns to the model: the server result, plus the report when there is one. */
export function fileOperationToolText(raw: unknown): string {
  const report = fileOperationReport(raw);
  return JSON.stringify(report.length && raw && typeof raw === "object" ? { ...raw, report } : raw);
}
