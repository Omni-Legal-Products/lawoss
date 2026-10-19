import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// Ozubené koliesko znamená iba nastavenia appky a žije v jedinom menu účtu.
const read = (path: string) => readFileSync(join(import.meta.dir, "../src", path), "utf8");

const lucideImports = (source: string) =>
  [...source.matchAll(/import\s*\{([^}]*)\}\s*from\s*"lucide-react"/g)]
    .flatMap(match => (match[1] ?? "").split(","))
    .map(entry => entry.trim().split(/\s+as\s+/)[0] ?? "")
    .filter(Boolean);

const gearIcons = ["Settings", "Settings2", "Cog"];

const sidebar = "react-app/domains/session/sidebar/app-sidebar.tsx";
const sessionPage = "react-app/domains/session/chat/session-page.tsx";
const modelSelect = "components/model-select.tsx";
const toolMenu = "react-app/domains/session/surface/composer/tool-menu.tsx";
const projectHome = "react-app/domains/workspace/project-home.tsx";
const projectReviews = "react-app/domains/reviews/project-reviews.tsx";
const windowButton = "react-app/domains/session/panel/workspace-window-button.tsx";
const accountMenu = "react-app/domains/session/sidebar/eigenwelt-account-menu.tsx";

describe("jedno ozubené koliesko = nastavenia appky", () => {
  for (const path of [sidebar, sessionPage, modelSelect, toolMenu, projectHome, projectReviews, windowButton]) {
    test(`${path} neimportuje ozubené koliesko`, () => {
      const icons = lucideImports(read(path));
      for (const gear of gearIcons) expect(icons).not.toContain(gear);
    });
  }

  test("menu účtu ostáva jediným miestom s kolieskom", () => {
    expect(lucideImports(read(accountMenu))).toContain("Settings");
  });

  test("ostatné miesta používajú ikonu podľa významu", () => {
    expect(lucideImports(read(sidebar))).toContain("PencilLine");
    expect(lucideImports(read(sessionPage))).toContain("Plug");
    expect(lucideImports(read(modelSelect))).toContain("List");
    expect(lucideImports(read(projectHome))).toContain("PencilLine");
    expect(lucideImports(read(windowButton))).toContain("RotateCcw");
  });

  test("menu skladania a revízie majú tlačidlá bez ikony ozubeného kolesa", () => {
    const tool = read(toolMenu);
    expect(tool).toContain('onClick={() => props.onConfigure(props.section)}>{t("composer.configure")}</Button>');
    const reviews = read(projectReviews);
    expect(reviews).toContain('>{t("review.settings")}</Button>');
    expect(reviews).toContain(">{reviewModeLabel(review.settings.mode)}</Button>");
  });

  test("slovenské znenie úpravy polí je v množnom čísle", async () => {
    const sk = (await import("../src/i18n/locales/sk")).default;
    expect(sk["projects.configure_fields"]).toBe("Upraviť polia");
  });

  // doplní sa po zlúčení #174
  test.todo("session-route.tsx skrýva druhé koliesko v stavovom riadku (showSettingsButton: false)");
});
