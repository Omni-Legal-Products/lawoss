/**
 * Register vstupů `VSTUPY.md`: čtení nezařazených řádků (`pending`) a zápis nového řádku. Sdílí kokpit, LAWOSS-lite
 * (`matter-intake.ts`) i server (`lawoss_files`, N-A7-6, přes `input-register.mjs`). Bez závislostí, jen typy.
 */
import type { MatterInput } from "./read";

/** Sloupce podle šablony `templates/spis/VSTUPY.md`: ID, Přijato, Zdroj, Originál, Stav, Výsledné záznamy. */
export type PendingInput = { id: string; received: string; source: string; original: string; matterPath: string; file: string; scope?: "client" };

export function pendingInputs(input: MatterInput): PendingInput[] {
  const rows: PendingInput[] = [];
  const sources: readonly { content: string; file: string; matterPath: string; scope?: "client" }[] = [
    { content: input.intake ?? "", file: input.path ? `${input.path}/VSTUPY.md` : "VSTUPY.md", matterPath: input.path },
    ...(input.inheritedIntakes ?? []).map((source) => ({ content: source.content, file: source.path, matterPath: source.path.split("/").slice(0, -1).join("/"), scope: source.scope })),
  ];
  for (const source of sources) {
    for (const line of source.content.split("\n")) {
      const cells = line.trim().split("|").slice(1, -1).map((cell) => cell.trim());
      if (cells[4] !== "pending") continue; // prázdné ID zůstává "" - kokpit ho ukazoval vždy
      rows.push({ id: cells[0], received: cells[1] ?? "", source: cells[2] ?? "", original: cells[3] ?? "", matterPath: source.matterPath, file: source.file, ...(source.scope ? { scope: source.scope } : {}) });
    }
  }
  return rows;
}

/**
 * Predvolené priečinky na nezaradené (SK, CS, EN), porovnávané bez ohľadu na veľkosť písmen. Rola `inbox` pracovného
 * profilu prípadu (#241) k nim pridá vlastný priečinok.
 */
export const INBOX_FOLDERS: ReadonlySet<string> = new Set(["00_na_zatriedenie", "00_k_zarazeni", "00_inbox"]);
/** Karty, podľa ktorých je priečinok vecou (prípadom); rovnaké ako pri čítaní prehľadu. */
export const MATTER_CARD_FILES: readonly string[] = ["matter.md", "spis.md", "project.md", "projekt.md"];
export const INPUT_REGISTER_FILE = "VSTUPY.md";
/** Zdroj riadku, ktorý zapíše appka pri vložení dokumentu do veci. */
export const MANUAL_INTAKE_SOURCE = "ruční vložení (LAWOSS)";

const TABLE_HEADER = "| ID | Přijato | Zdroj | Originál | Stav | Výsledné záznamy |";
const TABLE_RULE = "|---|---|---|---|---|---|";

/** Další volné ID vstupu: nejvyšší `IN-<číslo>` v registru + 1, tři číslice. */
export function nextInputId(intake: string | null): string {
  const numbers = [...(intake ?? "").matchAll(/\|\s*IN-(\d+)\s*\|/g)].map((m) => Number(m[1]));
  return `IN-${String(Math.max(0, ...numbers) + 1).padStart(3, "0")}`;
}

/** Čas přijetí s časovým pásmem počítače, např. `2026-09-24T14:32:05+02:00`. */
export function receivedStamp(now: Date): string {
  const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
  const offset = -now.getTimezoneOffset();
  const zone = `${offset >= 0 ? "+" : "-"}${pad(Math.trunc(offset / 60))}:${pad(offset % 60)}`;
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}T${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}${zone}`;
}

/** Název souboru bez cesty a znaků, které by rozbily cestu nebo tabulku. */
export function safeFileName(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  const clean = base.replace(/[\u0000-\u001f|]/g, "").trim().replace(/^\.+/, "");
  return clean || "dokument";
}

/** Text bunky bez znakov, ktoré by rozbili riadok tabuľky. */
const cellText = (value: string): string => value.replace(/[\u0000-\u001f|]/g, " ").trim();

export function inputRow(id: string, received: string, original: string, source = MANUAL_INTAKE_SOURCE): string {
  return `| ${id} | ${received} | ${cellText(source)} | ${original} | pending | |`;
}

/**
 * Bunka Originál pre cestu voči priečinku `VSTUPY.md`: obyčajná cesta, ako ju zapisuje appka; meno, ktoré by rozbilo
 * tabuľku alebo by sa čítalo ako odkaz, ide ako odkaz v Markdowne s percentovo kódovaným cieľom.
 */
export function originalCell(relativePath: string): string {
  const path = relativePath.split(/[\\/]+/).filter(Boolean).join("/");
  if (!/[\u0000-\u001f|[\]`<>]/.test(path) && path === path.trim()) return path;
  return linkCell(path);
}

/** Odkaz v Markdowne na cestu voči priečinku `VSTUPY.md`; text bez znakov Markdownu a HTML (review #292), cieľ kódovaný celý. */
function linkCell(path: string): string {
  const target = path.split("/").map((part) => encodeURIComponent(part).replace(/[()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`)).join("/");
  return `[${safeFileName(path).replace(/[[\]<>`]/g, "")}](./${target})`;
}

/**
 * N-A9-2 (alfa test 1. 11. 2026): riadok, ktorý mal Originál ako odkaz, ho po presune alebo premenovaní nestratí.
 * Obyčajná relatívna cesta od appky sa v takom riadku zapíše opäť ako odkaz; kódový span (NAS) a odkaz ostanú.
 */
function keepLink(previous: string, next: string): string {
  const cell = next.trim();
  if (!firstLink(previous.trim()) || cell.startsWith("`") || cell.startsWith("[") || !cell) return next;
  return linkCell(cell);
}

/**
 * Přidá řádek na konec první tabulky registru (za poslední její řádek). Registr bez tabulky
 * dostane tabulku na konec; chybějící registr se založí. Ostatní text zůstává beze změny.
 */
export function appendInputRow(intake: string | null, row: string, title: string): string {
  if (intake === null) {
    return `---\ntype: input-register\ntitle: ${JSON.stringify(`${title} - Vstupy`)}\n---\n\n# Vstupy a komunikace\n\n${TABLE_HEADER}\n${TABLE_RULE}\n${row}\n`;
  }
  const lines = intake.split("\n");
  const rule = lines.findIndex((line) => /^\|(\s*:?-{3,}:?\s*\|)+\s*$/.test(line.trim()));
  if (rule === -1) return `${intake.replace(/\n*$/, "\n")}\n${TABLE_HEADER}\n${TABLE_RULE}\n${row}\n`;
  let end = rule + 1;
  while (end < lines.length && lines[end]!.trim().startsWith("|")) end++;
  lines.splice(end, 0, row);
  return lines.join("\n");
}

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

const lastSegment = (path: string): string => path.split(/[\\/]+/).filter(Boolean).pop() ?? path;

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

/**
 * N-A7-6: riadok registra, ktorého Originál je daná cesta (voči priečinku `VSTUPY.md`, bez ohľadu na veľkosť písmen
 * a tvar Unicode), dostane nový Originál. Vráti `null`, keď taký riadok nie je; ID a ostatné bunky ostanú.
 *
 * `handedOver` (review #292): súbor odišiel do iného prípadu, ktorý ho eviduje vlastným riadkom. Tu je o ňom rozhodnuté
 * bez ďalšej akcie, preto stav `processed` a odôvodnenie (napr. „presunuté do …/VSTUPY.md, IN-004“) v stĺpci
 * Výsledné záznamy, za tým, čo v ňom už bolo.
 */
export function moveInputOriginal(intake: string, from: string, to: string, handedOver?: string): { content: string; id: string } | null {
  const key = (path: string) => path.normalize("NFC").replace(/\\/g, "/").split("/").filter((part) => part && part !== ".").join("/").toLowerCase();
  const wanted = key(from);
  const lines = intake.split("\n");
  for (const [index, line] of lines.entries()) {
    const cells = line.trim().split("|").slice(1, -1);
    if (cells.length < 5 || !/^\s*IN-\d+\s*$/.test(cells[0]!)) continue;
    if (key(inputOriginal(cells[3]!).target) !== wanted) continue;
    cells[3] = ` ${keepLink(cells[3]!, to)} `;
    if (handedOver !== undefined) {
      const results = (cells[5] ?? "").trim();
      cells[4] = " processed ";
      cells[5] = ` ${[results, cellText(handedOver)].filter(Boolean).join("; ")} `;
    }
    lines[index] = `${line.slice(0, line.indexOf("|"))}|${cells.join("|")}|`;
    return { content: lines.join("\n"), id: cells[0]!.trim() };
  }
  return null;
}

/**
 * N-A8-1 (MČ 31. 10. 2026): všetky riadky, ktorých Originál je `from` alebo pri priečinku (`folder`) leží v ňom.
 * `to` dostane zvyšok cesty za `from` v pôvodnom tvare (`""` pri tom istom súbore, inak `IN-003/a.pdf`) a vráti novú
 * bunku Originál; `null` bunku nechá. `handedOver` uzavrie riadok ako pri #292 (`processed`, dôvod vo Výsledných
 * záznamoch). `null`, keď žiadny riadok nesedí; ID ostanú, nič sa nepridá ani neodoberie.
 */
export function moveInputOriginals(intake: string, from: string, to: (rest: string) => string | null, options: { folder?: boolean; handedOver?: string } = {}): { content: string; ids: string[] } | null {
  const parts = (path: string) => path.normalize("NFC").replace(/\\/g, "/").split("/").filter((part) => part && part !== ".");
  const wanted = parts(from).map((part) => part.toLowerCase());
  const lines = intake.split("\n"), ids: string[] = [];
  for (const [index, line] of lines.entries()) {
    const cells = line.trim().split("|").slice(1, -1);
    if (cells.length < 5 || !/^\s*IN-\d+\s*$/.test(cells[0]!)) continue;
    const original = parts(inputOriginal(cells[3]!).target);
    if (original.length < wanted.length || (!options.folder && original.length !== wanted.length)) continue;
    if (wanted.some((part, at) => original[at]!.toLowerCase() !== part)) continue;
    const cell = to(original.slice(wanted.length).join("/"));
    if (cell !== null) cells[3] = ` ${keepLink(cells[3]!, cell)} `;
    if (options.handedOver !== undefined) {
      const results = (cells[5] ?? "").trim();
      cells[4] = " processed ";
      cells[5] = ` ${[results, cellText(options.handedOver)].filter(Boolean).join("; ")} `;
    }
    lines[index] = `${line.slice(0, line.indexOf("|"))}|${cells.join("|")}|`;
    ids.push(cells[0]!.trim());
  }
  return ids.length ? { content: lines.join("\n"), ids } : null;
}

/**
 * Text ako kódový span (review #292): cesta v bunke sa nečíta ako odkaz, obrázok ani HTML. `|` a riadiace znaky
 * by rozbili riadok tabuľky, preto ich nahradí medzera; plot je dlhší než najdlhší rad `` ` `` v texte.
 */
export function codeSpan(text: string): string {
  const clean = cellText(text);
  const fence = "`".repeat(Math.max(0, ...[...clean.matchAll(/`+/g)].map((run) => run[0].length)) + 1);
  const pad = clean.startsWith("`") || clean.endsWith("`") ? " " : "";
  return `${fence}${pad}${clean}${pad}${fence}`;
}
