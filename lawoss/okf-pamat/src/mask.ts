/**
 * Maskovanie citlivých údajov vo výstupoch pre človeka.
 *
 * Maskuje sa iba to, čo sa zobrazuje — nikdy uložený súbor. Záznam je
 * dôkazný materiál podľa § 8 AML zákona a musí zostať úplný; maskovanie
 * len znižuje šancu, že rodné číslo skončí na screenshote alebo v exporte.
 *
 * Nie je to bezpečnostné opatrenie. Kto má prístup k adresáru spisu, má
 * prístup k plným údajom — na to je šifrovanie úložiska, nie táto funkcia.
 */

import { SENSITIVE_FIELDS } from "./schema.ts";
import type { OkfRecord } from "./record.ts";

const DOT = "•";

function maskDigits(value: string): string {
  return value.replace(/\d/g, DOT);
}

export function maskValue(canonical: string, value: string): string {
  if (value === "") return value;
  if (!SENSITIVE_FIELDS.includes(canonical)) return value;

  switch (canonical) {
    case "birth_number": {
      // Prvých šesť číslic je dátum narodenia, ktorý je aj tak inde;
      // koncovka je to, čo robí rodné číslo jedinečným identifikátorom.
      const m = /^(\d{6})(\/?)(\d+)$/.exec(value);
      if (!m) return maskDigits(value);
      return `${m[1]}${m[2]}${DOT.repeat((m[3] ?? "").length)}`;
    }
    case "id_document_number": {
      const keep = Math.min(2, value.length);
      return value.slice(0, keep) + DOT.repeat(value.length - keep);
    }
    case "birth_date": {
      const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
      return m ? `${m[1]}-${DOT.repeat(2)}-${DOT.repeat(2)}` : maskDigits(value);
    }
    case "residence":
      // Ulica a obec zostávajú čitateľné, čísla popisné a PSČ nie —
      // adresa tak stále dáva zmysel, ale nie je to doručovacia adresa.
      return maskDigits(value);
    default:
      return maskDigits(value);
  }
}

/** Vráti kópiu záznamu s maskovanými citlivými poľami. Zdroj nemení. */
export function maskRecord(r: OkfRecord): OkfRecord {
  const copy: OkfRecord = { ...r, timeline: [...r.timeline] };
  const target = copy as unknown as Record<string, unknown>;
  for (const key of SENSITIVE_FIELDS) {
    const v = target[key];
    if (typeof v === "string") target[key] = maskValue(key, v);
  }
  return copy;
}
