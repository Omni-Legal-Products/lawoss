/** Zlatý lesk (design-system.md §4b, MČ 14. 11. 2026): hlavná akcia, aktívna položka bežného režimu, práve zmenený riadok. */
import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { isVisibleChange, JUST_CHANGED_CLASS, JUST_CHANGED_MS } from "../src/lawoss/lite/just-changed";
import { ClientRowLabelView, type ClientRow } from "../src/lawoss/lite/client-row-view";
import { markUiModeOnDocument } from "../src/lawoss/lite/ui-mode";

const read = (path: string) => readFileSync(join(import.meta.dir, "..", path), "utf8");
const tokens = read("../../lawoss/theme/lawoss-tokens.css");
const components = read("../../lawoss/theme/lawoss-components.css");
const shell = read("src/lawoss/shell/lawoss.css");
const glass = read("src/lawoss/lite/pages/okf-glass.css");
const block = (css: string, selectorStart: string) => {
  const start = css.indexOf(selectorStart);
  return start < 0 ? "" : css.slice(start, css.indexOf("}", start) + 1);
};
const reducedBlocks = (css: string) => [...css.matchAll(/@media \(prefers-reduced-motion: reduce\) \{([\s\S]*?)\n\}/g)].map((m) => m[1]).join("\n");

describe("zlatý lesk: tokeny a hlavná akcia", () => {
  test("farby lesku sú tokeny vedľa existujúcich --lw-gold-*", () => {
    for (const name of ["--lw-gold-gloss", "--lw-gold-gloss-shadow", "--lw-gold-gloss-shadow-hover", "--lw-gold-sheen", "--lw-gold-focus", "--lw-gold-glaze", "--lw-gold-glaze-border", "--lw-gold-glaze-shadow", "--lw-gold-glaze-sheen", "--lw-gold-glaze-text", "--lw-duration-changed"]) {
      expect(tokens).toContain(`${name}:`);
    }
    // Vertikálny prechod so svetlou hranou hore.
    expect(tokens).toMatch(/--lw-gold-gloss: linear-gradient\(180deg/);
    expect(tokens).toMatch(/--lw-gold-gloss-shadow: inset 0 1px 0 rgba\(255, 255, 255/);
  });
  test("každé zlaté hlavné tlačidlo má lesk z tokenov, zdvih pri hoveri a viditeľné zameranie; bez hexov", () => {
    expect(block(components, '[data-slot="button"][data-variant="default"],\n.lw-composer-send:not(:disabled) {')).toContain("background: var(--lw-gold-gloss);");
    expect(block(shell, ".lw-btn.gold {")).toContain("background: var(--lw-gold-gloss);");
    expect(block(glass, ".lw-today-primary {")).toContain("background: var(--lw-gold-gloss);");
    for (const css of [components, shell, glass]) expect(css).toMatch(/:hover:not\(:disabled\)[^{]*\{[^}]*transform: translateY\(-1px\)/);
    expect(components).toContain("outline-color: var(--lw-gold-focus);");
    expect(block(shell, ".lw-btn.gold:focus-visible {")).toContain("var(--lw-gold-focus)");
    expect(block(glass, ".lw-today-primary:focus-visible {")).toContain("var(--lw-gold-focus)");
    const sheenStart = components.indexOf("/* ── zlatý lesk");
    expect(components.slice(sheenStart)).not.toMatch(/#[0-9a-f]{3,8}\b/i);
  });
  test("odlesk prejde raz (~0,9 s) len pri hoveri a zameraní klávesnicou; nikde nič nebeží dookola; len transform", () => {
    // MČ 14. 11. 2026: žiadny odlesk v pokoji ani nekonečná animácia (predtým raz za ~7 s, v paneli raz za 9 s).
    // (Kostra načítania `lw-okf-shimmer` v okf-glass.css je ukazovateľ práce, nie zlatý lesk.)
    for (const css of [components, shell, glass]) {
      expect(css).not.toMatch(/animation:[^;]*lw-(sheen|changed)[^;]*infinite/);
      expect(css).not.toMatch(/animation:\s*lw-sheen\s/);
      expect(css).not.toContain("@keyframes lw-sheen {");
    }
    expect(components).not.toMatch(/\binfinite\b/);
    expect(shell).not.toMatch(/\binfinite\b/);
    expect(components).toMatch(/:is\(:hover, :focus-visible\):not\(:disabled\)::after \{\n  animation: lw-sheen-once 900ms var\(--lw-ease-expo\) 1 both;/);
    // V pokoji len pseudo-prvok mimo tlačidla, bez animácie.
    const idle = block(components, ':is([data-slot="button"][data-variant="default"]:not([data-size="sm"]):not([data-size="xs"]), .lw-composer-send, .lw-btn.gold, .lw-today-primary)::after {');
    expect(idle).toContain("background: var(--lw-gold-sheen);");
    expect(idle).not.toContain("animation");
    for (const name of ["lw-sheen-once", "lw-changed-fade"]) {
      const frames = components.slice(components.indexOf(`@keyframes ${name} {`));
      const body = frames.slice(0, frames.indexOf("\n}\n"));
      expect(body.length).toBeGreaterThan(0);
      expect(body).not.toMatch(/\b(left|right|top|width|height|background)\s*:/);
    }
  });
  test("prefers-reduced-motion: bez odlesku a bez zdvihu, zmena riadku ostane viditeľná", () => {
    const reduced = reducedBlocks(components);
    expect(reduced).toContain('.lw-today-primary)::after { content: none; animation: none; }');
    expect(reduced).toContain('.lw-today-primary):hover { transform: none; }');
    expect(reduced).toContain(".lw-just-changed::before { animation: none; opacity: 1; }");
    expect(reducedBlocks(shell)).toContain("[data-active]::after { content: none; animation: none; }");
  });
});

describe("aktívna položka v bežnom režime: glazúra, nikdy prúžok na okraji", () => {
  test("glazúra a 1 px obrys len pod data-lawoss-ui=lite; obrys je celý rámik", () => {
    const rule = block(shell, ':root[data-lawoss-ui="lite"] .lw-chat-sidebar :is(.lw-sidebar-item, .lw-sidebar-session)[data-active] {');
    expect(rule).toContain("background: var(--lw-gold-glaze);");
    expect(rule).toContain("box-shadow: inset 0 0 0 1px var(--lw-gold-glaze-border), var(--lw-gold-glaze-shadow);");
    // Glazúra a obrys sú statické; odlesk len pri hoveri, raz.
    expect(rule).not.toContain("animation");
    expect(block(shell, ':root[data-lawoss-ui="lite"] .lw-chat-sidebar :is(.lw-sidebar-item, .lw-sidebar-session)[data-active]::after {')).not.toContain("animation");
    expect(block(shell, ':root[data-lawoss-ui="lite"] .lw-chat-sidebar :is(.lw-sidebar-item, .lw-sidebar-session)[data-active]:hover::after {')).toContain("animation: lw-sheen-once 900ms var(--lw-ease-expo) 1 both;");
  });
  test("žiadny zvislý prúžok: v CSS LAWOSS ani v bočnom paneli nie je posunutý vnútorný tieň ani okraj aktívnej položky", () => {
    for (const css of [shell, components, glass]) {
      expect(css).not.toMatch(/inset\s+-?[1-9]\d*px\s+0(\s+0)?\s+(var|rgba|#)/);
      expect(css).not.toMatch(/\[data-active\][^{]*\{[^}]*border-(left|inline-start)/);
    }
    const sidebar = read("src/react-app/domains/session/sidebar/app-sidebar.tsx");
    expect(sidebar).not.toMatch(/data-active:(border-l|border-s|shadow-\[inset)/);
  });
  test("režim sa zapíše na <html data-lawoss-ui>", () => {
    const root = { dataset: {} as DOMStringMap };
    markUiModeOnDocument("lite", root);
    expect(root.dataset.lawossUi).toBe("lite");
    markUiModeOnDocument("pro", root);
    expect(root.dataset.lawossUi).toBe("pro");
    expect(() => markUiModeOnDocument("lite", null)).not.toThrow();
    expect(() => markUiModeOnDocument("lite", {})).not.toThrow();
  });
});

describe("práve zmenený riadok", () => {
  test("zvýrazní sa len skutočná zmena známej hodnoty, nie prvé načítanie ani zmiznutie", () => {
    expect(isVisibleChange("next:2026-11-20", "next:2026-11-17")).toBe(true);
    expect(isVisibleChange("next:2026-11-20", "overdue")).toBe(true);
    expect(isVisibleChange(undefined, "next:2026-11-17")).toBe(false);
    expect(isVisibleChange("next:2026-11-17", undefined)).toBe(false);
    expect(isVisibleChange("next:2026-11-17", "next:2026-11-17")).toBe(false);
    expect(JUST_CHANGED_MS).toBe(1200);
    expect(block(components, ".lw-just-changed::before {")).toContain("animation: lw-changed-fade var(--lw-duration-changed)");
  });
  test("riadok klienta v bežnom režime nesie triedu len počas zvýraznenia", () => {
    const row: ClientRow = { label: "Tatran", nativeLabel: "tatran", client: true, due: { text: "o 3 dni", urgency: "near" }, dueKey: "next:2026-11-17" };
    expect(renderToStaticMarkup(<ClientRowLabelView row={row} mode="lite" justChanged />)).toContain(JUST_CHANGED_CLASS);
    expect(renderToStaticMarkup(<ClientRowLabelView row={row} mode="lite" />)).not.toContain(JUST_CHANGED_CLASS);
    expect(renderToStaticMarkup(<ClientRowLabelView row={row} mode="pro" justChanged />)).not.toContain(JUST_CHANGED_CLASS);
  });
});
