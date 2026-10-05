import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { CHEVRON7_BUNDLE_ID, findChevron7App, plistDeclaresChevron7 } from "../../desktop/electron/lawoss-chevron7.mjs";
import { t } from "../src/i18n";
import {
  CHEVRON7_WEB_URL,
  shouldCheckChevron7Installed,
  shouldShowChevron7Card,
} from "../src/lawoss/domains/integrations/chevron7-card";
import { Chevron7CardContent } from "../src/lawoss/domains/integrations/chevron7-integration-card";

const languages = ["sk", "cs", "en", "de"] as const;

describe("LAWOSS Chevron7 karta: viditeľnosť", () => {
  test("zobrazí sa na macOS", () => {
    expect(shouldShowChevron7Card({ isMac: true })).toBe(true);
  });

  test("mimo macOS (Windows, Linux) sa skryje", () => {
    expect(shouldShowChevron7Card({ isMac: false })).toBe(false);
  });
});

describe("LAWOSS Chevron7 karta: obsah", () => {
  test("v slovenčine ukáže názov, štítok Pripravujeme a odkaz na web Chevron7", () => {
    const html = renderToStaticMarkup(<Chevron7CardContent locale="sk" />);
    expect(html).toContain(">Chevron7</h4>");
    expect(html).toContain('data-lawoss-badge="chevron7-coming-soon"');
    expect(html).toContain("Pripravujeme");
    expect(html).toContain("podpis vždy potvrdíte v Chevron7");
    expect(html).toContain(`href="${CHEVRON7_WEB_URL}"`);
    expect(html).toContain("Viac o Chevron7");
    expect(CHEVRON7_WEB_URL).toBe("https://chevron7.slovensko.app");
  });

  test("karta nemá tlačidlo Pripojiť ani inú akciu okrem odkazu", () => {
    for (const locale of languages) {
      const html = renderToStaticMarkup(<Chevron7CardContent locale={locale} />);
      expect(html).not.toContain("<button");
      expect(html.match(/<a\s/g)?.length).toBe(1);
      expect(html).not.toContain(t("mcp.connect", locale));
    }
  });

  test("štítok a odkaz majú preklad vo všetkých štyroch jazykoch", () => {
    const badges = languages.map(locale => t("lawoss.integrations.chevron7.badge", locale));
    expect(badges).toEqual(["Pripravujeme", "Připravujeme", "Coming soon", "In Vorbereitung"]);
    for (const locale of languages) {
      const html = renderToStaticMarkup(<Chevron7CardContent locale={locale} />);
      expect(html).toContain(t("lawoss.integrations.chevron7.link", locale));
      expect(html).toContain(t("lawoss.integrations.chevron7.description", locale));
    }
  });
});

describe("LAWOSS Chevron7 karta: stav nainštalované", () => {
  test("kontrola beží len v desktop appke na macOS", () => {
    expect(shouldCheckChevron7Installed({ desktopRuntime: true, isMac: true })).toBe(true);
    expect(shouldCheckChevron7Installed({ desktopRuntime: false, isMac: true })).toBe(false);
    expect(shouldCheckChevron7Installed({ desktopRuntime: true, isMac: false })).toBe(false);
  });

  test("nainštalovaná appka ukáže stav, inak karta stav nemá", () => {
    const installed = renderToStaticMarkup(<Chevron7CardContent locale="sk" installed />);
    expect(installed).toContain('data-lawoss-status="chevron7-installed"');
    expect(installed).toContain("Nainštalované na tomto Macu");
    expect(installed).not.toContain("<button");
    const missing = renderToStaticMarkup(<Chevron7CardContent locale="sk" installed={false} />);
    expect(missing).not.toContain("chevron7-installed");
  });
});

describe("LAWOSS Chevron7 detekcia podľa bundle id (desktop, len čítanie)", () => {
  const plist = (id: string) =>
    Buffer.from(`<?xml version="1.0"?><plist><dict><key>CFBundleName</key><string>X</string><key>CFBundleIdentifier</key>\n  <string>${id}</string></dict></plist>`);

  test("XML Info.plist sa porovná podľa CFBundleIdentifier", () => {
    expect(CHEVRON7_BUNDLE_ID).toBe("app.slovensko.chevron7");
    expect(plistDeclaresChevron7(plist("app.slovensko.chevron7"))).toBe(true);
    expect(plistDeclaresChevron7(plist("app.slovensko.chevron7.helper"))).toBe(false);
    expect(plistDeclaresChevron7(plist("digital.slovensko.autogram"))).toBe(false);
  });

  test("binárny plist sa porovná podľa presne zakódovaného ASCII reťazca identifikátora", () => {
    const bplistString = (id: string) =>
      Buffer.concat([Buffer.from("bplist00"), Buffer.from([0x5f, 0x10, id.length]), Buffer.from(id, "latin1")]);
    expect(plistDeclaresChevron7(bplistString("app.slovensko.chevron7"))).toBe(true);
    expect(plistDeclaresChevron7(bplistString("app.slovensko.chevron7.helper"))).toBe(false);
    expect(plistDeclaresChevron7(bplistString("com.example.other"))).toBe(false);
  });

  test("nájde aj premenovaný bundle, ignoruje iné appky a mimo macOS nehľadá", async () => {
    const root = mkdtempSync(join(tmpdir(), "lawoss-chevron7-"));
    try {
      const bundle = (name: string, id: string) => {
        mkdirSync(join(root, name, "Contents"), { recursive: true });
        writeFileSync(join(root, name, "Contents", "Info.plist"), plist(id));
      };
      bundle("Other.app", "com.example.other");
      expect(await findChevron7App({ platform: "darwin", roots: [root, join(root, "missing")] })).toEqual({ installed: false });
      bundle("Podpis.app", "app.slovensko.chevron7");
      expect(await findChevron7App({ platform: "darwin", roots: [join(root, "missing"), root] })).toEqual({ installed: true });
      expect(await findChevron7App({ platform: "win32", roots: [root] })).toEqual({ installed: false });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  test("modul detekcie appku nespúšťa ani nevolá", () => {
    const source = readFileSync(new URL("../../desktop/electron/lawoss-chevron7.mjs", import.meta.url), "utf8");
    expect(source).not.toMatch(/child_process|shell\.|openPath|spawn|execFile|execSync/);
    expect(source).not.toMatch(/chevron7-cli-sign|pin-stdin|QuickActionRunner/);
  });
});

test("Integrations (záložka Connectors) vykresľuje kartu Chevron7 namiesto karty Autogram", () => {
  const source = readFileSync(new URL("../src/react-app/domains/settings/pages/extensions-view.tsx", import.meta.url), "utf8");
  expect(source).toContain("<Chevron7IntegrationCard />");
  expect(source).not.toContain("<AutogramIntegrationCard />");
});
