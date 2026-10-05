/**
 * LAWOSS: lokálny model rozpoznávania textu sa sťahuje až pri prvom skutočnom použití.
 *
 * Rozhodnutie MČ 5. 10. 2026: appka nerobí sieťové spojenia bez akcie používateľa.
 * Upstream pri každom štarte servera spúšťal `OcrManager.downloadDefaultIfNeeded()`
 * (sťahovanie z huggingface.co). LAWOSS ho predvolene vypína (`autoDownloadOcr`
 * v `apps/server/src/config.ts`, zapnúť ho dá len používateľ premennou prostredia
 * `LEGALWORK_OCR_AUTO_DOWNLOAD` alebo voľbou `autoDownloadOcr` v konfigurácii servera) a rýchly lokálny model
 * stiahne až príprava dokumentu, ktorá ho naozaj potrebuje: revízia so skenom,
 * hľadanie v naskenovaných PDF, korpus alebo nástroj agenta
 * (`apps/server/src/document-preparation/service.ts`, `snapshot()` a `run()`).
 *
 * Sťahuje sa len rýchly model (`pp-ocrv6-small`) a model rozloženia dokumentu, ktorý
 * upstream inštaluje v tom istom kroku. Kvalitný model (asi 1,8 GB) sa nikdy
 * nesťahuje sám; jeho výber v nastaveniach vyžaduje, aby už bol stiahnutý.
 * Stráž: `lawoss/scripts/check-no-eigenwelt.mjs`.
 */
import { ApiError } from "../errors.js";
import type { OcrManager } from "../ocr/manager.js";
import { layoutModelAsset, smallModelAssets } from "../ocr/models.js";
import type { LocalEngineSettings } from "../ocr/settings.js";

const megabytes = (bytes: number) => Math.round(bytes / 1_000_000);
export const OCR_MODEL_BYTES = smallModelAssets.reduce((total, asset) => total + asset.bytes, 0);
export const OCR_LAYOUT_BYTES = layoutModelAsset.bytes;

/** Text pre agenta a záznam prípravy. Appka ukazuje preložený text (`lawoss.ocr.*`). */
export const OCR_DOWNLOAD_NOTICE = `LAWOSS is downloading the text recognition model once: about ${megabytes(OCR_MODEL_BYTES)} MB for text recognition and ${megabytes(OCR_LAYOUT_BYTES)} MB for document layout, from huggingface.co (PaddlePaddle). Scanned pages are then read on this computer.`;
export const OCR_DOWNLOAD_FAILED = "The text recognition model could not be downloaded from huggingface.co. Check the internet connection and free disk space, then run it again. Scanned pages were not read; the document itself is unchanged.";
const NOT_READY = "Download the selected OCR model in Settings → AI Providers, then retry the review.";
const LOCAL_SETUP_IDS = ["local-fast", "local-layout"];
const POLL_MS = 500;
/** Ako dlho čakať, kým iná operácia OCR (test, iná inštalácia) uvoľní miesto. */
const BUSY_LIMIT_MS = 5 * 60_000;

export type FirstUseDownload = { notice: string; wait: (signal: AbortSignal) => Promise<void> };

const sleep = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
const busyError = (error: unknown) => error instanceof ApiError && (error.code === "ocr_busy" || error.code === "ocr_install_busy");

/** Jedno sťahovanie na server; súbežné prípravy čakajú na to isté. */
const pending = new WeakMap<OcrManager, Promise<void>>();

async function downloadAndWait(ocr: OcrManager, engineId: string, model: LocalEngineSettings["model"]) {
  let started = false;
  const since = Date.now();
  for (;;) {
    if (!ocr.runtime.busy) {
      if (await ocr.runtime.ready(model)) return;
      if (started) throw new ApiError(502, "ocr_download_failed", OCR_DOWNLOAD_FAILED);
      try {
        // Prvé použitie je akcia používateľa: rovnaká cesta ako tlačidlo v nastaveniach.
        await ocr.install(engineId);
        started = true;
      } catch (error) {
        if (!busyError(error)) throw error;
        if (Date.now() - since > BUSY_LIMIT_MS) throw new ApiError(409, "ocr_busy", "Wait for the current OCR operation to finish.");
      }
    } else if (LOCAL_SETUP_IDS.includes(ocr.runtime.installation?.engineId ?? "")) {
      // Sťahovanie už beží (napríklad z nastavení); po ňom stačí overiť pripravenosť.
      started = true;
    }
    await sleep(POLL_MS);
  }
}

function abortable(work: Promise<void>, signal: AbortSignal) {
  signal.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => reject(signal.reason);
    signal.addEventListener("abort", abort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener("abort", abort));
  });
}

/**
 * Pre nepripravený lokálny model vráti sťahovanie pri prvom použití. Keď sa model
 * stiahnuť nedá (kvalitný model, chýba pribalený runtime), vyhodí pôvodnú chybu upstreamu.
 * Zrušenie prípravy len prestane čakať; začaté sťahovanie dobehne, aby sa nezačínalo znova.
 */
export async function firstUseOcrDownload(ocr: OcrManager, engine: LocalEngineSettings): Promise<FirstUseDownload> {
  if (engine.model !== "pp-ocrv6-small" || !await ocr.runtime.available()) throw new ApiError(400, "ocr_not_ready", NOT_READY);
  return {
    notice: OCR_DOWNLOAD_NOTICE,
    wait: signal => {
      let work = pending.get(ocr);
      if (!work) {
        work = downloadAndWait(ocr, engine.id, engine.model).finally(() => pending.delete(ocr));
        pending.set(ocr, work);
      }
      return abortable(work, signal);
    },
  };
}

/** Text chyby pre dokumenty, ktorých príprava čakala na model. */
export const firstUseFailure = (error: unknown) => error instanceof ApiError ? error.message : OCR_DOWNLOAD_FAILED;
