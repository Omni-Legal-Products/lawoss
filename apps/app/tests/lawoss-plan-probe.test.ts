import { expect, test } from "bun:test";
import { previewPlan, probePlanFiles } from "../src/lawoss/okf/preview";
import type { NovySpisForm } from "../src/lawoss/okf/compose-prompt";

const form: NovySpisForm = { mode: "okf", subject: "spis", title: "Synthetic", ico: "", jurisdikcia: "SK", root: "/office", protistrana: "" };
const client = (files: string[]) => ({ statWorkspaceFile: async (_id: string, path: string) => ({ ok: true, path, exists: files.includes(path) }) });

test("native probe retains legacy card and existing nested files in retrofit preview", async () => {
  const names = await probePlanFiles(client(["Synthetic/spis.md", "Synthetic/01_Podklady/.keep"]), "w", "Synthetic", form);
  const rows = previewPlan(form, (path) => names.includes(path));
  expect(rows.find((row) => row.path === "spis.md")?.action).toBe("skip");
  expect(rows.some((row) => row.path === "matter.md")).toBe(false);
  expect(rows.find((row) => row.path === "01_Podklady/.keep")?.action).toBe("skip");
});

test("native probe rejects duplicate cards before a plan is shown", async () => {
  await expect(probePlanFiles(client(["Synthetic/spis.md", "Synthetic/matter.md"]), "w", "Synthetic", form)).rejects.toThrow("Viac kariet");
});
