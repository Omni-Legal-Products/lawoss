/**
 * LAWOSS: text, ktorý model dostane po `lawoss_files` (P6, test 24. 10. 2026, N-A3-6). Výsledok servera
 * hlási Kôš len strojovo (`trash: "system"`), preto agent po presune na NAS nepovedal, že originály sú
 * v Koši. K výsledku sa pridá `report`: obyčajné vety, ktoré má agent advokátovi odovzdať. Sémantiku
 * operácií nemení; vety vznikajú len z toho, čo server ohlásil ako vykonané. Bez závislostí (len typy),
 * aby pomocný modul prešiel strážou importov pluginov.
 */

/** Rule for the model in the tool's fixed system text: say where originals went, propose another name on a clash. */
export const FILE_REPORT_RULE = "When the lawoss_files result has a report, pass it on to the user in plain words: if an original went to the Trash, say so (for example \"The originals are in the Trash\"). If a target name already exists, nothing was overwritten: propose a different name to the user, for example with the date or \"(2)\" added, and use it only after the user agrees.";

/**
 * N-A4-3 (#229): asked to "move to the NAS", the agent first only copied and kept the originals. A move to another
 * drive or a linked folder is a real move, and the user's "move" (presuň, přesuň) means `move`.
 */
export const MOVE_ACROSS_DRIVES_RULE = "A move to another drive or to a linked folder (for example a NAS) is a real move: the tool copies the item there, checks the copy, and moves the original to the Trash, where the user can restore it. When the user asks to move something (\"move\", \"presuň\", \"přesuň\"), use the move operation, not copy, even across drives; use copy only when the user asks for a copy or to keep the original in place.";

/**
 * N-A5-1 (test 25. 10. 2026): asked to delete `podklad.pdf`, the agent put a similar `Podklady.pdf` on the card.
 * The exact name the user wrote wins; a similar name is never a correction, and several similar names mean a question.
 * N-A7-7 (test 28. 10. 2026): the folder is listed with read, because glob lists files only and hides an empty folder.
 */
export const EXACT_NAME_RULE = "Use the exact file or folder name the user wrote, letter for letter, including case, accents and extension. Never replace it with a similar existing name (for example Podklady.pdf when the user wrote podklad.pdf). If no item has exactly that name, or several items have similar names, list the folder with read on its path (glob does not show empty folders) and ask the user which item they mean before calling lawoss_files. When the card or result names similar items next to the one changed, make sure it is the item the user meant.";

type Row = { register: string; id: string };
type Input = Row & { updated: boolean; trashed: boolean; handedOver?: Row; also?: Row[] };
type Result = { operation: string; kind?: string; from?: string; to?: string; status: string; trash?: string; similar?: string[]; input?: Input; inputError?: string };

const text = (value: unknown): string | undefined => typeof value === "string" ? value : undefined;

function rowOf(value: unknown): Row | undefined {
  if (!value || typeof value !== "object") return undefined;
  const register = text(Reflect.get(value, "register")), id = text(Reflect.get(value, "id"));
  return register && id ? { register, id } : undefined;
}

function resultOf(entry: unknown): Result | null {
  if (!entry || typeof entry !== "object") return null;
  const operation = text(Reflect.get(entry, "operation")), status = text(Reflect.get(entry, "status"));
  if (!operation || !status) return null;
  const kind = text(Reflect.get(entry, "kind")), from = text(Reflect.get(entry, "from")), to = text(Reflect.get(entry, "to")), trash = text(Reflect.get(entry, "trash"));
  const listed: unknown = Reflect.get(entry, "similar");
  const similar = Array.isArray(listed) ? listed.filter((name): name is string => typeof name === "string") : [];
  const filed: unknown = Reflect.get(entry, "input"), inputError = text(Reflect.get(entry, "inputError"));
  const row = rowOf(filed);
  const handedOver = filed && typeof filed === "object" ? rowOf(Reflect.get(filed, "handedOver")) : undefined;
  const listedAlso: unknown = filed && typeof filed === "object" ? Reflect.get(filed, "also") : undefined;
  const also = Array.isArray(listedAlso) ? listedAlso.map(rowOf).filter((other): other is Row => other !== undefined) : [];
  const input = row && filed && typeof filed === "object" ? { ...row, updated: Reflect.get(filed, "updated") === true, trashed: Reflect.get(filed, "trashed") === true,
    ...(handedOver ? { handedOver } : {}), ...(also.length ? { also } : {}) } : undefined;
  return { operation, status, ...(kind ? { kind } : {}), ...(from ? { from } : {}), ...(to ? { to } : {}), ...(trash ? { trash } : {}), ...(similar.length ? { similar } : {}),
    ...(input ? { input } : {}), ...(inputError ? { inputError } : {}) };
}

/**
 * N-A7-6: a file filed from an inbox folder into a case is already in the case's input register (the server wrote it,
 * as the app does): the agent must not add a second row, and sets `processed` only after reading the whole document.
 * N-A8-1: rows of a moved or renamed file or folder point to the new place; rows of an item in the Trash are closed.
 */
function inputSentence(value: Result): string | null {
  if (value.status !== "done") return null;
  const change = `${value.from ?? ""} → ${value.to ?? ""}`;
  const rows = value.input ? [value.input, ...(value.input.also ?? [])] : [];
  const listed = rows.map((row) => `${row.id} in ${row.register}`).join(", ");
  if (value.input?.trashed)
    return `${value.from ?? ""}: ${rows.length > 1 ? `its inputs ${listed} stay in the register, closed` : `its input ${listed} stays in the register, closed`} as moved to the Trash. Tell the user. Do not remove or reopen ${rows.length > 1 ? "these rows" : "this row"}.`;
  if (value.input?.updated && rows.length > 1) return `${change}: its existing inputs ${listed} now point to the new place. Do not add other rows for these files.`;
  if (value.input?.updated) return `${change}: its existing input ${value.input.id} in ${value.input.register} now points to the new place. Do not add another row for this file.`;
  const handed = value.input?.handedOver ? ` Its earlier input ${value.input.handedOver.id} in ${value.input.handedOver.register} is closed as moved there.` : "";
  if (value.input) return `${change}: recorded in ${value.input.register} as input ${value.input.id} with status pending.${handed} Tell the user. Do not add another row for this file; set it to processed only after reading the whole document.`;
  if (value.inputError) return `${change}: the file was ${value.operation === "copy" ? "copied" : "moved"}, but the input register VSTUPY.md could not be updated (${value.inputError}). Tell the user and offer to add the row.`;
  return null;
}

const item = (kind: string | undefined) => kind === "folder" ? "folder" : "file";

const TRASH_FOLDER_SEGMENT = ".lawoss-kos/";

/**
 * Where the item really went, from the server's `trash` value: the system Trash, or the recovery folder in the root
 * the item lay in. The server prefixes a linked folder's label (`pripojeny-A/.lawoss-kos/…`); a path without a prefix
 * lies in the client's own folder. A move to a NAS on Windows keeps the original in the NAS's recovery folder.
 */
function trashPlace(trash: string): { where: string; tell: string } {
  if (trash === "system") return { where: "in the system Trash, where the user can restore it", tell: "in the Trash" };
  const cut = trash.indexOf(`/${TRASH_FOLDER_SEGMENT}`);
  const root = cut > 0 ? `the linked folder ${trash.slice(0, cut)}` : "the client's folder";
  return {
    where: `in the recovery folder ${trash} in ${root} (the system Trash is not available there), where the user can restore it`,
    tell: `in the recovery folder ${trash} in ${root}`,
  };
}

function sentence(value: Result): string | null {
  if (value.status !== "done" || !value.trash) return null;
  const place = trashPlace(value.trash);
  if (value.operation === "move")
    return `${value.from ?? ""} → ${value.to ?? ""}: the ${item(value.kind)} went to another drive. It was copied there, the copy was checked, and the original is now ${place.where}. Tell the user plainly that the original is ${place.tell}.`;
  if (value.operation === "delete") return `${value.from ?? ""}: the ${item(value.kind)} is now ${place.where}.`;
  return null;
}

/** Sentences for the user from the applied results; empty when nothing went to the Trash and everything was done. */
export function fileOperationReport(raw: unknown): string[] {
  if (!raw || typeof raw !== "object") return [];
  const results: unknown = Reflect.get(raw, "results");
  if (!Array.isArray(results)) return [];
  const lines = results.flatMap((entry) => {
    const value = resultOf(entry);
    const line = value ? sentence(value) : null;
    // N-A5-1: a similar name next to the changed item may be the one the user meant.
    const similar = value?.status === "done" && value.similar ? `${value.from ?? ""}: next to it are items with similar names (${value.similar.join(", ")}). Tell the user exactly which item was changed, so they can check it was the one they meant.` : null;
    return [line, similar, value ? inputSentence(value) : null].filter((item): item is string => item !== null);
  });
  if (Reflect.get(raw, "complete") === false) lines.push("Not every change was made: tell the user only about the changes with status done, and say which ones were not made and why.");
  return lines;
}

/** What the tool returns to the model: the server result, plus the report when there is one. */
export function fileOperationToolText(raw: unknown): string {
  const report = fileOperationReport(raw);
  return JSON.stringify(report.length && raw && typeof raw === "object" ? { ...raw, report } : raw);
}
