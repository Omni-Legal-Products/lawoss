/** Ručný obsah a jeho deklarovaný dátum sú nezávislé od mtime projekcie. */
import { parseFrontmatter, type OkfRecord } from "./record.ts";
import { manualStatusContent } from "./render.ts";

export type ManualStatus = {
  content: string;
  updated?: string;
  state: "unknown" | "stale" | "dated";
  message: string;
};

export function readManualStatus(text: string, records: readonly OkfRecord[], today = new Date().toISOString().slice(0, 10)): ManualStatus {
  const content = manualStatusContent(text);
  const header = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(text)?.[1];
  const value = header ? parseFrontmatter(header).get("manual_updated") : undefined;
  const updated = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value && value <= today ? value : undefined;
  if (!updated) return { content, state: "unknown", message: "Ručný stav: aktuálnosť neznáma — chýba platný manual_updated; čas synchronizácie nie je kontrola obsahu." };
  const stale = records.some((record) => record.updated > updated);
  return { content, updated, state: stale ? "stale" : "dated", message: stale
    ? `Ručný stav z ${updated} je starší než pamäť — skontroluj Fázu a Ďalší krok.`
    : `Ručný stav má deklarovaný dátum ${updated}; nejde o dôkaz ľudského schválenia ani kontroly všetkých podkladov.` };
}
