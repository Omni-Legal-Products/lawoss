import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { t } from "../src/i18n";
import { ClientsView } from "../src/lawoss/lite/pages/clients-page";
import { TriagePreviewView } from "../src/lawoss/domains/roztriedenie/triage-page";
import { triageApply, triageGrant, triageLink, triagePlan, triageReplan, triageUndo, type TriageApiPath, type TriageClient, type TriagePreview } from "../src/lawoss/domains/roztriedenie/api";
import { LAWOSS_ROUTES } from "../src/lawoss/shell/routes";

const BANNED = /workspace|session|skill|\bMCP\b|\bOKF\b|opencode|plugin|treeDigest|fingerprint/i;
const html = (node: ReactElement) => renderToStaticMarkup(<MemoryRouter>{node}</MemoryRouter>);

/** Syntetický náhľad (vymyslené mená), tvar ako vracia /lawoss/triage/plan. */
const preview: TriagePreview = {
  id: "00000000-0000-4000-8000-000000000000", fingerprint: "a".repeat(64), runId: "triage-20261005-100000-abcdef", root: "/x/Vymysleny klient (trial 2026-10-05)", language: "sk",
  documents: 4, keepInInbox: ["d0000000000000003"], classification: { used: false, documents: 0 },
  matters: [{ key: "case-1", title: "Konanie 8C 123-2023", folder: "Spisy/2026-10 Konanie 8C 123-2023", date: "2026-10-05", dateSource: "today", kind: "contentious", caseNumber: "8C 123/2023", source: "rules", documents: 1 }],
  moves: [
    { id: "d0000000000000001", from: "odpoved.eml", to: "05_Komunikacia/odpoved.eml", size: 1, role: "correspondence", source: "rules", confidence: "high", rule: "email_file", matched: ".eml" },
    { id: "d0000000000000002", from: "Spor/Rozsudok 8C_123_2023.pdf", to: "Spisy/2026-10 Konanie 8C 123-2023/05_Komunikacia/Dolezita_posta/Rozsudok 8C_123_2023.pdf", size: 1, role: "important_mail", matter: "case-1", source: "rules", confidence: "medium", rule: "court_decision", matched: "rozsudok" },
    { id: "d0000000000000003", from: "Plnomocenstvo.pdf", to: "00_Na_zatriedenie/Plnomocenstvo.pdf", size: 1, role: "inbox", source: "user", confidence: "high" },
    { id: "d0000000000000004", from: "scan.pdf", to: "01_Podklady/scan.pdf", size: 1, role: "client_documents", source: "model", confidence: "high", reason: "Podpísaná zmluva o dielo.", truncated: true },
  ],
  stays: [{ id: "d0000000000000005", path: "00_Na_zatriedenie/x.jpg", why: "already_in_place" }],
  newFolders: 9,
};

describe("roztriedenie v appke", () => {
  test("náhľad je tabuľka pre advokáta: odkiaľ, kam, prečo, istota, nová vec", () => {
    const out = html(<TriagePreviewView preview={preview} text={(key, params) => t(`lawoss.triage.${key}`, "sk", params)} busy={false} onKeep={() => {}} onConfirm={() => {}} onModel={() => {}} />);
    for (const label of ["Dokument", "Odkiaľ", "Kam", "Prečo", "Istota", "Nechať na zatriedenie"]) expect(out).toContain(label);
    expect(out).toContain("Komunikácia");
    expect(out).toContain("Dôležitá pošta");
    expect(out).toContain("nová vec");
    expect(out).toContain("Spisová značka 8C 123/2023");
    expect(out).toContain("E-mailová správa (.eml)");
    expect(out).toContain("Rozhodnutie alebo písomnosť súdu podľa názvu („rozsudok“)");
    expect(out).toContain("Ponechali ste na zatriedenie");
    expect(out).toContain("Podpísaná zmluva o dielo.");
    expect(out).toContain("Model čítal skrátený text");
    expect(out).toContain("Hlavný priečinok klienta");
    expect(out).toContain("Dokumenty na presun v skúšobnom klone: 4.");
    expect(out).toContain("Potvrdiť a roztriediť");
    expect(out).toContain("Už je na správnom mieste");
    expect(out).toMatch(/aria-label="Nechať na zatriedenie: Plnomocenstvo.pdf" checked=""/);
    expect(out.replace(/<[^>]+>/g, " ")).not.toMatch(BANNED);
  });
  test("texty roztriedenia sú v SK, CZ, EN a DE", () => {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      expect(t("lawoss.triage.title", locale)).not.toBe("lawoss.triage.title");
      expect(t("lawoss.triage.model_privacy", locale)).toMatch(/model|Modell/i);
    }
    expect(t("lawoss.triage.title", "cs")).toBe("Roztřídit dokumenty");
    expect(t("lawoss.triage.title", "sk")).toBe("Roztriediť dokumenty");
  });
  test("Klienti ponúknu roztriedenie vedľa novej veci a stránka má vlastnú trasu", () => {
    const out = html(<ClientsView groups={[]} locale="sk" actions={<a href={triageLink("/x/klon")}>roztriedit</a>} />);
    expect(out).toContain('href="/roztriedenie?klon=%2Fx%2Fklon"');
    expect(LAWOSS_ROUTES.some((route) => route.path === "/roztriedenie")).toBe(true);
  });
  test("klient posiela len cestu, voľby a potvrdenie odtlačku", async () => {
    const calls: [string, unknown][] = [];
    const client: TriageClient = { lawossTriage: async <T,>(path: string, body: unknown) => { calls.push([path, body]); return {} as T; } };
    await triagePlan(client, "/x/klon");
    await triagePlan(client, "/x/klon", true);
    await triageReplan(client, preview.id, ["d0000000000000001"]);
    await triageApply(client, preview);
    await triageUndo(client, "/x/klon", preview.runId);
    expect(calls).toEqual([
      ["plan", { root: "/x/klon" }],
      ["plan", { root: "/x/klon", useModel: true }],
      ["replan", { id: preview.id, keepInInbox: ["d0000000000000001"] }],
      ["apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true }],
      ["undo", { root: "/x/klon", runId: preview.runId, confirm: true }],
    ]);
  });
});

test("grant posiela root a potvrdenie", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const client: TriageClient = { lawossTriage: async <T,>(path: TriageApiPath, body: unknown): Promise<T> => { calls.push({ path, body }); return { granted: true, root: "/k" } as T; } };
  expect(await triageGrant(client, "/k")).toEqual({ granted: true, root: "/k" });
  expect(calls).toEqual([{ path: "grant", body: { root: "/k", confirm: true } }]);
});
