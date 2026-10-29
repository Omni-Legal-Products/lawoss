/**
 * N-A7-3 (úplný UI test 28. 10. 2026, A9): klient C030 s podpriečinkom „C099 …“ sa pripájal bez upozornenia a C099
 * vybraný priamo sa ponúkal ako „jeden prípad“. Syntetické cesty, žiadne skutočné priečinky.
 */
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import type { OnboardingSuggestion } from "../src/lawoss/domains/onboarding/api";
import { FoundView, foundProposal, headline } from "../src/lawoss/domains/onboarding/found-screen";
import { nestedClientWarningText, nestedClientWarnings, nestedInClient } from "../src/lawoss/domains/onboarding/found-flow";
import { foundText } from "../src/lawoss/domains/onboarding/found-text";
import { WizardFoundView } from "../src/lawoss/domains/onboarding/wizard/found-step";
import { wizardText } from "../src/lawoss/domains/onboarding/wizard/wizard-text";

const OUTER = "/Users/advokat/Prax/C030 SYN Vonkajsi klient";
const base = (patch: Partial<OnboardingSuggestion>): OnboardingSuggestion => ({ root: OUTER, level: "client", marked: false, score: 0.5, signals: ["plain_directories"], clients: [], complete: true, ...patch });
const noop = () => undefined;
const props = { text: foundText("sk"), busy: false, selected: [] as string[], scope: "client" as const, onPickRoot: noop, onLevel: noop, onScope: noop, onToggle: noop, onAll: noop, onAnswer: noop, onChangeFolder: noop };
const wizard = { text: wizardText("sk"), found: foundText("sk"), busy: false, scope: "client" as const, selected: [] as string[], onLevel: noop, onScope: noop, onToggle: noop, onAll: noop, onAdd: noop, onTable: noop, onPickRoot: noop, childPath: (name: string) => name };

describe("klient s priečinkom ďalšieho klienta: upozornenie pred pripojením", () => {
  const outer = base({ units: [{ path: "", matters: [], matterCount: 0, files: 2, exact: true, nestedClients: [{ path: "C099 SYN Vnoreny klient", name: "C099 SYN Vnoreny klient" }] }] });
  const warning = "V priečinku klienta C030 SYN Vonkajsi klient je priečinok, ktorý vyzerá ako iný klient: C099 SYN Vnoreny klient. Prípadom nie je, ale agent klienta C030 SYN Vonkajsi klient uvidí aj jeho súbory.";
  test("bočný panel aj sprievodca upozornia pri voľbe Klient", () => {
    expect(renderToStaticMarkup(<FoundView {...props} suggestion={outer} level="client" />)).toContain(warning);
    expect(renderToStaticMarkup(<WizardFoundView {...wizard} suggestion={outer} headline="h" level="client" />)).toContain(warning);
  });
  test("pri praxi upozorní pri klientovi, ktorý taký priečinok má", () => {
    const practice = base({
      root: "/Users/advokat/Prax", level: "practice", signals: ["coded_hierarchy"], clients: [{ path: "C030 SYN Vonkajsi klient", name: "C030 SYN Vonkajsi klient" }, { path: "C031 Iny", name: "C031 Iny" }],
      units: [{ path: "C030 SYN Vonkajsi klient", matters: [], matterCount: 0, files: 2, exact: true, nestedClients: [{ path: "C099 SYN Vnoreny klient", name: "C099 SYN Vnoreny klient" }] }, { path: "C031 Iny", matters: [], matterCount: 0, files: 1, exact: true, nestedClients: [] }],
    });
    expect(nestedClientWarnings(practice, "practice")).toEqual([{ key: "C030 SYN Vonkajsi klient", client: "C030 SYN Vonkajsi klient", names: ["C099 SYN Vnoreny klient"] }]);
    expect(renderToStaticMarkup(<WizardFoundView {...wizard} suggestion={practice} headline="h" level="practice" />)).toContain(warning);
  });
  test("bez takého priečinka (aj zo staršieho servera bez poľa) nič", () => {
    const plain = base({ units: [{ path: "", matters: [], matterCount: 0, files: 2, exact: true }] });
    expect(nestedClientWarnings(plain, "client")).toEqual([]);
    expect(renderToStaticMarkup(<FoundView {...props} suggestion={plain} level="client" />)).not.toContain("vyzerá ako iný klient");
  });
  test("text vo všetkých jazykoch nesie meno klienta aj priečinka, pri viacerých menách v množnom čísle (review #294)", () => {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      for (const names of [["C099 Y"], ["C098 Z", "C099 Y"]]) {
        const sentence = nestedClientWarningText(foundText(locale), { key: "k", client: "C030 X", names });
        expect(sentence).toContain("C030 X");
        expect(sentence).toContain(names.join(", "));
        expect(sentence).not.toContain("{");
      }
    }
    expect(nestedClientWarningText(foundText("sk"), { key: "k", client: "C030 X", names: ["C098 Z", "C099 Y"] })).toBe("V priečinku klienta C030 X sú priečinky, ktoré vyzerajú ako iní klienti: C098 Z, C099 Y. Prípadmi nie sú, ale agent klienta C030 X uvidí aj ich súbory.");
    expect(nestedClientWarningText(foundText("cs"), { key: "k", client: "C030 X", names: ["C098 Z", "C099 Y"] })).toContain("jsou složky, které vypadají jako jiní klienti");
  });
  test("dvaja klienti praxe s rovnakým menom dostanú rôzne kľúče (cesta), obe upozornenia sa zobrazia", () => {
    const nested = [{ path: "C099 X", name: "C099 X" }];
    const practice = base({
      root: "/Users/advokat/Prax", level: "practice", signals: ["letter_buckets"], clients: [{ path: "A/C030 Novak", name: "C030 Novak" }, { path: "B/C030 Novak", name: "C030 Novak" }],
      units: [{ path: "A/C030 Novak", matters: [], matterCount: 0, files: 1, exact: true, nestedClients: nested }, { path: "B/C030 Novak", matters: [], matterCount: 0, files: 1, exact: true, nestedClients: nested }],
    });
    expect(nestedClientWarnings(practice, "practice").map(warning => warning.key)).toEqual(["A/C030 Novak", "B/C030 Novak"]);
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={practice} level="practice" />);
    expect(html.split("V priečinku klienta C030 Novak je priečinok")).toHaveLength(3);
  });
  test("návrh praxe ručne prepnutý na Klient upozorní na klientov v koreni (review #294)", () => {
    const practice = base({
      root: "/Users/advokat/Prax", level: "practice", signals: ["coded_hierarchy"], clients: [{ path: "C030 Alfa", name: "C030 Alfa", title: "Alfa s. r. o." }, { path: "C031 Beta", name: "C031 Beta" }],
      units: [{ path: "", matters: [], matterCount: 0, files: 0, exact: true, nestedClients: [{ path: "Novak Jan", name: "Novak Jan" }] }],
    });
    expect(nestedClientWarnings(practice, "client")).toEqual([{ key: "/Users/advokat/Prax", client: "Prax", names: ["Novak Jan", "Alfa s. r. o.", "C031 Beta"] }]);
    expect(renderToStaticMarkup(<WizardFoundView {...wizard} suggestion={practice} headline="h" level="client" />)).toContain("V priečinku klienta Prax sú priečinky, ktoré vyzerajú ako iní klienti: Novak Jan, Alfa s. r. o., C031 Beta.");
    // Pri voľbe Celá prax sa koreň neupozorňuje (klienti sú klientmi praxe).
    expect(nestedClientWarnings(practice, "practice")).toEqual([]);
  });
});

describe("priečinok s kódom iného klienta vybraný priamo nie je prípad", () => {
  const inner = base({ root: `${OUTER}/C099 SYN Vnoreny klient`, level: "matter", score: 0.5, signals: ["documents_only"], units: [{ path: "", matters: [], matterCount: 0, files: 1, exact: true }] });
  test("veta nehovorí o prípade; ponúkne vonkajšieho klienta (rozhodnutie MČ 23. 10. 2026)", () => {
    expect(nestedInClient(inner)).toBe(true);
    expect(foundProposal(inner)).toEqual({ key: "nestedClientFound", level: "matter" });
    expect(headline(foundText("sk"), inner, "matter")).toBe("Priečinok C099 SYN Vnoreny klient má kód iného klienta než priečinok, v ktorom leží. Klient nemôže byť vnútri iného klienta.");
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={inner} level="matter" />);
    expect(html).toContain("Ako prípad ho nepripojím. Pripojím klienta C030 SYN Vonkajsi klient, ktorému priečinok patrí; v jeho súboroch ostane ako obyčajný priečinok.");
    expect(html).toContain("Pripojiť klienta C030 SYN Vonkajsi klient");
    expect(html).not.toContain("jeden prípad");
    expect(html).not.toContain("Prípad patrí pod klienta");
  });
  test("v strome sprievodcu je priečinkom, nie prípadom", () => {
    const html = renderToStaticMarkup(<WizardFoundView {...wizard} suggestion={inner} headline={headline(foundText("sk"), inner, "matter")} level="matter" />);
    expect(html).toContain('<span class="sr-only">Priečinok: </span>C099 SYN Vnoreny klient');
    expect(html).not.toContain('<span class="sr-only">Prípad: </span>C099');
    expect(html).not.toContain("Prípad patrí pod klienta");
  });
  test("prípady ostávajú prípadmi: kód pod kódom klienta, slovo veci, Spisy/, iná predpona a karta", () => {
    for (const root of [`${OUTER}/C030-2024-01 Najom`, `${OUTER}/C031 Spor o nahradu`, `${OUTER}/Spisy/C099 Iny`, `${OUTER}/M004 Vyuctovanie`, "/Users/advokat/Prax/Novak/C099 Nieco"]) {
      const matter = base({ root, level: "matter", signals: ["documents_only"] });
      expect(nestedInClient(matter)).toBe(false);
      expect(foundProposal(matter).key).toBe("matterFound");
    }
    expect(nestedInClient(base({ root: `${OUTER}/C099 SYN Vnoreny klient`, level: "matter", marked: true, signals: ["matter_card"] }))).toBe(false);
  });
  test("text vo všetkých jazykoch", () => {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      const text = foundText(locale);
      expect(text("nestedClientFound", { name: "C099 Y" })).toContain("C099 Y");
      expect(text("nestedClientHint", { client: "C030 X" })).toContain("C030 X");
    }
  });
});
