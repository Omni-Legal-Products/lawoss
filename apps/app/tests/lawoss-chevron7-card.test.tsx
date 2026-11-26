import { describe, expect, test } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";

import { CHEVRON7_BUNDLE_ID, findChevron7App, plistDeclaresChevron7 } from "../../desktop/electron/lawoss-chevron7.mjs";
import { t } from "../src/i18n";
import {
  CHEVRON7_WEB_URL,
  CHEVRON7_INSTALL_URL,
  shouldCheckChevron7Installed,
  shouldShowChevron7Card,
} from "../src/lawoss/domains/integrations/chevron7-card";
import { chevron7SourceAction, isChevron7FileSelection } from "../src/lawoss/domains/integrations/chevron7-file-action";
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
  test("v slovenčine ukáže názov, podpisovanie PDF a odkaz na web Chevron7", () => {
    const html = renderToStaticMarkup(<Chevron7CardContent locale="sk" installed={false} />);
    expect(html).toContain(">Chevron7</h4>");
    expect(html).toContain('data-lawoss-badge="chevron7-signing"');
    expect(html).toContain("Podpisovanie PDF");
    expect(html).toContain("V Chevron7 vyberiete certifikát a zadáte PIN");
    expect(html).toContain(`href="${CHEVRON7_INSTALL_URL}"`);
    expect(html).toContain("Nainštalovať Chevron7");
    expect(CHEVRON7_INSTALL_URL).toBe("https://chevron7.slovensko.app/#stiahnut");
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
    expect(badges).toEqual(["Podpisovanie PDF", "Podpisování PDF", "PDF signing", "PDF signieren"]);
    for (const locale of languages) {
      const html = renderToStaticMarkup(<Chevron7CardContent locale={locale} installed={false} />);
      expect(html).toContain(t("lawoss.integrations.chevron7.install", locale));
      expect(html).toContain(t("lawoss.integrations.chevron7.description", locale));
    }
  });
});

describe("LAWOSS Chevron7 karta: stav nainštalované", () => {
  test("podporovaný helper zobrazí verziu bez podpisovacej akcie", () => {
    const html = renderToStaticMarkup(<Chevron7CardContent locale="sk" installed available version="1.23.2" />);
    expect(html).not.toContain("<button");
    expect(html).not.toContain("Podpísať v Chevron7");
    expect(html).toContain("1.23.2");
    expect(html).not.toContain("Pre toto prepojenie nainštalujte");
  });
  test("odlišuje neistý stav a prebiehajúcu kontrolu od chýbajúcej inštalácie", () => {
    for (const checking of [false, true]) {
      const html = renderToStaticMarkup(<Chevron7CardContent locale="sk" checking={checking} />);
      expect(html).toContain(t(checking ? "lawoss.integrations.chevron7.checking" : "lawoss.integrations.chevron7.unknown", "sk"));
      expect(html).not.toContain(CHEVRON7_INSTALL_URL);
      expect(html).toContain(`href="${CHEVRON7_WEB_URL}"`);
    }
    const unsupported = renderToStaticMarkup(<Chevron7CardContent locale="sk" installed available={false} />);
    expect(unsupported).toContain(t("lawoss.integrations.chevron7.unsupported", "sk"));
    expect(unsupported).not.toContain(CHEVRON7_INSTALL_URL);
  });
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

test("Integrations (úvod prehľadu integrácií) vykresľuje kartu Chevron7 namiesto karty Autogram", () => {
  // Upstream v0.3.9: prehliadač integrácií podľa kategórií; LAWOSS karty idú do `lawossIntro` v nastaveniach.
  const source = readFileSync(new URL("../src/react-app/shell/settings-route.tsx", import.meta.url), "utf8");
  expect(source).toContain("<Chevron7IntegrationCard />");
  expect(source).not.toContain("<AutogramIntegrationCard />");
});

test("offers a file action only for a local desktop PDF selection", () => {
  const selection = { workspaceId: "office", relativePath: "Spis/Návrh.PDF", serverUrl: "http://127.0.0.1:43123" };
  expect(isChevron7FileSelection(selection, true)).toBe(true);
  expect(isChevron7FileSelection(selection, false)).toBe(false);
  expect(isChevron7FileSelection({ ...selection, serverUrl: "https://remote.example" }, true)).toBe(false);
  for (const relativePath of ["/tmp/Návrh.pdf", "../Návrh.pdf", "sub/../Návrh.pdf", "file:///tmp/a.pdf", "test.docx"]) {
    expect(isChevron7FileSelection({ ...selection, relativePath }, true)).toBe(false);
  }
});

test("a PDF opened in another project activates its exact source tab before signing", async () => {
  const { usePanelTabStore, workspacePanelKey } = await import("../src/react-app/domains/session/panel/panel-tab-store");
  const { useUiStateStore } = await import("../src/react-app/shell/ui-state-store");
  const previousTabs = usePanelTabStore.getState();
  const previousUi = useUiStateStore.getState();
  const workspaceId = "synthetic-source";
  const scope = workspacePanelKey(workspaceId);
  const name = "Návrh.PDF";
  const path = `B/${name}`;
  const routes: string[] = [];
  const navigate = (route: string) => { routes.push(route); };
  try {
    usePanelTabStore.getState().openTab(scope, { id: "other", type: "artifact", label: name, value: `A/${name}`, preview: "pdf" });
    const open = chevron7SourceAction("synthetic-viewer", workspaceId, path, name, navigate);
    expect(routes).toEqual([]);
    open!();
    expect(routes).toEqual(["/workspace/synthetic-source/session?view=workspace"]);
    const session = usePanelTabStore.getState().sessions[scope];
    const selected = session.tabs.find(tab => tab.id === session.activeTabId);
    expect(selected).toMatchObject({ label: name, value: path, sourceProject: { projectId: workspaceId, workspaceId, path, name } });
    expect(useUiStateStore.getState().sidePanelState[scope]).toBe("panel");
    expect(chevron7SourceAction(workspaceId, workspaceId, path, name, navigate)).toBeUndefined();
  } finally {
    usePanelTabStore.setState(previousTabs, true);
    useUiStateStore.setState(previousUi, true);
  }
});
