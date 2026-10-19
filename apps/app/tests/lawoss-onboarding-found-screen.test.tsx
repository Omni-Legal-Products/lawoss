import { describe, expect, spyOn, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BatchView, FoundView, ReorganizeView } from "../src/lawoss/domains/onboarding/found-screen";
import { t } from "../src/i18n";
import type { TriagePreview } from "../src/lawoss/domains/roztriedenie/api";
import { foundText } from "../src/lawoss/domains/onboarding/found-text";
import type { OnboardingApi, OnboardingSuggestion } from "../src/lawoss/domains/onboarding/api";
import { addOkfFiles } from "../src/lawoss/domains/onboarding/found-flow";
import { onboardingErrorMessage } from "../src/lawoss/domains/onboarding/lawoss-welcome-page";
import { LegalworkServerError } from "../src/app/lib/legalwork-server";

const base = (patch: Partial<OnboardingSuggestion>): OnboardingSuggestion => ({ root: "/p/Novák", level: "client", marked: false, score: 0.8, signals: [], clients: [], complete: true, ...patch });
const props = { text: foundText("sk"), busy: false, selected: [] as string[], scope: "client" as const, onLevel: () => undefined, onScope: () => undefined, onToggle: () => undefined, onAll: () => undefined, onAnswer: () => undefined, onChangeFolder: () => undefined };

describe("Toto som našiel", () => {
  test("klient: návrh, oznámenie o pomocných súboroch a obe odpovede", () => {
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({})} level="client" />);
    expect(html).toContain("Vyzerá to ako klient Novák.");
    expect(html).toContain("AGENTS.md");
    expect(html).toContain("Nie, nechaj ho tak, ako je");
    expect(html).toContain("Áno, usporiadaj");
  });
  test("prax: počet, rozsah a zaškrtnutí klienti", () => {
    const clients = [{ path: "Alfa s. r. o.", name: "Alfa s. r. o." }, { path: "Beta a. s.", name: "Beta a. s." }];
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({ level: "practice", clients, clientPattern: "*" })} level="practice" selected={["Alfa s. r. o."]} />);
    expect(html).toContain("celá prax: 2 klientov");
    expect(html).toContain("Každý klient zvlášť");
    expect(html).toMatch(/type="checkbox"[^>]*checked=""[^>]*\/?>[^<]*<span>Alfa s\. r\. o\./);
    expect(html).toMatch(/type="checkbox"[^>]*\/?>[^<]*<span>Beta a\. s\./);
    expect(html).not.toMatch(/type="checkbox"[^>]*checked=""[^>]*\/?>[^<]*<span>Beta a\. s\./);
  });
  test("celá prax ako jeden priečinok: Áno je vypnuté s vysvetlením", () => {
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({ level: "practice" })} level="practice" scope="practice" />);
    expect(html).toContain("Celú prax ako jeden priečinok usporiadať nejde");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Áno, usporiadaj/);
  });
  test("vec: ponúkne nadradeného klienta", () => {
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({ root: "/p/Novák/2024-03 Zmluva", level: "matter" })} level="matter" />);
    expect(html).toContain("Pripojiť klienta Novák");
    expect(html).toContain("AGENTS.md");
    expect(html).toContain("Beriem na vedomie a pokračujem");
  });
  test("vec v Spisy/ ponúkne klienta nad Spisy", () => {
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({ root: "/p/Novák/Spisy/2024-03 Zmluva", level: "matter" })} level="matter" />);
    expect(html).toContain("Pripojiť klienta Novák");
    expect(html).not.toContain("Pripojiť klienta Spisy");
  });
  test("prax po klientoch bez označeného klienta: obe odpovede sú vypnuté", () => {
    const clients = [{ path: "Alfa s. r. o.", name: "Alfa s. r. o." }];
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({ level: "practice", clients, clientPattern: "*" })} level="practice" selected={[]} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Nie, nechaj ho tak, ako je/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Áno, usporiadaj/);
  });
  test("oprava návrhu prepne voľby bez nového výberu priečinka", () => {
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({ level: "practice" })} level="client" />);
    expect(html).toContain("Vyzerá to ako celá prax");
    expect(html).not.toContain("Každý klient zvlášť");
    expect(html).toContain("Nie, nechaj ho tak, ako je");
  });
  test("súhrn hromadného spracovania so zlyhaním", () => {
    const html = renderToStaticMarkup(<BatchView text={foundText("sk")} busy={false} items={[{ root: "/a", name: "Alfa", status: "done" }, { root: "/z", name: "Zamknutý", status: "failed", error: "Súbor je otvorený v inej aplikácii." }]} onRetry={() => undefined} onContinue={() => undefined} />);
    expect(html).toContain("Hotovo: 1 z 2");
    expect(html).toContain("Nepodarilo sa: Zamknutý. Súbor je otvorený v inej aplikácii.");
    expect(html).toContain("Skúsiť znova neúspešných");
    expect(html).toContain("Otvoriť v LAWOSS");
  });
  test("keď zlyhali všetci, ponúkne iný priečinok namiesto otvorenia", () => {
    const html = renderToStaticMarkup(<BatchView text={foundText("sk")} busy={false} items={[{ root: "/z", name: "Zamknutý", status: "failed", error: "locked_file" }]} onRetry={() => undefined} onContinue={() => undefined} onChangeFolder={() => undefined} />);
    expect(html).toContain("Hotovo: 0 z 1");
    expect(html).toContain("Vybrať iný priečinok");
    expect(html).not.toContain("Otvoriť v LAWOSS");
  });
  test("súhrn po odpovedi Áno pokračuje na ďalšieho klienta", () => {
    const html = renderToStaticMarkup(<BatchView text={foundText("sk")} busy={false} answer="yes" items={[{ root: "/a", name: "Alfa", status: "done" }]} onRetry={() => undefined} onContinue={() => undefined} />);
    expect(html).toContain("Ďalší klient");
    expect(html).not.toContain("Otvoriť v LAWOSS");
  });
});

test("usporiadanie v onboardingu má štýly roztriedenia a hovorí o priečinku, nie o klone", () => {
  const preview: TriagePreview = {
    id: "00000000-0000-4000-8000-000000000000", fingerprint: "a".repeat(64), runId: "triage-20261008-100000-abcdef", root: "/p/Novák", language: "sk",
    documents: 1, keepInInbox: [], classification: { used: false, documents: 0 }, matters: [],
    moves: [{ id: "d0000000000000001", from: "odpoved.eml", to: "05_Komunikacia/odpoved.eml", size: 1, role: "correspondence", source: "rules", confidence: "high", rule: "email_file", matched: ".eml" }],
    stays: [], newFolders: 1,
  };
  const html = renderToStaticMarkup(<ReorganizeView text={foundText("sk")} triageText={(key, params) => t(`lawoss.triage.${key}`, "sk", params)} busy={false} name="Novák" preview={preview} more={false} onKeep={() => undefined} onConfirm={() => undefined} onSkip={() => undefined} />);
  expect(html).toMatch(/<div class="lw-triage[ "]/);
  expect(html).toContain("Usporiadanie: Novák");
  expect(html).toContain("Dokumenty sa presunú priamo vo vašom priečinku.");
  expect(html).toContain("Dokončiť");
});

describe("slabý návrh praxe (review VŘ k #135, bod 5)", () => {
  const clients = [{ path: "Kúpna zmluva", name: "Kúpna zmluva" }, { path: "Nájom", name: "Nájom" }];
  test("jediný signál vecí: appka sa pýta a predvolí klienta", async () => {
    const { initialFoundLevel } = await import("../src/lawoss/domains/onboarding/found-screen");
    const weak = base({ level: "practice", score: 0.5, signals: ["matter_named_children"], clients, clientPattern: "*" });
    expect(initialFoundLevel(weak)).toBe("client");
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={weak} level={initialFoundLevel(weak)} />);
    expect(html).toContain("Môže to byť jeden klient Novák s vecami, alebo celá prax s 2 klientmi");
    expect(html).not.toContain("Vyzerá to ako celá prax");
    expect(html).toContain("Nie, nechaj ho tak, ako je");
  });
  test("istá prax a označená prax ostávajú praxou", async () => {
    const { initialFoundLevel } = await import("../src/lawoss/domains/onboarding/found-screen");
    expect(initialFoundLevel(base({ level: "practice", score: 0.83, signals: ["legal_form_children", "matter_named_children"], clients }))).toBe("practice");
    expect(initialFoundLevel(base({ level: "practice", score: 0.5, signals: ["letter_buckets"], clients }))).toBe("practice");
    expect(initialFoundLevel(base({ level: "practice", score: 1, marked: true, clients }))).toBe("practice");
    expect(initialFoundLevel(base({ level: "matter" }))).toBe("matter");
    expect(initialFoundLevel(base({ level: "unknown" }))).toBe("client");
  });
});

describe("zrozumiteľná chyba v hromadnom kroku (MČ 19. 10.: domovský priečinok)", () => {
  // Presne to, čo videl advokát: server zabalí chybu OKF do `onboarding_failed` so surovou správou.
  const ownerError = new LegalworkServerError(400, "onboarding_failed", "The directory could not be inspected completely and unambiguously: .: office_search_incomplete");
  const failingApi: Pick<OnboardingApi, "planOnboarding" | "applyOnboarding" | "updateOnboardingProfile"> = {
    planOnboarding: async () => { throw ownerError; },
    applyOnboarding: async () => { throw new Error("nevolá sa"); },
    updateOnboardingProfile: async () => { throw new Error("nevolá sa"); },
  };
  const identity = { lawyerName: "L", jurisdiction: "sk" as const, language: "sk" as const };
  test("príliš veľký priečinok: veta pre advokáta s menom priečinka, surový text len v konzole", async () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    const items = await addOkfFiles(failingApi, [{ root: "/Users/magneto", name: "magneto" }], identity, new Date(), () => undefined, (reason) => onboardingErrorMessage(reason, "sk"));
    const html = renderToStaticMarkup(<BatchView text={foundText("sk")} busy={false} items={items} onRetry={() => undefined} onContinue={() => undefined} onChangeFolder={() => undefined} />);
    expect(html).toContain("Nepodarilo sa: magneto. Priečinok je príliš veľký alebo má priveľa podpriečinkov. Vyberte priečinok konkrétneho klienta alebo kancelárie, nie celý domovský priečinok.");
    expect(html).not.toContain("office_search_incomplete");
    expect(html).not.toContain("inspected");
    expect(String(warn.mock.calls[0]?.[1])).toContain("office_search_incomplete");
    warn.mockRestore();
  });
  test("vrchný pruh chyby hovorí to isté, nie všeobecnú vetu", () => {
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);
    expect(onboardingErrorMessage(ownerError, "sk")).toBe("Priečinok je príliš veľký alebo má priveľa podpriečinkov. Vyberte priečinok konkrétneho klienta alebo kancelárie, nie celý domovský priečinok.");
    warn.mockRestore();
  });
  test("text neúspechu vo všetkých jazykoch nesie meno aj vetu", () => {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      const line = foundText(locale)("batchFailed", { name: "magneto", error: "VETA" });
      expect(line).toContain("magneto");
      expect(line).toEndWith("VETA");
      expect(line).not.toContain("(");
    }
  });
});

describe("veta návrhu a predvolená úroveň sa zhodujú (MČ 19. 10.)", () => {
  const clients = [{ path: "A", name: "A" }, { path: "B", name: "B" }];
  const shapes: [string, OnboardingSuggestion, string, string][] = [
    ["obyčajné podpriečinky", base({ root: "/p/LAWOSS-synteticke-data", level: "client", score: 0.5, signals: ["plain_directories"] }), "Vyzerá to ako klient LAWOSS-synteticke-data.", "client"],
    ["karta klienta", base({ level: "client", marked: true, score: 1, signals: ["client_card"] }), "Vyzerá to ako klient Novák.", "client"],
    ["istá prax", base({ level: "practice", score: 0.83, signals: ["legal_form_children"], clients }), "Vyzerá to ako celá prax: 2 klientov.", "practice"],
    ["označená prax", base({ level: "practice", marked: true, score: 1, signals: ["office_config"], clients }), "Vyzerá to ako celá prax: 2 klientov.", "practice"],
    ["slabá prax", base({ level: "practice", score: 0.5, signals: ["matter_named_children"], clients }), "Predvolený je klient.", "client"],
    ["vec", base({ root: "/p/Novák/2024-03 Zmluva", level: "matter", score: 0.8, signals: ["matter_named_root"] }), "Vyzerá to ako jedna vec: 2024-03 Zmluva.", "matter"],
    ["neznámy", base({ level: "unknown", score: 0, signals: ["empty"] }), "Neviem s istotou, čo tento priečinok je.", "client"],
  ];
  for (const [name, suggestion, sentence, selected] of shapes) {
    test(name, async () => {
      const { foundProposal, initialFoundLevel } = await import("../src/lawoss/domains/onboarding/found-screen");
      const proposal = foundProposal(suggestion);
      expect(proposal.level).toBe(initialFoundLevel(suggestion));
      const html = renderToStaticMarkup(<FoundView {...props} suggestion={suggestion} level={initialFoundLevel(suggestion)} />);
      expect(html).toContain(sentence);
      expect(html).toContain(`<option value="${selected}" selected="">`);
    });
  }
});

describe("navigácia bez rolovania (MČ 19. 10.)", () => {
  test("Vybrať iný priečinok je v hlavičke pri nadpise, pred voľbou úrovne a odpoveďami, a len raz", () => {
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({ level: "practice", clients: [{ path: "A", name: "A" }], clientPattern: "*" })} level="practice" selected={["A"]} />);
    const change = html.indexOf("Vybrať iný priečinok");
    expect(change).toBeGreaterThan(html.indexOf("Toto som našiel"));
    expect(change).toBeLessThan(html.indexOf("<select"));
    expect(html.split("Vybrať iný priečinok")).toHaveLength(2);
  });
  test("počas zápisu je Vybrať iný priečinok vypnuté", () => {
    const html = renderToStaticMarkup(<FoundView {...props} busy suggestion={base({})} level="client" />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Vybrať iný priečinok/);
  });
});

describe("zlyhané usporiadanie po pripojení (MČ 19. 10.)", () => {
  test("veta, uistenie, že priečinok je pripojený, Skúsiť znova a pokračovanie", async () => {
    const { ReorganizeFailedView } = await import("../src/lawoss/domains/onboarding/found-screen");
    const html = renderToStaticMarkup(<ReorganizeFailedView text={foundText("sk")} busy={false} name="Novák" message="Roztriedenie sa nepodarilo. Skúste to znova." more={false} onRetry={() => undefined} onSkip={() => undefined} />);
    expect(html).toContain("Usporiadanie: Novák");
    expect(html).toContain("Roztriedenie sa nepodarilo. Skúste to znova.");
    expect(html).toContain("Priečinok je pripojený a pomocné súbory sú pridané. Usporiadanie môžete skúsiť znova teraz alebo neskôr.");
    expect(html).toMatch(/class="lw-btn gold"[^>]*>Skúsiť znova</);
    expect(html).toContain("Dokončiť");
    const more = renderToStaticMarkup(<ReorganizeFailedView text={foundText("sk")} busy={false} name="Novák" message="x" more onRetry={() => undefined} onSkip={() => undefined} />);
    expect(more).toContain("Tohto klienta preskočiť");
  });
});
