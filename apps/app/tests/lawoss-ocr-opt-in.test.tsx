/**
 * LAWOSS: rozpoznávanie textu zo skenov (OCR) je voľba, ktorú advokát výslovne zapne
 * (MČ 5. 10. 2026). Bez nej nastavenia neponúknu stiahnutie, kontrola ukáže preložený
 * oznam o vypnutom OCR a recorder pri nahrávaní nesťahuje modely rečníkov.
 */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { renderToStaticMarkup } from "react-dom/server";
import type { OcrSettingsView } from "@legalwork/types/ocr";
import { OcrOptInPanel, ocrModelState } from "../src/lawoss/domains/settings/ocr-opt-in-section";
import { isOcrDisabledError, localizedDocumentError, type LawossOcrView } from "../src/lawoss/domains/settings/ocr-opt-in";

const settings = (patch: Partial<OcrSettingsView> = {}): OcrSettingsView => ({
  defaultEngineId: "local-fast", readOnly: false, installerAvailable: true, installation: null,
  layout: { model: "pp-doclayout-v3-onnx", bytes: 130_502_049, status: "not-installed" },
  engines: [
    { id: "local-fast", label: "Fast", kind: "local", model: "pp-ocrv6-small", languages: null, keyConfigured: false, status: "not-installed" },
    { id: "local-quality", label: "Quality", kind: "local", model: "paddleocr-vl-1.6", languages: null, keyConfigured: false, status: "not-installed" },
  ],
  ...patch,
});
const view = (enabled: boolean, patch: Partial<OcrSettingsView> = {}): LawossOcrView => ({
  enabled, model: { textBytes: 31_190_469, layoutBytes: 130_502_049, source: "huggingface.co (PaddlePaddle)" }, settings: settings(patch),
});
const noop = { toggle: () => {}, download: () => {}, cancel: () => {}, remove: () => {} };
const render = (value: LawossOcrView, locale: "sk" | "en" = "sk") =>
  renderToStaticMarkup(<OcrOptInPanel view={value} error={null} connected busy={false} locale={locale} actions={noop} />);
const ready = (status: "ready" | "not-installed") => ({
  layout: { model: "pp-doclayout-v3-onnx", bytes: 130_502_049, status },
  engines: settings().engines.map((engine) => engine.id === "local-fast" ? { ...engine, status } : engine),
});

describe("LAWOSS: OCR len po výslovnom zapnutí", () => {
  test("vypnuté: prepínač, vysvetlenie (lokálne, veľkosť, zdroj) a žiadne tlačidlo na stiahnutie", () => {
    const html = render(view(false));
    expect(html).toContain("Rozpoznávanie textu zo skenov (OCR)");
    expect(html).toContain('role="switch"');
    expect(html).toContain("huggingface.co (PaddlePaddle)");
    expect(html).toContain("asi 162 MB");
    expect(html).toContain("Stiahne sa až po zapnutí");
    expect(html).toContain("Nestiahnutý");
    expect(html).not.toContain("Stiahnuť model");
    expect(html).toContain("Tlačidlo na stiahnutie sa ukáže po zapnutí");
  });

  test("zapnuté: tlačidlo stiahnuť, po stiahnutí odstrániť; vypnuté so stiahnutým modelom ponúkne odstránenie", () => {
    expect(render(view(true))).toContain("Stiahnuť model (asi 162 MB)");
    const downloaded = render(view(true, ready("ready")));
    expect(downloaded).toContain("Stiahnutý");
    expect(downloaded).toContain("Odstrániť model");
    expect(downloaded).not.toContain("Stiahnuť model");
    const kept = render(view(false, ready("ready")));
    expect(kept).toContain("Odstrániť model");
    expect(kept).toContain("kým je OCR vypnuté, nepoužíva sa");
  });

  test("stav modelu: sťahovanie, zlyhanie, čiastočne stiahnutý", () => {
    expect(ocrModelState(view(true, { installation: { engineId: "local-fast", stage: "models" } }))).toBe("downloading");
    expect(ocrModelState(view(true, { installation: { engineId: "local-fast", stage: "failed" } }))).toBe("failed");
    expect(ocrModelState(view(false, { layout: { model: "pp-doclayout-v3-onnx", bytes: 1, status: "ready" } }))).toBe("partial");
    expect(ocrModelState(view(false))).toBe("missing");
    expect(render(view(true, { installation: { engineId: "local-fast", stage: "models" } }), "en")).toContain("Cancel");
  });

  test("chyba dokumentu pri vypnutom OCR sa zobrazí preložene, iné chyby ostanú", () => {
    const server = "Text recognition from scans (OCR) is off. Scanned pages were not read; only the document's own text layer was used. To read scans, turn on Settings → AI Providers → Text recognition from scans (OCR). [ocr_disabled]";
    expect(isOcrDisabledError(server)).toBe(true);
    expect(isOcrDisabledError("Could not prepare this document.")).toBe(false);
    expect(localizedDocumentError(server)).not.toContain("[ocr_disabled]");
    expect(localizedDocumentError("Could not prepare this document.")).toBe("Could not prepare this document.");
  });

  test("server a appka používajú ten istý kód vypnutého OCR", () => {
    const server = readFileSync(new URL("../../server/src/lawoss/ocr-opt-in.ts", import.meta.url), "utf8");
    expect(server).toContain('OCR_DISABLED_CODE = "ocr_disabled"');
    expect(server).toContain("[${OCR_DISABLED_CODE}]");
  });

  test("recorder nesťahuje modely rečníkov pri štarte appky ani pri nahrávaní", () => {
    const store = readFileSync(new URL("../src/react-app/domains/recorder/recorder-store.ts", import.meta.url), "utf8");
    expect(store).not.toMatch(/get\(\)\.ensureDiarizationReady\(\)/);
    expect(store.match(/get\(\)\.downloadDiarization\(\)/g)?.length ?? 0).toBeLessThanOrEqual(1);
  });
});
