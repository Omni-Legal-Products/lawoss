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

/** IČO býva písané po trojiciach — „291 396 43" je ten istý údaj. */
function registryNeedle(value: string, source: string): Needle | undefined {
  const digits = value.replace(/\D/g, "");
  if (digits.length < 3) return undefined;
  const body = digits.split("").map(escapeRegex).join("[ \\u00a0]?");
  return { pattern: atWordBoundary(body), label: value, source, strength: "hard" };
}

/** Dátum narodenia hľadáme v ISO aj v českom a slovenskom zápise. */
function birthDateNeedle(value: string, source: string): Needle | undefined {
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!iso) return undefined;
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

function clientNeedles(records: readonly OkfRecord[]): Needle[] {
  const out: Needle[] = [];
  for (const r of records) {
    if (r.type !== "subject") continue;
    if (r.registry_id) {
      const n = registryNeedle(r.registry_id, r.id);
      if (n) out.push(n);
    }
    if (r.birth_date) {
      const n = birthDateNeedle(r.birth_date, r.id);
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

export function validateStore(records: readonly OkfRecord[]): Finding[] {
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

  return findings;
}
