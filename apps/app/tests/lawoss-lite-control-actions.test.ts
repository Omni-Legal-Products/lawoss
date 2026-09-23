import { describe, expect, test } from "bun:test";

import { liteControlActions } from "../src/lawoss/shell/layout";
import { LITE_CLIENTS_PATH, LITE_TODAY_PATH } from "../src/lawoss/lite/links";
import { currentUiMode, setUiMode } from "../src/lawoss/lite/ui-mode";
import type { LegalworkControlHelpers } from "../src/react-app/shell/control/control-provider";

// `useControlActions`/`registerAction` only fire inside `useEffect`, so a DOM
// mount (React Testing Library / happy-dom) would be needed to assert actual
// registration — neither is a dependency of this repo, and adding one for a
// single test is disproportionate (ledger: task-8-report.md). Instead this
// tests the action list `LawossNav` registers: right ids, and each one's
// `execute()` does what the CDP smoke test (scripts/lite-smoke.mjs) expects
// end-to-end against the real running app.

const helpers: LegalworkControlHelpers = { setNarration: () => {} };

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

describe("ovládací akce LAWOSS-lite (lawoss.lite.*)", () => {
  test("registruje přesně čtyři akce se správnými id", () => {
    const ids = liteControlActions(() => {}).map((action) => action.id);
    expect(ids).toEqual([
      "lawoss.lite.mode.get",
      "lawoss.lite.mode.set",
      "lawoss.lite.route.today",
      "lawoss.lite.route.clients",
    ]);
  });

  test("mode.get vrací aktuální režim", () => {
    setUiMode("pro");
    const [modeGet] = liteControlActions(() => {});
    expect(modeGet.execute(undefined, helpers)).toEqual({ mode: "pro" });
  });

  test("mode.set přepne režim a vrátí ok", () => {
    setUiMode("pro");
    const [, modeSet] = liteControlActions(() => {});
    expect(modeSet.execute({ mode: "lite" }, helpers)).toEqual({ ok: true, mode: "lite" });
    expect(currentUiMode()).toBe("lite");
    setUiMode("pro");
  });

  test("mode.set odmítne neznámý režim beze změny stavu", () => {
    setUiMode("pro");
    const [, modeSet] = liteControlActions(() => {});
    const result = asRecord(modeSet.execute({ mode: "turbo" }, helpers));
    expect(result.ok).toBe(false);
    expect(String(result.error)).toContain("turbo");
    expect(currentUiMode()).toBe("pro");
  });

  test("route.today a route.clients navigují na lite trasy", () => {
    const visited: string[] = [];
    const [, , routeToday, routeClients] = liteControlActions((path) => visited.push(path));
    routeToday.execute(undefined, helpers);
    routeClients.execute(undefined, helpers);
    expect(visited).toEqual([LITE_TODAY_PATH, LITE_CLIENTS_PATH]);
  });
});
