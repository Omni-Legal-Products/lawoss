import { writeRecord } from "../okf-pamat/src/cli.ts";
import { workspaceProfilePresent } from "./workspace-checkpoint.mjs";

/**
 * LAWOSS (N-A7-10, MČ 23. 10. 2026: zápis s kartou „čo a kam“): zápis jedného záznamu pamäte spisu
 * bez shellu a bez dočasného súboru v priečinku klienta. Ten istý kód ako `okf-memory write`
 * (`writeRecord`), v procese servera; bez `apply` iba náhľad. Meno schvaľujúceho (`--approve-as`)
 * sem nikdy nejde: hostiteľ zapisuje len to, čo brána pustí bez neho. Hranicu klienta overí volajúci.
 */
export function writeMatterMemory(directory, text, { reason, expectedRevision, apply = false }) {
  if (workspaceProfilePresent(directory)) {
    return { code: 1, out: "ODMIETNUTÉ: write uses typed OKF memory, but .lawoss/memory-profile.json is present." };
  }
  const result = writeRecord(directory, text, { reason, expectedRevision, apply });
  if (!result.plan) return { code: result.code, out: result.out };
  const { diff, targetDir, file } = result.plan;
  const record = diff.after ?? diff.before;
  const history = diff.after ? diff.after.timeline.slice(diff.before?.timeline.length ?? 0).map((entry) => `${entry.date} — ${entry.text}`) : [];
  // Iné zmenené polia než pravda a dátum zmeny, ako ich ukazuje diff CLI (`~ pole: pred → po`).
  const fields = diff.lines.filter((line) => line.startsWith("~ ") && !line.startsWith("~ Truth") && !line.startsWith("~ updated:")).map((line) => line.slice(2));
  return {
    code: result.code, out: result.out,
    plan: {
      kind: diff.kind, id: diff.id, layer: diff.layer, requiresApproval: diff.requiresApproval, targetDir, file,
      title: record?.title ?? diff.id, truth: diff.after?.truth ?? "",
      ...(diff.kind === "update" && diff.before && diff.before.truth !== diff.after?.truth ? { previousTruth: diff.before.truth } : {}),
      history, fields,
    },
  };
}
