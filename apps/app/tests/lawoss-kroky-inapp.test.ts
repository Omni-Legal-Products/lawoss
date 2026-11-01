// N-A8-2 (regresia 30. 10. 2026, D12): krok „Spúšťanie inapp markdown create“. Nástroje dokumentu otvoreného v appke
// (`inapp_*`) majú slovenský popis ako ostatné kroky, počas behu aj po skončení, nikdy názov nástroja.
import { afterEach, expect, test } from "bun:test";
import type { DynamicToolUIPart } from "ai";
import { setLocale } from "../src/i18n";
import { getToolHistoryLabel } from "../src/components/tools/tool-presentation";
import { getToolActivityLabel } from "../src/lib/tool-activity";

afterEach(() => setLocale("en"));

const part = (toolName: string, state: "input-available" | "output-available"): DynamicToolUIPart => (state === "input-available"
  ? { type: "dynamic-tool", toolName, toolCallId: `call_${toolName}`, state, input: {} }
  : { type: "dynamic-tool", toolName, toolCallId: `call_${toolName}`, state, input: {}, output: "ok" });

test("kroky `inapp_*` po slovensky", () => {
  setLocale("sk");
  const expected: Record<string, [string, string]> = {
    inapp_markdown_create: ["Vytváranie dokumentu", "Vytvorený dokument"],
    inapp_docx_read_document: ["Čítanie dokumentu", "Prečítaný dokument"],
    inapp_pptx_preview: ["Čítanie dokumentu", "Prečítaný dokument"],
    inapp_documents_list: ["Čítanie dokumentu", "Prečítaný dokument"],
    inapp_documents_open: ["Otváranie dokumentu", "Otvorený dokument"],
    inapp_docx_suggest_change: ["Úprava dokumentu", "Upravený dokument"],
    inapp_md_replace_text: ["Úprava dokumentu", "Upravený dokument"],
    inapp_office_save: ["Ukladanie dokumentu", "Uložený dokument"],
    inapp_docx_compare_documents: ["Porovnávanie dokumentov", "Porovnané dokumenty"],
  };
  for (const [name, [active, done]] of Object.entries(expected)) {
    expect(getToolActivityLabel(part(name, "input-available"))).toBe(active);
    expect(getToolHistoryLabel(part(name, "output-available"))).toBe(done);
  }
  for (const name of Object.keys(expected)) {
    for (const label of [getToolActivityLabel(part(name, "input-available")), getToolHistoryLabel(part(name, "output-available"))])
      expect(label.toLowerCase()).not.toMatch(/inapp|markdown create|docx|pptx/);
  }
});
