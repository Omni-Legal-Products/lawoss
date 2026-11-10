/**
 * LAWOSS #264 (rozhodnutie MČ 9. 11. 2026): `glob` a `grep` z priečinka nadradeného klienta kartu nedostanú, ale výsledky
 * z priečinka iného klienta vnoreného v ňom sa ticho vynechajú. Cielené hľadanie do vnoreného klienta má kartu
 * (`targetedNestedClientOf`) a po povolení advokátom sa nefiltruje. Spis bez vlastnej karty je ten istý klient a nefiltruje
 * sa. Tvar výsledkov je tvar natívnych nástrojov enginu 2.1.4: `output` sú záznamy s cestou relatívnou k priečinku chatu,
 * `content` text pre model s absolútnymi cestami, `metadata` počet.
 */
import type { Tool } from "@opencode/schema/tool";
import { isAbsolute, join, relative, resolve } from "node:path";
import { isPathWithin } from "./path-within.js";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);

/** Výsledok natívneho nástroja (`Tool.Result`), ako ho vidí háčik `tool.execute.after`. */
export type SearchResult = Tool.Result;

/**
 * Vynechá záznamy, ktorých cesta leží v niektorom z `roots`. `directory` je priečinok lokácie, ako ho vidí engine,
 * `canonical` ten istý priečinok kanonicky (korene sú kanonické). Vráti `null`, keď nebolo čo vynechať.
 */
export function withoutNestedClientResults(tool: string, result: SearchResult, directory: string, canonical: string, roots: readonly string[]): SearchResult | null {
  if (!roots.length || (tool !== "glob" && tool !== "grep")) return null;
  // Korene v tvare kanonickom aj v tvare priečinka lokácie (napr. /var a /private/var na macOS).
  const forms = roots.flatMap((root) => {
    const rest = relative(canonical, root);
    return !rest.startsWith("..") && !isAbsolute(rest) ? [root, join(directory, rest)] : [root];
  });
  const hidden = (path: string) => {
    const absolute = isAbsolute(path) ? path : resolve(directory, path);
    return forms.some((root) => isPathWithin(root, absolute));
  };
  const entryPath = (item: unknown): string | null => {
    const entry = tool === "grep" && isRecord(item) ? item.entry : item;
    return isRecord(entry) && typeof entry.path === "string" ? entry.path : null;
  };
  const output = Array.isArray(result.output) ? result.output.filter((item) => { const path = entryPath(item); return path === null || !hidden(path); }) : result.output;
  let removed = Array.isArray(result.output) && Array.isArray(output) ? result.output.length - output.length : 0;
  const matches = Array.isArray(output) ? output.length : null;
  /** Text pre model; `null` = bez zmeny. */
  const filterText = (text: string): string | null => {
    if (tool === "glob") {
      // Absolútna cesta na riadok; ostatné riadky (napr. poznámka o skrátení) ostanú.
      const lines = text.split("\n"), kept = lines.filter((line) => !(isAbsolute(line) && hidden(line)));
      if (kept.length === lines.length) return null;
      return kept.some((line) => isAbsolute(line)) ? kept.join("\n") : "No files found";
    }
    if (!text.startsWith("Found ")) return null;
    // „Found N matches“, potom bloky „<cesta>:\n  Line …“ oddelené prázdnym riadkom.
    const blocks = text.slice(text.indexOf("\n") + 1).split("\n\n");
    const kept = blocks.filter((block) => {
      const head = block.split("\n").find((line) => line.trim()) ?? "";
      return !(head.endsWith(":") && isAbsolute(head.slice(0, -1)) && hidden(head.slice(0, -1)));
    });
    if (kept.length === blocks.length) return null;
    const count = matches ?? kept.join("\n").split("\n").filter((line) => /^\s+Line \d+/.test(line)).length;
    return count ? `Found ${count} matches\n${kept.join("\n\n")}` : "No matches found";
  };
  let content = result.content;
  if (typeof content === "string") {
    const text = filterText(content);
    if (text !== null) { content = text; removed ||= 1; }
  } else if (Array.isArray(content)) {
    // Iný plugin mohol text zmeniť na časti (napr. pripomienky stavu appky); filtruje sa každá textová časť.
    content = content.map((part) => {
      if (part.type !== "text") return part;
      const text = filterText(part.text);
      if (text === null) return part;
      removed ||= 1;
      return { ...part, text };
    });
  }
  if (!removed) return null;
  const count = Array.isArray(output) ? output.length : undefined;
  const metadata = isRecord(result.metadata) && count !== undefined
    ? { ...result.metadata, ...(typeof result.metadata.count === "number" ? { count } : {}), ...(typeof result.metadata.matches === "number" ? { matches: count } : {}) }
    : result.metadata;
  return { ...result, output, content, metadata };
}
