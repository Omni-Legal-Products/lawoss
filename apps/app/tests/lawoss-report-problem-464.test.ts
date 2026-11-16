import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { reportProblem } from "../src/lawoss/lite/report-problem";

const notifier = () => {
  const seen: Array<[string, string]> = [];
  return { seen, notify: { success: (message: string) => seen.push(["success", message]), error: (message: string) => seen.push(["error", message]) } };
};

describe("#464: Nahlásiť chybu alebo nápad", () => {
  test("otvorí formulár na webe v jazyku appky a oznámi to", async () => {
    const opened: string[] = [], { seen, notify } = notifier();
    expect(await reportProblem("sk", async (url) => { opened.push(url); }, notify)).toBe(true);
    expect(opened).toEqual(["https://lawoss.app/sk/alfa/hlasenie"]);
    expect(seen).toEqual([["success", "Formulár na nahlásenie sa otvoril v prehliadači (lawoss.app/sk/alfa/hlasenie)."]]);
    await reportProblem("cs", async (url) => { opened.push(url); }, notify);
    expect(opened.at(-1)).toBe("https://lawoss.app/cz/alfa/hlasenie");
  });

  test("zlyhané otvorenie prehliadača ukáže adresu formulára", async () => {
    const { seen, notify } = notifier();
    expect(await reportProblem("en", async () => { throw new Error("IPC failed"); }, notify)).toBe(false);
    expect(seen).toEqual([["error", "The browser could not be opened. The report form is at lawoss.app/en/alfa/hlasenie."]]);
  });

  test("desktop čaká na bezpečné otvorenie cez hlavný proces (openDesktopUrl)", () => {
    const source = readFileSync(join(import.meta.dir, "..", "src/lawoss/lite/sidebar-footer.tsx"), "utf8");
    expect(source).toContain("reportProblem(locale, isDesktopRuntime() ? openDesktopUrl : async (url) => platform.openLink(url), toast)");
  });
});
