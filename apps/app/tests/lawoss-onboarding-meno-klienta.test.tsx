import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { OnboardingApi, OnboardingApplyResult, OnboardingSuggestion } from "../src/lawoss/domains/onboarding/api";
import { addOkfFiles, childPath, clientName, matterClientName, registeredName, rootClientName, type BatchItem } from "../src/lawoss/domains/onboarding/found-flow";
import { headline } from "../src/lawoss/domains/onboarding/found-screen";
import { foundText } from "../src/lawoss/domains/onboarding/found-text";
import { FoundTree } from "../src/lawoss/domains/onboarding/wizard/found-step";
import { wizardText } from "../src/lawoss/domains/onboarding/wizard/wizard-text";

// N-A4-2 (test 23. 10. 2026): v usporiadanej kancelárii (Klienti/C001-…) sa klient v onboardingu volal podľa
// priečinka. Strom kroku 3, tlačidlo kroku 6 a prvá správa majú použiť názov z karty klienta ako bočný panel.

const TATRAN = "SYN Tatran Automatika, s. r. o.";
const HRON = "SYN Hron, a. s.";
const office: OnboardingSuggestion = {
  root: "/p/4-usporiadana-kancelaria", level: "practice", marked: false, score: 0.9, signals: ["office_without_config"], clientPattern: "Klienti/*", complete: true,
  clients: [
    { path: "Klienti/C001-syn-tatran-automatika-s-r-o", name: "C001-syn-tatran-automatika-s-r-o", title: TATRAN },
    { path: "Klienti/C002-syn-hron", name: "C002-syn-hron", title: HRON },
    { path: "Klienti/C003-bez-karty", name: "C003-bez-karty" },
  ],
};

describe("N-A4-2: meno klienta v onboardingu z karty klienta", () => {
  test("strom kroku 3: názov z karty, priečinok bez karty ostáva menom priečinka", () => {
    const html = renderToStaticMarkup(<FoundTree text={wizardText("sk")} suggestion={office} level="practice" scope="client" selected={["Klienti/C001-syn-tatran-automatika-s-r-o"]} busy={false} onToggle={() => undefined} />);
    expect(html).toContain(TATRAN);
    expect(html).toContain(HRON);
    expect(html).toContain("C003-bez-karty");
    expect(html).not.toContain("C001-syn-tatran-automatika-s-r-o");
    expect(html).toContain(`aria-label="Označený na pripojenie: ${TATRAN}" checked=""`);
  });
  test("stav po pridaní sa páruje podľa priečinka, nie podľa mena (dvaja klienti s rovnakým názvom)", () => {
    const twins: OnboardingSuggestion = { ...office, clients: [{ path: "Klienti/A", name: "A", title: "Novák" }, { path: "Klienti/B", name: "B", title: "Novák" }] };
    const added: BatchItem[] = [{ root: childPath(twins.root, "Klienti/B"), name: "Novák", status: "done" }];
    const html = renderToStaticMarkup(<FoundTree text={wizardText("sk")} suggestion={twins} level="practice" scope="client" selected={[]} busy={false} added={added} />);
    expect(html.match(/data-tone="ok"/g)).toHaveLength(1);
    expect(html.indexOf("data-tone=\"ok\"")).toBeGreaterThan(html.lastIndexOf(">Novák<"));
  });
  test("klient otvorený priamo: strom aj veta návrhu menujú klienta názvom z karty", () => {
    const client: OnboardingSuggestion = { root: "/p/Klienti/C001-syn-tatran-automatika-s-r-o", level: "client", marked: true, score: 1, signals: ["client_card"], clients: [], complete: true, rootTitle: TATRAN };
    const html = renderToStaticMarkup(<FoundTree text={wizardText("sk")} suggestion={client} level="client" scope="client" selected={[]} busy={false} />);
    expect(html).toContain(TATRAN);
    expect(headline(foundText("sk"), client, "client")).toBe(`Vyzerá to ako klient ${TATRAN}.`);
    // Prípad ostáva menom priečinka prípadu (karta klienta sa naň nevzťahuje).
    expect(headline(foundText("sk"), { ...client, root: "/p/C001/M001-uhrada", level: "matter" }, "matter")).toBe("Vyzerá to ako jeden prípad: M001-uhrada.");
  });
  test("starší server bez názvov: meno priečinka", () => {
    expect(clientName({ name: "C003" })).toBe("C003");
    expect(clientName({ name: "C003", title: "  " })).toBe("C003");
    expect(rootClientName({ root: "/p/Klienti/C003" })).toBe("C003");
  });
  test("krok 6 a prvá správa: meno, pod ktorým server klienta zaregistroval (pravidlo bočného panela)", async () => {
    // Server pri novej registrácii vráti `name` (názov z karty), `displayName` len pri mene zadanom používateľom.
    const registered: Record<string, { name: string; displayName?: string }> = {
      "C001-syn-tatran-automatika-s-r-o": { name: TATRAN },
      "C002-syn-hron": { name: "C002-syn-hron", displayName: "Môj Hron" },
      "C003-bez-karty": { name: "C003-bez-karty" },
    };
    const api: Pick<OnboardingApi, "planOnboarding" | "applyOnboarding" | "updateOnboardingProfile"> = {
      planOnboarding: async (request) => ({ id: "root" in request ? request.root : "x", fingerprint: "f".repeat(64), preview: {} }),
      applyOnboarding: async (input): Promise<OnboardingApplyResult> => ({ result: "applied", root: input.id, workspace: { id: "ws", path: input.id, ...registered[input.id.split("/").pop() ?? ""] } }),
      updateOnboardingProfile: async () => ({ version: 1, lawyerName: "L", jurisdiction: "sk", language: "sk" }),
    };
    const items = office.clients.map((client) => ({ root: childPath(office.root, client.path), name: clientName(client) }));
    const batch = await addOkfFiles(api, items, { lawyerName: "L", jurisdiction: "sk", language: "sk" }, new Date("2026-10-24T10:00:00Z"), () => undefined, String);
    expect(batch.map((item) => item.name)).toEqual([TATRAN, "Môj Hron", "C003-bez-karty"]);
    // Klient zaregistrovaný skôr pod menom priečinka (pred N-22): ostáva názov z karty, nie slug.
    expect(registeredName({ root: "/p/Klienti/C001-x", name: TATRAN }, { name: "c001-X" })).toBe(TATRAN);
    expect(registeredName({ root: "/p/Klienti/C001-x", name: TATRAN }, { name: "Vlastné meno" })).toBe("Vlastné meno");
    expect(registeredName({ root: "/p/Klienti/C001-x", name: TATRAN }, undefined)).toBe(TATRAN);
  });
  test("prípad otvorený priamo: klient, ku ktorému sa pripojí, sa volá názvom z jeho karty", () => {
    const matter: OnboardingSuggestion = { root: "/p/Klienti/C001-syn-tatran-automatika-s-r-o/Spisy/M001-uhrada", level: "matter", marked: true, score: 1, signals: ["matter_card"], clients: [], complete: true, matterClientTitle: TATRAN };
    const html = renderToStaticMarkup(<FoundTree text={wizardText("sk")} suggestion={matter} level="matter" scope="client" selected={[]} busy={false} />);
    expect(html).toContain(TATRAN);
    expect(html).not.toContain("C001-syn-tatran-automatika-s-r-o");
    expect(matterClientName({ root: matter.root })).toBe("C001-syn-tatran-automatika-s-r-o");
  });
});
