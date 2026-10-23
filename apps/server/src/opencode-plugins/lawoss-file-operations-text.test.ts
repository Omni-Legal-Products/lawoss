// LAWOSS: text pre model po `lawoss_files` (P6, test 24. 10. 2026, V10b): agent po presune na NAS nepovedal,
// že originály sú v Koši, lebo výsledok niesol len `trash: "system"`.
import { afterEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { LawossFileOperations } from "./lawoss-file-operations.js";
import { FILE_REPORT_RULE, fileOperationReport, fileOperationToolText } from "./lawoss-file-operations-text.js";

const moved = { operation: "move", kind: "file", from: "Spisy/M004/Podklady.pdf", to: "C002-podklady/Podklady.pdf", status: "done", trash: "system" };

test("a move to another drive tells the agent that the original is in the Trash", () => {
  const text = fileOperationToolText({ complete: true, results: [moved, { ...moved, from: "Spisy/M004/Vyjadrenie.pdf", to: "C002-podklady/Vyjadrenie.pdf" }] });
  const parsed: unknown = JSON.parse(text);
  expect(parsed).toMatchObject({ complete: true, results: [moved, { status: "done" }] });
  const report = fileOperationReport(parsed);
  expect(parsed).toHaveProperty("report", report);
  expect(report).toHaveLength(2);
  expect(report[0]).toContain("Spisy/M004/Podklady.pdf → C002-podklady/Podklady.pdf");
  expect(report[0]).toContain("the original is now in the Trash");
  expect(report[0]).toContain("Tell the user plainly that the original is in the Trash");
});

test("the recovery folder is named when the system Trash was not available; deletes say where items went", () => {
  const [line] = fileOperationReport({ complete: true, results: [{ ...moved, trash: "C002-podklady/.lawoss-kos/2026/Podklady.pdf" }] });
  expect(line).toContain("recovery folder C002-podklady/.lawoss-kos/2026/Podklady.pdf");
  expect(fileOperationReport({ complete: true, results: [{ operation: "delete", kind: "folder", from: "Stare", status: "done", trash: "system" }] }))
    .toEqual(["Stare: the folder is now in the Trash, where the user can restore it."]);
});

test("an ordinary rename adds no report; an incomplete batch says what to tell the user", () => {
  const rename = { complete: true, results: [{ operation: "move", kind: "file", from: "a.pdf", to: "b.pdf", status: "done" }] };
  expect(fileOperationToolText(rename)).toBe(JSON.stringify(rename));
  expect(fileOperationReport({ complete: false, results: [{ operation: "move", from: "a", to: "b", status: "failed", error: "x" }] }))
    .toEqual(["Not every change was made: tell the user only about the changes with status done, and say which ones were not made and why."]);
  expect(fileOperationToolText("unexpected")).toBe("\"unexpected\"");
});

test("the fixed system rule asks to mention the Trash and to propose another name on a clash", () => {
  expect(FILE_REPORT_RULE).toContain("The originals are in the Trash");
  expect(FILE_REPORT_RULE).toContain("\"(2)\"");
});

const priorUrl = process.env.LEGALWORK_SERVER_URL;
afterEach(() => { if (priorUrl === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = priorUrl; });

test("the lawoss_files tool returns the report to the model after an approved move to another drive", async () => {
  const folder = tmpdir();
  const plan = { operations: [{ operation: "move", kind: "file", from: "Podklady.pdf", to: "NAS/Podklady.pdf" }], revision: "r1" };
  const server = Bun.serve({ port: 0, fetch: (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/workspaces") return Response.json({ items: [{ id: "ws_c002", path: folder }] });
    if (path.endsWith("/lawoss/files/plan")) return Response.json(plan);
    return Response.json({ complete: true, results: [{ ...plan.operations[0], status: "done", trash: "system" }] });
  } });
  try {
    process.env.LEGALWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
    const plugin = await LawossFileOperations();
    const asked: string[] = [];
    const output = await plugin.tool.lawoss_files.execute({ operations: [{ operation: "move", from: "Podklady.pdf", to: "NAS/Podklady.pdf" }] },
      { sessionID: "ses_1", directory: folder, ask: async (input) => { asked.push(input.permission); } });
    expect(asked).toEqual(["lawoss_file_change"]);
    expect(output).toContain("the original is now in the Trash");
    const system: string[] = [];
    await plugin["experimental.chat.system.transform"]({}, { system });
    expect(system.join("\n")).toContain(FILE_REPORT_RULE);
  } finally { await server.stop(true); }
});
