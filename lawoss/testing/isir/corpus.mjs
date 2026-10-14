import { createHash } from "node:crypto";
import { readFile, realpath } from "node:fs/promises";
import { basename, dirname, isAbsolute, relative, resolve, sep } from "node:path";

export const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");

// A complete, small PDF, so offline tests exercise binary documents as well as
// filenames. Live acceptance uses originals downloaded from ISIR instead.
export function syntheticPdf(label) {
  const stream = `BT /F1 12 Tf 36 72 Td (${label}) Tj ET`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 120] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    `<< /Length ${Buffer.byteLength(stream)} >>\nstream\n${stream}\nendstream`,
  ];
  let text = "%PDF-1.4\n";
  const offsets = [0];
  for (const [index, object] of objects.entries()) {
    offsets.push(Buffer.byteLength(text));
    text += `${index + 1} 0 obj\n${object}\nendobj\n`;
  }
  const xref = Buffer.byteLength(text);
  text += `xref\n0 6\n0000000000 65535 f \n${offsets.slice(1).map(offset => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}

/** No real debtor identifiers or document contents belong in committed fixtures. */
export async function loadISIRCorpus(manifestPath = process.env.LAWOSS_ISIR_CORPUS) {
  if (!manifestPath) return {
    mode: "synthetic",
    cases: Array.from({ length: 10 }, (_, index) => ({
      id: `case-${String(index + 1).padStart(2, "0")}`,
      documents: [
        { name: "Usnesení (A-1) — originál.pdf", bytes: syntheticPdf(`SYNTHETIC case ${index + 1} A-1`) },
        { name: "Zpráva správce [B-2].pdf", bytes: syntheticPdf(`SYNTHETIC case ${index + 1} B-2`) },
      ],
    })),
  };
  const root = await realpath(dirname(resolve(manifestPath)));
  const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
  if (manifest.version !== 1 || manifest.source !== "ISIR" || !Array.isArray(manifest.cases) || manifest.cases.length !== 10) {
    throw new Error("ISIR acceptance requires a version 1 manifest containing ten cases");
  }
  const cases = [];
  const ids = new Set();
  for (const entry of manifest.cases) {
    if (!/^case-\d{2}$/.test(entry.id) || ids.has(entry.id) || !Array.isArray(entry.documents) || entry.documents.length < 2) throw new Error("Invalid or duplicate ISIR case");
    ids.add(entry.id);
    const documents = [];
    for (const document of entry.documents) {
      if (typeof document.name !== "string" || !document.name || basename(document.name) !== document.name || /[\\\x00-\x1f]/.test(document.name)) throw new Error("Invalid ISIR document name");
      if (typeof document.path !== "string" || isAbsolute(document.path)) throw new Error("Invalid ISIR document path");
      const sourcePath = await realpath(resolve(root, document.path));
      const child = relative(root, sourcePath);
      if (!child || isAbsolute(child) || child === ".." || child.startsWith(`..${sep}`)) throw new Error("ISIR document escapes the corpus");
      const bytes = await readFile(sourcePath);
      if (bytes.length !== document.bytes || sha256(bytes) !== document.sha256 || !bytes.subarray(0, 5).equals(Buffer.from("%PDF-"))) throw new Error("ISIR document integrity check failed");
      documents.push({ name: document.name, bytes, sourcePath });
    }
    cases.push({ id: entry.id, documents });
  }
  return { mode: "live-snapshot", cases };
}
