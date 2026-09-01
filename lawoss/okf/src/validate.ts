/**
 * Deterministická validácia pamäte.
 *
 * Najdôležitejšia kontrola je únik z L2 do L3: spec 0002 hovorí, že právna
 * vrstva nesmie obsahovať klientsky identifikujúce údaje prenesené zo spisu.
 * Tu sa to z vety mení na bránu.
 *
 * Kontrola rozlišuje silu zhody, lebo falošný poplach a únik nemajú rovnakú
 * cenu. Únik je porušenie mlčanlivosti; falošný poplach iba zdržuje:
 *
 *   hard   — IČO, dátum narodenia. Presný identifikátor, blokuje vždy.
 *   strong — celé meno alebo obchodná firma. Blokuje.
 *   weak   — samotné krátke priezvisko. Iba varovanie na revíziu.
 *
 * Prahy sú vedomé rozhodnutie, nie technická konštanta — meniť ich znamená
 * posúvať hranicu medzi „otravuje" a „pustí von klientsky údaj".
 */

import type { OkfRecord } from "./record.ts";
import {
  AML_REQUIRED, PERSON_KINDS, SENSITIVE_FIELDS, fieldLabel, needleFields,
  type FieldDef, type Jurisdiction,
} from "./schema.ts";

export type Severity = "error" | "warning";

export interface Finding {
  readonly severity: Severity;
  readonly code: string;
  readonly recordId: string;
  readonly message: string;
}

/** Meno kratšie než toto sa nehľadá vôbec — spôsobilo by falošné nálezy. */
const MIN_NAME_LENGTH = 4;

/** Jednoslovné meno od tejto dĺžky sa považuje za dosť určité na blokovanie. */
const STRONG_SINGLE_TOKEN_LENGTH = 8;

type Strength = "hard" | "strong" | "weak";

interface Needle {
  readonly pattern: RegExp;
  readonly label: string;
  readonly source: string;
  readonly strength: Strength;
}

/** Diakritika ani veľkosť písmen nesmie byť spôsob, ako údaj prepašovať von. */
function normalize(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Zhoda musí sedieť na hranicu slova — „Rada" nesmie chytiť „porada". */
function atWordBoundary(body: string): RegExp {
  return new RegExp(`(?<![\\p{L}\\p{N}])(?:${body})(?![\\p{L}\\p{N}])`, "u");
}

/** Právne formy sa odstraňujú, aby „Gh Real Estate" chytilo aj bez „s.r.o.". */
const LEGAL_FORM =
  /[\s,]*(spol\.?\s*s\s*r\.?\s*o\.?|s\.?\s*r\.?\s*o\.?|a\.\s*s\.?|v\.\s*o\.\s*s\.?|o\.\s*p\.\s*s\.?|z\.\s*s\.?|z\.\s*u\.?|k\.\s*s\.?)\s*$/;

/**
 * Presný identifikátor (IČO, rodné číslo, číslo dokladu). Hľadá sa aj keď
 * je rozdelený oddeľovačmi — „291 396 43" a „750101/1234" sú tie isté údaje
 * ako bez medzery a lomítka.
 */
function exactNeedle(value: string, source: string, label: string): Needle | undefined {
  const chars = value.replace(/[^0-9a-zA-Z]/g, "");
  if (chars.length < 3) return undefined;
  const body = chars.split("").map(escapeRegex).join("[ \\u00a0/.\\-]?");
  return { pattern: atWordBoundary(body), label, source, strength: "hard" };
}

/** Dátum narodenia hľadáme v ISO aj v českom a slovenskom zápise. */
function birthDateNeedle(value: string, source: string): Needle | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!iso) return exactNeedle(value, source, value);
  const [, y, mm, dd] = iso;
  if (!y || !mm || !dd) return undefined;
  const d = String(Number(dd));
  const m = String(Number(mm));
  const local = `0?${d}\\.\\s*0?${m}\\.\\s*${y}`;
  return {
    pattern: atWordBoundary(`${escapeRegex(value.trim())}|${local}`),
    label: value,
    source,
    strength: "hard",
  };
}

/** Viacslovný údaj — adresa. Hľadá sa celý, preto je zhoda dosť určitá. */
function phraseNeedle(value: string, source: string): Needle | undefined {
  const tokens = normalize(value).split(" ").filter((t) => t.length > 0);
  if (tokens.length === 0) return undefined;
  const body = tokens.map(escapeRegex).join("\\s+");
  return { pattern: atWordBoundary(body), label: value, source, strength: "strong" };
}

function nameNeedle(title: string, source: string): Needle | undefined {
  const stripped = normalize(title).replace(LEGAL_FORM, "").trim();
  const tokens = stripped.split(" ").filter((t) => t.length >= 2);
  if (tokens.length === 0) return undefined;

  let strength: Strength;
  if (tokens.length >= 2) strength = "strong";
  else if ((tokens[0] ?? "").length >= STRONG_SINGLE_TOKEN_LENGTH) strength = "strong";
  else if ((tokens[0] ?? "").length >= MIN_NAME_LENGTH) strength = "weak";
  else return undefined;

  const body = tokens.map(escapeRegex).join("\\s+");
  return { pattern: atWordBoundary(body), label: title, source, strength };
}

function needleForField(f: FieldDef, value: string, source: string): Needle | undefined {
  if (f.canonical === "birth_date") return birthDateNeedle(value, source);
  if (f.needle === "strong") return phraseNeedle(value, source);
  return exactNeedle(value, source, value);
}

/**
 * Jehly sa berú z tabuľky polí, nie z ručného zoznamu. Nové citlivé pole je
 * tým pádom automaticky strážené — pridanie AML údaja nemôže ticho oslabiť
 * bránu tým, že sa niekto zabudne vrátiť sem.
 */
function clientNeedles(records: readonly OkfRecord[]): Needle[] {
  const out: Needle[] = [];
  for (const r of records) {
    if (r.type !== "subject") continue;
    const raw = r as unknown as Record<string, unknown>;
    for (const f of needleFields()) {
      const v = raw[f.canonical];
      if (typeof v !== "string" || v.trim() === "") continue;
      const n = needleForField(f, v, r.id);
      if (n) out.push(n);
    }
    if (r.title) {
      const n = nameNeedle(r.title, r.id);
      if (n) out.push(n);
    }
  }
  return out;
}

function recordText(r: OkfRecord): string {
  return [r.title, r.summary, r.truth, ...r.timeline.map((e) => `${e.date} ${e.text}`)].join("\n");
}

function linkTargets(r: OkfRecord): string[] {
  const out = [...(r.related ?? [])];
  if (r.subject_ref) out.push(r.subject_ref);
  for (const m of recordText(r).matchAll(/\[\[([^\]]+)\]\]/g)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
}

function leakFinding(r: OkfRecord, n: Needle): Finding {
  if (n.strength === "weak") {
    return {
      severity: "warning",
      code: "L3_LEAK_SUSPECT",
      recordId: r.id,
      message:
        `Právny prameň ${r.id} obsahuje „${n.label}" — zhoda so subjektom ${n.source}, ` +
        `ale meno je krátke a môže ísť o zhodu náhodou. Posúď a buď ho prepíš, alebo nechaj.`,
    };
  }
  return {
    severity: "error",
    code: "L3_LEAK",
    recordId: r.id,
    message:
      `Právny prameň ${r.id} obsahuje identifikátor klienta „${n.label}" ` +
      `zo záznamu ${n.source}. Vrstva L3 je zdieľateľná — klientske údaje do nej nesmú.`,
  };
}

export interface ValidateOptions {
  /** Dnešný dátum pre kontrolu lehôt. Vstupuje zvonka, aby boli testy deterministické. */
  readonly today?: string;
}

/** Roly, pri ktorých vzniká identifikačná povinnosť. */
const IDENTIFIED_ROLES = ["client", "representative", "ubo"] as const;

/** Vzor českého a slovenského rodného čísla — šesť číslic, voliteľné lomítko, koncovka. */
const BIRTH_NUMBER_PATTERN = /\b\d{6}\s?\/\s?\d{3,4}\b/;

/** Popis sa dostáva do INDEX.md aj do projekcie v _STATUS.md — citlivý údaj tam nepatrí. */
function sensitiveInSummary(r: OkfRecord): Finding | undefined {
  const raw = r as unknown as Record<string, unknown>;
  if (BIRTH_NUMBER_PATTERN.test(r.summary)) {
    return {
      severity: "error",
      code: "SENSITIVE_IN_SUMMARY",
      recordId: r.id,
      message:
        `Popis záznamu ${r.id} obsahuje rodné číslo. Popis sa renderuje do INDEX.md ` +
        `a do _STATUS.md — citlivý údaj patrí do poľa frontmatteru, nie do popisu.`,
    };
  }
  for (const key of SENSITIVE_FIELDS) {
    const v = raw[key];
    if (typeof v === "string" && v.trim().length >= 4 && r.summary.includes(v)) {
      return {
        severity: "error",
        code: "SENSITIVE_IN_SUMMARY",
        recordId: r.id,
        message:
          `Popis záznamu ${r.id} opakuje citlivý údaj z poľa ` +
          `${fieldLabel(key, r.jurisdiction)}. Popis sa renderuje do INDEX.md a do _STATUS.md.`,
      };
    }
  }
  return undefined;
}
/** Je údaj v zázname vyplnený? Prázdny reťazec ani prázdny zoznam sa nepočíta. */
function filled(raw: Record<string, unknown>, canonical: string): boolean {
  const v = raw[canonical];
  if (v === undefined) return false;
  if (typeof v === "string") return v.trim() !== "";
  if (Array.isArray(v)) return v.length > 0;
  return true;
}

/**
 * Kontrola úplnosti identifikácie podľa AML predpisu jurisdikcie.
 *
 * Rieši aj zákonné alternatívy — „rodné číslo, a nebylo-li přiděleno, datum
 * narození a pohlaví" nie sú deväť povinných polí, ale osem a vetva.
 */
function amlCompleteness(r: OkfRecord): Finding | undefined {
  // Identifikačná povinnosť mieri na klienta, jeho zástupcu a konečného
  // užívateľa výhod — nie na protistranu. Hlásiť pri protistrane chýbajúce
  // rodné číslo je šum, ktorý celú kontrolu znehodnotí.
  if (!IDENTIFIED_ROLES.some((role) => role === r.role)) return undefined;
  const ruleset = AML_REQUIRED[r.jurisdiction as Jurisdiction];
  if (!ruleset) return undefined;
  const kind = PERSON_KINDS.find((k) => k === r.person_type);
  if (!kind) return undefined;

  const raw = r as unknown as Record<string, unknown>;
  const missing: string[] = [];
  for (const req of ruleset[kind]) {
    if (typeof req === "string") {
      if (!filled(raw, req)) missing.push(req);
      continue;
    }
    if (filled(raw, req.primary)) continue;
    const chybaju = req.fallback.filter((c) => !filled(raw, c));
    if (chybaju.length === 0) continue;
    missing.push(req.primary, ...chybaju);
  }
  if (missing.length === 0) return undefined;

  const keys = [...new Set(missing)].map((c) => fieldLabel(c, r.jurisdiction)).join(", ");
  const predpis =
    r.jurisdiction === "sk"
      ? "§ 7 ods. 1 zák. č. 297/2008 Z. z."
      : "§ 5 ods. 1 zák. č. 253/2008 Sb.";
  return {
    severity: "warning",
    code: "AML_INCOMPLETE",
    recordId: r.id,
    message: `Identifikácia subjektu ${r.id} nie je úplná podľa ${predpis} — chýba: ${keys}`,
  };
}

export function validateStore(
  records: readonly OkfRecord[],
  opts: ValidateOptions = {},
): Finding[] {
  const findings: Finding[] = [];
  const ids = new Set(records.map((r) => r.id));

  const seen = new Set<string>();
  for (const r of records) {
    if (seen.has(r.id)) {
      findings.push({
        severity: "error",
        code: "DUPLICATE_ID",
        recordId: r.id,
        message: `Identifikátor ${r.id} nesie viac než jeden záznam`,
      });
    }
    seen.add(r.id);
  }

  const needles = clientNeedles(records);
  for (const r of records) {
    if (r.layer !== "L3") continue;
    const haystack = normalize(recordText(r));
    for (const n of needles) {
      if (n.pattern.test(haystack)) findings.push(leakFinding(r, n));
    }
  }

  for (const r of records) {
    for (const target of linkTargets(r)) {
      if (!ids.has(target)) {
        findings.push({
          severity: "error",
          code: "BROKEN_LINK",
          recordId: r.id,
          message: `Záznam ${r.id} odkazuje na neexistujúci záznam ${target}`,
        });
      }
    }
  }

  for (const r of records) {
    const last = r.timeline.at(-1);
    if (last && last.date > r.updated) {
      findings.push({
        severity: "warning",
        code: "STALE_UPDATED",
        recordId: r.id,
        message: `Záznam ${r.id} má zmena: ${r.updated}, ale história siaha do ${last.date}`,
      });
    }
  }

  for (const r of records) {
    const f = sensitiveInSummary(r);
    if (f) findings.push(f);
  }

  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const screenings = records.filter((r) => r.type === "screening");

  // § 9 — priebežná kontrola. Preverenie s uplynutou platnosťou treba zopakovať.
  for (const r of screenings) {
    if (r.valid_until && r.valid_until < today) {
      findings.push({
        severity: "warning",
        code: "AML_EXPIRED",
        recordId: r.id,
        message:
          `Preverenie ${r.id} platilo do ${r.valid_until} a je po lehote. ` +
          `§ 9 AML zákona vyžaduje priebežnú kontrolu — zopakuj a založ nový záznam.`,
      });
    }
  }

  // § 8 — klient musí byť preverený. Protistrana pod túto povinnosť nespadá.
  for (const r of records) {
    if (r.type !== "subject" || r.role !== "client") continue;
    if (!screenings.some((p) => p.subject_ref === r.id)) {
      findings.push({
        severity: "warning",
        code: "AML_MISSING",
        recordId: r.id,
        message: `Klient ${r.id} nemá žiadny záznam o preverení (typ screening).`,
      });
    }
  }

  // Varovanie patrí tam, kde by kontrola úplnosti reálne bežala — teda kde
  // niekto AML identifikáciu naozaj vedie (`typ_osoby`). Subjekt bez nej je
  // len údaj o tom, kto je protistrana, nie AML záznam.
  const unverified = records.find(
    (r) =>
      r.type === "subject" &&
      PERSON_KINDS.some((k) => k === r.person_type) &&
      IDENTIFIED_ROLES.some((role) => role === r.role) &&
      AML_REQUIRED[r.jurisdiction as Jurisdiction] === undefined,
  );
  if (unverified) {
    findings.push({
      severity: "warning",
      code: "AML_RULESET_UNVERIFIED",
      recordId: unverified.id,
      message:
        `Pre jurisdikciu ${unverified.jurisdiction} nie je overená povinná identifikačná sada, ` +
        `takže sa úplnosť nekontroluje. Doplní advokát danej jurisdikcie.`,
    });
  } else {
    for (const r of records) {
      if (r.type !== "subject") continue;
      const f = amlCompleteness(r);
      if (f) findings.push(f);
    }
  }

  return findings;
}
