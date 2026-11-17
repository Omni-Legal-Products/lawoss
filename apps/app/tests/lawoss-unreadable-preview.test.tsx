import { describe, expect, it } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { deflateRawSync } from "node:zlib";
import { setLocale } from "../src/i18n";
import { unreadableFile } from "../src/lawoss/domains/artifacts/unreadable-file";
import { UnreadableFileNotice } from "../src/lawoss/domains/artifacts/unreadable-file-notice";

// #492: syntetické bajty podľa E017 (0 B PDF), E018 (PDF skrátené v strede objektu), E020 (DOCX bez centrálneho adresára).
const bytes = (text: string) => new TextEncoder().encode(text).buffer;
const PDF = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF\n";

function zip(names: string[]) {
  const parts: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const name of names) {
    const data = deflateRawSync(Buffer.from("<x/>"));
    const local = Buffer.alloc(30); local.writeUInt32LE(0x04034b50, 0); local.writeUInt16LE(8, 8); local.writeUInt32LE(data.length, 18); local.writeUInt16LE(name.length, 26);
    const entry = Buffer.alloc(46); entry.writeUInt32LE(0x02014b50, 0); entry.writeUInt16LE(8, 10); entry.writeUInt32LE(data.length, 20); entry.writeUInt16LE(name.length, 28); entry.writeUInt32LE(offset, 42);
    parts.push(local, Buffer.from(name), data);
    central.push(entry, Buffer.from(name));
    offset += 30 + name.length + data.length;
  }
  const directory = Buffer.concat(central);
  const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(names.length, 8); end.writeUInt16LE(names.length, 10); end.writeUInt32LE(directory.length, 12); end.writeUInt32LE(offset, 16);
  const whole = Buffer.concat([...parts, directory, end]);
  return whole.buffer.slice(whole.byteOffset, whole.byteOffset + whole.byteLength);
}

describe("rozpoznanie nečitateľného súboru (#492)", () => {
  it("prázdne a skrátené PDF sú nečitateľné, celé PDF nie", () => {
    expect(unreadableFile("prazdny.pdf", new ArrayBuffer(0))).toBe(true);
    expect(unreadableFile("skratene.pdf", bytes(PDF.slice(0, 60)))).toBe(true);
    expect(unreadableFile("text.pdf", bytes("toto nie je pdf"))).toBe(true);
    expect(unreadableFile("zmluva.pdf", bytes(PDF))).toBe(false);
    expect(unreadableFile("zmluva.pdf", bytes(`${PDF}\n\n`))).toBe(false);
  });

  it("DOCX/XLSX/PPTX bez konca ZIP sú nečitateľné, celý balík nie", () => {
    const docx = zip(["[Content_Types].xml", "word/document.xml"]);
    expect(unreadableFile("poskodene.docx", docx.slice(0, Math.floor(docx.byteLength / 2)))).toBe(true);
    expect(unreadableFile("prazdny.xlsx", new ArrayBuffer(0))).toBe(true);
    expect(unreadableFile("zmluva.docx", docx)).toBe(false);
    expect(unreadableFile("tabulka.xlsx", docx)).toBe(false);
    expect(unreadableFile("poznamka.txt", new ArrayBuffer(0))).toBe(false);
  });
});

describe("hláška v paneli (#492)", () => {
  it("je v jazyku appky a ponúka otvorenie inde, nie surovú chybu", () => {
    setLocale("sk");
    const html = renderToStaticMarkup(<UnreadableFileNotice onOpenExternal={() => undefined} onReveal={() => undefined} />);
    expect(html).toContain("Súbor sa nedá zobraziť");
    expect(html).toContain("prázdny alebo poškodený");
    expect(html).toContain("Otvoriť v inej aplikácii");
    expect(html).toContain("Zobraziť v priečinku");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("Failed to load");
  });

  it("bez akcií (napr. vzdialený priečinok) ostane len hláška", () => {
    setLocale("cs");
    const html = renderToStaticMarkup(<UnreadableFileNotice />);
    expect(html).toContain("Soubor nelze zobrazit");
    expect(html).not.toContain("<button");
  });

});
