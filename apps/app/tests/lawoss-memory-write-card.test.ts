// LAWOSS N-A7-10 (test 28. 10. 2026): zápis do pamäte prípadu je jedna karta „Zapísať do pamäte prípadu?“
// s textom a súborom, nie karta „Spustiť príkaz v počítači?“ s kódom `node …`.
import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PendingPermission } from "../src/app/types";
import { currentLocale, setLocale, t, type Language } from "../src/i18n";
import { lawossToolActivityLabel, lawossToolHistoryLabel } from "../src/lawoss/chat/tool-labels";
import { fileOperationCard } from "../src/lawoss/lite/file-operation-card";
import { PermissionApprovalPanel } from "../src/react-app/domains/session/chat/permission-approval-modal";

const initial: Language = currentLocale();
afterEach(() => setLocale(initial));

const lawossMemory = {
  target: "Spisy/M004-SYN/memory/M004-MAT.md", kind: "update", title: "Stav veci SYN",
  truth: "Strany rokovali o náhradnom nájomcovi.\n\nKlient preferuje komunikáciu e-mailom.", previousTruth: "Strany rokovali o náhradnom nájomcovi.",
  history: ["2026-10-28 — klient preferuje e-mail"], fields: [], reason: "Pokyn advokáta v chate",
};
const permission: PendingPermission = { id: "per_1", sessionID: "ses_1", permission: "lawoss_file_change", patterns: [lawossMemory.target],
  metadata: { lawossMemory }, always: [], receivedAt: 1, protocol: "legacy" };
const buttons = (html: string) => Array.from(html.matchAll(/<button\b[\s\S]*?<\/button>/g)).map((match) => match[0].replace(/<[^>]*>/g, "").trim());

describe("karta zápisu do pamäte prípadu", () => {
  test("po slovensky: nadpis, text, súbor a história; bez „Spustiť príkaz“ a bez surového JSON", () => {
    setLocale("sk");
    const html = renderToStaticMarkup(React.createElement(PermissionApprovalPanel, { permission, respondPermission: () => {} }));
    expect(html).toContain("Zapísať do pamäte prípadu?");
    expect(html).toContain("Súbor: Spisy/M004-SYN/memory/M004-MAT.md");
    expect(html).toContain("Klient preferuje komunikáciu e-mailom.");
    expect(html).toContain("Do histórie: 2026-10-28 — klient preferuje e-mail");
    expect(html).toContain("Doteraz: Strany rokovali o náhradnom nájomcovi.");
    expect(html).toContain("Dôvod: Pokyn advokáta v chate");
    for (const raw of ["lawossMemory", "previousTruth", "&quot;truth&quot;", "Spustiť príkaz", "node "]) expect(html.includes(raw) ? raw : null).toBeNull();
    expect(buttons(html)).toEqual([t("session.deny"), t("session.allow_once")]);
  });

  test("nadpis v SK, CS, EN a DE; neúplné údaje kartu nevytvoria", () => {
    const titles: Record<"sk" | "cs" | "en" | "de", string> = { sk: "Zapísať do pamäte prípadu?", cs: "Zapsat do paměti případu?", en: "Write to the case memory?", de: "In das Fallgedächtnis schreiben?" };
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      setLocale(locale);
      expect(fileOperationCard({ lawossMemory })?.title).toBe(titles[locale]);
    }
    expect(fileOperationCard({ lawossMemory: { ...lawossMemory, target: "" } })).toBeNull();
    expect(fileOperationCard({ lawossMemory: { truth: "x" } })).toBeNull();
  });

  test("krok v chate má text pre advokáta, nie názov nástroja", () => {
    setLocale("sk");
    expect(lawossToolActivityLabel("lawoss_memory_write", {})).toBe("Príprava zápisu do pamäte prípadu");
    expect(lawossToolHistoryLabel("lawoss_memory_write", {})).toBe("Zápis do pamäte prípadu");
  });
});
