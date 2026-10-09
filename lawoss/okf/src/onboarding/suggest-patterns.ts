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
export const looksLikeMatterName = (name: string): boolean => MATTER_DATE.test(name) || findCaseNumber(name) !== undefined;
