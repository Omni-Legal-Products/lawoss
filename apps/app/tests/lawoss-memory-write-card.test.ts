// LAWOSS N-A7-10 (test 28. 10. 2026): zápis do pamäte prípadu je jedna karta „Zapísať do pamäte prípadu?“
// s textom a súborom, nie karta „Spustiť príkaz v počítači?“ s kódom `node …`.
import { afterEach, describe, expect, test } from "bun:test";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import type { PendingPermission } from "../src/app/types";
import { currentLocale, setLocale, t, type Language } from "../src/i18n";
import { lawossToolActivityLabel, lawossToolHistoryLabel } from "../src/lawoss/chat/tool-labels";
import { fileOperationCard } from "../src/lawoss/lite/file-operation-card";
import { deadlineText } from "../src/lawoss/okf/view-rules";
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
    expect(html).toContain("Zmena záznamu: Stav veci SYN");
    expect(html).toContain("Klient preferuje komunikáciu e-mailom.");
    expect(html).toContain("Do histórie: 2026-10-28 — klient preferuje e-mail");
    expect(html).toContain("Doteraz: Strany rokovali o náhradnom nájomcovi.");
    expect(html).toContain("Dôvod: Pokyn advokáta v chate");
    for (const raw of ["lawossMemory", "previousTruth", "&quot;truth&quot;", "Spustiť príkaz", "node "]) expect(html.includes(raw) ? raw : null).toBeNull();
    expect(buttons(html)).toEqual([t("session.deny"), t("session.allow_once")]);
  });

  test("nový záznam ukáže všetky svoje údaje, aj identifikátory subjektu", () => {
    setLocale("sk");
    const card = fileOperationCard({ lawossMemory: { ...lawossMemory, kind: "create", title: "SYN Subjekt", previousTruth: undefined,
      fields: ["type: subject", "description: SYN", "birth_number: 000000/0000", "id_document_number: SYN000000"] } });
    expect(card?.scopeValue.split("\n").slice(0, 2)).toEqual(["Súbor: Spisy/M004-SYN/memory/M004-MAT.md", "Nový záznam: SYN Subjekt"]);
    for (const line of ["Údaj: type: subject", "Údaj: description: SYN", "Údaj: birth_number: 000000/0000", "Údaj: id_document_number: SYN000000"])
      expect(card?.scopeValue).toContain(line);
    expect(card?.details.lines).not.toContain("Doteraz: Strany rokovali o náhradnom nájomcovi.");
  });

  test("nadpis v SK, CS, EN a DE; neúplné údaje kartu nevytvoria", () => {
    const titles: Record<"sk" | "cs" | "en" | "de", string> = { sk: "Zapísať do pamäte prípadu?", cs: "Zapsat do paměti případu?", en: "Write to the case memory?", de: "In das Fallgedächtnis schreiben?" };
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      setLocale(locale);
      expect(fileOperationCard({ lawossMemory })?.title).toBe(titles[locale]);
    }
    expect(fileOperationCard({ lawossMemory: { ...lawossMemory, target: "" } })).toBeNull();
    expect(fileOperationCard({ lawossMemory: { truth: "x" } })).toBeNull();
    expect(fileOperationCard({ lawossMemory: { ...lawossMemory, kind: "delete" } })).toBeNull();
  });

  test("krok v chate má text pre advokáta, nie názov nástroja", () => {
    setLocale("sk");
    expect(lawossToolActivityLabel("lawoss_memory_write", {})).toBe("Príprava zápisu do pamäte prípadu");
    expect(lawossToolHistoryLabel("lawoss_memory_write", {})).toBe("Zápis do pamäte prípadu");
  });

  // Rozhodnutia MČ 10. 11. 2026 (prehliadka s vetami advokáta).
  const clientNote = { target: "memory/CN-001-komunikacia-s-klientom.md", kind: "create", title: "Komunikácia s klientom", type: "client_note",
    truth: "Klient chce komunikovať len e-mailom, nie telefonicky.", history: ["2026-11-10 — pokyn advokáta v chate"], fields: ["type: client_note"], reason: "Pokyn advokáta v chate", scope: "client" };
  const deadline = { target: "Spisy/M001-SYN/memory/T-001-odpoved-protistrane.md", kind: "create", title: "Odpoveď protistrane", type: "task",
    truth: "Lehota 2026-11-25: Odpoveď protistrane. Zapísané podľa pokynu advokáta v chate (IN-002), neoverené z listiny.", history: ["2026-11-10 — x"],
    fields: ["type: task", "deadline_basis: lawyer_instruction"], reason: "Pokyn advokáta v chate (IN-002)",
    deadline: { case: "Spor o úhradu dodávok", date: "2026-11-25", what: "Odpoveď protistrane", basis: "lawyer_instruction", register: "Spisy/M001-SYN/VSTUPY.md", inputId: "IN-002" } };

  test("poznámka pre celého klienta: karta povie, že platí pre celého klienta, a menuje súbor", () => {
    setLocale("sk");
    const html = renderToStaticMarkup(React.createElement(PermissionApprovalPanel, { permission: { ...permission, patterns: [clientNote.target], metadata: { lawossMemory: clientNote } }, respondPermission: () => {} }));
    expect(html).toContain("Zapísať do pamäte klienta?");
    expect(html).toContain("Platí pre všetky jeho prípady.");
    expect(html).toContain("Platí pre celého klienta (všetky jeho prípady)");
    expect(html).toContain("Súbor: memory/CN-001-komunikacia-s-klientom.md");
    expect(html).toContain("Klient chce komunikovať len e-mailom, nie telefonicky.");
    expect(html).not.toContain("Zapísať do pamäte prípadu?");
    expect(buttons(html)).toEqual([t("session.deny"), t("session.allow_once")]);
    const titles: Record<"sk" | "cs" | "en" | "de", [string, string]> = {
      sk: ["Zapísať do pamäte klienta?", "Platí pre celého klienta (všetky jeho prípady)"], cs: ["Zapsat do paměti klienta?", "Platí pro celého klienta (všechny jeho případy)"],
      en: ["Write to the client's memory?", "Applies to the whole client (all of the client's cases)"], de: ["In das Mandantengedächtnis schreiben?", "Gilt für den gesamten Mandanten (alle seine Fälle)"] };
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      setLocale(locale);
      const card = fileOperationCard({ lawossMemory: clientNote });
      expect(card?.title).toBe(titles[locale][0]);
      expect(card?.scopeValue.split("\n")[0]).toBe(titles[locale][1]);
    }
    // Bez `scope` ostáva karta prípadu.
    setLocale("sk");
    expect(fileOperationCard({ lawossMemory: { ...clientNote, scope: undefined } })?.title).toBe("Zapísať do pamäte prípadu?");
  });

  test("lehota z pokynu advokáta: jedna karta s prípadom, dátumom, účelom, označením a oboma súbormi", () => {
    setLocale("sk");
    const html = renderToStaticMarkup(React.createElement(PermissionApprovalPanel, { permission: { ...permission, patterns: [deadline.target, deadline.deadline.register], metadata: { lawossMemory: deadline } }, respondPermission: () => {} }));
    expect(html).toContain("Zapísať lehotu do prípadu?");
    expect(html).toContain("zaeviduje váš pokyn a zapíše lehotu do pamäte prípadu");
    const card = fileOperationCard({ lawossMemory: deadline });
    // Deň v týždni a celý dátum s rokom; presný tvar určuje ICU, ISO deň ostáva vedľa.
    expect(card?.details.lines[1]).toMatch(/^Lehota: streda,? 25\. novembra 2026 \(2026-11-25\)$/);
    expect(card?.details.lines.filter((_, index) => index !== 1)).toEqual([
      "Prípad: Spor o úhradu dodávok",
      "Na čo: Odpoveď protistrane",
      "Označenie: podľa pokynu advokáta, neoverené z listiny",
      "Lehota sa zapíše do: Spisy/M001-SYN/memory/T-001-odpoved-protistrane.md",
      "Váš pokyn sa zaeviduje v: Spisy/M001-SYN/VSTUPY.md",
      "Text: Lehota 2026-11-25: Odpoveď protistrane. Zapísané podľa pokynu advokáta v chate (IN-002), neoverené z listiny.",
    ]);
    for (const line of card?.details.lines ?? []) expect(html).toContain(line);
    // Žiadne surové polia záznamu ani kód značky.
    for (const raw of ["lawossMemory", "deadline_basis", "lawyer_instruction", "type: task", "Spustiť príkaz"]) expect(html.includes(raw) ? raw : null).toBeNull();
    expect(buttons(html)).toEqual([t("session.deny"), t("session.allow_once")]);
    const texts: Record<"sk" | "cs" | "en" | "de", [string, string]> = {
      sk: ["Zapísať lehotu do prípadu?", "Označenie: podľa pokynu advokáta, neoverené z listiny"], cs: ["Zapsat lhůtu do případu?", "Označení: podle pokynu advokáta, neověřeno z listiny"],
      en: ["Write the deadline to the case?", "Marked: by the lawyer's instruction, not verified from a document"],
      de: ["Frist in den Fall eintragen?", "Kennzeichnung: laut Anweisung des Anwalts, nicht anhand einer Urkunde geprüft"] };
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      setLocale(locale);
      const localized = fileOperationCard({ lawossMemory: deadline });
      expect(localized?.title).toBe(texts[locale][0]);
      expect(localized?.details.lines[3]).toBe(texts[locale][1]);
      expect(localized?.details.lines[1]).toContain("(2026-11-25)");
    }
    // Neúplné údaje lehoty: ostane obyčajná karta zápisu so všetkými poliami, nie polovičná karta lehoty.
    setLocale("sk");
    expect(fileOperationCard({ lawossMemory: { ...deadline, deadline: { ...deadline.deadline, date: "25. novembra" } } })?.title).toBe("Zapísať do pamäte prípadu?");
  });

  test("prehľady ukážu lehotu z pokynu advokáta s poznámkou, ostatné bez nej", () => {
    const item = { title: "Odpoveď protistrane", raw: "2026-11-25 Odpoveď protistrane", recordId: "T-001" };
    const marked: Record<"sk" | "cs" | "en" | "de", string> = {
      sk: "Odpoveď protistrane (podľa pokynu advokáta, neoverené z listiny)", cs: "Odpoveď protistrane (podle pokynu advokáta, neověřeno z listiny)",
      en: "Odpoveď protistrane (by the lawyer's instruction, not verified from a document)", de: "Odpoveď protistrane (laut Anweisung des Anwalts, nicht anhand einer Urkunde geprüft)" };
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      setLocale(locale);
      expect(deadlineText({ ...item, basis: "instruction" })).toBe(marked[locale]);
      expect(deadlineText(item)).toBe("Odpoveď protistrane");
    }
  });

  test("krok zápisu lehoty má text pre advokáta", () => {
    setLocale("sk");
    expect(lawossToolActivityLabel("lawoss_memory_deadline", {})).toBe("Príprava zápisu lehoty");
    expect(lawossToolHistoryLabel("lawoss_memory_deadline", {})).toBe("Zápis lehoty");
  });
});
