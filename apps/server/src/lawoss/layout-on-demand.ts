/**
 * LAWOSS: rozloženie strany (PP-DocLayoutV3) len na požiadanie.
 *
 * Rozhodnutie MČ 8. 11. 2026 (limit RAM 2 GB, issue #367): model rozloženia má pri behu
 * špičku okolo 1 GB, spolu so zvyškom appky sa do limitu nezmestí. Automatická príprava
 * dokumentu preto číta naskenované strany len rozpoznávaním textu (PP-OCR, asi 0,36 GB)
 * a model rozloženia nenačíta. Rozloženie (tabuľky, stĺpce, bloky) sa spustí, až keď
 * príprava výslovne žiada `layout: true` pre daný dokument: v appke tlačidlo
 * „Spracovať aj rozloženie strany“ pri rozpoznaných stranách v kontrole
 * (`apps/app/src/lawoss/domains/reviews/layout-on-demand.tsx`).
 *
 * Strana bez rozloženia nemá pole `structure` (rovnako ako strana s vlastným textom).
 * Kľúč prípravy sa nemení, takže dodatočné rozloženie použije už rozpoznaný text
 * a OCR znova nespúšťa. Sťahovanie modelov ostáva bez zmeny.
 */
import type { PageStructure } from "@legalwork/types/document-structure";
import type { OcrContent } from "../ocr/types.js";
import { pageReviewReasons, unavailableStructure } from "../document-preparation/structure.js";

type PreparedPage = { status: "complete" | "needs-review" | "error"; ocr: unknown; structure?: Pick<PageStructure, "status"> };

/** Is this page finished for this request? With `layout`, every OCR page also needs its layout. */
export function pagePrepared(page: PreparedPage, layout: boolean) {
  if (page.status === "error" || page.structure?.status === "unavailable") return false;
  return !layout || page.ocr === null || page.structure !== undefined;
}

/** Why a page read by OCR without layout needs review. Missing layout itself is not a reason. */
export function textOnlyReviewReasons({ nativeText, ocr }: { nativeText: string; ocr: Pick<OcrContent, "text" | "regions" | "truncated"> }) {
  // Without layout a blank page cannot be told from an unread one, so it keeps "no-text".
  return pageReviewReasons({ nativeText, ocr, structure: { ...unavailableStructure(), issues: [] } });
}
