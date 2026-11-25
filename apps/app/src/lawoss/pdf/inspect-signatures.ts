import { MAX_PDF_INSPECTION_BYTES, unavailable, type PdfSignatureReport } from "./signature-report";

export { MAX_PDF_INSPECTION_BYTES, type PdfEmbeddedSignature, type PdfSignatureReport } from "./signature-report";

/** Inspect a private copy. The preview retains ownership of its exact file bytes. */
export async function inspectPdfSignatures(bytes: Uint8Array, signal?: AbortSignal): Promise<PdfSignatureReport> {
  signal?.throwIfAborted();
  if (bytes.length > MAX_PDF_INSPECTION_BYTES) return unavailable("too_large");
  if (!bytes.length) return unavailable("malformed");
  const worker = new Worker(new URL("./signature-parser.worker.ts", import.meta.url), { type: "module" });
  let timer: ReturnType<typeof setTimeout> | undefined;
  let abort: (() => void) | undefined;
  try {
    return await new Promise<PdfSignatureReport>((resolve, reject) => {
      timer = setTimeout(() => resolve(unavailable("limit")), 15_000);
      abort = () => reject(signal?.reason);
      signal?.addEventListener("abort", abort, { once: true });
      worker.onmessage = (event: MessageEvent<PdfSignatureReport>) => resolve(event.data);
      worker.onerror = () => resolve(unavailable("malformed"));
      worker.onmessageerror = () => resolve(unavailable("malformed"));
      const copy = Uint8Array.from(bytes);
      worker.postMessage(copy, [copy.buffer]);
    });
  } finally {
    worker.terminate();
    clearTimeout(timer);
    if (abort) signal?.removeEventListener("abort", abort);
  }
}
