import { describe, expect, test } from "bun:test";
import { shellCs, shellDe, shellEn, shellSk } from "../src/lawoss/i18n/shell";

const BANNED = /workspace|session|skill|\bMCP\b|\bOKF\b|opencode|plugin/i;
const REQUIRED = ["nav_today", "nav_clients", "nav_ask", "today_title", "deadlines_title", "due_in_days",
  "inputs_title", "clients_title", "tab_overview", "tab_known", "open_conversation", "action_summarize",
  "action_deadlines", "action_reply", "action_add_document", "action_verify_client", "mode_title",
  "mode_lite", "mode_pro", "advanced", "memory_write_title"];

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

  test("placeholder {days} je ve všech jazycích", () => {
    for (const dict of Object.values(dictionaries)) expect(dict["lawoss.lite.due_in_days"]).toContain("{days}");
  });
});
