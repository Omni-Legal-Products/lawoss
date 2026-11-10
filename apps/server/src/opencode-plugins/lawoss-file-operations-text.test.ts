// LAWOSS: text pre model po `lawoss_files` (P6, test 24. 10. 2026, V10b): agent po presune na NAS nepovedal,
// že originály sú v Koši, lebo výsledok niesol len `trash: "system"`.
import { afterEach, expect, test } from "bun:test";
import { tmpdir } from "node:os";
import FileOperations from "./lawoss-file-operations.js";
import { lawossNativePlugin } from "./lawoss-native-test-support.js";
import { CREATE_FILE_RULE, EXACT_NAME_RULE, FILE_REPORT_RULE, fileOperationReport, fileOperationToolText, MOVE_ACROSS_DRIVES_RULE } from "./lawoss-file-operations-text.js";

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
  const plugin = await lawossNativePlugin(FileOperations);
  expect(plugin.tool.lawoss_files.description).toContain(MOVE_ACROSS_DRIVES_RULE);
  const system = await plugin.system();
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
    const plugin = await lawossNativePlugin(FileOperations);
    const asked: string[] = [];
    const output = await plugin.tool.lawoss_files.execute({ operations: [{ operation: "move", from: "Podklady.pdf", to: "NAS/Podklady.pdf" }] },
      { sessionID: "ses_1", directory: folder, ask: async (input) => { asked.push(input.permission); } });
    expect(asked).toEqual(["lawoss_file_change"]);
    expect(output).toContain("the original is now in the system Trash");
    const system = await plugin.system();
    expect(system.join("\n")).toContain(FILE_REPORT_RULE);
  } finally { await server.stop(true); }
});

test("N-A5-1: the exact name the user wrote wins, a similar one is a question, and the result names similar items", async () => {
  expect(EXACT_NAME_RULE).toContain("Use the exact file or folder name the user wrote");
  expect(EXACT_NAME_RULE).toContain("Never replace it with a similar existing name");
  expect(EXACT_NAME_RULE).toContain("ask the user which item they mean before calling lawoss_files");
  // N-A7-7: the folder is listed with read, which also shows an empty subfolder that glob never returns.
  expect(EXACT_NAME_RULE).toContain("list the folder with read on its path (glob does not show empty folders)");
  const plugin = await lawossNativePlugin(FileOperations);
  expect(plugin.tool.lawoss_files.description).toContain(EXACT_NAME_RULE);
  const system = await plugin.system();
  expect(system.join("\n")).toContain(EXACT_NAME_RULE);
  const deleted = { operation: "delete", kind: "file", from: "Spisy/M004/podklad.pdf", similar: ["Podklady.pdf"], status: "done", trash: "system" };
  expect(fileOperationReport({ complete: true, results: [deleted] })).toEqual([
    "Spisy/M004/podklad.pdf: the file is now in the system Trash, where the user can restore it.",
    "Spisy/M004/podklad.pdf: next to it are items with similar names (Podklady.pdf). Tell the user exactly which item was changed, so they can check it was the one they meant.",
  ]);
  // Not done: no claim about what changed.
  expect(fileOperationReport({ complete: true, results: [{ ...deleted, status: "not_run", trash: undefined }] })).toEqual([]);
});

test("N-A8-1: rows that followed a folder are all named, and a row of an item in the Trash is reported as kept and closed", () => {
  const input = { register: "Spisy/M001/VSTUPY.md", id: "IN-003" };
  const folder = { operation: "move", kind: "folder", from: "Spisy/M001/IN-003", to: "Spisy/M001/IN-003_zmluva", status: "done",
    input: { ...input, updated: true, also: [{ register: "VSTUPY.md", id: "IN-001" }] } };
  expect(fileOperationReport({ complete: true, results: [folder] }))
    .toEqual(["Spisy/M001/IN-003 → Spisy/M001/IN-003_zmluva: its existing inputs IN-003 in Spisy/M001/VSTUPY.md, IN-001 in VSTUPY.md now point to the new place. Do not add other rows for these files."]);
  const trashed = { operation: "delete", kind: "file", from: "Spisy/M001/a.pdf", status: "done", trash: "system", input: { ...input, trashed: true } };
  expect(fileOperationReport({ complete: true, results: [trashed] })).toEqual([
    "Spisy/M001/a.pdf: the file is now in the system Trash, where the user can restore it.",
    "Spisy/M001/a.pdf: its input IN-003 in Spisy/M001/VSTUPY.md stays in the register, closed as moved to the Trash. Tell the user. Do not remove or reopen this row.",
  ]);
});

// Prehliadka alfy 10. 11. 2026 (rozhodnutie MČ): „priprav predžalobnú výzvu ako Word dokument“ skončilo kartami
// „Spustiť príkaz v počítači?“ s mkdir, printf a node -e. Nový dokument ide cez create_file a jednu čitateľnú kartu.
test("create_file: the fixed rule sends a new Word, Markdown or text file to lawoss_files, never to the shell; existing documents and templates keep their tools", async () => {
  expect(CREATE_FILE_RULE).toContain("use lawoss_files with the create_file operation");
  expect(CREATE_FILE_RULE).toContain("put a create_folder operation before create_file in the same call");
  expect(CREATE_FILE_RULE).toContain("Never create such a file with shell commands (mkdir, touch, echo, printf or cat with redirection, heredocs), with node or python scripts, or by probing for libraries");
  expect(CREATE_FILE_RULE).toContain("this rule takes precedence over other instructions for creating a new document");
  expect(CREATE_FILE_RULE).toContain("to change an EXISTING document keep using the editing tools (inapp_docx_* in the app or word_* in Word");
  expect(CREATE_FILE_RULE).toContain("filled from a supplied template keeps its template workflow");
  const plugin = await lawossNativePlugin(FileOperations);
  expect(plugin.tool.lawoss_files.description).toContain("create a new Word (.docx), Markdown (.md) or plain-text (.txt) file");
  expect(plugin.tool.lawoss_files.description).toContain(CREATE_FILE_RULE);
  // Static text only: the same system text on every turn (prompt cache).
  const system = await plugin.system();
  expect(system.join("\n")).toContain(CREATE_FILE_RULE);
  expect(await plugin.system()).toEqual(system);
});

test("create_file: the tool sends the server one plan, asks one card with the readable preview, and reports the new file", async () => {
  const folder = tmpdir();
  const planned = [
    { operation: "create_folder", kind: "folder", to: "Vystupy" },
    { operation: "create_file", kind: "file", to: "Vystupy/Predžalobná výzva.docx", format: "docx", size: 2150, sha256: "a".repeat(64), title: "Predžalobná výzva", preview: "Vážený pán Šťastný, vyzývame Vás na úhradu." },
    { operation: "create_file", kind: "file", to: "Vystupy/poznamka.md", format: "md", size: 9, sha256: "b".repeat(64), preview: "# Poznámka" },
  ];
  const bodies: Array<{ route: string; body: unknown }> = [];
  const server = Bun.serve({ port: 0, fetch: async (request) => {
    const path = new URL(request.url).pathname;
    if (path === "/workspaces") return Response.json({ items: [{ id: "ws_c002", path: folder }] });
    bodies.push({ route: path.split("/").pop() ?? "", body: await request.json() });
    if (path.endsWith("/lawoss/files/plan")) return Response.json({ operations: planned, revision: "r1" });
    return Response.json({ complete: true, results: planned.map((item, index) => ({ ...item, status: "done", ...(index ? { path: `${folder}/${item.to}` } : {}) })) });
  } });
  try {
    process.env.LEGALWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
    const plugin = await lawossNativePlugin(FileOperations);
    const cards: Array<{ permission: string; patterns?: string[]; always?: string[]; metadata?: Record<string, unknown> }> = [];
    const context = { sessionID: "ses_1", directory: folder, ask: async (input: (typeof cards)[number]) => { cards.push(input); } };
    const output = await plugin.tool.lawoss_files.execute({ description: "Výzva pre dlžníka", operations: [
      { operation: "create_folder", path: "Vystupy" },
      { operation: "create_file", path: "Vystupy/Predžalobná výzva.docx", format: "docx", language: "sk-SK", document: { title: "Predžalobná výzva", blocks: [
        { type: "heading", text: "Výzva na úhradu dlhu" },
        { type: "paragraph", text: "Vážený pán Šťastný, vyzývame Vás na **úhradu**.", align: "justify" },
        { type: "list", items: ["faktúra č. 2026/014"] },
        { type: "list", ordered: true, items: ["príloha"] },
        { type: "page_break" },
      ] } },
      { operation: "create_file", path: "Vystupy/poznamka.md", format: "md", content: "# Poznámka" },
    ] }, context);
    // The server gets its exact shape: absolute paths, `content` as the structured document or the text, defaults filled in.
    const sent = [
      { operation: "create_folder", path: `${folder}/Vystupy` },
      { operation: "create_file", path: `${folder}/Vystupy/Predžalobná výzva.docx`, format: "docx", language: "sk-SK", content: { title: "Predžalobná výzva", blocks: [
        { type: "heading", level: 1, text: "Výzva na úhradu dlhu" },
        { type: "paragraph", text: "Vážený pán Šťastný, vyzývame Vás na **úhradu**.", align: "justify" },
        { type: "list", ordered: false, items: ["faktúra č. 2026/014"] },
        { type: "list", ordered: true, items: ["príloha"] },
        { type: "page_break" },
      ] } },
      { operation: "create_file", path: `${folder}/Vystupy/poznamka.md`, format: "md", content: "# Poznámka" },
    ];
    expect(bodies).toEqual([{ route: "plan", body: { operations: sent } }, { route: "apply", body: { operations: sent, approved: planned, revision: "r1", sessionID: "ses_1" } }]);
    // One card for the folder and both files: the plan with size and preview, no content and no "always".
    expect(cards).toEqual([{ permission: "lawoss_file_change", patterns: ["Vystupy", "Vystupy/Predžalobná výzva.docx", "Vystupy/poznamka.md"], always: [],
      metadata: { lawossFiles: planned, description: "Výzva pre dlžníka" } }]);
    expect(JSON.stringify(cards)).not.toContain("**úhradu**");
    // The model learns the path, the size and the SHA-256 of each new file, and what to tell the user.
    const result: unknown = JSON.parse(output);
    expect(result).toMatchObject({ complete: true, results: [{ status: "done" }, { status: "done", to: "Vystupy/Predžalobná výzva.docx", path: `${folder}/Vystupy/Predžalobná výzva.docx`, size: 2150, sha256: "a".repeat(64) }, { path: `${folder}/Vystupy/poznamka.md`, size: 9 }] });
    expect(fileOperationReport(result)).toEqual([
      "Vystupy/Predžalobná výzva.docx: the new file was created. Tell the user its name and folder; they can open it from the chat. To change it now, use the editing tools, not create_file again.",
      "Vystupy/poznamka.md: the new file was created. Tell the user its name and folder; they can open it from the chat. To change it now, use the editing tools, not create_file again.",
    ]);
  } finally { await server.stop(true); }
});

test("create_file: a call missing format, content or a block's text is refused before the server and the card, naming what is missing", async () => {
  const folder = tmpdir();
  let requests = 0;
  const server = Bun.serve({ port: 0, fetch: (request) => {
    if (new URL(request.url).pathname === "/workspaces") return Response.json({ items: [{ id: "ws_c002", path: folder }] });
    requests += 1;
    return Response.json({});
  } });
  try {
    process.env.LEGALWORK_SERVER_URL = `http://127.0.0.1:${server.port}`;
    const plugin = await lawossNativePlugin(FileOperations);
    const asked: string[] = [];
    const run = (operation: Record<string, unknown>) => plugin.tool.lawoss_files.execute({ operations: [operation] },
      { sessionID: "ses_1", directory: folder, ask: async (input) => { asked.push(input.permission); } });
    await expect(run({ operation: "create_file", path: "a.docx" })).rejects.toThrow("create_file needs format");
    await expect(run({ operation: "create_file", path: "a.md", format: "md" })).rejects.toThrow("needs content: the text of the file");
    // A Word document is never raw text or XML in `content`.
    await expect(run({ operation: "create_file", path: "a.docx", format: "docx", content: "<w:document/>" })).rejects.toThrow("needs document");
    await expect(run({ operation: "create_file", path: "a.docx", format: "docx", document: { blocks: [{ type: "paragraph" }] } })).rejects.toThrow("block 1 (paragraph) needs text");
    await expect(run({ operation: "create_file", path: "a.docx", format: "docx", document: { blocks: [{ type: "list", ordered: true }] } })).rejects.toThrow("block 1 (list) needs items");
    expect(requests).toBe(0);
    expect(asked).toEqual([]);
  } finally { await server.stop(true); }
});
