// LAWOSS #550: engine v2 posiela cestu nástrojov read/edit/write ako `path`, nie `filePath`. Karta ukazovala „Zápis file“.
import { expect, test } from "bun:test";
import type { DynamicToolUIPart, UIMessage } from "ai";
import { getToolHistoryLabel } from "../src/components/tools/tool-presentation";
import { getToolActivityLabel } from "../src/lib/tool-activity";
import { getArtifactsFromMessages } from "../src/lib/artifacts";

const part = (toolName: string, input: Record<string, unknown>, state: "input-available" | "output-available"): DynamicToolUIPart =>
  state === "output-available"
    ? { type: "dynamic-tool", toolName, toolCallId: `${toolName}-1`, state, input, output: "ok" }
    : { type: "dynamic-tool", toolName, toolCallId: `${toolName}-1`, state, input };

const v2 = {
  read: { path: "/kancelaria/Klienti/C001/zmluva.docx" },
  edit: { path: "/kancelaria/Klienti/C001/zmluva.docx", oldString: "a", newString: "b" },
  write: { path: "test-okna.txt", content: "ahoj" },
};

test("kroky read/edit/write engine v2 ukazujú meno súboru, nie „file“", () => {
  for (const [tool, input] of Object.entries(v2)) {
    const file = String(input.path).split("/").pop()!;
    for (const label of [getToolActivityLabel(part(tool, input, "input-available")), getToolHistoryLabel(part(tool, input, "output-available"))]) {
      expect(label).toContain(file);
      expect(label).not.toMatch(/\bfile\b/);
    }
  }
});

test("starý vstup `filePath` funguje ďalej", () => {
  expect(getToolHistoryLabel(part("write", { filePath: "/x/stary.txt", content: "" }, "output-available"))).toContain("stary.txt");
});

test("súbor zapísaný alebo upravený cez `path` sa objaví v súboroch chatu", () => {
  const message = { id: "m1", role: "assistant", parts: [part("write", v2.write, "output-available"), part("edit", v2.edit, "output-available")] } as UIMessage;
  const names = getArtifactsFromMessages([message], [], { includeTargetFallbacks: false }).map((artifact) => artifact.name ?? artifact.path);
  expect(names.join(" ")).toContain("test-okna.txt");
  expect(names.join(" ")).toContain("zmluva.docx");
});
