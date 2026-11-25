/**
 * Dni pracovného pokoja (sviatky) SR a ČR na zobrazenie v kalendári. Slúži len na vyznačenie dňa; žiadna lehota
 * sa z tejto tabuľky nepočíta ani neposúva. SR a ČR sú modelované zvlášť, názvy ostávajú v jazyku zákona.
 *
 * SR: zákon č. 241/1993 Z. z. (§ 1, § 2, § 4b), znenie účinné od 29. 10. 2026, overené cez Slov-Lex 25. 11. 2026.
 *   Štátne sviatky 1. 9., 28. 10. a 17. 11. nie sú dňom pracovného pokoja (§ 2 ods. 3). V roku 2026 nie sú dňom
 *   pracovného pokoja 8. 5. ani 15. 9. (§ 4b). Pravidlá platia od úprav účinných 1. 11. 2025; pre skoršie dni tabuľka
 *   nič nevyznačí (`covered` = false), aby staré pravidlá nevyzerali ako dnešné.
 * ČR: zákon č. 245/2000 Sb. (§ 1, § 2, § 3), aktuálne znenie k 13. 5. 2026, overené 25. 11. 2026. Velký pátek je
 *   sviatkom od roku 2016; tabuľka pokrýva roky od 2016.
 */
export type HolidayJurisdiction = "sk" | "cz";
export type Holiday = { jurisdiction: HolidayJurisdiction; name: string };

const SK_FROM = "2025-11-01";
const CZ_FROM = "2016-01-01";

const SK_FIXED: Readonly<Record<string, string>> = {
  "01-01": "Deň vzniku Slovenskej republiky",
  "01-06": "Zjavenie Pána (Traja králi a vianočný sviatok pravoslávnych kresťanov)",
  "05-01": "Sviatok práce",
  "05-08": "Deň víťazstva nad fašizmom",
  "07-05": "Sviatok svätého Cyrila a svätého Metoda",
  "08-29": "Výročie Slovenského národného povstania",
  "09-15": "Sedembolestná Panna Mária",
  "11-01": "Sviatok Všetkých svätých",
  "12-24": "Štedrý deň",
  "12-25": "Prvý sviatok vianočný",
  "12-26": "Druhý sviatok vianočný",
};
/** § 4b: v roku 2026 nie sú 15. 9. a 8. 5. dňami pracovného pokoja. */
const SK_EXCEPT: Readonly<Record<string, readonly string[]>> = { "2026": ["05-08", "09-15"] };

const CZ_FIXED: Readonly<Record<string, string>> = {
  "01-01": "Den obnovy samostatného českého státu; Nový rok",
  "05-01": "Svátek práce",
  "05-08": "Den vítězství",
  "07-05": "Den slovanských věrozvěstů Cyrila a Metoděje",
  "07-06": "Den upálení mistra Jana Husa",
  "09-28": "Den české státnosti",
  "10-28": "Den vzniku samostatného československého státu",
  "11-17": "Den boje za svobodu a demokracii a Mezinárodní den studentstva",
  "12-24": "Štědrý den",
  "12-25": "1. svátek vánoční",
  "12-26": "2. svátek vánoční",
};

const MOVABLE: Readonly<Record<HolidayJurisdiction, { goodFriday: string; easterMonday: string }>> = {
  sk: { goodFriday: "Veľký piatok", easterMonday: "Veľkonočný pondelok" },
  cz: { goodFriday: "Velký pátek", easterMonday: "Velikonoční pondělí" },
};

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/;
const shift = (iso: string, days: number): string => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
};

/** Veľkonočná nedeľa gregoriánskeho kalendára (anonymný gregoriánsky algoritmus). */
export function easterSunday(year: number): string {
  const a = year % 19, b = Math.floor(year / 100), c = year % 100, d = Math.floor(b / 4), e = b % 4;
  const f = Math.floor((b + 8) / 25), g = Math.floor((b - f + 1) / 3), h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4), k = c % 4, l = (32 + 2 * e + 2 * i - h - k) % 7, m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31), day = ((h + l - 7 * m + 114) % 31) + 1;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** Tabuľka pokrýva tento deň v tejto jurisdikcii (inak o sviatku nič nevieme). */
export const holidayCovered = (iso: string, jurisdiction: HolidayJurisdiction): boolean =>
  ISO.test(iso) && iso >= (jurisdiction === "sk" ? SK_FROM : CZ_FROM);

/** Deň pracovného pokoja (okrem nedele) v jurisdikcii, ak ním deň je; inak `undefined`. */
export function publicHoliday(iso: string, jurisdiction: HolidayJurisdiction): Holiday | undefined {
  const match = ISO.exec(iso);
  if (!match || !holidayCovered(iso, jurisdiction)) return undefined;
  const [, year, month, day] = match;
  const easter = easterSunday(Number(year));
  if (iso === shift(easter, -2)) return { jurisdiction, name: MOVABLE[jurisdiction].goodFriday };
  if (iso === shift(easter, 1)) return { jurisdiction, name: MOVABLE[jurisdiction].easterMonday };
  const key = `${month}-${day}`;
  if (jurisdiction === "sk") {
    if (SK_EXCEPT[year ?? ""]?.includes(key)) return undefined;
    const name = SK_FIXED[key];
    return name ? { jurisdiction, name } : undefined;
  }
  const name = CZ_FIXED[key];
  return name ? { jurisdiction, name } : undefined;
}

/** Jurisdikcia záznamu OKF („sk“, „cz“) ako jurisdikcia sviatkov; iná hodnota žiadne sviatky nemá. */
export const holidayJurisdiction = (value: string | undefined): HolidayJurisdiction | undefined => {
  const v = value?.trim().toLowerCase();
  return v === "sk" ? "sk" : v === "cz" ? "cz" : undefined;
};
