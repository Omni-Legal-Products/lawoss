// LAWOSS #427: hlavička behu hlási „Akcia zlyhala“ len vtedy, keď zlyhal posledný krok (asistent sa nezotavil).
import { afterEach, expect, test } from "bun:test";
import type { DynamicToolUIPart } from "ai";
import { renderToStaticMarkup } from "react-dom/server";
import { setLocale } from "../src/i18n";
import { ToolRun } from "../src/components/chat/tool-run";

afterEach(() => setLocale("en"));

const read = (id: string): DynamicToolUIPart => ({ type: "dynamic-tool", toolName: "read", toolCallId: id, state: "output-available", input: { filePath: "zmluva.md" }, output: "" });
const failed = (id: string): DynamicToolUIPart => ({ type: "dynamic-tool", toolName: "read", toolCallId: id, state: "output-error", input: { filePath: "chyba.md" }, errorText: "File not found" });
const render = (parts: DynamicToolUIPart[]) => renderToStaticMarkup(<ToolRun parts={parts} showDetails={false} renderTool={() => null} defaultOpen />);
/** Text stavu v hlavičke (`role="status"`). */
const header = (html: string) => html.match(/role="status"[^>]*>([^<]*)</)?.[1];

test("chyba v strede behu, po ktorej asistent pokračoval, nie je zlyhanie behu", () => {
  setLocale("sk");
  const html = render([read("r1"), failed("f1"), read("r2")]);
  expect(header(html)).toBe("Dokončené");
  expect(html).not.toContain("lucide-circle-alert");
  // Krok, ktorý zlyhal, ostáva v zozname označený.
  expect(html).toContain("text-xs text-destructive");
});

test("zlyhaný posledný krok hlavička hlási", () => {
  setLocale("en");
  const html = render([read("r1"), failed("f1")]);
  expect(header(html)).toBe("Action failed");
  expect(html).not.toContain("Completed");
  expect(html).toContain("lucide-circle-alert");
});
