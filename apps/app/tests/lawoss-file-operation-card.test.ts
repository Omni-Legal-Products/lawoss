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

  test("a batch lists every change; deleting says Trash, with counts, empty and large folders", () => {
    const card = fileOperationCard({ lawossFiles: [
      { operation: "create_folder", kind: "folder", to: "Zmluvy" },
      { operation: "move", kind: "file", from: "Pripady/M001/zmluva.txt", to: "Zmluvy/01_Zmluva.txt" },
      { operation: "copy", kind: "file", from: "pripojeny-A/podklad.pdf", to: "Zmluvy/podklad.pdf" },
      { operation: "delete", kind: "folder", from: "Pripady/M001", entries: 3 },
      { operation: "delete", kind: "folder", from: "Prazdny", entries: 0 },
      { operation: "delete", kind: "folder", from: "Archiv", entries: 1000, entriesCapped: true },
      { operation: "delete", kind: "file", from: "stary.txt" },
    ] });
    expect(card?.title).toBe(t("lawoss.files.title_batch", { count: 7 }));
    expect(card?.message).toBe(t("lawoss.files.message_trash"));
    expect(card?.permissionLabel).toBe(t("lawoss.files.permission_label"));
    expect(card?.scopeValue.split("\n")).toEqual([
      t("lawoss.files.line_create_folder", undefined, { path: "Zmluvy" }),
      "Pripady/M001/zmluva.txt → Zmluvy/01_Zmluva.txt",
      t("lawoss.files.line_copy", undefined, { from: "pripojeny-A/podklad.pdf", to: "Zmluvy/podklad.pdf" }),
      t("lawoss.files.line_trash_folder", { path: "Pripady/M001", count: 3 }),
      t("lawoss.files.line_trash_folder_empty", undefined, { path: "Prazdny" }),
      t("lawoss.files.line_trash_folder_large", undefined, { path: "Archiv", limit: "1000" }),
      t("lawoss.files.line_trash", undefined, { path: "stary.txt" }),
    ]);
    // Slovak and Czech plural forms.
    expect(t("lawoss.files.title_batch", { count: 2, lng: "sk" })).toBe("Vykonať 2 zmeny súborov?");
    expect(t("lawoss.files.title_batch", { count: 5, lng: "sk" })).toBe("Vykonať 5 zmien súborov?");
    expect(t("lawoss.files.title_batch", { count: 3, lng: "cs" })).toBe("Provést 3 změny souborů?");
    expect(t("lawoss.files.line_trash_folder", { path: "X", count: 1, lng: "sk" })).toBe("Do Koša priečinok: X (vnútri 1 položka)");
    expect(t("lawoss.files.line_trash_folder_large", { path: "X", limit: "1000", lng: "sk" })).toBe("Do Koša priečinok: X (vnútri 1000+ položiek)");
    expect(t("lawoss.files.title_trash", "sk")).toBe("Presunúť do Koša?");
    // A move to another folder is not called a rename.
    expect(fileOperationCard({ lawossFiles: [{ operation: "move", kind: "file", from: "a.txt", to: "Archiv/a.txt" }] })?.title).toBe(t("lawoss.files.title_move"));
    expect(fileOperationCard({ lawossFiles: [{ operation: "explode", kind: "file" }] })).toBeNull();
    expect(fileOperationCard({ command: "mv a b" })).toBeNull();
  });

  test("'allow for the conversation' is never offered for a folder outside the client or when the engine cannot keep it", () => {
    expect(offersRememberedApproval(engineCard({ permission: "external_directory", always: ["/Klienti/C001/*"] }))).toBe(false);
    expect(offersRememberedApproval(engineCard({ always: [] }))).toBe(false);
    // A native edit card: the engine would keep "always" for every chat of this client.
    expect(offersRememberedApproval(engineCard({ permission: "edit", always: ["*"] }))).toBe(false);
    expect(offersRememberedApproval(engineCard({ permission: "skill", always: ["pdf"] }))).toBe(true);
    const outside = renderToStaticMarkup(React.createElement(PermissionApprovalPanel, {
      permission: engineCard({ permission: "external_directory", patterns: ["/Klienti/C001/*"], always: ["/Klienti/C001/*"] }), respondPermission: () => {} }));
    expect(buttons(outside)).toEqual([t("session.deny"), t("session.allow_once")]);
  });

  test("the one managed-shell card shows the command and what it covers outside Details", () => {
    const permission = engineCard({ id: "host:req_1", permission: "bash", patterns: ["/Klienti/C001"], protocol: "host", metadata: { description: "Premenuj poznámky", summary: "Run this command on this computer?" },
      host: { id: "req_1", workspaceId: "ws", sessionID: "ses_1", action: "sandbox.bash", summary: "Run this command on this computer?", description: "Premenuj poznámky",
        paths: ["/Klienti/C001"], command: "mv poznamky.txt SYN-overenie.txt", hostWide: true, canRemember: true, createdAt: 1, actor: { type: "host" } } });
    const main = renderToStaticMarkup(React.createElement(PermissionApprovalPanel, { permission, respondPermission: () => {} })).split("<details")[0];
    expect(main).toContain("mv poznamky.txt SYN-overenie.txt");
    expect(main).toContain(t("lawoss.shell_card.host_wide"));
    expect(t("lawoss.shell_card.host_wide", "sk")).toContain("Toto jedno schválenie pokrýva");
    // It covers folders outside this client: no "allow for the conversation" even if a server offered it.
    expect(buttons(main)).toEqual([t("session.deny"), t("session.allow_once")]);
  });
});
