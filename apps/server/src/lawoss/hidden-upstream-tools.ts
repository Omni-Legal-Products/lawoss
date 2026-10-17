/**
 * LAWOSS: nástroje agenta z LegalWork v0.2.x, ktoré alfa neprevzala (spec 0017, časť 8.1, S1 a S2).
 *
 * Wiki, uložené pohľady, kalendár, výpočet lehôt, plánované úlohy a metadáta projektu by
 * zakladali druhý zdroj pravdy vedľa OKF. Upstream kód ostáva na disku nedotknutý; návrat je
 * zmena jedného riadku tu.
 */

/** S1: plugin `legalwork-wiki-tools` (nástroje `wiki_*`, `view_*` a ich blok pravidiel) sa nenačíta. Návrat: `true`. */
export const LAWOSS_LOAD_WIKI_TOOLS = false;

/**
 * S2: zapisujúce nástroje upstreamu, ktoré agent nesmie použiť. Kľúče sú pravidlá oprávnení enginu,
 * hviezdička platí ako zástupný znak (OpenCode 1.18, `agent-sandbox/permissions.ts`).
 * `wiki_*` a `view_*` sú poistka pre prípad, že plugin wiki načíta iná konfigurácia. Návrat: prázdny zoznam.
 */
export const LAWOSS_DENIED_UPSTREAM_TOOLS: readonly string[] = [
  "legalwork_calendar_create",
  "legalwork_calendar_update",
  "legalwork_deadline_calculate",
  "legalwork_calculation_present",
  "legalwork_schedule_create",
  "legalwork_schedule_update",
  "legalwork_schedule_delete",
  "legalwork_project_set_metadata",
  "wiki_*",
  "view_*",
];

/**
 * Pripojí zamietnutia za pravidlá používateľa a firmy. Engine berie posledné zhodné pravidlo,
 * preto sa kľúč najprv odstráni: inak by si ponechal pôvodnú pozíciu pred širším `"*": "allow"`.
 */
export function appendLawossToolDenials(permission: Record<string, unknown>): void {
  for (const tool of LAWOSS_DENIED_UPSTREAM_TOOLS) {
    delete permission[tool];
    permission[tool] = "deny";
  }
}
