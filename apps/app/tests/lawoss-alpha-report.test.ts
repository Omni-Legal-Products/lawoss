import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { canSubmitReport, formatReportBytes, initialReportForm, reportErrorKey, toReport } from "../src/lawoss/alpha-report/model";
import { alphaReportStore, closeAlphaReport, openAlphaReport } from "../src/lawoss/alpha-report/store";
import { alphaReportCs, alphaReportDe, alphaReportEn, alphaReportSk } from "../src/lawoss/i18n/alpha-report";

const source = (file: string) => readFileSync(join(import.meta.dir, "..", file), "utf8");
const session = { id: 3, screenshot: null, server: "lawoss.app" };
let detach: (() => void) | null = null;
afterEach(() => { closeAlphaReport(async () => undefined); detach?.(); detach = null; });

describe("okno Nahlásiť chybu alebo nápad", () => {
  test("predvolene je diagnostika zaškrtnutá a snímka nie; popis má minimum servera", () => {
    const form = initialReportForm();
    expect(form.includeDiagnostics).toBe(true);
    expect(form.includeScreenshot).toBe(false);
    expect(canSubmitReport({ ...form, what: "  abc " })).toBe(false);
    expect(canSubmitReport({ ...form, what: "Spadlo" })).toBe(true);
  });

  test("závažnosť a opakovanie idú len pri chybe", () => {
    const bug = toReport({ ...initialReportForm(), what: " Spadlo ", severity: "blokuje", repeat: "vzdy", contact: " a@b.sk " });
    expect(bug).toEqual({ kind: "chyba", severity: "blokuje", repeat: "vzdy", what: "Spadlo", outcome: "", contact: "a@b.sk", includeDiagnostics: true, includeScreenshot: false });
    const idea = toReport({ ...initialReportForm(), kind: "vylepsenie", what: "Export", severity: "blokuje", repeat: "vzdy" });
    expect("severity" in idea).toBe(false);
    expect("repeat" in idea).toBe(false);
  });

  test("každý kód chyby má vetu vo všetkých jazykoch, neznámy kód všeobecnú", () => {
    for (const code of ["rate_limited", "too_large", "consent", "invalid", "file_type", "too_many_files", "storage_failed", "bad_request", "server", "timeout", "network", "diagnostics"]) {
      const key = reportErrorKey(code);
      expect(key).toBe(`lawoss.report.error_${code}` as typeof key);
      for (const dict of [alphaReportEn, alphaReportSk, alphaReportCs, alphaReportDe]) expect(dict[key]).toBeTruthy();
    }
    expect(reportErrorKey("<script>")).toBe("lawoss.report.error_unknown");
    expect(Object.keys(alphaReportSk).sort()).toEqual(Object.keys(alphaReportEn).sort());
    for (const dict of [alphaReportEn, alphaReportSk, alphaReportCs, alphaReportDe]) {
      for (const value of Object.values(dict)) expect(value).not.toMatch(/[\u2013\u2014]/);
    }
  });

  test("veľkosť diagnostiky podľa jazyka", () => {
    expect(formatReportBytes(512, "sk")).toBe("512 B");
    expect(formatReportBytes(1536 * 1024, "sk")).toBe("1,5 MB");
    expect(formatReportBytes(1536 * 1024, "en")).toBe("1.5 MB");
  });

  test("bez hostiteľa alebo mimo desktopu ostáva webový formulár", async () => {
    let web = 0;
    expect(await openAlphaReport({ desktop: true, prepare: async () => session, openWeb: async () => { web++; } })).toBe("web");
    detach = alphaReportStore.attachHost();
    expect(await openAlphaReport({ desktop: false, prepare: async () => session, openWeb: async () => { web++; } })).toBe("web");
    expect(web).toBe(2);
    expect(alphaReportStore.snapshot()).toBeNull();
  });

  test("s hostiteľom hlavný proces pripraví snímku a okno sa otvorí; druhé otvorenie počká", async () => {
    detach = alphaReportStore.attachHost();
    expect(await openAlphaReport({ desktop: true, prepare: async () => session, openWeb: async () => undefined })).toBe("window");
    expect(alphaReportStore.snapshot()).toEqual(session);
    expect(await openAlphaReport({ desktop: true, prepare: async () => session, openWeb: async () => undefined })).toBe("busy");
    const discarded: number[] = [];
    closeAlphaReport(async (id) => { discarded.push(id); });
    expect(discarded).toEqual([3]);
    expect(alphaReportStore.snapshot()).toBeNull();
  });

  test("zlyhaná príprava v hlavnom procese ponúkne web; zlyhá aj web, appka to oznámi", async () => {
    detach = alphaReportStore.attachHost();
    expect(await openAlphaReport({ desktop: true, prepare: async () => { throw new Error("IPC"); }, openWeb: async () => undefined })).toBe("web");
    expect(await openAlphaReport({ desktop: true, prepare: async () => { throw new Error("IPC"); }, openWeb: async () => { throw new Error("no browser"); } })).toBe("failed");
  });

  test("okno sa otvára z bočného panela, chybovej obrazovky pri štarte a z menu Pomocník", () => {
    expect(source("src/lawoss/lite/sidebar-footer.tsx")).toContain("onReport={() => void requestAlphaReport(locale)}");
    expect(source("src/react-app/shell/loading-overlay.tsx")).toContain("requestAlphaReport(currentLocale())");
    expect(source("src/react-app/shell/providers.tsx")).toContain("<AlphaReportHost />");
    expect(source("src/lawoss/alpha-report/report-dialog.tsx")).toContain("window.addEventListener(ALPHA_REPORT_OPEN_EVENT, open)");
    expect(source("../desktop/electron/preload.cjs")).toContain('const LAWOSS_ALPHA_REPORT_OPEN_EVENT = "lawoss:alpha-report:open";');
  });

  test("renderer nič neposiela na internet sám, odosiela hlavný proces", () => {
    const dialog = source("src/lawoss/alpha-report/report-dialog.tsx");
    expect(dialog).not.toMatch(/\bfetch\(|XMLHttpRequest|lawoss\.app\/api/);
    expect(dialog).toContain("desktopBridge.lawossAlphaReportSubmit");
  });
});
