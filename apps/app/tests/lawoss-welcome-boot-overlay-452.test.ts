import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Testy appky nemajú DOM, efekty sa v nich nespúšťajú: kontrola zdroja trasy (ako lawoss-alfa14-ui-nalezy).
const source = readFileSync(join(import.meta.dir, "..", "src/react-app/shell/welcome-route.tsx"), "utf8");
const body = source.slice(source.indexOf("export function WelcomeRoute()"));

describe("#452: reload na /welcome nenechá štartovací prekryv", () => {
  test("WelcomeRoute oznámi pripravenú trasu efektom", () => {
    expect(source).toContain('import { useBootState } from "./boot-state";');
    expect(body).toMatch(/const \{ markRouteReady \} = useBootState\(\);\s*useEffect\(\(\) => markRouteReady\(\), \[markRouteReady\]\);/);
  });

  test("oznámenie je pred skorými návratmi (chyba aj „Connecting…“ ostanú klikateľné)", () => {
    const mark = body.indexOf("markRouteReady()");
    const firstReturn = body.indexOf("if (error) return");
    expect(mark).toBeGreaterThan(0);
    expect(firstReturn).toBeGreaterThan(mark);
  });

  test("prekryv sa skryje až pri pripravenej trase (boot-state bez zmeny)", () => {
    const boot = readFileSync(join(import.meta.dir, "..", "src/react-app/shell/boot-state.tsx"), "utf8");
    expect(boot).toContain('const canHide = routeReady && (phase === "ready" || phase === "idle");');
  });
});
