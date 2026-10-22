import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PendingPermission } from "../src/app/types";
import { t } from "../src/i18n";
import { fileOperationCard, offersRememberedApproval } from "../src/lawoss/lite/file-operation-card";
import { PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";

function engineCard(overrides: Partial<PendingPermission> = {}): PendingPermission {
  return { id: "per_1", sessionID: "ses_1", permission: "edit", patterns: ["poznamky.txt", "SYN-overenie.txt"], metadata: {}, always: [], receivedAt: 1, protocol: "legacy", ...overrides };
}

const buttons = (html: string) => Array.from(html.matchAll(/<button\b[\s\S]*?<\/button>/g)).map((match) => match[0].replace(/<[^>]*>/g, "").trim());

describe("lawoss_files card", () => {
  test("one rename reads as old → new, with no 'allow for the conversation'", () => {
    const permission = engineCard({ metadata: { lawossFiles: [{ operation: "move", kind: "file", from: "poznamky.txt", to: "SYN-overenie.txt" }], description: "Premenovanie podľa zadania" } });
    const html = renderToStaticMarkup(React.createElement(PermissionApprovalPanel, { permission, respondPermission: () => {} }));
    expect(t("lawoss.files.title_rename")).toBe("Rename?");
    expect(t("lawoss.files.title_rename", "sk")).toBe("Premenovať?");
    expect(html).toContain(t("lawoss.files.title_rename"));
    expect(html).toContain("poznamky.txt → SYN-overenie.txt");
    expect(html).toContain(t("lawoss.files.message"));
    expect(buttons(html)).toEqual([t("session.deny"), t("session.allow_once")]);
  });

  test("a batch lists every change; a delete warns that it cannot be undone", () => {
    const card = fileOperationCard({ lawossFiles: [
      { operation: "create_folder", kind: "folder", to: "Zmluvy" },
      { operation: "move", kind: "file", from: "Pripady/M001/zmluva.txt", to: "Zmluvy/01_Zmluva.txt" },
      { operation: "copy", kind: "file", from: "pripojeny-A/podklad.pdf", to: "Zmluvy/podklad.pdf" },
      { operation: "delete", kind: "folder", from: "Pripady/M001", entries: 1 },
    ] });
    expect(card?.title).toBe(t("lawoss.files.title_batch", undefined, { count: "4" }));
    expect(card?.message).toBe(t("lawoss.files.message_delete"));
    expect(card?.scopeValue.split("\n")).toEqual([
      t("lawoss.files.line_create_folder", undefined, { path: "Zmluvy" }),
      "Pripady/M001/zmluva.txt → Zmluvy/01_Zmluva.txt",
      t("lawoss.files.line_copy", undefined, { from: "pripojeny-A/podklad.pdf", to: "Zmluvy/podklad.pdf" }),
      t("lawoss.files.line_delete_folder", undefined, { path: "Pripady/M001", count: "1" }),
    ]);
    // A move to another folder is not called a rename.
    expect(fileOperationCard({ lawossFiles: [{ operation: "move", kind: "file", from: "a.txt", to: "Archiv/a.txt" }] })?.title).toBe(t("lawoss.files.title_move"));
    expect(fileOperationCard({ lawossFiles: [{ operation: "explode", kind: "file" }] })).toBeNull();
    expect(fileOperationCard({ command: "mv a b" })).toBeNull();
  });

  test("'allow for the conversation' is never offered for a folder outside the client or when the engine cannot keep it", () => {
    expect(offersRememberedApproval(engineCard({ permission: "external_directory", always: ["/Klienti/C001/*"] }))).toBe(false);
    expect(offersRememberedApproval(engineCard({ always: [] }))).toBe(false);
    expect(offersRememberedApproval(engineCard({ always: ["*"] }))).toBe(true);
    const outside = renderToStaticMarkup(React.createElement(PermissionApprovalPanel, {
      permission: engineCard({ permission: "external_directory", patterns: ["/Klienti/C001/*"], always: ["/Klienti/C001/*"] }), respondPermission: () => {} }));
    expect(buttons(outside)).toEqual([t("session.deny"), t("session.allow_once")]);
  });
});
