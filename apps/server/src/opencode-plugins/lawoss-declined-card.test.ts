import { expect, test } from "bun:test";
import { askOrDeclined, declinedCard } from "./lawoss-declined-card.js";

// Test alfy 10. 11. 2026: po „Zamietnuť“ agent napísal „zápis zlyhal“.
const tagged = (tag: string, extra: Record<string, unknown> = {}) => Object.assign(new Error(tag), { _tag: tag, ...extra });

test("zamietnutie a zamietnutie s pripomienkou sú rozhodnutie advokáta, zákaz pravidlom a iné chyby nie", () => {
  expect(declinedCard(tagged("Permission.DeclinedError"))).toEqual({});
  expect(declinedCard(tagged("Permission.CorrectedError", { feedback: " Daj to do iného prípadu. " }))).toEqual({ feedback: "Daj to do iného prípadu." });
  expect(declinedCard(tagged("Permission.BlockedError"))).toBeNull();
  expect(declinedCard(new Error("Case memory refused (409): conflict"))).toBeNull();
  expect(declinedCard("Permission.DeclinedError")).toBeNull();
});

test("zamietnutá karta vráti výsledok bez zápisu, iná chyba sa vyhodí ďalej", async () => {
  const declined = await askOrDeclined(async () => { throw tagged("Permission.DeclinedError"); }, "memory/CN-002.md");
  expect(JSON.parse(declined ?? "{}")).toMatchObject({ done: false, declined: true, what: "memory/CN-002.md" });
  expect(JSON.parse(declined ?? "{}").note).toContain("because they declined");
  expect(await askOrDeclined(async () => "ok", "x")).toBeNull();
  const blocked = tagged("Permission.BlockedError");
  await expect(askOrDeclined(async () => { throw blocked; }, "x")).rejects.toBe(blocked);
});
