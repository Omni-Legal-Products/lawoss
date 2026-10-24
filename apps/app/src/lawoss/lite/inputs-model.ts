/**
 * „Na zaradenie“ (rozhodnutie MČ 23. 10. 2026, N-A3-2): na Dnes len počet s odkazom na podrobný zoznam a v ňom len
 * dokumenty, ktoré ešte neležia v žiadnom prípade (alebo len v jeho priečinku na nezaradené). Riadok `VSTUPY.md`
 * so stavom `pending`, ktorého súbor už je v prípade (`Spisy/M001…/01_Podklady/IN-001/…`), čaká na vecnú kontrolu.
 * Bunka Originál je často odkaz v Markdowne (`[01-zmluva.docx](./01_Podklady/IN-001/01-zmluva%20v2.docx)`);
 * advokát vidí jeho text, nie surový Markdown. Bez Reactu, aby sa pravidlá dali otestovať.
 */
import type { MatterOverview } from "../../../../../lawoss/okf/read";
import { pendingInputs, type PendingInput } from "../../../../../lawoss/okf/inputs";
import type { OkfReadResult } from "../okf/read-model";
import { clientOverviewLink, liteMatterLink } from "./links";
import { groupByClient } from "./today-model";

/** Priečinok prípadu na nezaradené dokumenty (rola `inbox` pracovného profilu: SK, CS, EN). */
const INBOX_FOLDERS = new Set(["00_na_zatriedenie", "00_k_zarazeni", "00_inbox"]);

const decode = (value: string): string => {
  try { return decodeURIComponent(value); } catch { return value; }
};

/** Prvý odkaz v Markdowne v bunke: zátvorky v ceste (`sken (1).pdf`), cieľ v `<…>` a titulok za cieľom. */
function firstLink(cell: string): { label: string; target: string } | null {
  const open = cell.indexOf("[");
  const close = open < 0 ? -1 : cell.indexOf("](", open);
  if (close < 0) return null;
  let depth = 0, end = close + 2;
  for (; end < cell.length; end++) {
    if (cell[end] === "(") depth++;
    else if (cell[end] === ")") { if (depth === 0) break; depth--; }
  }
  if (end >= cell.length) return null;
  let target = cell.slice(close + 2, end).trim();
  if (target.startsWith("<") && target.includes(">")) target = target.slice(1, target.indexOf(">"));
  else target = target.replace(/\s+(?:"[^"]*"|'[^']*')$/, "");
  return { label: cell.slice(open + 1, close).trim(), target: target.trim() };
}

/** Text a cieľ bunky Originál: odkaz v Markdowne → jeho text a dekódovaný cieľ; inak bunka sama (bez `…`). */
export function inputOriginal(cell: string): { label: string; target: string } {
  const trimmed = cell.trim();
  const link = firstLink(trimmed);
  if (!link) {
    const plain = trimmed.replace(/^`(.*)`$/, "$1").trim();
    return { label: plain, target: plain };
  }
  const target = decode(link.target);
  return { label: link.label || lastSegment(target), target };
}

const lastSegment = (path: string): string => path.split(/[\\/]+/).filter(Boolean).pop() ?? path;

/**
 * Cesta súboru vstupu v súradniciach prehľadu (ako `VSTUPY.md` a cesty prípadov): cieľ voči priečinku `VSTUPY.md`.
 * Absolútna cesta, adresa (`https://`, `file:`, `mailto:`) alebo cesta nad koreň prehľadu = `null`.
 */
export function inputFilePath(input: Pick<PendingInput, "original" | "file">): string | null {
  const { target } = inputOriginal(input.original);
  if (/^(?:[a-z][a-z0-9+.-]*:\/\/|(?:file|mailto):|[a-z]:[\\/]|[\\/])/i.test(target)) return null;
  const parts = input.file.split("/").slice(0, -1);
  for (const part of target.split(/[\\/]+/)) {
    if (!part || part === ".") continue;
    if (part === "..") { if (!parts.length) return null; parts.pop(); } else parts.push(part);
  }
  return parts.join("/").normalize("NFC");
}

/**
 * Súbor vstupu už leží v prípade: v priečinku prípadu, ale nie v jeho priečinku na nezaradené (`00_Na_zatriedenie`,
 * kam ho vloží aj appka). Riadok prípadu s adresou alebo absolútnou cestou patrí svojmu prípadu.
 */
export function isFiled(input: Pick<PendingInput, "original" | "file" | "matterPath" | "scope">, matterPaths: readonly string[]): boolean {
  const path = inputFilePath(input);
  if (path === null) return input.scope !== "client" && matterPaths.includes(input.matterPath);
  return matterPaths.some((matter) => {
    const root = matter.normalize("NFC");
    if (!(root === "" || path === root || path.startsWith(`${root}/`))) return false;
    const inside = (root ? path.slice(root.length + 1) : path).split("/");
    return !(inside.length > 1 && INBOX_FOLDERS.has(inside[0]!.toLowerCase()));
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
