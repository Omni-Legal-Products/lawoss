import { describe, expect, test } from "bun:test";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";

const BANNED = /workspace|session|skill|\bMCP\b|\bOKF\b|opencode|plugin/i;
const REQUIRED = ["nav_today", "nav_clients", "nav_ask", "today_title", "deadlines_title", "due_in_days_one", "due_in_days_other", "due_tomorrow",
  "inputs_title", "clients_title", "tab_overview", "tab_known", "action_summarize",
  "action_deadlines", "action_reply", "action_add_document", "action_verify_client", "mode_title",
  "mode_lite", "mode_pro", "memory_write_title", "memory_write_matter", "memory_write_approved_by"];
/** Nepoužívané klíče odstraněné při finální revizi (M2) — nesmí se vrátit. */
const REMOVED = ["open_conversation", "advanced", "matter_counterparty", "new_client", "due_in_days"];

const dictionaries = { en: shellEn, cs: shellCs, sk: shellSk, de: shellDe } as const;

describe("slovník LAWOSS-lite", () => {
  for (const [language, dict] of Object.entries(dictionaries)) {
    const lite = Object.entries(dict).filter(([key]) => key.startsWith("lawoss.lite."));

    test(`${language}: obsahuje všechny povinné klíče`, () => {
      // Pole s jedním prvkem = literální plochý klíč. Bun (na rozdíl od záměru testu)
      // řetězec s tečkami bere jako vnořenou cestu, ne jako plochý klíč se znaky "." —
      // stejné ploché klíče se ale používají v celém shell.ts i v testu níže.
      for (const key of REQUIRED) expect(dict).toHaveProperty([`lawoss.lite.${key}`]);
    });

    test(`${language}: žádný technický pojem`, () => {
      for (const [key, value] of lite) expect({ key, value, banned: BANNED.test(value) }).toEqual({ key, value, banned: false });
    });
  }

  test("placeholder {count} je ve všech tvarech due_in_days", () => {
    for (const dict of Object.values(dictionaries)) {
      const forms = Object.entries(dict).filter(([key]) => key.startsWith("lawoss.lite.due_in_days_"));
      expect(forms.length).toBeGreaterThanOrEqual(2);
      for (const [, value] of forms) expect(value).toContain("{count}");
    }
  });
  test("čeština a slovenština mají tvary one/few/many/other", () => {
    for (const dict of [shellCs, shellSk]) for (const form of ["one", "few", "many", "other"]) expect(dict).toHaveProperty([`lawoss.lite.due_in_days_${form}`]);
  });
  test("odstraněné nepoužívané klíče chybí ve všech jazycích (M2)", () => {
    for (const dict of Object.values(dictionaries)) for (const key of REMOVED) expect(dict).not.toHaveProperty([`lawoss.lite.${key}`]);
  });
});
