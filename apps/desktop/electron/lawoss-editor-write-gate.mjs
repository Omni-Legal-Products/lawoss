// LAWOSS: zápis cez editor dokumentov len zo schválenej cesty servera (N-A7-8, 28. 10. 2026).
//
// Most UI (`ui-control-server.mjs`, `POST /execute`) volajú tri cesty: nástroje `inapp_*` pluginu
// `legalwork-extensions-preview` (pred zápisom karta enginu `edit`, `lawoss-editor-approval.ts`),
// odovzdanie editorov pred zápisom súborov (`apps/server/src/file-editor-handoff.ts`, za kartou príkazu
// alebo `lawoss_files`) a všeobecné nástroje, ktoré pošlú ľubovoľnú akciu podľa modelu
// (`legalwork_ui_execute_action` a MCP `legalwork-ui` → `ui_execute_action`). Prvé dve posielajú hlavičku
// `x-lawoss-editor-write: 1`; model ju nastaviť nevie, lebo ovláda len `actionId` a `args`. Akcia editora,
// ktorá zapisuje, bez hlavičky neprejde, takže pravidlo platí pre plugin aj MCP na jednom mieste.

/** Header the server sets on editor calls that passed the approval card or belong to a file handoff. */
export const EDITOR_WRITE_HEADER = "x-lawoss-editor-write";

/** Renderer actions that save or create a file (`apps/app/src/.../artifacts`, docx editor). */
export const EDITOR_WRITE_ACTIONS = Object.freeze([
  "document.agent_tool", "office.agent_tool", "markdown.agent_tool", "markdown.create", "document.propose_change",
  // Saves every open draft of the task to disk before a file pipeline writes.
  "documents.begin_file_edit",
]);

/** Document actions that only read, select, navigate or reload; `documents.open` copies only with `copyTo`. */
export const EDITOR_OTHER_ACTIONS = Object.freeze([
  "documents.open", "documents.list", "documents.select_open", "documents.navigate", "documents.end_file_edit",
  "document.read_draft", "document.read_metadata",
]);

/** The bridge's refusal for an editor write sent without the server's header; null when it may run. */
export function editorWriteRefusal(input, headers) {
  if (headers?.[EDITOR_WRITE_HEADER] === "1" || !input || typeof input !== "object") return null;
  const { actionId, args } = input;
  const copies = actionId === "documents.open" && typeof args?.copyTo === "string" && args.copyTo !== "";
  if (!EDITOR_WRITE_ACTIONS.includes(actionId) && !copies) return null;
  return { ok: false, error: `${actionId} cannot be run as a general UI action. Use the inapp_* document tools, which ask the user before saving a file. Nothing was changed.` };
}
