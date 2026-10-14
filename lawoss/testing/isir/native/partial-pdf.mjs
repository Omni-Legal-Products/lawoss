// Two actual PDF pages: one readable text layer and one blank scanned-page
// stand-in. The production extractor must report incomplete 1/2 coverage.
export function partialPdf() {
  const streams=["BT /F1 10 Tf 20 95 Td (SYNTHETIC evidence page contains native text and complete source provenance.) Tj 0 -16 Td (This readable paragraph has sufficient letters for the document preparation.) Tj 0 -16 Td (The following page intentionally has no text layer and must remain incomplete.) Tj ET", ""];
  const objects=[
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R 5 0 R] /Count 2 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 120] /Resources << /Font << /F1 7 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${Buffer.byteLength(streams[0])} >>\nstream\n${streams[0]}\nendstream`,
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 500 120] /Resources << /Font << /F1 7 0 R >> >> /Contents 6 0 R >>",
    "<< /Length 0 >>\nstream\n\nendstream",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];
  let text="%PDF-1.4\n";
  const offsets=[];
  for(const [i,object] of objects.entries()){offsets.push(Buffer.byteLength(text));text+=`${i+1} 0 obj\n${object}\nendobj\n`;}
  const xref=Buffer.byteLength(text);
  text+=`xref\n0 8\n0000000000 65535 f \n${offsets.map(offset=>`${String(offset).padStart(10,"0")} 00000 n \n`).join("")}trailer\n<< /Size 8 /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(text);
}
