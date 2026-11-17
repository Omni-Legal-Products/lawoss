// LAWOSS #493: CSV z Excelu v SK/CZ prostredí používa `;` a desatinnú čiarku. Oddeľovač sa určí z obsahu
// a uloženie zapíše nezmenené bunky v pôvodnom znení, takže sa mení len to, čo používateľ upravil.

const CANDIDATES = [",", ";", "\t"] as const;
const SAMPLE_LINES = 20;
const BOM = "﻿";

type Cell = { value: string; raw: string };
type Dialect = { delimiter: string; newline: string; bom: boolean; trailingNewline: boolean };

/** Počet výskytov každého kandidáta mimo úvodzoviek v prvých neprázdnych riadkoch. */
function countPerLine(content: string) {
  const lines: Record<string, number>[] = [];
  let counts: Record<string, number> = {};
  let quoted = false;
  let empty = true;
  for (let index = 0; index < content.length && lines.length < SAMPLE_LINES; index += 1) {
    const char = content[index]!;
    if (char === '"') quoted = !quoted;
    else if (!quoted && char === "\n") {
      if (!empty) lines.push(counts);
      counts = {};
      empty = true;
      continue;
    } else if (!quoted && (CANDIDATES as readonly string[]).includes(char)) counts[char] = (counts[char] ?? 0) + 1;
    if (char !== "\r") empty = false;
  }
  if (!empty && lines.length < SAMPLE_LINES) lines.push(counts);
  return lines;
}

/** Oddeľovač s rovnakým počtom výskytov v najviac riadkoch; pri zhode alebo bez dôkazu `fallback`. */
export function detectDelimiter(content: string, fallback: string) {
  const lines = countPerLine(content);
  let best = { delimiter: fallback, consistent: 0, fields: 0 };
  for (const delimiter of [fallback, ...CANDIDATES.filter(candidate => candidate !== fallback)]) {
    const first = lines[0]?.[delimiter] ?? 0;
    if (!first) continue;
    const consistent = lines.filter(line => (line[delimiter] ?? 0) === first).length;
    if (consistent > best.consistent || (consistent === best.consistent && first > best.fields)) best = { delimiter, consistent, fields: first };
  }
  return best.delimiter;
}

function dialectOf(source: string, fallback: string): Dialect {
  const bom = source.startsWith(BOM);
  const body = bom ? source.slice(1) : source;
  return {
    delimiter: detectDelimiter(body, fallback),
    newline: body.includes("\r\n") ? "\r\n" : "\n",
    bom,
    trailingNewline: body === "" || body.endsWith("\n"),
  };
}

function scan(content: string, delimiter: string): Cell[][] {
  const rows: Cell[][] = [];
  let row: Cell[] = [];
  let value = "";
  let start = 0;
  let quoted = false;
  const endCell = (end: number) => {
    row.push({ value, raw: content.slice(start, end) });
    value = "";
  };
  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (quoted) {
      if (char === '"' && content[index + 1] === '"') {
        value += '"';
        index += 1;
      } else if (char === '"') quoted = false;
      else value += char;
    } else if (char === '"') quoted = true;
    else if (char === delimiter) {
      endCell(index);
      start = index + 1;
    } else if (char === "\n") {
      endCell(content[index - 1] === "\r" ? index - 1 : index);
      rows.push(row);
      row = [];
      start = index + 1;
    } else if (char !== "\r") value += char;
  }
  if (value || row.length || start < content.length) {
    endCell(content.length);
    rows.push(row);
  }
  return rows;
}

export function parseDelimitedText(content: string, fallbackDelimiter: string): string[][] {
  const dialect = dialectOf(content, fallbackDelimiter);
  const rows = scan(dialect.bom ? content.slice(1) : content, dialect.delimiter).map(row => row.map(cell => cell.value));
  return rows.length ? rows : [[""]];
}

function encode(value: string, delimiter: string) {
  return value.includes(delimiter) || /["\r\n]/.test(value) ? `"${value.replace(/"/g, '""')}"` : value;
}

/**
 * Riadky mriežky späť na text v dialekte `source`. Nezmenená bunka sa zapíše v pôvodnom znení; prázdne
 * bunky, ktoré editor doplnil len pre tvar mriežky, sa nezapíšu, pokiaľ používateľ nepridal stĺpec.
 */
export function serializeDelimitedText(rows: string[][], source: string, fallbackDelimiter: string) {
  const dialect = dialectOf(source, fallbackDelimiter);
  const original = scan(dialect.bom ? source.slice(1) : source, dialect.delimiter);
  const originalWidth = Math.max(0, ...original.map(row => row.length));
  const lines = rows.map((row, rowIndex) => {
    const before = original[rowIndex];
    let width = row.length;
    if (before && row.length <= originalWidth) {
      width = before.length;
      for (let index = row.length - 1; index >= width; index -= 1) if (row[index]) { width = index + 1; break; }
    }
    return row.slice(0, width).map((value, index) => {
      const cell = before?.[index];
      return cell && cell.value === value ? cell.raw : encode(value, dialect.delimiter);
    }).join(dialect.delimiter);
  });
  return (dialect.bom ? BOM : "") + lines.join(dialect.newline) + (dialect.trailingNewline ? dialect.newline : "");
}
