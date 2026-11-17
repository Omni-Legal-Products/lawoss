// LAWOSS #492: prázdny alebo poškodený súbor sa v paneli nezobrazí zabudovaným prehliadačom PDF (anglická
// chyba Chromia mimo štýlu appky) ani editorom Office (surová chyba JSZip), ale hláškou appky.

const ZIP_LOCAL = [0x50, 0x4b, 0x03, 0x04];
const ZIP_END = [0x50, 0x4b, 0x05, 0x06];
const ZIP_END_SIZE = 22;
const ZIP_MAX_COMMENT = 0xffff;
const PDF_HEADER = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-
const PDF_HEADER_WINDOW = 1024;
const PDF_EOF = [0x25, 0x25, 0x45, 0x4f, 0x46]; // %%EOF

const matchesAt = (data: Uint8Array, at: number, pattern: number[]) => pattern.every((byte, index) => data[at + index] === byte);

function lastIndexOf(data: Uint8Array, pattern: number[], from: number, to: number) {
  for (let at = Math.min(from, data.length - pattern.length); at >= to; at -= 1) if (matchesAt(data, at, pattern)) return at;
  return -1;
}

function indexOf(data: Uint8Array, pattern: number[], to: number) {
  for (let at = 0; at <= Math.min(to, data.length - pattern.length); at += 1) if (matchesAt(data, at, pattern)) return at;
  return -1;
}

/** Hlavička `%PDF-` v prvom kilobajte a aspoň jeden `%%EOF` (hľadá sa od konca, platný súbor ho má hneď tam). */
function unreadablePdf(data: Uint8Array) {
  return indexOf(data, PDF_HEADER, PDF_HEADER_WINDOW) < 0 || lastIndexOf(data, PDF_EOF, data.length, 0) < 0;
}

/** ZIP (DOCX/XLSX/PPTX) začína lokálnou hlavičkou a končí záznamom centrálneho adresára. */
function unreadableZip(data: Uint8Array) {
  if (!matchesAt(data, 0, ZIP_LOCAL)) return true;
  return lastIndexOf(data, ZIP_END, data.length - ZIP_END_SIZE, Math.max(0, data.length - ZIP_END_SIZE - ZIP_MAX_COMMENT)) < 0;
}

const CHECKS: Record<string, (data: Uint8Array) => boolean> = {
  pdf: unreadablePdf,
  docx: unreadableZip,
  xlsx: unreadableZip,
  pptx: unreadableZip,
};

/** `true`, keď súbor podľa prípony isto nejde zobraziť; pre neznáme typy vždy `false`. */
export function unreadableFile(name: string, content: ArrayBuffer) {
  const check = CHECKS[name.toLowerCase().split(".").pop() ?? ""];
  return check ? check(new Uint8Array(content)) : false;
}
