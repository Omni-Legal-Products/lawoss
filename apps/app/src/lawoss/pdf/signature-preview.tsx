import { useState, type ComponentProps } from "react";
import { SlidersHorizontal } from "lucide-react";
import { t } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { PdfPreview } from "@/react-app/domains/session/artifacts/preview";
import { PdfSignatureBadge } from "./signature-badge";
import "./reader.css";

export function PdfSignaturePreview({ bytes, visible = true, ...viewer }: ComponentProps<typeof PdfPreview> & {
  bytes: ArrayBuffer;
  visible?: boolean;
}) {
  useLocale();
  const [tools, setTools] = useState(false);
  // PDFium supports the toolbar fragment. WebKit supplies its own PDF controls.
  const pdfium = typeof navigator !== "undefined" && /(?:Chrome|Chromium)\//.test(navigator.userAgent);
  return <section aria-label={viewer.title} className="lawoss-pdf-reader">
    <div className="lawoss-pdf-ribbon">
      <PdfSignatureBadge bytes={bytes} visible={visible} />
      {pdfium && <button type="button" className="lawoss-pdf-tools" aria-pressed={tools}
        title={t("lawoss.pdf_reader.tools")} onClick={() => setTools(value => !value)}>
        <SlidersHorizontal aria-hidden="true"/><span>{t("lawoss.pdf_reader.tools")}</span>
      </button>}
    </div>
    <PdfPreview {...viewer} readingMode={pdfium ? !tools : undefined} className="lawoss-pdf-page" />
  </section>;
}
