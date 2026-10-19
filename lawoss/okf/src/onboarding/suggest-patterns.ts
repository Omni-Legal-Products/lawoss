/**
 * Vzory pre návrh úrovne priečinka. SK a CZ sú oddelené: rovnaká skratka (s.r.o., a.s.)
 * je v oboch, ale z.s., o.p.s. či z.ú. sú len české a š.p. či j.s.a. len slovenské.
 */
import { findCaseNumber } from "../triage/rules.ts";

const form = (body: string) => new RegExp(`(?:^|[\\s,(])${body}(?=$|[\\s,)])`, "iu");
/** Obchodný zákonník a zákon o štátnom podniku: s. r. o., a. s., k. s., v. o. s., š. p., j. s. a. */
export const SK_LEGAL_FORMS: readonly RegExp[] = [
  form("s\\.\\s?r\\.\\s?o\\.?"), form("a\\.\\s?s\\.?"), form("k\\.\\s?s\\.?"),
  form("v\\.\\s?o\\.\\s?s\\.?"), form("š\\.\\s?p\\.?"), form("j\\.\\s?s\\.\\s?a\\.?"),
];
/** Zákon o obchodních korporacích a NOZ: spol. s r.o., s.r.o., a.s., k.s., v.o.s., z.s., o.p.s., z.ú. */
export const CZ_LEGAL_FORMS: readonly RegExp[] = [
  form("spol\\.\\s?s\\s?r\\.\\s?o\\.?"), form("s\\.\\s?r\\.\\s?o\\.?"), form("a\\.\\s?s\\.?"), form("k\\.\\s?s\\.?"),
  form("v\\.\\s?o\\.\\s?s\\.?"), form("z\\.\\s?s\\.?"), form("o\\.\\s?p\\.\\s?s\\.?"), form("z\\.\\s?ú\\.?"),
];
export const hasLegalForm = (name: string): boolean => [...SK_LEGAL_FORMS, ...CZ_LEGAL_FORMS].some(pattern => pattern.test(name));
/** Vec: na začiatku rok 2000 až 2099 (voliteľne s mesiacom) a oddeľovač, alebo spisová značka v názve. */
const MATTER_DATE = /^20\d{2}(?:[-_. ](?:0[1-9]|1[0-2]))?(?:[-_ ]|$)/;
/** Holý rok alebo dátum bez názvu („2021“, „2024-01“, „2024-01-15“): archív podľa rokov, nie vec ani klient. */
export const isBareDate = (name: string): boolean => /^20\d{2}(?:[-_. ]\d{1,2}){0,2}$/.test(name);
/**
 * Slová, ktorými advokát začína názov veci („Spor s Alfa s.r.o.“, „Nájom Beta k.s.“). Vec pomenovaná podľa
 * protistrany nesie jej právnu formu, takže bez tohto pravidla vyzerá ako klient a jeden klient s vecami ako
 * prax (review VŘ k #135, bod 5; rozhodnutie MČ 13. 10. 2026, možnosť B). Slovo musí stáť samostatne:
 * „Nájomné domy s.r.o.“ ostáva klientom. SK a CZ sú oddelené, rovnaké slovo môže byť v oboch.
 */
export const SK_MATTER_WORDS: readonly string[] = [
  "spor", "žaloba", "návrh", "nájom", "prenájom", "kúpa", "predaj", "zmluva", "kúpna", "nájomná", "darovacia", "dohoda",
  "exekúcia", "konanie", "odvolanie", "dovolanie", "sťažnosť", "vymáhanie", "pohľadávka", "rozvod", "dedičstvo",
  "dedičské", "konkurz", "reštrukturalizácia", "oddlženie", "trestné", "trestná", "správne", "výpoveď", "náhrada",
  "platobný", "darovanie", "vec",
];
export const CZ_MATTER_WORDS: readonly string[] = [
  "spor", "žaloba", "návrh", "nájem", "pronájem", "koupě", "prodej", "smlouva", "kupní", "nájemní", "darovací", "dohoda",
  "exekuce", "řízení", "odvolání", "dovolání", "stížnost", "vymáhání", "pohledávka", "rozvod", "dědictví",
  "dědické", "insolvence", "oddlužení", "trestní", "správní", "výpověď", "náhrada", "platební", "darování", "věc",
];
/** Malé písmená bez diakritiky: priečinky z e-mailu, skenera či starého systému ju často nemajú („Kupa haly“). */
const fold = (word: string): string => word.normalize("NFD").replace(/\p{M}/gu, "").toLocaleLowerCase("sk");
const MATTER_WORDS = new Set([...SK_MATTER_WORDS, ...CZ_MATTER_WORDS].map(fold));
const firstWord = (name: string): string => fold(name.normalize("NFC").trim().split(/[\s,.;:()_-]+/u)[0] ?? "");
/** Prvé slovo názvu je slovo veci zo zoznamu SK alebo CZ, s diakritikou aj bez nej (test 16. 10. 2026, N2). */
export const startsWithMatterWord = (name: string): boolean => MATTER_WORDS.has(firstWord(name));
export const looksLikeMatterName = (name: string): boolean => !isBareDate(name) && (MATTER_DATE.test(name) || findCaseNumber(name) !== undefined || startsWithMatterWord(name));
