// LAWOSS P6 (test 24. 10. 2026, N-A3-6): advokát nevidí technické texty.
import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { currentLocale, setLocale, t, type Language } from "../src/i18n";
import { getDisplaySessionTitle } from "../src/app/lib/session-title";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PendingPermission } from "../src/app/types";
import { fileOperationCard } from "../src/lawoss/lite/file-operation-card";
import { PermissionApprovalModal, PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";

const initial: Language = currentLocale();
afterEach(() => setLocale(initial));
const source = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");

describe("nová karta chatu nemá názov enginu „New session - …“", () => {
  test("predvolený názov enginu sa ukáže po slovensky, česky, anglicky a nemecky", () => {
    const engineTitle = `New session - ${new Date("2026-10-24T13:35:00.000Z").toISOString()}`;
    const expected: Record<Language, string> = { sk: "Nový chat", cs: "Nový chat", en: "New chat", de: "Neuer Chat" };
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      setLocale(locale);
      expect(getDisplaySessionTitle(engineTitle)).toBe(expected[locale]);
    }
    expect(getDisplaySessionTitle("Presun PDF na NAS")).toBe("Presun PDF na NAS");
  });

  test("karta chatu z „+“ aj uložené karty idú cez zobrazovaný názov", () => {
    expect(source("src/react-app/shell/session-route.tsx")).toContain("label: getDisplaySessionTitle(session.title)");
    expect(source("src/react-app/shell/session-route.tsx")).not.toContain("label: session.title ||");
    expect(source("src/react-app/domains/session/panel/side-panel.tsx")).toContain('tab.type === "chat" ? getDisplaySessionTitle(tab.label)');
  });
});

describe("detail skillu v Integráciách nie je po anglicky (V14)", () => {
  const modal = () => source("src/react-app/design-system/extension-detail-modal.tsx");
  test("popisky nie sú napevno anglické", () => {
    for (const label of ["Details", "Type", "Location", "Status", "Visibility", "Endpoint", "Launch", "Authentication", "Availability", "Trigger", "Setup", "Preview", "Show", "Hide"])
      expect(modal().match(new RegExp(`>\\s*${label}\\s*<`))?.[0] ?? null).toBeNull();
    for (const value of ["Installed", "Connected", "Not installed", "Not connected", "Hidden", "Shown", "Uninstall", "Disconnect"])
      expect(modal().includes(`"${value}"`) ? value : null).toBeNull();
  });
  test("SK, CS a DE majú vlastné texty detailu", () => {
    const keys = ["session.details_label", "mcp.server_type", "extension_detail.location", "identities.status_label", "skills.installed_status",
      "extension_detail.visibility", "extension_detail.shown", "extension_card.hidden", "common.hide", "office_addins.uninstall", "extension_detail.not_installed",
      "extension_detail.trigger", "extension_detail.availability", "extension_detail.setup"];
    const expected: Record<"sk" | "cs" | "de", string[]> = {
      sk: ["Podrobnosti", "Typ", "Umiestnenie", "Stav", "Nainštalované", "Viditeľnosť", "Zobrazené", "Skryté", "Skryť", "Odinštalovať", "Nenainštalované", "Kedy sa použije", "Dostupnosť", "Nastavenie"],
      cs: ["Podrobnosti", "Typ", "Umístění", "Stav", "Nainstalováno", "Viditelnost", "Zobrazeno", "Skryté", "Skrýt", "Odinstalovat", "Nenainstalováno", "Kdy se použije", "Dostupnost", "Nastavení"],
      de: ["Details", "Typ", "Speicherort", "Status", "Installiert", "Sichtbarkeit", "Angezeigt", "Ausgeblendet", "Ausblenden", "Deinstallieren", "Nicht installiert", "Wann er verwendet wird", "Verfügbarkeit", "Einrichtung"],
    };
    for (const locale of ["sk", "cs", "de"] as const) {
      setLocale(locale);
      expect(keys.map((key) => t(key))).toEqual(expected[locale]);
    }
  });
});

describe("„Podrobnosti“ karty zmeny súborov bez surového JSON (V10a)", () => {
  const metadata = { lawossFiles: [
    { operation: "move", kind: "file", from: "00_Na_zatriedenie/sken_sud_001.pdf", to: "Spisy/M004 Vyúčtovanie nájmu logistického skladu/2026-10-15 Uznesenie.pdf" },
    { operation: "move", kind: "file", from: "Spisy/M004/podklad.pdf", to: "Spisy/M004/zmluva (2).pdf" },
    { operation: "copy", kind: "folder", from: "Spisy/M004/Podania", to: "C002-podklady/Podania", entries: 3 },
    { operation: "delete", kind: "file", from: "stary.txt" },
  ], description: "Zaradenie rozhodnutia do prípadu" };
  const permission: PendingPermission = { id: "per_1", sessionID: "ses_1", permission: "lawoss_file_change", patterns: [], metadata, always: [], receivedAt: 1, protocol: "legacy" };

  test("každá zmena má sloveso, obe cesty celé a počty položiek, v SK/CS/EN/DE", () => {
    setLocale("sk");
    expect(fileOperationCard(metadata)?.details).toEqual({ reason: "Dôvod: Zaradenie rozhodnutia do prípadu", lines: [
      "Presunúť: 00_Na_zatriedenie/sken_sud_001.pdf → Spisy/M004 Vyúčtovanie nájmu logistického skladu/2026-10-15 Uznesenie.pdf",
      "Premenovať: Spisy/M004/podklad.pdf → Spisy/M004/zmluva (2).pdf",
      "Kópia priečinka: Spisy/M004/Podania → C002-podklady/Podania s 3 položkami",
      "Do Koša: stary.txt",
    ] });
    const first = (locale: Language) => { setLocale(locale); return fileOperationCard(metadata)?.details.lines.slice(0, 3).map((line) => line.split(":")[0]); };
    expect(first("cs")).toEqual(["Přesunout", "Přejmenovat", "Kopie složky"]);
    expect(first("en")).toEqual(["Move", "Rename", "Copy folder"]);
    expect(first("de")).toEqual(["Verschieben", "Umbenennen", "Ordner kopieren"]);
  });

  test("karta v chate aj dialóg ukážu zoznam, nie lawossFiles/operation/kind", () => {
    setLocale("sk");
    for (const html of [renderToStaticMarkup(<PermissionApprovalPanel permission={permission} respondPermission={() => {}} />),
      renderToStaticMarkup(<PermissionApprovalModal permission={permission} respondPermission={() => {}} />)]) {
      if (!html.includes("data-lawoss-file-details")) continue; // A closed or portalled dialog renders nothing on the server.
      for (const raw of ["lawossFiles", "&quot;operation&quot;", "&quot;kind&quot;", "&quot;from&quot;"]) expect(html.includes(raw) ? raw : null).toBeNull();
      expect(html).toContain("Premenovať: Spisy/M004/podklad.pdf → Spisy/M004/zmluva (2).pdf");
    }
    const panel = renderToStaticMarkup(<PermissionApprovalPanel permission={permission} respondPermission={() => {}} />);
    expect(panel).toContain("data-lawoss-file-details");
    expect(panel).toContain("Dôvod: Zaradenie rozhodnutia do prípadu");
  });

  test("iné karty si surové podrobnosti nechávajú", () => {
    setLocale("sk");
    const other: PendingPermission = { ...permission, permission: "webfetch", metadata: { url: "https://example.invalid", format: "text" } };
    const html = renderToStaticMarkup(<PermissionApprovalPanel permission={other} respondPermission={() => {}} />);
    expect(html).toContain("&quot;format&quot;");
    expect(html).not.toContain("data-lawoss-file-details");
  });
});

describe("nový chat prípadu: technické pokyny idú modelu skryto (R1)", () => {
  test("prvé odoslanie pridá skrytý pokyn chatu do system-reminder časti správy", () => {
    const route = source("src/react-app/shell/session-route.tsx");
    expect(route).toContain("yoloTurnContext(), takeCaseChatContext(targetSessionId)]");
    expect(route).toContain("if (turnSystemContext) parts.push(systemReminderPart(turnSystemContext));");
  });
});
