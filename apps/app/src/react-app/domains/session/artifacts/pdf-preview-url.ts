/** Override PDFium's remembered sidebar state only when opening the document. */
export function pdfPreviewUrl(url: string, page?: number, readingMode?: boolean): string {
  const parsed = new URL(url);
  const params = new URLSearchParams(parsed.hash.slice(1));
  params.set("navpanes", "0");
  if (readingMode !== undefined) {
    params.set("toolbar", readingMode ? "0" : "1");
    if (!params.has("zoom") && !params.has("view")) params.set("view", "FitH");
  }
  if (page !== undefined) params.set("page", String(page));
  parsed.hash = params.toString();
  return parsed.toString();
}
