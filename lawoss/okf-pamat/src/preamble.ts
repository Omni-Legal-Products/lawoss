/**
 * Session-preambula (N3a, N4).
 *
 * Na začiatku session nad spisom sa agent riadi tromi vecami z pamäte
 * kancelárie: pravidlami (L1 `rule`), poučeniami z chýb (L1 `lesson`)
 * a ban-listom prameňov, ktoré sa už necitujú (`authority` so statusom
 * `banned`/`deprecated`). Obsah spisu (L2) sem zámerne nepatrí — preambula
 * je to, čo platí naprieč vecami, nie stav konkrétnej veci.
 */

import type { OkfRecord } from "./record.ts";

const bullet = (r: OkfRecord) => `- [${r.id}] ${r.title} — ${r.description}`;

/** Kompaktný blok pre system prompt session: čo platí vždy a čo sa nesmie citovať. */
export function composePreamble(records: readonly OkfRecord[]): string {
  const active = (r: OkfRecord) => String(r.status) === "active";
  const rules = records.filter((r) => r.type === "rule" && active(r));
  const lessons = records.filter((r) => r.type === "lesson" && active(r));
  const banned = records.filter(
    (r) => r.type === "authority"
      && (String(r.status) === "banned" || String(r.status) === "deprecated"),
  );
  const parts: string[] = [];
  if (rules.length) parts.push("## Pravidlá kancelárie", ...rules.map(bullet));
  if (lessons.length) parts.push("## Poučenia z chýb", ...lessons.map(bullet));
  if (banned.length) parts.push("## Necitovať (ban-list)", ...banned.map(bullet));
  return parts.join("\n");
}
