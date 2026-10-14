import { loadISIRCorpus, syntheticPdf, sha256 } from "../corpus.mjs";

export async function loadNativeCorpus(manifestPath) {
  const corpus = await loadISIRCorpus(manifestPath);
  if (corpus.mode !== "synthetic") return corpus;
  for (const [index, entry] of corpus.cases.entries()) {
    entry.documents.push({ name: "Přihláška věřitele C-3.pdf", bytes: syntheticPdf(`SYNTHETIC case ${index + 1} C-3`) });
    entry.reference = {
      source: "ISIR", sampleOnly: true, company: `Synthetic company ${index + 1}`,
      caseNumber: `SYN ${index + 1}/2026`, sourceUrl: `https://isir.justice.cz/isir/synthetic/${index + 1}`,
      documents: entry.documents.map((d, i) => ({ file: `Dokumenty/${d.name}`, documentId: `SYN-${index + 1}-${i + 1}`, url: `https://isir.justice.cz/isir/document/SYN-${index + 1}-${i + 1}`, sha256: sha256(d.bytes) })),
    };
    if (index === 0) entry.documents.push({ ...entry.documents[0], name: "Usnesení (A-1) — originál (1).pdf", unlistedCopy: true });
  }
  return corpus;
}
