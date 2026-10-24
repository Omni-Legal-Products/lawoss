/**
 * „Na zaradenie“ (rozhodnutie MČ 23. 10. 2026, N-A3-2): na Dnes len počet s odkazom na podrobný zoznam a v ňom len
 * dokumenty, ktoré ešte neležia v žiadnom prípade. Riadok `VSTUPY.md` so stavom `pending`, ktorého súbor už je
 * v priečinku prípadu (`Spisy/M001…/01_Podklady/IN-001/…`), čaká na vecnú kontrolu, nie na zaradenie.
 * Bunka Originál je často odkaz v Markdowne (`[01-zmluva.docx](./01_Podklady/IN-001/01-zmluva%20v2.docx)`);
 * advokát vidí jeho text, nie surový Markdown. Bez Reactu, aby sa pravidlá dali otestovať.
 */
import type { MatterOverview } from "../../../../../lawoss/okf/read";
import { pendingInputs, type PendingInput } from "../../../../../lawoss/okf/inputs";
import type { OkfReadResult } from "../okf/read-model";
import { clientOverviewLink, liteMatterLink } from "./links";
import { groupByClient } from "./today-model";

const LINK = /^\[([^\]]*)\]\(\s*<?([^)>]*?)>?\s*\)$/;

const decode = (value: string): string => {
  try { return decodeURIComponent(value); } catch { return value; }
};

/** Text a cieľ bunky Originál: odkaz v Markdowne → jeho text a dekódovaný cieľ; inak bunka sama (aj ako cieľ). */
export function inputOriginal(cell: string): { label: string; target: string } {
  const trimmed = cell.trim();
  const link = LINK.exec(trimmed);
  if (!link) return { label: trimmed, target: trimmed };
  const target = decode(link[2]!.trim());
  return { label: link[1]!.trim() || lastSegment(target), target };
}

const lastSegment = (path: string): string => path.split(/[\\/]+/).filter(Boolean).pop() ?? path;

/**
 * Cesta súboru vstupu v súradniciach prehľadu (ako `VSTUPY.md` a cesty prípadov): cieľ voči priečinku `VSTUPY.md`.
 * Absolútna cesta, adresa (`https:`, `file:`) alebo cesta nad koreň prehľadu = `null` (v žiadnom prípade nie je).
 */
export function inputFilePath(input: Pick<PendingInput, "original" | "file">): string | null {
  const { target } = inputOriginal(input.original);
  if (/^(?:[a-z][a-z0-9+.-]*:|[\\/])/i.test(target)) return null;
  const parts = input.file.split("/").slice(0, -1);
  for (const part of target.split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(part);
  }
  return parts.join("/").normalize("NFC");
}

/** Súbor vstupu leží v priečinku niektorého prípadu (aj v jeho `00_Na_zatriedenie`). */
export function isFiled(input: Pick<PendingInput, "original" | "file">, matterPaths: readonly string[]): boolean {
  const path = inputFilePath(input);
  if (path === null) return false;
  return matterPaths.some((matter) => {
    const root = matter.normalize("NFC");
    return root === "" || path === root || path.startsWith(`${root}/`);
  });
}

/** Nezaradené vstupy celého prehľadu: `pending` riadky bez opakovaní, ktorých súbor ešte nie je v žiadnom prípade. */
export function unfiledInputs(result: Pick<OkfReadResult, "inputs" | "matters">): PendingInput[] {
  const matterPaths = result.matters.map((matter) => matter.path);
  const unique = new Map(result.inputs.flatMap(pendingInputs).map((entry) => [
    entry.scope === "client" ? `${entry.scope}\u0000${entry.file}\u0000${entry.id}` : `${entry.matterPath}\u0000${entry.file}\u0000${entry.id}`,
    entry,
  ]));
  return [...unique.values()].filter((entry) => !isFiled(entry, matterPaths));
}

export type InputRow = { input: PendingInput; label: string; matter?: Pick<MatterOverview, "path" | "title">; link: string };
export type InputGroup = { key: string; client: string; link: string; rows: InputRow[] };

/**
 * Podrobný zoznam podľa klienta a prípadu (nie podľa stĺpca Zdroj): klientsky vstup patrí klientovi svojho
 * `VSTUPY.md`, vstup prípadu klientovi prípadu (`groupByClient`, rovnaké pravidlo ako Klienti).
 */
export function inputGroups(result: Pick<OkfReadResult, "inputs" | "matters" | "clients">, inputs: readonly PendingInput[] = unfiledInputs(result)): InputGroup[] {
  const groups = groupByClient(result.matters, result.inputs, result.clients ?? []);
  const groupOfMatter = new Map(groups.flatMap((group) => group.matters.map((matter) => [matter.path, group] as const)));
  const byKey = new Map<string, InputGroup>();
  for (const input of inputs) {
    const matter = input.scope === "client" ? undefined : result.matters.find((m) => m.path === input.matterPath);
    const owner = matter ? groupOfMatter.get(matter.path) : groups.find((group) => group.key === `client:${input.matterPath}`);
    const key = owner?.key ?? `client:${input.matterPath}`;
    const client = owner?.client || lastSegment(input.matterPath) || "";
    const group = byKey.get(key) ?? { key, client, link: clientOverviewLink(key), rows: [] };
    group.rows.push({
      input,
      label: inputOriginal(input.original).label || input.id || "-",
      ...(matter ? { matter: { path: matter.path, title: matter.title } } : {}),
      link: matter ? liteMatterLink(matter.path) : group.link,
    });
    byKey.set(key, group);
  }
  return [...byKey.values()].sort((a, b) => a.client.localeCompare(b.client, "cs") || a.key.localeCompare(b.key));
}
