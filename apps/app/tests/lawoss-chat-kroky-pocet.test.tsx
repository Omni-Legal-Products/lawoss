// LAWOSS N-A8-5 (rozhodnutie MČ 31. 10. 2026): číslo v hlavičke krokov ráta dávku zmien súborov po vykonaných zmenách.
import { afterEach, describe, expect, test } from "bun:test";
import type { DynamicToolUIPart } from "ai";
import { renderToStaticMarkup } from "react-dom/server";
import { setLocale } from "../src/i18n";
import { ToolRun } from "../src/components/chat/tool-run";

afterEach(() => setLocale("en"));

const operations = ["a", "b", "c", "d", "e"].map((name) => ({ operation: "move", from: `00_Na_zatriedenie/${name}.txt`, to: `Korespondencia/${name}.txt` }));
const batch = (statuses: string[]): DynamicToolUIPart => ({
  type: "dynamic-tool", toolName: "lawoss_files", toolCallId: `batch-${statuses.join("-")}`, state: "output-available", input: { operations: operations.slice(0, statuses.length) },
  output: JSON.stringify({ results: statuses.map((status, index) => ({ ...operations[index], kind: "file", status })), complete: statuses.every((status) => status === "done") }),
});
const rejected: DynamicToolUIPart = {
  type: "dynamic-tool", toolName: "lawoss_files", toolCallId: "batch-rejected", state: "output-error", input: { operations },
  errorText: "The user rejected permission to use this specific tool call",
};
const pending: DynamicToolUIPart = { type: "dynamic-tool", toolName: "lawoss_files", toolCallId: "batch-pending", state: "input-available", input: { operations } };
const read: DynamicToolUIPart = { type: "dynamic-tool", toolName: "read", toolCallId: "read-1", state: "output-available", input: { filePath: "zmluva.md" }, output: "" };

/** Text malého čísla vedľa názvu kroku (`tabular-nums`) v zbalenej hlavičke. */
function headerCount(parts: DynamicToolUIPart[], active = false): string {
  const html = renderToStaticMarkup(<ToolRun parts={parts} showDetails={false} renderTool={() => null} active={active} />);
  const match = html.match(/<span class="[^"]*tabular-nums[^"]*">([^<]*)<\/span>/);
  if (!match) throw new Error("Hlavička krokov bez čísla");
  return match[1] ?? "";
}

describe("hlavička krokov pri dávke zmien súborov (N-A8-5)", () => {
  test("dávka 5 presunov je „Zmena súborov 5“, nie 1", () => {
    setLocale("sk");
    const html = renderToStaticMarkup(<ToolRun parts={[batch(["done", "done", "done", "done", "done"])]} showDetails={false} renderTool={() => null} />);
    expect(html).toContain("Zmena súborov");
    expect(headerCount([batch(["done", "done", "done", "done", "done"])])).toBe("5");
  });

  test("ráta sa ako v okne „Skrátiť rozhovor?“: vykonané zmeny, zamietnutá dávka 0", () => {
    expect(headerCount([batch(["done", "done", "failed", "not_run", "not_run"])])).toBe("2");
    expect(headerCount([batch(["failed", "not_run", "not_run", "not_run", "not_run"])])).toBe("");
    expect(headerCount([rejected])).toBe("");
    expect(headerCount([read, batch(["done", "done", "done"]), rejected])).toBe("4");
  });

  test("ostatné kroky a dávka, ktorá ešte čaká na schválenie, sú jeden krok", () => {
    expect(headerCount([read])).toBe("1");
    expect(headerCount([read, read])).toBe("2");
    expect(headerCount([read, pending], true)).toBe("2");
  });
});
