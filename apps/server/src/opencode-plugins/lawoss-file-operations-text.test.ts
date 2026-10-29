// LAWOSS: text pre model po `lawoss_files` (P6, test 24. 10. 2026, V10b): agent po presune na NAS nepovedal,
// že originály sú v Koši, lebo výsledok niesol len `trash: "system"`.
import { afterEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import { LawossFileOperations } from "./lawoss-file-operations.js";
import { EXACT_NAME_RULE, FILE_REPORT_RULE, fileOperationReport, fileOperationToolText, MOVE_ACROSS_DRIVES_RULE } from "./lawoss-file-operations-text.js";

const moved = { operation: "move", kind: "file", from: "Spisy/M004/Podklady.pdf", to: "C002-podklady/Podklady.pdf", status: "done", trash: "system" };

test("a move to another drive tells the agent that the original is in the Trash", () => {
  const text = fileOperationToolText({ complete: true, results: [moved, { ...moved, from: "Spisy/M004/Vyjadrenie.pdf", to: "C002-podklady/Vyjadrenie.pdf" }] });
  const parsed: unknown = JSON.parse(text);
  expect(parsed).toMatchObject({ complete: true, results: [moved, { status: "done" }] });
  const report = fileOperationReport(parsed);
  expect(parsed).toHaveProperty("report", report);
  expect(report).toHaveLength(2);
  expect(report[0]).toContain("Spisy/M004/Podklady.pdf → C002-podklady/Podklady.pdf");
  expect(report[0]).toContain("the original is now in the system Trash");
  expect(report[0]).toContain("Tell the user plainly that the original is in the Trash");
});

test("the place of the original follows the real result: system Trash, client's folder or linked folder (P3 review of #227)", () => {
  const line = (trash: string, from = moved.from) => fileOperationReport({ complete: true, results: [{ ...moved, from, trash }] })[0] ?? "";
  // Moved from the client's folder; the system Trash was unavailable: the recovery folder in the client's folder.
  const client = line(".lawoss-kos/2026-10-24T10-00-00-000Z-ab12cd34/Spisy/M004/Podklady.pdf");
  expect(client).toContain("the original is now in the recovery folder .lawoss-kos/2026-10-24T10-00-00-000Z-ab12cd34/Spisy/M004/Podklady.pdf in the client's folder");
  expect(client).not.toContain("linked folder");
  // Moved from a linked NAS folder on Windows (UNC, no reliable Trash): the recovery folder stays on the NAS.
  const linked = line("C002-podklady/.lawoss-kos/2026-10-24T10-00-00-000Z-ab12cd34/Podklady.pdf", "C002-podklady/Podklady.pdf");
  expect(linked).toContain("in the recovery folder C002-podklady/.lawoss-kos/2026-10-24T10-00-00-000Z-ab12cd34/Podklady.pdf in the linked folder C002-podklady");
  expect(linked).toContain("Tell the user plainly that the original is in the recovery folder C002-podklady/.lawoss-kos/");
  expect(linked).not.toContain("client's folder");
  // An ambiguous linked folder is labelled with its full path; the label is everything before the recovery folder.
  expect(line("/Volumes/NAS/Zdielane/.lawoss-kos/b/a.pdf")).toContain("in the linked folder /Volumes/NAS/Zdielane");
  expect(line("system")).toContain("the original is now in the system Trash, where the user can restore it. Tell the user plainly that the original is in the Trash.");
  expect(fileOperationReport({ complete: true, results: [{ operation: "delete", kind: "folder", from: "Stare", status: "done", trash: "system" }] }))
    .toEqual(["Stare: the folder is now in the system Trash, where the user can restore it."]);
});

test("a move to another drive or linked folder is described as a real move, and \"presuň\" means move, not copy (#229 N-A4-3)", async () => {
  expect(MOVE_ACROSS_DRIVES_RULE).toContain("is a real move");
  expect(MOVE_ACROSS_DRIVES_RULE).toContain("moves the original to the Trash, where the user can restore it");
  expect(MOVE_ACROSS_DRIVES_RULE).toContain("use the move operation, not copy, even across drives");
  expect(MOVE_ACROSS_DRIVES_RULE).toContain("\"presuň\"");
  const plugin = await LawossFileOperations();
  expect(plugin.tool.lawoss_files.description).toContain(MOVE_ACROSS_DRIVES_RULE);
  const system: string[] = [];
  await plugin["experimental.chat.system.transform"]({}, { system });
  expect(system.join("\n")).toContain(MOVE_ACROSS_DRIVES_RULE);
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
    expect(output).toContain("the original is now in the system Trash");
    const system: string[] = [];
    await plugin["experimental.chat.system.transform"]({}, { system });
    expect(system.join("\n")).toContain(FILE_REPORT_RULE);
  } finally { await server.stop(true); }
});

test("N-A5-1: the exact name the user wrote wins, a similar one is a question, and the result names similar items", async () => {
  expect(EXACT_NAME_RULE).toContain("Use the exact file or folder name the user wrote");
  expect(EXACT_NAME_RULE).toContain("Never replace it with a similar existing name");
  expect(EXACT_NAME_RULE).toContain("ask the user which item they mean before calling lawoss_files");
  // N-A7-7: the folder is listed with read, which also shows an empty subfolder that glob never returns.
  expect(EXACT_NAME_RULE).toContain("list the folder with read on its path (glob does not show empty folders)");
  const plugin = await LawossFileOperations();
  expect(plugin.tool.lawoss_files.description).toContain(EXACT_NAME_RULE);
  const system: string[] = [];
  await plugin["experimental.chat.system.transform"]({}, { system });
  expect(system.join("\n")).toContain(EXACT_NAME_RULE);
  const deleted = { operation: "delete", kind: "file", from: "Spisy/M004/podklad.pdf", similar: ["Podklady.pdf"], status: "done", trash: "system" };
  expect(fileOperationReport({ complete: true, results: [deleted] })).toEqual([
    "Spisy/M004/podklad.pdf: the file is now in the system Trash, where the user can restore it.",
    "Spisy/M004/podklad.pdf: next to it are items with similar names (Podklady.pdf). Tell the user exactly which item was changed, so they can check it was the one they meant.",
  ]);
  // Not done: no claim about what changed.
  expect(fileOperationReport({ complete: true, results: [{ ...deleted, status: "not_run", trash: undefined }] })).toEqual([]);
});
