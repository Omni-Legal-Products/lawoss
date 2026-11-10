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

/**
 * Nové súbory, ktoré hotové volanie `lawoss_files` vytvorilo (`create_file`, MČ 10. 11. 2026): plné cesty z výsledku
 * servera (`path`). `lib/artifacts.ts` z nich robí otvárateľné karty súborov pod odpoveďou, ako pri zápise natívnym
 * nástrojom; meno s diakritikou alebo medzerou by z textu odpovede nerozpoznal.
 */
export function createdFilesOf(parts: ReadonlyArray<{ type: string }>): string[] {
  return parts.flatMap((part) => {
    const name: unknown = Reflect.get(part, "toolName"), state: unknown = Reflect.get(part, "state");
    if (part.type !== "dynamic-tool" || name !== BATCH_TOOL || state !== "output-available") return [];
    const result = parsedOutput(Reflect.get(part, "output"));
    const results: unknown = result && typeof result === "object" ? Reflect.get(result, "results") : undefined;
    if (!Array.isArray(results)) return [];
    return results.flatMap((entry: unknown) => {
      if (!entry || typeof entry !== "object" || Reflect.get(entry, "operation") !== "create_file" || Reflect.get(entry, "status") !== "done") return [];
      const path: unknown = Reflect.get(entry, "path");
      return typeof path === "string" && path.trim() ? [path] : [];
    });
  });
}

/**
 * Cesty správy pre karty súborov spolu s novými súbormi. Agent nový súbor v odpovedi aj pomenuje (`Vystupy/vyzva.docx`):
 * cesta z textu, ktorá je koncom cesty vytvoreného súboru, je ten istý súbor a druhú kartu nedostane.
 */
export function withCreatedFiles(paths: readonly string[], parts: ReadonlyArray<{ type: string }>): string[] {
  const created = createdFilesOf(parts);
  const plain = (path: string) => path.replace(/\\/g, "/").replace(/^\.\//, "").toLowerCase();
  const same = (path: string) => created.some((file) => plain(file) === plain(path) || plain(file).endsWith(`/${plain(path)}`));
  return [...paths.filter((path) => !same(path)), ...created];
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
