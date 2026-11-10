// LAWOSS (prehliadka alfy 10. 11. 2026, rozhodnutie MČ): nový dokument cez `lawoss_files` `create_file` – karta
// „Vytvoriť súbor?“ s cestou, veľkosťou a začiatkom textu, krok „Nový dokument“, karta súboru pod odpoveďou a dokument,
// ktorý otvorí prehliadač Wordu v appke.
import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { DynamicToolUIPart, UIMessage } from "ai";
import { parseDocx } from "@eigenpal/docx-editor-core/docx";
import { toProseDoc } from "@eigenpal/docx-editor-core/prosemirror/conversion";
import type { PendingPermission } from "../src/app/types";
import { setLocale, t } from "../src/i18n";
import { getArtifactsFromMessages } from "../src/lib/artifacts";
import { createdFilesOf, fileChangesOf } from "../src/lawoss/chat/file-changes";
import { lawossToolActivityLabel, lawossToolHistoryLabel } from "../src/lawoss/chat/tool-labels";
import { fileOperationCard, mayDeleteFiles, readableSize } from "../src/lawoss/lite/file-operation-card";
import { PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";
import { buildDocx } from "../../server/src/lawoss/docx-writer";

afterEach(() => setLocale("en"));

const created = { operation: "create_file", kind: "file", to: "Spisy/M001/Predžalobná výzva.docx", format: "docx", size: 2150, sha256: "a".repeat(64),
  title: "Predžalobná výzva", preview: "Vážený pán Šťastný, vyzývame Vás na úhradu 1 250,00 EUR do 7 dní." };

describe("lawoss_files create_file", () => {
  test("the card asks 'Create a file?' and shows the path, the size, the title and the beginning of the text, never code", () => {
    setLocale("sk");
    const card = fileOperationCard({ lawossFiles: [created], description: "Výzva pre dlžníka" })!;
    expect(card.title).toBe("Vytvoriť súbor?");
    expect(card.scopeValue.split("\n")).toEqual([
      "Nový súbor: Spisy/M001/Predžalobná výzva.docx (2 kB)",
      "Názov: Predžalobná výzva",
      "Začiatok textu: Vážený pán Šťastný, vyzývame Vás na úhradu 1 250,00 EUR do 7 dní.",
    ]);
    expect(card.details.lines).toEqual(card.scopeValue.split("\n"));
    expect(card.details.reason).toBe("Dôvod: Výzva pre dlžníka");
    expect(card.message).toBe(t("lawoss.files.message"));
    expect(mayDeleteFiles({ lawossFiles: [created] })).toBe(false);
    // Neither the hash nor the format name is something a lawyer reads on the card.
    expect(card.scopeValue).not.toContain("aaaa");
    const permission: PendingPermission = { id: "per_1", sessionID: "ses_1", permission: "lawoss_file_change", patterns: [created.to], metadata: { lawossFiles: [created] }, always: [], receivedAt: 1, protocol: "legacy" };
    const html = renderToStaticMarkup(React.createElement(PermissionApprovalPanel, { permission, respondPermission: () => {} }));
    expect(html).toContain("Vytvoriť súbor?");
    expect(html).toContain("Nový súbor: Spisy/M001/Predžalobná výzva.docx (2 kB)");
    expect(html).toContain("Začiatok textu: Vážený pán Šťastný");
    expect(html).not.toContain("printf");
  });

  test("a text file has no title line; a folder with its file is one batch card listing both", () => {
    setLocale("sk");
    const note = { operation: "create_file", kind: "file", to: "Vystupy/poznamka.md", format: "md", size: 512, sha256: "b".repeat(64), preview: "# Poznámka Dlžník neuhradil dve faktúry." };
    expect(fileOperationCard({ lawossFiles: [note] })?.scopeValue.split("\n")).toEqual(["Nový súbor: Vystupy/poznamka.md (512 B)", "Začiatok textu: # Poznámka Dlžník neuhradil dve faktúry."]);
    const batch = fileOperationCard({ lawossFiles: [{ operation: "create_folder", kind: "folder", to: "Vystupy" }, note] })!;
    expect(batch.title).toBe("Vykonať 2 zmeny súborov?");
    expect(batch.scopeValue.split("\n")).toEqual(["Nový priečinok: Vystupy", "Nový súbor: Vystupy/poznamka.md (512 B)", "Začiatok textu: # Poznámka Dlžník neuhradil dve faktúry."]);
    // An empty file has nothing to preview.
    expect(fileOperationCard({ lawossFiles: [{ ...note, size: 0, preview: "" }] })?.scopeValue).toBe("Nový súbor: Vystupy/poznamka.md (0 B)");
    expect([readableSize(999), readableSize(1024), readableSize(150_000), readableSize(1024 * 1024 + 200_000)]).toEqual(["999 B", "1 kB", "146 kB", "1.2 MB"]);
  });

  test("the texts exist in Slovak, Czech, English and German", () => {
    expect(t("lawoss.files.title_create_file", "sk")).toBe("Vytvoriť súbor?");
    expect(t("lawoss.files.title_create_file", "cs")).toBe("Vytvořit soubor?");
    expect(t("lawoss.files.title_create_file", "en")).toBe("Create a file?");
    expect(t("lawoss.files.title_create_file", "de")).toBe("Datei erstellen?");
    expect(t("lawoss.files.line_create_file", { path: "a.docx", size: "2 kB", lng: "cs" })).toBe("Nový soubor: a.docx (2 kB)");
    expect(t("lawoss.files.line_create_file_preview", { text: "Text", lng: "de" })).toBe("Textanfang: Text");
    expect(t("lawoss.files.line_create_file_title", { title: "Výzva", lng: "en" })).toBe("Title: Výzva");
  });

  test("the step in the chat is a new document, not a 'change to files'; other requests keep their text", () => {
    setLocale("sk");
    const document = { operations: [{ operation: "create_folder", path: "Vystupy" }, { operation: "create_file", path: "Vystupy/vyzva.docx", format: "docx" }] };
    expect(lawossToolActivityLabel("lawoss_files", document)).toBe("Príprava nového dokumentu");
    expect(lawossToolHistoryLabel("lawoss_files", document)).toBe("Nový dokument");
    const mixed = { operations: [{ operation: "create_file", path: "a.md", format: "md" }, { operation: "delete", path: "b.md" }] };
    expect(lawossToolHistoryLabel("lawoss_files", mixed)).toBe(t("lawoss.tool.files_done"));
    expect(lawossToolHistoryLabel("lawoss_files", { operations: [{ operation: "create_folder", path: "Vystupy" }] })).toBe(t("lawoss.tool.files_done"));
  });

  test("a created file becomes an openable file chip under the answer, with its own name", () => {
    const output = JSON.stringify({ complete: true, results: [
      { operation: "create_folder", kind: "folder", to: "Vystupy", status: "done" },
      { ...created, status: "done", path: "/Klienti/C001/Spisy/M001/Predžalobná výzva.docx" },
      { ...created, to: "Spisy/M001/Druhá.docx", status: "not_run" },
    ] });
    const tool = (state: DynamicToolUIPart["state"], toolName = "lawoss_files") => ({ type: "dynamic-tool", toolName, toolCallId: "call_1", state, input: { operations: [] }, output }) as DynamicToolUIPart;
    expect(createdFilesOf([tool("output-available")])).toEqual(["/Klienti/C001/Spisy/M001/Predžalobná výzva.docx"]);
    // A declined card, another tool or a file that was not created adds nothing.
    expect(createdFilesOf([tool("output-denied"), tool("output-available", "legalwork_shell")])).toEqual([]);
    expect(fileChangesOf("lawoss_files", { operations: [] }, output)).toBe(2);
    const message: UIMessage = { id: "msg_1", role: "assistant", parts: [tool("output-available"), { type: "text", text: "Dokument je pripravený." }] };
    const artifacts = getArtifactsFromMessages([message]);
    expect(artifacts.map((artifact) => ({ name: artifact.name, type: artifact.type, path: artifact.path, preview: artifact.legacy_target.preview })))
      .toEqual([{ name: "Predžalobná výzva.docx", type: "document", path: "/Klienti/C001/Spisy/M001/Predžalobná výzva.docx", preview: "word" }]);
  });

  test("the app's own Word viewer reads the document the server builds", async () => {
    const bytes = buildDocx({ title: "Predžalobná výzva", blocks: [
      { type: "heading", level: 1, text: "Výzva na úhradu dlhu" },
      { type: "paragraph", text: "Vážený pán Šťastný, vyzývame Vás na úhradu **1 250,00 EUR** do *7 dní*; A < B & C.", align: "justify" },
      { type: "list", ordered: true, items: ["faktúra č. 2026/014", "faktúra č. 2026/019"] },
      { type: "list", ordered: false, items: ["úrok z omeškania"] },
      { type: "page_break" },
      { type: "paragraph", text: "S úctou\nJUDr. Ľubica Žňavová", align: "right" },
    ] });
    const buffer = new ArrayBuffer(bytes.byteLength);
    new Uint8Array(buffer).set(bytes);
    const prose = toProseDoc(await parseDocx(buffer));
    expect(prose.textContent).toContain("Predžalobná výzvaVýzva na úhradu dlhuVážený pán Šťastný, vyzývame Vás na úhradu 1 250,00 EUR do 7 dní; A < B & C.");
    const paragraphs: Array<{ style: unknown; numbered: boolean; bullet: unknown; align: unknown; marks: string[] }> = [];
    prose.forEach((node) => {
      const marks = new Set<string>();
      node.descendants((child) => { for (const mark of child.marks) marks.add(mark.type.name); });
      paragraphs.push({ style: node.attrs.styleId, numbered: Boolean(node.attrs.numPr), bullet: node.attrs.listIsBullet, align: node.attrs.alignment, marks: [...marks].sort() });
    });
    expect(paragraphs[0]).toMatchObject({ style: "Title" });
    expect(paragraphs[1]).toMatchObject({ style: "Heading1" });
    expect(paragraphs[2]).toMatchObject({ align: "both", marks: ["bold", "italic"] });
    expect(paragraphs[3]).toMatchObject({ numbered: true, bullet: false });
    expect(paragraphs[5]).toMatchObject({ numbered: true, bullet: true });
  });
});
