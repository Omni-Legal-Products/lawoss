/**
 * LAWOSS N-A7-8: zapisujúce nástroje editora dokumentov sa pred zápisom pýtajú enginu (`edit`, cesta od koreňa
 * klienta), po zamietnutí do editora nič neodíde a čítanie sa nepýta. Cesty sú syntetické.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { LegalWorkExtensionsPreview } from "./legalwork-extensions-preview.js";

const roots: string[] = [];
let originalFetch: typeof globalThis.fetch | null = null;
let previousDiscovery: string | undefined;

afterEach(async () => {
  if (originalFetch) {
    globalThis.fetch = originalFetch;
    if (previousDiscovery === undefined) delete process.env.LEGALWORK_UI_CONTROL_DISCOVERY;
    else process.env.LEGALWORK_UI_CONTROL_DISCOVERY = previousDiscovery;
  }
  originalFetch = null;
  while (roots.length) await rm(roots.pop()!, { recursive: true, force: true });
});

const SESSION = "ses_m004";
const PROFILE = "Spisy/M005-syn-neakceptovany-modul/PRACOVNY-PROFIL.md";
const CONTRACT = "Spisy/M005-syn-neakceptovany-modul/01-zmluva.docx";

const surface = (format: string, path: string) => ({
  kind: "document", format, sessionId: SESSION, name: path.split("/").at(-1), path, editable: true, agentEditsTracked: format === "docx",
});

/** A fake UI bridge (replacing an earlier one): every task-document snapshot shows `active`; every other action is recorded. */
async function withBridge(active: object | null) {
  const root = await mkdtemp(join(tmpdir(), "lawoss-editor-approval-"));
  roots.push(root);
  const discovery = join(root, "legalwork-ui-control.json");
  await writeFile(discovery, JSON.stringify({ baseUrl: "http://ui.test", token: "t" }), "utf8");
  if (!originalFetch) {
    previousDiscovery = process.env.LEGALWORK_UI_CONTROL_DISCOVERY;
    originalFetch = globalThis.fetch;
  }
  process.env.LEGALWORK_UI_CONTROL_DISCOVERY = discovery;
  const actions: { actionId: string; args: Record<string, unknown> }[] = [];
  globalThis.fetch = Object.assign(
    async (input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
      const url = input instanceof Request ? input.url : input.toString();
      const snapshot = { ok: true, activeSurface: active, surfaces: active ? [active] : [], openFiles: [] };
      if (url.endsWith("/snapshot")) return Response.json(snapshot);
      if (!url.endsWith("/execute")) return new Response("Not found", { status: 404 });
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      const actionId = String(Reflect.get(Object(body), "actionId"));
      if (actionId === "documents.list") return Response.json({ ok: true, result: snapshot });
      actions.push({ actionId, args: Object(Reflect.get(Object(body), "args")) });
      return Response.json({ ok: true, result: { ok: true, saved: true } });
    },
    { preconnect: originalFetch.preconnect },
  );
  return actions;
}

type Card = { permission: string; patterns: string[]; always: string[]; metadata: Record<string, unknown> };

function approver(reply: "once" | "reject" = "once") {
  const cards: Card[] = [];
  const ask = async (card: Card) => {
    cards.push(card);
    if (reply === "reject") throw new Error("The user rejected permission to use this specific tool call.");
  };
  return { cards, context: { sessionID: SESSION, ask } };
}

const WRITES = new Set(["markdown.create", "markdown.agent_tool", "office.agent_tool", "document.agent_tool", "documents.open"]);
const writesSent = (actions: { actionId: string; args: Record<string, unknown> }[]) =>
  actions.filter(({ actionId, args }) => WRITES.has(actionId) && (actionId !== "documents.open" || args.copyTo));

describe("editor writes ask with the native edit card first", () => {
  test("a Markdown replacement shows the client-relative path and the change, then edits", async () => {
    const actions = await withBridge(surface("md", PROFILE));
    const plugin = await LegalWorkExtensionsPreview();
    const { cards, context } = approver();
    await plugin.tool.inapp_md_replace_text.execute({ path: PROFILE, search: "Telefón: —", replacement: "Telefón: 0900 000 000" }, context);
    expect(cards).toEqual([{ permission: "edit", patterns: [PROFILE], always: [],
      metadata: { filepath: PROFILE, diff: "- Telefón: —\n+ Telefón: 0900 000 000" } }]);
    expect(actions).toEqual([{ actionId: "markdown.agent_tool", args: expect.objectContaining({ sessionId: SESSION, path: PROFILE, toolName: "replace_text" }) }]);
  });

  test("a Word edit without a path asks for the task's document and addresses exactly that document", async () => {
    const actions = await withBridge(surface("docx", CONTRACT));
    const plugin = await LegalWorkExtensionsPreview();
    const { cards, context } = approver();
    await plugin.tool.inapp_docx_suggest_change.execute({ paraId: "p1", search: "30 dní", replaceWith: "15 dní" }, context);
    expect(cards.map((card) => [card.permission, card.patterns, card.metadata])).toEqual([["edit", [CONTRACT], { filepath: CONTRACT, diff: "- 30 dní\n+ 15 dní" }]]);
    expect(actions).toEqual([{ actionId: "document.agent_tool", args: expect.objectContaining({ path: CONTRACT, toolName: "suggest_change" }) }]);
  });

  test("every writing tool asks; a new copy or file asks for its own name", async () => {
    const calls: [string, () => Promise<unknown>, object | null, string][] = [];
    const plugin = await LegalWorkExtensionsPreview();
    const { cards, context } = approver();
    const xlsx = surface("xlsx", "Spisy/M004-syn/Trovy.xlsx"), pptx = surface("pptx", "Spisy/M004-syn/Prednes.pptx");
    const md = surface("md", PROFILE), docx = surface("docx", CONTRACT);
    const identity = { documentId: "doc-1", draftRevision: 1 };
    calls.push(
      ["inapp_md_save", () => plugin.tool.inapp_md_save.execute({ path: PROFILE }, context), md, PROFILE],
      ["inapp_office_save", () => plugin.tool.inapp_office_save.execute({ path: xlsx.path }, context), xlsx, xlsx.path],
      ["inapp_xlsx_write", () => plugin.tool.inapp_xlsx_write.execute({ path: xlsx.path, sheet: "Hárok1", range: "A1", values: [[1]] }, context), xlsx, xlsx.path],
      ["inapp_pptx_add_slide", () => plugin.tool.inapp_pptx_add_slide.execute({ path: pptx.path, templateSlideIndex: 0 }, context), pptx, pptx.path],
      ["inapp_pptx_replace_text", () => plugin.tool.inapp_pptx_replace_text.execute({ path: pptx.path, slideIndex: 0, elementId: "t", search: "a", replaceWith: "b" }, context), pptx, pptx.path],
      ["inapp_pptx_update_layout", () => plugin.tool.inapp_pptx_update_layout.execute({ path: pptx.path, slideIndex: 0, elementId: "t", fontSize: 20 }, context), pptx, pptx.path],
      ["inapp_pptx_prepare_file_edit", () => plugin.tool.inapp_pptx_prepare_file_edit.execute({ path: pptx.path }, context), pptx, pptx.path],
      ["inapp_docx_prepare_file_edit", () => plugin.tool.inapp_docx_prepare_file_edit.execute({ path: CONTRACT }, context), docx, CONTRACT],
      ["inapp_docx_edit", () => plugin.tool.inapp_docx_edit.execute({ ...identity, action: "save" }, context), docx, CONTRACT],
      ["inapp_docx_add_comment", () => plugin.tool.inapp_docx_add_comment.execute({ paraId: "p1", text: "Overiť" }, context), docx, CONTRACT],
      ["inapp_docx_fill_template", () => plugin.tool.inapp_docx_fill_template.execute({ paraId: "p1", placeholder: "[DÁTUM]", value: "28. 10. 2026" }, context), docx, CONTRACT],
      ["inapp_docx_reply_comment", () => plugin.tool.inapp_docx_reply_comment.execute({ commentId: 1, text: "Áno" }, context), docx, CONTRACT],
      ["inapp_docx_accept_changes", () => plugin.tool.inapp_docx_accept_changes.execute({ changeIds: [1] }, context), docx, CONTRACT],
      ["inapp_docx_reject_changes", () => plugin.tool.inapp_docx_reject_changes.execute({ changeIds: [1] }, context), docx, CONTRACT],
      ["inapp_docx_compare_documents", () => plugin.tool.inapp_docx_compare_documents.execute({ ...identity, fileName: "Porovnanie.docx", versions: [{ path: "Vratene.docx", author: "Protistrana" }] }, context), docx, "Porovnanie.docx"],
      ["inapp_docx_inspect_document", () => plugin.tool.inapp_docx_inspect_document.execute({ ...identity, fileName: "Odchadzajuca.docx", categories: ["comments"] }, context), docx, "Odchadzajuca.docx"],
      ["inapp_documents_open", () => plugin.tool.inapp_documents_open.execute({ path: "Sablony/Plnomocenstvo.docx", copy_to: "Spisy/M004-syn/Plnomocenstvo.docx" }, context), null, "Spisy/M004-syn/Plnomocenstvo.docx"],
      ["inapp_markdown_create", () => plugin.tool.inapp_markdown_create.execute({ path: "Spisy/M004-syn/Poznamka.md", content: "# Poznámka\n", complete: true }, context), null, "Spisy/M004-syn/Poznamka.md"],
    );
    for (const [name, call, active, path] of calls) {
      const actions = await withBridge(active);
      await call();
      expect([name, cards.at(-1)?.permission, cards.at(-1)?.patterns]).toEqual([name, "edit", [path]]);
      expect([name, writesSent(actions).length]).toEqual([name, 1]);
    }
    expect(cards).toHaveLength(calls.length);
  });
});

describe("a rejected or impossible card changes nothing", () => {
  test("after a rejection no editor write is sent", async () => {
    for (const [active, run] of [
      [surface("md", PROFILE), (plugin, context) => plugin.tool.inapp_md_replace_text.execute({ path: PROFILE, search: "a", replacement: "b" }, context)],
      [surface("docx", CONTRACT), (plugin, context) => plugin.tool.inapp_docx_suggest_change.execute({ paraId: "p1", search: "a", replaceWith: "b" }, context)],
      [surface("xlsx", "Trovy.xlsx"), (plugin, context) => plugin.tool.inapp_xlsx_write.execute({ path: "Trovy.xlsx", sheet: "H", range: "A1", values: [[1]] }, context)],
      [null, (plugin, context) => plugin.tool.inapp_documents_open.execute({ path: "Sablona.docx", copy_to: "Kopia.docx" }, context)],
      [null, (plugin, context) => plugin.tool.inapp_markdown_create.execute({ path: "Nova.md", content: "x", complete: true }, context)],
    ] satisfies [object | null, (plugin: Awaited<ReturnType<typeof LegalWorkExtensionsPreview>>, context: ReturnType<typeof approver>["context"]) => Promise<unknown>][]) {
      const actions = await withBridge(active);
      const { cards, context } = approver("reject");
      await expect(run(await LegalWorkExtensionsPreview(), context)).rejects.toThrow("rejected");
      expect(cards).toHaveLength(1);
      expect(writesSent(actions)).toEqual([]);
    }
  });

  test("without approval requests or without a selected document nothing is written", async () => {
    let actions = await withBridge(surface("md", PROFILE));
    const plugin = await LegalWorkExtensionsPreview();
    await expect(plugin.tool.inapp_md_replace_text.execute({ path: PROFILE, search: "a", replacement: "b" }, { sessionID: SESSION })).rejects.toThrow("approval");
    expect(writesSent(actions)).toEqual([]);
    actions = await withBridge(null);
    const { cards, context } = approver();
    await expect(plugin.tool.inapp_docx_suggest_change.execute({ paraId: "p1", search: "a", replaceWith: "b" }, context)).rejects.toThrow("No document is selected");
    expect(cards).toEqual([]);
    expect(writesSent(actions)).toEqual([]);
  });

  test("editor write actions cannot be run through the general UI action tool", async () => {
    const actions = await withBridge(null);
    const plugin = await LegalWorkExtensionsPreview();
    for (const [actionId, args] of [
      ["markdown.agent_tool", { sessionId: SESSION, path: PROFILE, toolName: "replace_text", args: { search: "a", replacement: "b" } }],
      ["office.agent_tool", { sessionId: SESSION, path: "Trovy.xlsx", toolName: "write" }],
      ["document.agent_tool", { sessionId: SESSION, toolName: "suggest_change" }],
      ["document.propose_change", { name: "x" }],
      ["markdown.create", { sessionId: SESSION, path: "Nova.md", content: "x", complete: true }],
      ["documents.open", { sessionId: SESSION, path: "Sablona.docx", copyTo: "Kopia.docx" }],
    ] as const) {
      await expect(plugin.tool.legalwork_ui_execute_action.execute({ actionId, args }, { agent: "legalwork", sessionID: SESSION })).rejects.toThrow("inapp_*");
    }
    expect(actions).toEqual([]);
    await plugin.tool.legalwork_ui_execute_action.execute({ actionId: "documents.open", args: { sessionId: SESSION, path: "Zmluva.docx" } }, { agent: "legalwork", sessionID: SESSION });
    await plugin.tool.legalwork_ui_execute_action.execute({ actionId: "settings.panel.open", args: { panel: "general" } }, { agent: "legalwork" });
    expect(actions.map((action) => action.actionId)).toEqual(["documents.open", "settings.panel.open"]);
  });
});

describe("reading never asks", () => {
  test("read tools, opening without a copy and an unfinished Markdown draft show no card", async () => {
    const plugin = await LegalWorkExtensionsPreview();
    const { cards, context } = approver("reject");
    const reads: [object | null, () => Promise<unknown>][] = [
      [surface("md", PROFILE), () => plugin.tool.inapp_md_read.execute({ path: PROFILE }, context)],
      [surface("xlsx", "Trovy.xlsx"), () => plugin.tool.inapp_xlsx_read.execute({ path: "Trovy.xlsx" }, context)],
      [surface("pptx", "Prednes.pptx"), () => plugin.tool.inapp_pptx_read.execute({ path: "Prednes.pptx" }, context)],
      [surface("pptx", "Prednes.pptx"), () => plugin.tool.inapp_pptx_read_presentation.execute({ path: "Prednes.pptx" }, context)],
      [surface("pptx", "Prednes.pptx"), () => plugin.tool.inapp_pptx_preview.execute({ path: "Prednes.pptx" }, context)],
      [surface("docx", CONTRACT), () => plugin.tool.inapp_docx_read_document.execute({}, context)],
      [surface("docx", CONTRACT), () => plugin.tool.inapp_docx_read_selection.execute({}, context)],
      [surface("docx", CONTRACT), () => plugin.tool.inapp_docx_find_text.execute({ query: "zmluva" }, context)],
      [surface("docx", CONTRACT), () => plugin.tool.inapp_docx_read_changes.execute({}, context)],
      [surface("docx", CONTRACT), () => plugin.tool.inapp_docx_read_comments.execute({}, context)],
      [surface("docx", CONTRACT), () => plugin.tool.inapp_docx_inspect_document.execute({}, context)],
      [surface("docx", CONTRACT), () => plugin.tool.inapp_documents_list.execute({}, context)],
      [surface("docx", CONTRACT), () => plugin.tool.inapp_documents_select.execute({ path: CONTRACT }, context)],
      [null, () => plugin.tool.inapp_documents_open.execute({ path: CONTRACT }, context)],
      [null, () => plugin.tool.inapp_markdown_create.execute({ path: "Nova.md", content: "# Nová\n" }, context)],
    ];
    for (const [active, read] of reads) {
      await withBridge(active);
      await read();
    }
    expect(cards).toEqual([]);
  });

  test("every in-app tool is classified, so a tool added by an upstream sync cannot skip the card unnoticed", async () => {
    const tools = Object.keys((await LegalWorkExtensionsPreview()).tool).filter((name) => name.startsWith("inapp_")).sort();
    expect(tools).toEqual([
      // Ask before saving (or for copy_to / complete / fileName).
      "inapp_docx_accept_changes", "inapp_docx_add_comment", "inapp_docx_compare_documents", "inapp_docx_edit", "inapp_docx_fill_template",
      "inapp_docx_inspect_document", "inapp_docx_prepare_file_edit", "inapp_docx_reject_changes", "inapp_docx_reply_comment", "inapp_docx_suggest_change",
      "inapp_documents_open", "inapp_markdown_create", "inapp_md_replace_text", "inapp_md_save", "inapp_office_save",
      "inapp_pptx_add_slide", "inapp_pptx_prepare_file_edit", "inapp_pptx_replace_text", "inapp_pptx_update_layout", "inapp_xlsx_write",
      // Only read or select.
      "inapp_docx_find_text", "inapp_docx_read_changes", "inapp_docx_read_comments", "inapp_docx_read_document", "inapp_docx_read_selection",
      "inapp_documents_list", "inapp_documents_navigate", "inapp_documents_select", "inapp_md_read",
      "inapp_pptx_preview", "inapp_pptx_read", "inapp_pptx_read_presentation", "inapp_xlsx_read",
    ].sort());
  });
});
