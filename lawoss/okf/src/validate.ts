/**
 * Deterministická validácia pamäte.
 *
 * Najdôležitejšia kontrola je L3_LEAK: spec 0002 hovorí, že právna vrstva
 * nesmie obsahovať klientsky identifikujúce údaje prenesené z L2. Tu sa to
 * z vety mení na bránu — identifikátory subjektov spisu sa hľadajú v texte
 * každého záznamu vrstvy L3 vrátane jeho histórie.
 */

import type { OkfRecord } from "./record.ts";

export type Severity = "error" | "warning";

export interface Finding {
  readonly severity: Severity;
  readonly code: string;
  readonly recordId: string;
  readonly message: string;
}

/** Krátke reťazce sa nehľadajú — spôsobili by falošné nálezy. */
const MIN_NAME_LENGTH = 4;

function recordText(r: OkfRecord): string {
  return [r.title, r.summary, r.truth, ...r.timeline.map((e) => `${e.date} ${e.text}`)].join("\n");
}

function clientIdentifiers(records: readonly OkfRecord[]): { value: string; source: string }[] {
  const out: { value: string; source: string }[] = [];
  for (const r of records) {
    if (r.type !== "subject") continue;
    for (const v of [r.registry_id, r.birth_date, r.title]) {
      if (v && v.trim().length >= MIN_NAME_LENGTH) out.push({ value: v.trim(), source: r.id });
    }
  }
  return out;
}

function linkTargets(r: OkfRecord): string[] {
  const out = [...(r.related ?? [])];
  for (const m of recordText(r).matchAll(/\[\[([^\]]+)\]\]/g)) {
    if (m[1]) out.push(m[1]);
  }
  return out;
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

  const identifiers = clientIdentifiers(records);
  for (const r of records) {
    if (r.layer !== "L3") continue;
    const haystack = recordText(r).toLowerCase();
    for (const id of identifiers) {
      if (haystack.includes(id.value.toLowerCase())) {
        findings.push({
          severity: "error",
          code: "L3_LEAK",
          recordId: r.id,
          message:
            `Právny prameň ${r.id} obsahuje identifikátor klienta „${id.value}" ` +
            `zo záznamu ${id.source}. Vrstva L3 je zdieľateľná — klientske údaje do nej nesmú.`,
        });
      }
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
