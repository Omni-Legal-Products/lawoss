import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { writeRecord } from "../okf-pamat/src/cli.ts";
import { canonicalValue, serializeRecord } from "../okf-pamat/src/record.ts";
import { findOfficeDir, hasMatterCard } from "../okf-pamat/src/store.ts";
import { workspaceProfilePresent } from "./workspace-checkpoint.mjs";

/** Polia, ktoré karta ukazuje inak (text, história) alebo ktoré sa odvodzujú pri zápise. */
const SHOWN_APART = new Set(["okf", "title", "truth", "timeline", "truth_digest", "updated"]);

const empty = (value) => value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0);
const shown = (value) => typeof value === "string" ? value : canonicalValue(value) ?? "";

/**
 * LAWOSS (N-A7-10, MČ 23. 10. 2026: zápis s kartou „čo a kam“): zápis jedného záznamu pamäte spisu
 * bez shellu a bez dočasného súboru v priečinku klienta. Ten istý kód ako `okf-memory write`
 * (`writeRecord`), v procese servera; bez `apply` iba náhľad. Meno schvaľujúceho (`--approve-as`)
 * sem nikdy nejde: hostiteľ zapisuje len to, čo brána pustí bez neho. Hranicu klienta overí volajúci;
 * tu sa odmietne kancelária (jej pamäť čítajú všetci klienti) a priečinok bez karty veci.
 */
export function writeMatterMemory(directory, text, { reason, expectedRevision, apply = false }) {
  const office = findOfficeDir(directory);
  if (office && resolve(office) === resolve(directory)) {
    return { code: 1, out: "ODMIETNUTÉ: this is the office memory, shared by every client; write only to this client's case." };
  }
  if (!hasMatterCard(directory)) {
    return { code: 1, out: "ODMIETNUTÉ: this folder is not a case (no matter.md); write to the case folder, not the client root, an inbox or memory/." };
  }
  if (workspaceProfilePresent(directory)) {
    return { code: 1, out: "ODMIETNUTÉ: write uses typed OKF memory, but .lawoss/memory-profile.json is present." };
  }
  const result = writeRecord(directory, text, { reason, expectedRevision, apply });
  if (!result.plan) return { code: result.code, out: result.out };
  const { diff, targetDir, file } = result.plan;
  const record = diff.after ?? diff.before;
  const history = diff.after ? diff.after.timeline.slice(diff.before?.timeline.length ?? 0).map((entry) => `${entry.date} — ${entry.text}`) : [];
  // Nový záznam: každé neprázdne pole (aj citlivé údaje subjektu), aby karta ukázala všetko, čo sa zapíše.
  // Úprava: zmenené polia, ako ich ukazuje diff CLI (`~ pole: pred → po`).
  const fields = diff.kind === "create" && diff.after
    ? Object.entries(diff.after).filter(([key, value]) => !SHOWN_APART.has(key) && !empty(value)).map(([key, value]) => `${key}: ${shown(value)}`)
    : diff.lines.filter((line) => line.startsWith("~ ") && !line.startsWith("~ Truth") && !line.startsWith("~ updated:")).map((line) => line.slice(2));
  return {
    code: result.code, out: result.out,
    plan: {
      kind: diff.kind, id: diff.id, layer: diff.layer, requiresApproval: diff.requiresApproval, targetDir, file,
      title: record?.title ?? diff.id, type: record?.type ?? "", truth: diff.after?.truth ?? "",
      ...(diff.kind === "update" && diff.before && diff.before.truth !== diff.after?.truth ? { previousTruth: diff.before.truth } : {}),
      history, fields,
      // Bajty zapisovaného záznamu: schválenie karty sa viaže na ne, nie len na výpis náhľadu.
      recordHash: createHash("sha256").update(diff.after ? serializeRecord(diff.after) : "").digest("hex"),
    },
  };
}
