// LAWOSS alfa 2 (N-A3-3): reading case memory shows a plain label, never the tool name lawoss_memory.
import { expect, test } from "bun:test";
import type { DynamicToolUIPart } from "ai";
import { t } from "../src/i18n";
import { getToolHistoryLabel } from "../src/components/tools/tool-presentation";
import { getToolActivityLabel } from "../src/lib/tool-activity";

const part = (state: "input-available" | "output-available"): DynamicToolUIPart => state === "output-available"
  ? { type: "dynamic-tool", toolName: "lawoss_memory", toolCallId: "memory-1", state, input: { action: "read" }, output: "{}" }
  : { type: "dynamic-tool", toolName: "lawoss_memory", toolCallId: "memory-1", state, input: { action: "read" } };

test("case memory reads are labelled as reading, without the tool name", () => {
  expect(getToolActivityLabel(part("input-available"))).toBe(t("tool_activity.reading_project_content"));
  expect(getToolHistoryLabel(part("output-available"))).toBe(t("tool_run.summary.read"));
  for (const label of [getToolActivityLabel(part("input-available")), getToolHistoryLabel(part("output-available"))]) expect(label.toLowerCase()).not.toContain("lawoss");
});
