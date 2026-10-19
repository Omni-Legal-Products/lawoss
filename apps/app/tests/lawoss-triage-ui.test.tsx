import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ReactElement } from "react";
import { t } from "../src/i18n";
import { ClientsView } from "../src/lawoss/lite/pages/clients-page";
import { TriagePreviewView, TriageTopline, TriageUndoSummary } from "../src/lawoss/domains/roztriedenie/triage-page";
import { offersTriageEntry, plansPreview, triageApply, triageGrant, triageLink, triageTargetRoot, triagePlan, triageReplan, triageUndo, type TriageApiPath, type TriageClient, type TriagePreview } from "../src/lawoss/domains/roztriedenie/api";
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
    expect(out).toContain("nový prípad");
    expect(out).toContain("Spisová značka 8C 123/2023");
    expect(out).toContain("E-mailová správa (.eml)");
    expect(out).toContain("Rozhodnutie alebo písomnosť súdu podľa názvu („rozsudok“)");
    expect(out).toContain("Ponechali ste na zatriedenie");
    expect(out).toContain("Podpísaná zmluva o dielo.");
    expect(out).toContain("Model čítal skrátený text");
    expect(out).toContain("Hlavný priečinok klienta");
    expect(out).toContain("Dokumenty na presun v kópii: 4.");
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

test("po vrátení na mieste sa ukážu ponechané dokumenty", () => {
  const out = html(<TriageUndoSummary text={(key, params) => `${key}${params ? JSON.stringify(params) : ""}`} result={{ status: "undone", runId: "triage-20261008-100000-abcdef", restored: 3, removed: 2, kept: ["05_Komunikacia/odpoved.eml"] }} />);
  expect(out).toContain("undo_restored{&quot;count&quot;:3}");
  expect(out).toContain("05_Komunikacia/odpoved.eml");
});

test("kľúče pre priečinok na mieste existujú vo všetkých jazykoch", () => {
  for (const locale of ["sk", "cs", "en", "de"] as const) {
    for (const key of ["undo_restored", "undo_kept", "not_reorganizable", "in_place_title", "organize_okf", "confirm_note_in_place", "nothing_in_place", "undo_question_in_place", "model_privacy_in_place"]) {
      expect(t(`lawoss.triage.${key}`, locale, { count: 3 })).not.toBe(`lawoss.triage.${key}`);
    }
    expect(t("lawoss.triage.undo_restored", locale, { count: 3 })).toContain("3");
  }
});

test("existujúci priečinok veci bez karty sa v náhľade nehlási ako vec zo spisovej značky (test 16. 10. 2026, N2)", () => {
  const text = (key: string, params?: Record<string, string | number>) => t(`lawoss.triage.${key}`, "sk", params);
  const adopted: TriagePreview = { ...preview, matters: [{ key: "existing-1", title: "Kupa haly Senec", folder: "Kupa haly Senec", date: "2026-10-16", dateSource: "today", kind: "non_contentious", source: "folder", documents: 3 }] };
  const out = html(<TriagePreviewView preview={adopted} text={text} busy={false} inPlace onKeep={() => {}} onConfirm={() => {}} onModel={() => {}} />);
  expect(out).toContain("Kupa haly Senec");
  expect(out).toContain(text("matter_from_folder"));
  expect(out).not.toContain(text("matter_from_rules"));
  for (const locale of ["sk", "cs", "en", "de"] as const) expect(t("lawoss.triage.matter_from_folder", locale)).not.toBe("lawoss.triage.matter_from_folder");
});

test("na mieste sa model neponúka, návrh je len deterministický (spec #92, rozhodnutie MČ 12. 10.)", () => {
  const text = (key: string, params?: Record<string, string | number>) => t(`lawoss.triage.${key}`, "sk", params);
  const ready: TriagePreview = { ...preview, proposal: { state: "ready", file: ".lawoss/triage/navrh.json", documents: 2, matters: 1 }, classification: { used: true, documents: 2 } };
  const panel = <section data-testid="model-panel">panel modelu</section>;
  const inPlace = html(<TriagePreviewView preview={ready} text={text} busy={false} inPlace onKeep={() => {}} onConfirm={() => {}} onModel={() => {}} model={panel} />);
  expect(inPlace).not.toContain("panel modelu");
  expect(inPlace).not.toContain(text("model_use"));
  expect(inPlace).not.toContain(text("model_rules_only"));
  const trial = html(<TriagePreviewView preview={ready} text={text} busy={false} onKeep={() => {}} onConfirm={() => {}} onModel={() => {}} model={panel} />);
  expect(trial).toContain("panel modelu");
  expect(trial).toContain(text("model_use"));
});

test("priečinok na mieste nehovorí o klone", () => {
  const text = (key: string, params?: Record<string, string | number>) => t(`lawoss.triage.${key}`, "sk", params);
  const out = html(<TriagePreviewView preview={preview} text={text} busy={false} inPlace onKeep={() => {}} onConfirm={() => {}} onModel={() => {}} />);
  expect(out).toContain("Dokumenty sa presunú priamo vo vašom priečinku. Presun sa dá vrátiť na stránke Roztriedenie.");
  expect(out).not.toMatch(/klon/i);
  const empty = html(<TriagePreviewView preview={{ ...preview, documents: 0, moves: [] }} text={text} busy={false} inPlace onKeep={() => {}} onConfirm={() => {}} onModel={() => {}} />);
  expect(empty).toContain("V priečinku nie je čo usporiadať.");
  expect(t("lawoss.triage.undo_question_in_place", "cs")).toBe("Vrátit dokumenty na původní místa? Dokumenty, které jste mezitím změnili, zůstanou na novém místě.");
  expect(t("lawoss.triage.model_privacy_in_place", "sk")).toBe("Model uvidí názvy a obsah dokumentov tohto klienta.");
});

describe("vstup do roztriedenia aj pri usporiadaní na mieste (D1 9. 10.)", () => {
  test("cieľ: odkaz, potom skúšobný klon, potom aktívny klient", () => {
    expect(triageTargetRoot({ param: "/a", trialRoot: "/b", activeRoot: "/c" })).toBe("/a");
    expect(triageTargetRoot({ trialRoot: "/b", activeRoot: "/c" })).toBe("/b");
    expect(triageTargetRoot({ trialRoot: null, activeRoot: "/c" })).toBe("/c");
    expect(triageTargetRoot({})).toBeNull();
  });
  test("vstup sa ukáže klientovi so súhlasom na mieste, nie klientovi bez neho", () => {
    expect(offersTriageEntry({ trial: true, mode: "in_place", root: "/c", runs: [] })).toBe(true);
    expect(offersTriageEntry({ trial: true, mode: "trial", root: "/b", runs: [] })).toBe(true);
    expect(offersTriageEntry({ trial: false, runs: [] })).toBe(false);
    expect(offersTriageEntry(null)).toBe(false);
  });
});

describe("štítok stránky roztriedenia podľa režimu (D1 9. 10.)", () => {
  const text = (key: string) => t(`lawoss.triage.${key}`, "sk");
  test("usporiadanie na mieste nehovorí o skúšobnom klone", () => {
    const markup = html(<TriageTopline text={text} root="/x/Samostatný klient" inPlace />);
    expect(markup).toContain("Priečinok klienta");
    expect(markup).not.toContain("klon");
    expect(markup).toContain("Samostatný klient");
  });
  test("skúšobná kópia ostáva označená ako kópia", () => {
    expect(html(<TriageTopline text={text} root="/x/Klient (trial 2026-10-05)" inPlace={false} />)).toContain("Kópia");
  });
});

test("spotrebovaný súhlas na mieste nežiada náhľad, skúšobný klon áno (rozhodnutie MČ 12. 10.)", () => {
  expect(plansPreview({ trial: true, mode: "in_place", root: "/x/K", canPlan: true, runs: [] })).toBe(true);
  expect(plansPreview({ trial: true, mode: "in_place", root: "/x/K", canPlan: false, runs: [] })).toBe(false);
  expect(plansPreview({ trial: true, mode: "trial", root: "/x/K (trial)", runs: [] })).toBe(true);
  expect(plansPreview({ trial: false, runs: [] })).toBe(false);
  for (const locale of ["sk", "cs", "en", "de"] as const) {
    expect(t("lawoss.triage.in_place_used", locale)).not.toBe("lawoss.triage.in_place_used");
    expect(t("lawoss.triage.in_place_again", locale)).not.toBe("lawoss.triage.in_place_again");
  }
  expect(t("lawoss.triage.in_place_used", "sk")).toContain("Usporiadať podľa OKF");
});

describe("vrátenie po novom súhlase (rozhodnutie MČ 13. 10. 2026)", () => {
  const run = (runId: string, state: "applied" | "undone" = "applied") => ({ runId, createdAt: "2026-10-13T10:00:00Z", state, moves: 3, matters: 1 });
  test("na mieste sa ponúkne len beh, na ktorý sa spotreboval súhlas", async () => {
    const { undoableRun } = await import("../src/lawoss/domains/roztriedenie/api");
    const runs = [run("triage-20261013-110000-bbbbbb"), run("triage-20261013-100000-aaaaaa")];
    expect(undoableRun({ trial: true, mode: "in_place", root: "/k", canPlan: false, undoRunId: "triage-20261013-110000-bbbbbb", runs })?.runId).toBe("triage-20261013-110000-bbbbbb");
    expect(undoableRun({ trial: true, mode: "in_place", root: "/k", canPlan: true, runs })).toBeUndefined();
    expect(undoableRun({ trial: true, mode: "trial", root: "/k", runs })?.runId).toBe("triage-20261013-110000-bbbbbb");
    expect(undoableRun({ trial: false, runs: [] })).toBeUndefined();
    expect(undoableRun(null)).toBeUndefined();
  });
});

test("náhľad je čitateľný: odkiaľ ako meno priečinka, riadky zoskupené podľa prípadu (test 19. 10. 2026)", () => {
  const text = (key: string, params?: Record<string, string | number>) => t(`lawoss.triage.${key}`, "sk", params);
  const m4 = "M004 Vyúčtovanie nájmu logistického skladu", m5 = "M005 Neakceptovaný modul informačného systému";
  const grouped: TriagePreview = {
    ...preview, keepInInbox: [], documents: 4,
    matters: [m4, m5].map((title, index) => ({ key: `existing-${index}`, title, folder: title, date: "2026-10-19", dateSource: "today" as const, kind: "non_contentious" as const, source: "folder" as const, documents: 2 })),
    moves: [
      { id: "d1", from: `${m5}/01-zmluva.docx`, to: `${m5}/01_Podklady/01-zmluva.docx`, size: 1, role: "client_documents", matter: "existing-1", source: "rules", confidence: "medium", rule: "contract", matched: "zmluva" },
      { id: "d2", from: `${m4}/01-zmluva.docx`, to: `${m4}/01_Podklady/01-zmluva.docx`, size: 1, role: "client_documents", matter: "existing-0", source: "rules", confidence: "medium", rule: "contract", matched: "zmluva" },
      { id: "d3", from: `${m4}/poznamky.txt`, to: `${m4}/00_Na_zatriedenie/poznamky.txt`, size: 1, role: "inbox", matter: "existing-0", source: "rules", confidence: "low", rule: "unknown" },
      { id: "d4", from: "odpoved.eml", to: "05_Komunikacia/odpoved.eml", size: 1, role: "correspondence", source: "rules", confidence: "high", rule: "email_file", matched: ".eml" },
    ],
  };
  const out = html(<TriagePreviewView preview={grouped} text={text} busy={false} inPlace onKeep={() => {}} onConfirm={() => {}} onModel={() => {}} />);
  // Skupina na prípad: hlavička skupiny, pod ňou jeho dokumenty; najprv klient, potom prípady podľa názvu.
  const groups = [...out.matchAll(/data-lawoss-triage-group="([^"]*)"[^>]*>(?:<[^>]+>)*([^<]+)/g)].map((match) => [match[1], match[2]]);
  expect(groups).toEqual([["", text("root_folder")], ["existing-0", m4], ["existing-1", m5]]);
  const body = out.slice(out.indexOf("<tbody"));
  expect(body.indexOf(`title="${m4}/poznamky.txt"`)).toBeGreaterThan(body.indexOf(`data-lawoss-triage-group="existing-0"`));
  expect(body.indexOf(`title="${m4}/poznamky.txt"`)).toBeLessThan(body.indexOf(`data-lawoss-triage-group="existing-1"`));
  // Odkiaľ: meno priečinka s plnou cestou v tooltipe, nie celá cesta písaná po znakoch.
  expect(out).toContain(`<td class="lw-triage-from" title="${m4}">${m4}</td>`);
  expect(out).not.toMatch(/<td class="lw-triage-path/);
  // Kam: pracovný priečinok prípadu menom, plná cesta v tooltipe.
  expect(out).toContain(`title="${m4}/01_Podklady">01_Podklady</small>`);
});

test("existujúci priečinok sa dá odškrtnúť; v skupine je „existujúci priečinok“, nie „nový prípad“ (rozhodnutie 19. 10. 2026)", () => {
  const text = (key: string, params?: Record<string, string | number>) => t(`lawoss.triage.${key}`, "sk", params);
  const m4 = "M004 Vyúčtovanie", m5 = "M005 Modul";
  const folders: TriagePreview = {
    ...preview, keepInInbox: [], leaveInPlace: ["existing-1"], documents: 2,
    matters: [
      { key: "existing-0", title: m4, folder: m4, date: "2026-10-19", dateSource: "today", kind: "non_contentious", source: "folder", documents: 1 },
      { key: "existing-1", title: m5, folder: m5, date: "2026-10-19", dateSource: "today", kind: "non_contentious", source: "folder", documents: 0, left: true },
    ],
    moves: [{ id: "d1", from: `${m4}/01-zmluva.docx`, to: `${m4}/01_Podklady/01-zmluva.docx`, size: 1, role: "client_documents", matter: "existing-0", source: "rules", confidence: "medium", rule: "contract", matched: "zmluva" }],
  };
  const calls: [string, boolean][] = [];
  const out = html(<TriagePreviewView preview={folders} text={text} busy={false} inPlace onKeep={() => {}} onLeave={(key, leave) => calls.push([key, leave])} onConfirm={() => {}} onModel={() => {}} />);
  expect(out).toContain(`data-lawoss-triage-group="existing-0"`);
  expect(out).toContain("existujúci priečinok");
  expect(out).not.toContain("nový prípad");
  expect(out).toMatch(/<input type="checkbox"[^>]*aria-label="Založiť ako prípad: M004 Vyúčtovanie" checked=""/);
  expect(out).toMatch(/<input type="checkbox"[^>]*aria-label="Založiť ako prípad: M005 Modul"(?![^>]*checked)/);
  expect(out).toContain("Priečinok ostane presne tak, ako je.");
  // Odškrtnutý priečinok sa nepočíta medzi nové prípady.
  expect(out).toMatch(/<dd>1<\/dd><dt>Nové prípady<\/dt>/);
  for (const locale of ["sk", "cs", "en", "de"] as const) for (const key of ["existing_folder_badge", "matter_keep_folder", "matter_left"]) {
    expect(t(`lawoss.triage.${key}`, locale)).not.toBe(`lawoss.triage.${key}`);
    expect(t(`lawoss.triage.${key}`, locale)).not.toContain("—");
  }
});

test("replan posiela odškrtnuté priečinky", async () => {
  const calls: [string, unknown][] = [];
  const client: TriageClient = { lawossTriage: async <T,>(path: string, body: unknown) => { calls.push([path, body]); return {} as T; } };
  await triageReplan(client, preview.id, [], ["existing-1"]);
  expect(calls).toEqual([["replan", { id: preview.id, keepInInbox: [], leaveInPlace: ["existing-1"] }]]);
});
