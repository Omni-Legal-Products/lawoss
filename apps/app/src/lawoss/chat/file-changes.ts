/**
 * LAWOSS: koľko zmien súborov urobil jeden krok agenta (N-A8-5, rozhodnutie MČ 31. 10. 2026).
 *
 * Jedno volanie `lawoss_files` je celá dávka (karta „Vykonať 5 zmien súborov?“). Rovnako ju ráta okno
 * „Skrátiť rozhovor?“ (`trim-confirm.ts`) aj číslo v hlavičke krokov nad odpoveďou
 * (`components/chat/tool-run.tsx`, PATCHES.md).
 */
import type { DynamicToolUIPart, ToolUIPart } from "ai";

type ToolPart = ToolUIPart | DynamicToolUIPart;

const BATCH_TOOL = "lawoss_files";

function parsedOutput(output: unknown): unknown {
  if (typeof output !== "string") return output;
  try {
    return JSON.parse(output);
  } catch {
    return undefined;
  }
}

/**
 * Zmeny hotového volania. Pri `lawoss_files` tie, ktoré server vo výsledku hlási ako vykonané
 * (`status: "done"`); ak výsledok nejde prečítať, položky schválenej dávky zo vstupu. Ostatné nástroje
 * sú jedna zmena na volanie.
 */
export function fileChangesOf(toolName: string, input: unknown, output: unknown): number {
  if (toolName !== BATCH_TOOL) return 1;
  const result = parsedOutput(output);
  const results: unknown = result && typeof result === "object" ? Reflect.get(result, "results") : undefined;
  if (Array.isArray(results)) return results.filter((entry) => entry && typeof entry === "object" && Reflect.get(entry, "status") === "done").length;
  const operations: unknown = input && typeof input === "object" ? Reflect.get(input, "operations") : undefined;
  return Array.isArray(operations) && operations.length > 0 ? operations.length : 1;
}

const toolName = (part: ToolPart) => part.type === "dynamic-tool" ? part.toolName : part.type.replace(/^tool-/, "");

/**
 * Číslo v hlavičke krokov: každý krok je 1, dávka `lawoss_files` jej vykonané zmeny. Zamietnutá alebo
 * neúspešná dávka je 0 ako v „Skrátiť rozhovor?“; dávka, ktorá ešte čaká alebo beží, je jeden krok.
 */
export function toolRunStepCount(parts: readonly ToolPart[]): number {
  let count = 0;
  for (const part of parts) {
    const name = toolName(part);
    if (name !== BATCH_TOOL) count += 1;
    else if (part.state === "output-available") count += fileChangesOf(name, part.input, part.output);
    else if (part.state !== "output-error" && part.state !== "output-denied") count += 1;
  }
  return count;
}
