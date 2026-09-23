import { describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describeMemoryWrite } from "../src/lawoss/lite/memory-write";
import { MemoryWriteNotice } from "../src/lawoss/lite/memory-write-notice";
import {
  PermissionApprovalModal,
  PermissionApprovalPanel,
} from "../src/react-app/domains/session/chat/permission-approval-modal";
import type { PendingPermission } from "../src/app/types";

describe("describeMemoryWrite", () => {
  test("dry-run přes node a cestu k CLI", () => {
    expect(describeMemoryWrite('node "/x/resources/okf-memory.js" write "Klienti/Novák/Spisy/Odvolání" --file navrh.md --reason "lhůta k odvolání"'))
      .toEqual({ matterDir: "Klienti/Novák/Spisy/Odvolání", file: "navrh.md", reason: "lhůta k odvolání", apply: false });
  });
  test("apply se schválením", () => {
    expect(describeMemoryWrite("okf-memory write spis --file a.md --reason r --apply --approve-as \"JUDr. X\"")).toMatchObject({ apply: true, approvedBy: "JUDr. X" });
  });
  test("jen zmínka nebo jiný příkaz → nic (Review Focus 5)", () => {
    for (const cmd of ["echo okf-memory write", "cat okf-memory.js", "okf-memory read spis", "okf-memory write", "", "grep 'okf-memory write' log"]) expect(describeMemoryWrite(cmd)).toBeNull();
  });
});

describe("MemoryWriteNotice", () => {
  test("náhled vs. zápis po schválení, vždy poznámka o lhůtách", () => {
    const dry = renderToStaticMarkup(<MemoryWriteNotice proposal={{ matterDir: "S", file: "a.md", reason: "r", apply: false }} />);
    expect(dry).toContain("Preview only");
    expect(dry).toContain("Deadlines always need your confirmation.");
    const apply = renderToStaticMarkup(<MemoryWriteNotice proposal={{ matterDir: "S", apply: true }} />);
    expect(apply).toContain("Will be written after your approval.");
  });
});

function pendingPermission(overrides: Partial<PendingPermission> = {}): PendingPermission {
  return {
    id: "permission-1",
    sessionID: "session-1",
    permission: "bash",
    patterns: ["okf-memory write"],
    metadata: {},
    always: { session: false, project: false },
    receivedAt: 1,
    protocol: "legacy",
    ...overrides,
  };
}

describe("integrace do PermissionApprovalPanel/Modal (upstream)", () => {
  // useUiMode() vrací přes useSyncExternalStore server snapshot "pro" — v bun
  // testu (renderToStaticMarkup) tedy vždy vykreslí pro cestu. To je přesně
  // důkaz, že pro zůstává beze změny: i příkaz odpovídající okf-memory write
  // kartu nezobrazí a detail příkazu se vykreslí jako dřív.
  const memoryWriteCommand = 'node "/x/resources/okf-memory.js" write "spis" --file navrh.md --reason "lhůta"';

  test("pro beze změny: karta se nezobrazí, detail příkazu je stejný jako dřív", () => {
    const permission = pendingPermission({ metadata: { command: memoryWriteCommand } });
    const panelHtml = renderToStaticMarkup(
      React.createElement(PermissionApprovalPanel, { permission, respondPermission: () => {} }),
    );
    expect(panelHtml).not.toContain('data-lawoss-lite="memory-write"');
    expect(panelHtml).not.toContain("The assistant wants to record to the matter memory");
    expect(panelHtml).toContain("okf-memory write"); // scope/detail rows render as before

    // AlertDialogContent renders via a Portal, which is a no-op under
    // renderToStaticMarkup (SSR) — this only proves the modal doesn't throw
    // with the new (always-null-under-SSR) memory-write branch wired in.
    expect(() =>
      renderToStaticMarkup(
        React.createElement(PermissionApprovalModal, { permission, respondPermission: () => {} }),
      ),
    ).not.toThrow();
  });
});
