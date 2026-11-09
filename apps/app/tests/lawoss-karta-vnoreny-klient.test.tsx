/** @jsxImportSource react */
// #264 (MČ 31. 10. 2026): kartu pre priečinok iného klienta vnoreného v klientovi chatu (natívny `read`, `edit`, …) otvorí
// plugin enginu so správou `NESTED_CLIENT_CARD_PREFIX` + koreň klienta, kartu príkazu server s `otherClientFolder`. Karta
// varuje menom klienta (aj bez karty v prehľade: meno registrovaného priečinka), technickú správu neukáže a neponúkne
// zapamätanie ani povolenie pre sedenie. Syntetická prax /Users/advokat/Prax.
import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { currentLocale, setLocale } from "../src/i18n";
import type { PendingPermission } from "../src/app/types";
import { ClientNavTestProvider } from "../src/lawoss/lite/client-nav";
import { offersRememberedApproval } from "../src/lawoss/lite/file-operation-card";
import { NESTED_CLIENT_CARD_PREFIX, nestedClientCardFolder, permissionCardNote } from "../src/lawoss/lite/nested-client-card";
import { nestedClientName } from "../src/lawoss/lite/other-client-folder";
import { clearSessionApprovals, coveredBySessionApproval, offersSessionApproval, rememberSessionApproval } from "../src/lawoss/lite/session-approvals";
import { PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";

const P = "/Users/advokat/Prax";
const parent = `${P}/Klienti/C001-syn-tatran`, nested = `${parent}/Dcéra s.r.o.`;
const original = currentLocale();
afterEach(() => { setLocale(original); clearSessionApprovals(); });

const card = (overrides: Partial<PendingPermission> = {}): PendingPermission => ({
  id: "per_1", sessionID: "ses_1", permission: "read", patterns: ["Dcéra s.r.o./Zmluvy/zmluva.txt"], metadata: {}, always: ["*"], receivedAt: 1, protocol: "v2",
  message: `${NESTED_CLIENT_CARD_PREFIX}${nested}`, ...overrides,
});

describe("karta vnoreného iného klienta", () => {
  test("priečinok zo správy pluginu aj z karty príkazu; iná správa nie je karta vnoreného klienta", () => {
    expect(nestedClientCardFolder(card())).toBe(nested);
    expect(nestedClientCardFolder({ host: { id: "a", workspaceId: "w", action: "sandbox.external_directory", summary: "", paths: [], createdAt: 1, actor: { type: "host" }, otherClientFolder: nested } })).toBe(nested);
    expect(nestedClientCardFolder(card({ message: "Iná poznámka" }))).toBeNull();
    expect(permissionCardNote(card().message)).toBeNull();
    expect(permissionCardNote("Iná poznámka")).toBe("Iná poznámka");
  });

  test("meno: z prehľadu, inak z registrovaného priečinka, inak názov priečinka", () => {
    expect(nestedClientName(nested, [{ folder: nested, name: "C007 SYN Dcéra" }], [])).toBe("C007 SYN Dcéra");
    expect(nestedClientName(nested, [], [{ path: nested, displayNameResolved: "SYN Dcéra" }])).toBe("SYN Dcéra");
    expect(nestedClientName(nested, [], [])).toBe("Dcéra s.r.o.");
  });

  test("bez zapamätania a bez povolenia pre sedenie; skoršie povolenie úprav pre sedenie ju nepokryje", () => {
    expect(offersRememberedApproval(card())).toBe(false);
    expect(offersRememberedApproval(card({ message: undefined }))).toBe(true);
    const edit = card({ permission: "edit", patterns: ["Dcéra s.r.o./nový.txt"] });
    rememberSessionApproval({ ...edit, message: undefined });
    expect(coveredBySessionApproval({ ...edit, message: undefined }, ["ses_1"])).toBe(true);
    expect(coveredBySessionApproval(edit, ["ses_1"])).toBe(false);
    expect(offersSessionApproval(edit, null)).toBe(false);
  });

  test("karta varuje menom vnoreného klienta a neukáže technickú správu ani tlačidlá zapamätania", () => {
    setLocale("sk");
    const workspace = { id: "ws_p", path: parent, name: "Tatran", displayNameResolved: "SYN Tatran" };
    const nav = {
      scope: { anchor: workspace, members: [{ workspace, prefix: "" }] },
      data: { clients: [] },
      connection: { workspaces: [workspace, { id: "ws_n", path: nested, name: "Dcéra", displayNameResolved: "SYN Dcéra" }] },
    } as unknown as React.ComponentProps<typeof ClientNavTestProvider>["value"];
    const html = renderToStaticMarkup(<ClientNavTestProvider value={nav}><PermissionApprovalPanel permission={card()} respondPermission={() => {}} chatDirectory={parent} /></ClientNavTestProvider>);
    expect(html).toContain("Pozor: priečinok patrí inému klientovi (SYN Dcéra). Ak ho povolíte, agent uvidí jeho súbory.");
    expect(html).toContain("data-lawoss-other-client");
    expect(html).not.toContain(NESTED_CLIENT_CARD_PREFIX);
    expect(html).not.toContain("data-lawoss-session-approval");
  });
});
