/**
 * LAWOSS: rozpoznávanie textu zo skenov (OCR) je voľba, ktorú advokát výslovne zapne.
 *
 * Rozhodnutie MČ 5. 10. 2026: model OCR sa nesmie stiahnuť automaticky, ani pri prvom
 * použití. Kým advokát v Nastaveniach → Poskytovatelia AI nezapne „Rozpoznávanie textu zo skenov (OCR)“:
 * - server nič nesťahuje (`LawossOcrManager` blokuje `install()` aj `downloadDefaultIfNeeded()`
 *   pre route nastavení, štart servera aj prípravu dokumentu);
 * - príprava dokumentu číta len vlastnú textovú vrstvu PDF, nespúšťa model rozloženia ani OCR
 *   a naskenované strany označí oznamom `OCR_DISABLED` (`document-preparation/service.ts`);
 * - to platí aj pre už stiahnutý model a pre vlastný OCR server: vypnuté znamená vypnuté.
 *
 * Po zapnutí sa model stiahne tlačidlom v nastaveniach alebo pri prvej príprave naskenovaného
 * dokumentu (`ocr-on-demand.ts`). Voľba je samostatný súbor v priečinku OCR, upstream
 * `settings.json` ostáva nezmenený. Stráž: `lawoss/scripts/check-no-eigenwelt.mjs` (bod 6).
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { OcrSettingsView } from "@legalwork/types/ocr";
import { ApiError } from "../errors.js";
import type { ServerConfig } from "../types.js";
import { addRoute, type RequestContext, type Route } from "../routes/registry.js";
import { OcrManager } from "../ocr/manager.js";
import { layoutModelAsset, smallModelAssets } from "../ocr/models.js";
import { OcrService } from "../ocr/service.js";
import type { OcrEngine } from "../ocr/types.js";

export const OCR_OPT_IN_FILE = "lawoss-ocr.json";
export const OCR_DISABLED_CODE = "ocr_disabled";
/** Text pre agenta a záznam prípravy; kód v hranatých zátvorkách rozpozná appka a ukáže preklad. */
export const OCR_DISABLED = `Text recognition from scans (OCR) is off. Scanned pages were not read; only the document's own text layer was used. To read scans, turn on Settings → AI Providers → Text recognition from scans (OCR). [${OCR_DISABLED_CODE}]`;
const DOWNLOAD_REFUSED = "Text recognition from scans (OCR) is off. Turn it on in Settings → AI Providers → Text recognition from scans (OCR) before downloading the model.";
export const OCR_MODEL_SOURCE = "huggingface.co (PaddlePaddle)";
export const OCR_MODEL_BYTES = smallModelAssets.reduce((total, asset) => total + asset.bytes, 0);
export const OCR_LAYOUT_BYTES = layoutModelAsset.bytes;

const enabledIn = (text: string) => {
  const value: unknown = JSON.parse(text);
  return typeof value === "object" && value !== null && Reflect.get(value, "enabled") === true;
};
export async function ocrEnabled(root: string): Promise<boolean> {
  try { return enabledIn(await readFile(join(root, OCR_OPT_IN_FILE), "utf8")); } catch { return false; }
}
function ocrEnabledNow(root: string) {
  try { return enabledIn(readFileSync(join(root, OCR_OPT_IN_FILE), "utf8")); } catch { return false; }
}

export async function requireOcrEnabled(root: string) {
  if (!await ocrEnabled(root)) throw new ApiError(403, OCR_DISABLED_CODE, DOWNLOAD_REFUSED);
}

export async function writeOcrEnabled(root: string, enabled: boolean) {
  await mkdir(root, { recursive: true, mode: 0o700 });
  const target = join(root, OCR_OPT_IN_FILE), temporary = `${target}.${randomUUID()}.tmp`;
  try {
    await writeFile(temporary, `${JSON.stringify({ version: 1, enabled, changedAt: new Date().toISOString() }, null, 2)}\n`, { mode: 0o600, flag: "wx" });
    await rename(temporary, target);
  } finally { await rm(temporary, { force: true }); }
}

/** OcrManager servera: bez zapnutej voľby nič nesťahuje, ani na žiadosť z nastavení či prípravy. */
export class LawossOcrManager extends OcrManager {
  override async install(id: string, automatic = false) {
    await requireOcrEnabled(this.runtime.root);
    return super.install(id, automatic);
  }
  /** Volá sa pri štarte servera len so zapnutým `autoDownloadOcr`; bez zapnutého OCR nič neplánuje. */
  override downloadDefaultIfNeeded() {
    return ocrEnabledNow(this.runtime.root) ? super.downloadDefaultIfNeeded() : Promise.resolve();
  }
}

/** Príprava bez OCR: jediný „engine“ nikdy nečíta obraz, strany berú len vlastnú textovú vrstvu. */
const textLayer: OcrEngine = {
  info: { id: "lawoss-text-layer", label: "Text layer only (OCR off)", execution: "local", model: "none", regions: false, languages: null, warnings: [] },
  async recognize() { throw new ApiError(403, OCR_DISABLED_CODE, OCR_DISABLED); },
};
export function textLayerSnapshot() {
  return { service: new OcrService([textLayer], textLayer.info.id), fingerprint: "lawoss-text-layer-1", textOnly: true as const, notice: OCR_DISABLED, noticeCode: OCR_DISABLED_CODE };
}

export type LawossOcrView = {
  enabled: boolean;
  /** Veľkosť rýchleho modelu a modelu rozloženia v bajtoch a ich zdroj. */
  model: { textBytes: number; layoutBytes: number; source: string };
  settings: OcrSettingsView;
};

export async function lawossOcrView(ocr: OcrManager, readOnly: boolean): Promise<LawossOcrView> {
  return {
    enabled: await ocrEnabled(ocr.runtime.root),
    model: { textBytes: OCR_MODEL_BYTES, layoutBytes: OCR_LAYOUT_BYTES, source: OCR_MODEL_SOURCE },
    settings: await ocr.view(readOnly),
  };
}

/** Zapnutie nič nesťahuje. Vypnutie zastaví prebiehajúce sťahovanie; stiahnutý model ostáva, kým ho advokát neodstráni. */
export async function setOcrEnabled(ocr: OcrManager, enabled: boolean) {
  await writeOcrEnabled(ocr.runtime.root, enabled);
  if (!enabled && ocr.runtime.busy) await ocr.cancelInstall();
}

/** Stiahne rýchly model a model rozloženia; len so zapnutou voľbou (kontroluje aj `LawossOcrManager.install`). */
export async function downloadLocalOcrModel(ocr: OcrManager) {
  await requireOcrEnabled(ocr.runtime.root);
  if (!await ocr.runtime.ready("pp-ocrv6-small")) await ocr.install("local-fast");
  else if (!await ocr.runtime.layoutReady()) await ocr.install("local-layout");
}

/** Odstráni stiahnuté lokálne modely OCR; nastavenia a kľúče vlastných OCR serverov ostávajú. */
export async function removeLocalOcrModels(ocr: OcrManager) {
  if (ocr.runtime.busy) throw new ApiError(409, "ocr_busy", "Wait for the current OCR operation to finish.");
  const root = ocr.runtime.root;
  await rm(join(root, "models"), { recursive: true, force: true });
  await rm(join(root, "venv"), { recursive: true, force: true });
  for (const name of ["pp-ocrv6-small.ready", "paddleocr-vl-1.6.ready"]) await rm(join(root, name), { force: true });
}

/** `GET/PUT /lawoss/ocr`, `POST/DELETE /lawoss/ocr/model`: voľba, stiahnutie a odstránenie modelu (host token ako `/ocr/*`). */
export function registerLawossOcrRoutes(options: {
  routes: Route[];
  config: ServerConfig;
  ocr: OcrManager;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBodyLimited: (request: Request, maxBytes: number) => Promise<Record<string, unknown>>;
  ensureWritable: (config: ServerConfig) => void;
}) {
  const { routes, config, ocr, jsonResponse, readJsonBodyLimited, ensureWritable } = options;
  const route = (method: string, path: string, handler: (ctx: RequestContext) => Promise<unknown>) => {
    addRoute(routes, method, path, "host", async (ctx) => {
      if (method !== "GET") ensureWritable(config);
      return jsonResponse(await handler(ctx));
    });
  };
  route("GET", "/lawoss/ocr", () => lawossOcrView(ocr, config.readOnly));
  route("PUT", "/lawoss/ocr", async (ctx) => {
    const input = await readJsonBodyLimited(ctx.request, 1024);
    if (typeof input.enabled !== "boolean") throw new ApiError(400, "ocr_invalid_settings", "Send enabled: true or false.");
    await setOcrEnabled(ocr, input.enabled);
    return lawossOcrView(ocr, config.readOnly);
  });
  route("POST", "/lawoss/ocr/model", async () => { await downloadLocalOcrModel(ocr); return lawossOcrView(ocr, config.readOnly); });
  route("DELETE", "/lawoss/ocr/model", async () => { await removeLocalOcrModels(ocr); return lawossOcrView(ocr, config.readOnly); });
}
