import { afterEach, expect, test } from "bun:test";
import { resetLocaleForTests, setLocale } from "../src/i18n";
import { formatUiDate, formatUiDateTime } from "../src/lawoss/i18n/format-date";

// #548: dátumy sa formátovali podľa jazyka systému, nie rozhrania.
const moment = Date.UTC(2026, 10, 18, 0, 54, 5);
afterEach(() => resetLocaleForTests());

test("slovenské rozhranie formátuje dátum a čas po slovensky aj pri inom jazyku systému", () => {
  setLocale("sk");
  expect(formatUiDate(moment)).toBe(new Date(moment).toLocaleDateString("sk"));
  expect(formatUiDateTime(moment)).toBe(new Date(moment).toLocaleString("sk"));
  expect(formatUiDate(moment)).toMatch(/18\. ?11\. ?2026/);
});

test("anglické rozhranie ostáva anglické", () => {
  setLocale("en");
  expect(formatUiDateTime(moment)).toBe(new Date(moment).toLocaleString("en"));
});
