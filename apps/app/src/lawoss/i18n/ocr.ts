/**
 * LAWOSS: oznam o stiahnutí modelu rozpoznávania textu pri prvom použití
 * (`apps/server/src/lawoss/ocr-on-demand.ts`, zobrazuje `lawoss/domains/reviews/ocr-download-hint.tsx`).
 */
export const ocrEn = {
  "lawoss.ocr.downloading": "LAWOSS is downloading the text recognition model for scanned pages, once: about {size} MB from huggingface.co (PaddlePaddle). Scanned pages are then read on this computer. The review continues on its own.",
  "lawoss.ocr.download_failed": "The text recognition model could not be downloaded from huggingface.co. Check the internet connection and free disk space, then run the review again. Scanned pages were not read; the documents themselves are unchanged.",
};

export const ocrSk = {
  "lawoss.ocr.downloading": "LAWOSS jednorazovo sťahuje model na rozpoznávanie textu naskenovaných strán: asi {size} MB z huggingface.co (PaddlePaddle). Potom sa naskenované strany čítajú priamo na tomto počítači. Kontrola pokračuje sama.",
  "lawoss.ocr.download_failed": "Model na rozpoznávanie textu sa nepodarilo stiahnuť z huggingface.co. Skontrolujte pripojenie na internet a voľné miesto na disku a spustite kontrolu znova. Naskenované strany sa neprečítali, samotné dokumenty ostali nezmenené.",
} satisfies Record<keyof typeof ocrEn, string>;

export const ocrCs = {
  "lawoss.ocr.downloading": "LAWOSS jednorázově stahuje model pro rozpoznávání textu naskenovaných stran: asi {size} MB z huggingface.co (PaddlePaddle). Naskenované strany se pak čtou přímo na tomto počítači. Kontrola pokračuje sama.",
  "lawoss.ocr.download_failed": "Model pro rozpoznávání textu se nepodařilo stáhnout z huggingface.co. Zkontrolujte připojení k internetu a volné místo na disku a spusťte kontrolu znovu. Naskenované strany se nepřečetly, samotné dokumenty zůstaly beze změny.",
} satisfies Record<keyof typeof ocrEn, string>;

export const ocrDe = {
  "lawoss.ocr.downloading": "LAWOSS lädt einmalig das Texterkennungsmodell für gescannte Seiten herunter: etwa {size} MB von huggingface.co (PaddlePaddle). Gescannte Seiten werden danach direkt auf diesem Computer gelesen. Die Prüfung läuft von selbst weiter.",
  "lawoss.ocr.download_failed": "Das Texterkennungsmodell konnte nicht von huggingface.co heruntergeladen werden. Prüfen Sie die Internetverbindung und den freien Speicherplatz und starten Sie die Prüfung erneut. Gescannte Seiten wurden nicht gelesen, die Dokumente selbst sind unverändert.",
} satisfies Record<keyof typeof ocrEn, string>;
