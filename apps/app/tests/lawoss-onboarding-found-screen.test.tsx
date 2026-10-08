import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BatchView, FoundView } from "../src/lawoss/domains/onboarding/found-screen";
import { foundText } from "../src/lawoss/domains/onboarding/found-text";
import type { OnboardingSuggestion } from "../src/lawoss/domains/onboarding/api";

const base = (patch: Partial<OnboardingSuggestion>): OnboardingSuggestion => ({ root: "/p/Novák", level: "client", marked: false, score: 0.8, signals: [], clients: [], complete: true, ...patch });
const props = { text: foundText("sk"), busy: false, selected: [] as string[], scope: "client" as const, onLevel: () => undefined, onScope: () => undefined, onToggle: () => undefined, onAll: () => undefined, onAnswer: () => undefined, onChangeFolder: () => undefined };

describe("Toto som našiel", () => {
  test("klient: návrh, oznámenie OKF a obe odpovede", () => {
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({})} level="client" />);
    expect(html).toContain("Vyzerá to ako klient Novák.");
    expect(html).toContain("AGENTS.md");
    expect(html).toContain("Nie, len pridaj OKF súbory");
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
  test("prax po klientoch bez označeného klienta: obe odpovede sú vypnuté", () => {
    const clients = [{ path: "Alfa s. r. o.", name: "Alfa s. r. o." }];
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({ level: "practice", clients, clientPattern: "*" })} level="practice" selected={[]} />);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Nie, len pridaj OKF súbory/);
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Áno, usporiadaj/);
  });
  test("oprava návrhu prepne voľby bez nového výberu priečinka", () => {
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({ level: "practice" })} level="client" />);
    expect(html).toContain("Vyzerá to ako celá prax");
    expect(html).not.toContain("Každý klient zvlášť");
    expect(html).toContain("Nie, len pridaj OKF súbory");
  });
  test("súhrn hromadného spracovania so zlyhaním", () => {
    const html = renderToStaticMarkup(<BatchView text={foundText("sk")} busy={false} items={[{ root: "/a", name: "Alfa", status: "done" }, { root: "/z", name: "Zamknutý", status: "failed", error: "locked_file" }]} onRetry={() => undefined} onContinue={() => undefined} />);
    expect(html).toContain("Hotovo: 1 z 2");
    expect(html).toContain("Nepodarilo sa: Zamknutý (locked_file)");
    expect(html).toContain("Skúsiť znova neúspešných");
    expect(html).toContain("Otvoriť v LAWOSS");
  });
  test("súhrn po odpovedi Áno pokračuje na ďalšieho klienta", () => {
    const html = renderToStaticMarkup(<BatchView text={foundText("sk")} busy={false} answer="yes" items={[{ root: "/a", name: "Alfa", status: "done" }]} onRetry={() => undefined} onContinue={() => undefined} />);
    expect(html).toContain("Ďalší klient");
    expect(html).not.toContain("Otvoriť v LAWOSS");
  });
});
