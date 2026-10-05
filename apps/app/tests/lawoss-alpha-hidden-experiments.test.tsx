import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Navigate } from "react-router-dom";
import { ALPHA_HIDDEN_EXPERIMENTS, isExperimentHidden } from "../src/lawoss/feature-flags";
import { EXPERIMENT_VIEWS, VISIBLE_EXPERIMENT_VIEWS } from "../src/lawoss/experiments/registry";
import { experimentyNavItems } from "../src/lawoss/shell/layout";
import { LAWOSS_ROUTES } from "../src/lawoss/shell/routes";
import { NEW_MATTER_PATH } from "../src/lawoss/lite/links";

/** Cieľ presmerovania skrytej obrazovky; `null`, keď trasa ukazuje svoju obrazovku. */
const redirectOf = (path: string): string | null => {
  const element = LAWOSS_ROUTES.find((item) => item.path === path)?.element;
  if (!element) throw new Error(`missing route ${path}`);
  if (element.type !== Navigate) return null;
  const props = element.props as { to?: unknown };
  return typeof props.to === "string" ? props.to : null;
};

describe("alfa skryje experimenty Nový spis a Prvé nastavenie", () => {
  test("jeden prepínač drží obe obrazovky", () => {
    expect([...ALPHA_HIDDEN_EXPERIMENTS].sort()).toEqual(["view-novy-spis", "view-prve-nastavenie"]);
    expect(isExperimentHidden("view-prehlad")).toBe(false);
  });

  test("bočný panel ani zoznam experimentov ich neponúkajú, ostatné obrazovky ostávajú", () => {
    const visible = VISIBLE_EXPERIMENT_VIEWS.map((view) => view.to);
    expect(visible).not.toContain("/experimenty/novy-spis");
    expect(visible).not.toContain("/experimenty/prve-nastavenie");
    expect(visible).toEqual(EXPERIMENT_VIEWS.filter((view) => !ALPHA_HIDDEN_EXPERIMENTS.has(view.id)).map((view) => view.to));
    const nav = experimentyNavItems().map((item) => item.to);
    expect(nav).not.toContain("/experimenty/novy-spis");
    expect(nav).not.toContain("/experimenty/prve-nastavenie");
    expect(nav).toContain("/prehlad");
  });

  test("starý odkaz na Nový spis vedie na formulár novej veci z onboardingu", () => {
    expect(redirectOf("/experimenty/novy-spis")).toBe(NEW_MATTER_PATH);
    expect(redirectOf("/prehlad")).toBeNull();
  });

  test("starý odkaz na Prvé nastavenie vedie na zoznam experimentov", () => {
    expect(redirectOf("/experimenty/prve-nastavenie")).toBe("/experimenty");
  });

  test("prázdny stav Spisu a dialóg Pridať priečinok nevedú do agentového sprievodcu", () => {
    const spis = readFileSync(join(import.meta.dir, "../src/lawoss/domains/spis/spis-page.tsx"), "utf8");
    expect(spis).toContain('isExperimentHidden("view-novy-spis") ? NEW_MATTER_PATH');
    const session = readFileSync(join(import.meta.dir, "../src/react-app/shell/session-route.tsx"), "utf8");
    expect(session).toContain('additionalContent={!isExperimentHidden("view-novy-spis") && createWorkspaceOpen');
  });
});
