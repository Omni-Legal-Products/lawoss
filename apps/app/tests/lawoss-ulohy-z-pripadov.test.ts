import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { t } from "../src/i18n";
import { matterTaskCount } from "../src/lawoss/lite/matter-tasks-notice";

// Prehliadka alfy 10. 11. 2026: Úlohy klienta hlásili „Žiadne úlohy“, Prehľad ukazoval 6 úloh z prípadov.

describe("poznámka o úlohách z prípadov nad zoznamom úloh klienta", () => {
  test("bez prehľadu alebo pri priestore, ktorý nie je klient, sa nič nepočíta", () => {
    expect(matterTaskCount(null, "ws", "2026-11-10")).toBe(0);
  });

  test("texty sú vo všetkých jazykoch a obsahujú počet", () => {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      expect(t("lawoss.lite.tasks_in_matters", locale, { count: 6 })).toContain("6");
      expect(t("lawoss.lite.tasks_in_matters_open", locale)).not.toContain("lawoss.");
    }
    expect(t("lawoss.lite.tasks_in_matters", "sk", { count: 6 })).toBe("Úlohy zapísané v prípadoch: 6. Tento zoznam ukazuje len úlohy vytvorené v aplikácii.");
  });

  test("natívny zoznam úloh poznámku vykreslí len na stránke klienta, nie v koši ani vo vloženom paneli (strážca väzby)", () => {
    const pane = readFileSync(join(import.meta.dir, "../src/react-app/domains/tasks/tasks-pane.tsx"), "utf8");
    expect(pane).toContain("{!props.embedded && !inTrash && <MatterTasksNotice projectId={props.projectId} />}");
  });
});
