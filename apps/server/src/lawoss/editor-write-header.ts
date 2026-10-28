/**
 * LAWOSS: hlavička, ktorou server označí volanie editora dokumentov po karte enginu alebo pri odovzdaní
 * editorov pred zápisom súborov (N-A7-8, 28. 10. 2026). Most UI v desktope (`apps/desktop/electron/
 * lawoss-editor-write-gate.mjs`) akciu editora, ktorá zapisuje, bez nej odmietne. Model ju nastaviť nevie:
 * všeobecné nástroje (`legalwork_ui_execute_action`, MCP `legalwork-ui`) posielajú len `actionId` a `args`.
 */
export const EDITOR_WRITE_HEADERS: Readonly<Record<string, string>> = Object.freeze({ "x-lawoss-editor-write": "1" });
