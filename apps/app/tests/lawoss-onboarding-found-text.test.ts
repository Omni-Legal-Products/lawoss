import { expect, test } from "bun:test";
import { FOUND_TEXT, foundText } from "../src/lawoss/domains/onboarding/found-text";

test("všetky jazyky majú rovnaké kľúče a neprázdne texty", () => {
  const keys = Object.keys(FOUND_TEXT.sk).sort();
  for (const locale of ["cs", "en", "de"] as const) expect(Object.keys(FOUND_TEXT[locale]).sort()).toEqual(keys);
  for (const locale of ["sk", "cs", "en", "de"] as const) for (const value of Object.values(FOUND_TEXT[locale])) expect(value.trim().length).toBeGreaterThan(0);
});
test("parametre sa doplnia a slovenčina nepreberá české pojmy", () => {
  expect(foundText("sk")("practiceFound", { count: 37 })).toContain("37");
  expect(foundText("sk")("matterFound", { name: "2024-03 Zmluva" })).toContain("2024-03 Zmluva");
  expect(FOUND_TEXT.sk.reorganizeQuestion).toContain("usporiadať");
  expect(FOUND_TEXT.cs.reorganizeQuestion).toContain("uspořádat");
});
test("bez dlhej pomlčky", () => {
  for (const locale of ["sk", "cs", "en", "de"] as const) for (const value of Object.values(FOUND_TEXT[locale])) expect(value).not.toMatch(/[–—]/);
});

test("voľby „Toto je“ začínajú veľkým písmenom vo všetkých jazykoch, vety ostávajú malým (test 19. 10. 2026)", () => {
  const expected = {
    sk: ["Klient", "Celá prax", "Jeden prípad"],
    cs: ["Klient", "Celá praxe", "Jeden případ"],
    en: ["A client", "A whole practice", "One case"],
    de: ["Ein Mandant", "Eine ganze Kanzlei", "Ein Fall"],
  } as const;
  for (const locale of ["sk", "cs", "en", "de"] as const) {
    const text = foundText(locale);
    expect([text("asClient"), text("asPractice"), text("asMatter")]).toEqual([...expected[locale]]);
  }
  expect(foundText("sk")("practiceFound", { count: 3 })).toBe("Vyzerá to ako celá prax: 3 klienti.");
  expect(foundText("sk")("connectExistingHint")).toBe("Klient, celá prax alebo jeden prípad. Rozpoznám to a spýtam sa.");
});

test("počet klientov praxe v správnom tvare (review #293): 2 až 4 inak než 5 a viac, v SK aj CS", () => {
  expect([2, 4, 5, 24].map((count) => foundText("sk")("practiceFound", { count }))).toEqual([
    "Vyzerá to ako celá prax: 2 klienti.", "Vyzerá to ako celá prax: 4 klienti.", "Vyzerá to ako celá prax: 5 klientov.", "Vyzerá to ako celá prax: 24 klientov.",
  ]);
  expect([3, 7].map((count) => foundText("cs")("practiceFound", { count }))).toEqual(["Vypadá to jako celá praxe: 3 klienti.", "Vypadá to jako celá praxe: 7 klientů."]);
  expect(foundText("en")("practiceFound", { count: 3 })).toBe("This looks like a whole practice: 3 clients.");
  expect(foundText("de")("practiceFound", { count: 3 })).toBe("Das sieht aus wie eine ganze Kanzlei: 3 Mandanten.");
  // Kľúč bez tvarov ostáva pri základnom texte aj s počtom.
  expect(foundText("sk")("working", { done: 1, total: 3, count: 3 })).toBe("Pridávam pomocné súbory: 1 z 3");
});
