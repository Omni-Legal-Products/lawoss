import type { ComponentProps } from "react";
import { PdfPreview } from "@/react-app/domains/session/artifacts/preview";
import { PdfSignatureBadge } from "./signature-badge";

export function PdfSignaturePreview({ bytes, visible = true, ...viewer }: ComponentProps<typeof PdfPreview> & {
  bytes: ArrayBuffer;
  visible?: boolean;
}) {
  return <div className="flex h-full min-h-0 flex-col">
    <PdfSignatureBadge bytes={bytes} visible={visible} />
    <PdfPreview {...viewer} className="min-h-0 flex-1" />
  </div>;
}
