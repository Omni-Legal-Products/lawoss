import { expect, test } from "bun:test";
import { easterSunday, holidayCovered, holidayJurisdiction, publicHoliday } from "../holidays.ts";

const days = (year: number, j: "sk" | "cz"): string[] => {
  const out: string[] = [];
  for (let d = new Date(Date.UTC(year, 0, 1)); d.getUTCFullYear() === year; d.setUTCDate(d.getUTCDate() + 1)) {
    const iso = d.toISOString().slice(0, 10);
    if (publicHoliday(iso, j)) out.push(iso.slice(5));
  }
  return out;
};

test("Easter Sunday matches known dates", () => {
  expect(["2024", "2025", "2026", "2027", "2028"].map((y) => easterSunday(Number(y)))).toEqual(["2024-03-31", "2025-04-20", "2026-04-05", "2027-03-28", "2028-04-16"]);
});

test("SK 2026: § 4b drops 8 May and 15 September; 1 Sep, 28 Oct and 17 Nov are not days off", () => {
  expect(days(2026, "sk")).toEqual(["01-01", "01-06", "04-03", "04-06", "05-01", "07-05", "08-29", "11-01", "12-24", "12-25", "12-26"]);
});

test("SK 2027: 8 May and 15 September are days off again", () => {
  expect(days(2027, "sk")).toEqual(["01-01", "01-06", "03-26", "03-29", "05-01", "05-08", "07-05", "08-29", "09-15", "11-01", "12-24", "12-25", "12-26"]);
});

test("CZ 2026 per act 245/2000 Sb.", () => {
  expect(days(2026, "cz")).toEqual(["01-01", "04-03", "04-06", "05-01", "05-08", "07-05", "07-06", "09-28", "10-28", "11-17", "12-24", "12-25", "12-26"]);
});

test("SK and CZ differ and keep their own legal names", () => {
  expect(publicHoliday("2026-12-24", "sk")?.name).toBe("Štedrý deň");
  expect(publicHoliday("2026-12-24", "cz")?.name).toBe("Štědrý den");
  expect(publicHoliday("2026-11-17", "sk")).toBeUndefined();
  expect(publicHoliday("2026-11-17", "cz")?.jurisdiction).toBe("cz");
});

test("days before the SK rules took effect are not covered and never marked", () => {
  expect(holidayCovered("2025-10-31", "sk")).toBe(false);
  expect(publicHoliday("2025-09-01", "sk")).toBeUndefined();
  expect(holidayCovered("2025-11-01", "sk")).toBe(true);
  expect(publicHoliday("2025-11-01", "sk")?.name).toBe("Sviatok Všetkých svätých");
  expect(publicHoliday("nie je dátum", "sk")).toBeUndefined();
});

test("only canonical OKF jurisdictions map to holiday tables", () => {
  expect([holidayJurisdiction("sk"), holidayJurisdiction("CZ"), holidayJurisdiction("at"), holidayJurisdiction(undefined)]).toEqual(["sk", "cz", undefined, undefined]);
});
