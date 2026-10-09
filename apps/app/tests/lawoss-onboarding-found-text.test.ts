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
