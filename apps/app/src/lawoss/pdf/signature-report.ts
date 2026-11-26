export type PdfEmbeddedSignature = {
  kind: "signature" | "timestamp";
  fieldName?: string;
  subFilter?: string;
  signer?: string;
  issuer?: string;
  signedAt?: string;
};

export type PdfSignatureReport = {
  status: "inspected" | "partial" | "unavailable";
  signatures: PdfEmbeddedSignature[];
  emptyFields: number;
  issue?: "encrypted" | "malformed" | "too_large" | "limit" | "unsupported";
};

export const MAX_PDF_INSPECTION_BYTES = 32 * 1024 * 1024;

export function unavailable(issue: NonNullable<PdfSignatureReport["issue"]>): PdfSignatureReport {
  return { status: "unavailable", signatures: [], emptyFields: 0, issue };
}
