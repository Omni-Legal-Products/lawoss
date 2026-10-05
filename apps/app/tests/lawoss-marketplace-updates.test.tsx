import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";

import { MARKETPLACE_CATALOG } from "../src/lawoss/domains/marketplace/catalog";
import { lawossMarketplaceMethods, type LawossMarketplaceApi, type MarketplaceView } from "../src/lawoss/domains/marketplace/marketplace-api";
import { catalogPluginId } from "../src/lawoss/domains/marketplace/native-actions";
import { updateAllWithoutConflicts, updatesSignature } from "../src/lawoss/domains/marketplace/update-notifier";
import { FileDecisionForm, LegacyInstallsPanel, MarketplaceUpdatesPanel } from "../src/lawoss/domains/marketplace/updates-panel";
import { globalInstalledIds, installGlobalEntries } from "../src/lawoss/domains/marketplace/use-lawoss-marketplace";
import { PacksStep } from "../src/lawoss/domains/onboarding/packs-step";

const entry = (id: string) => MARKETPLACE_CATALOG.find((item) => item.id === id)!;
const plugin = (id: string) => ({ pluginId: catalogPluginId(entry(id)), name: entry(id).name, marketplaceId: null, description: null, updatedAt: null, files: [], importedAt: null });
const SHA = "b".repeat(40);

function view(overrides: Partial<MarketplaceView> = {}): MarketplaceView {
  return {
    global: [plugin("slovlex"), plugin("orsr")], globalChanges: {}, workspace: [],
    settings: { weeklyCheck: true, lastCheckedAt: Date.UTC(2026, 9, 5, 10, 30) },
    check: { status: "ok", release: { tag: "v0.2.0", sha: SHA, publishedAt: null, source: "release", plugins: [] } },
    updates: [], ...overrides,
  };
}

function fakeApi(outcomes: Record<string, "updated" | "needs_decision" | "fail"> = {}) {
  const calls: string[] = [];
  const api: LawossMarketplaceApi = lawossMarketplaceMethods(async <T,>(path: string, init?: { method?: string; body?: unknown }): Promise<T> => {
    calls.push(`${init?.method ?? "GET"} ${path}`);
    const body = (init?.body ?? {}) as { pluginId?: string; url?: string };
    if (path === "/lawoss/marketplace/plugins") {
      if (body.url?.endsWith("/plugins/orsr")) throw new Error("GitHub nedostupný");
      return { status: "installed", item: plugin("slovlex") } as T;
    }
    if (path === "/lawoss/marketplace/plugins/update") {
      const outcome = outcomes[body.pluginId ?? ""] ?? "updated";
      if (outcome === "fail") throw new Error("zlyhalo");
      return (outcome === "needs_decision"
        ? { status: "needs_decision", changes: [{ path: ".opencode/skills/slovlex-plugin/slovlex/SKILL.md", title: "slovlex", state: "modified" }] }
        : { status: "updated", item: plugin("slovlex"), backups: [], kept: [] }) as T;
    }
    return view() as T;
  });
  return { api, calls };
}

describe("LAWOSS Marketplace v appke: inštalácia pre všetkých klientov", () => {
  test("klient volá len lokálne routes /lawoss/marketplace", async () => {
    const { api, calls } = fakeApi();
    await api.view("ws_1");
    await api.check("open", "ws_1");
    await api.setWeeklyCheck(false);
    await api.move("ws_1", "github:x#plugins/a", "https://github.com/x", { ".opencode/a": "keep" });
    expect(calls).toEqual([
      "GET /lawoss/marketplace?workspaceId=ws_1",
      "POST /lawoss/marketplace/check",
      "PUT /lawoss/marketplace/settings",
      "POST /lawoss/marketplace/plugins/move",
    ]);
  });

  test("odporúčané balíky po jednom; zlyhanie jedného nezastaví ostatné", async () => {
    const { api, calls } = fakeApi();
    const result = await installGlobalEntries(api, [entry("slovlex"), entry("orsr"), entry("rpo")]);
    expect(result.installed).toEqual(["slovlex", "rpo"]);
    expect(result.failed).toEqual([{ id: "orsr", message: "GitHub nedostupný" }]);
    expect(calls).toHaveLength(3);
  });

  test("nainštalované pre všetkých klientov sa páruje s katalógom podľa id pluginu", () => {
    expect([...globalInstalledIds(view(), MARKETPLACE_CATALOG)].sort()).toEqual(["orsr", "slovlex"]);
    expect(globalInstalledIds(null, MARKETPLACE_CATALOG).size).toBe(0);
  });

  test("krok onboardingu: text o GitHube Omni Legal Products, inštalácia až tlačidlom, dá sa pokračovať", () => {
    const html = renderToStaticMarkup(<PacksStep api={null} jurisdiction="sk" busy={false} onContinue={() => undefined} />);
    expect(html).toContain("data-lawoss-onboarding-packs");
    expect(html).toContain("Recommended LAWOSS bundles");
    expect(html).toContain("Nothing is downloaded until you click Install");
    expect(html).toContain("Omni-Legal-Products/lawoss-marketplace");
    expect(html.match(/checked=""/g)).toHaveLength(6);
    expect(html).toContain(">Continue<");
  });
});

describe("LAWOSS Marketplace v appke: aktualizácie", () => {
  const panel = (current: MarketplaceView) => renderToStaticMarkup(<MarketplaceUpdatesPanel api={fakeApi().api} view={current} checking={false} error={null}
    onCheck={() => undefined} onWeeklyChange={() => undefined} onChanged={async () => undefined} />);

  test("upozornenie s Aktualizovať jednotlivo aj všetko, naposledy skontrolované a týždenné nastavenie", () => {
    const html = panel(view({ updates: [
      { pluginId: plugin("slovlex").pluginId, name: "Slov-Lex", installed: "1.1.1", available: "1.2.0", path: "plugins/slovlex" },
      { pluginId: plugin("orsr").pluginId, name: "ORSR", installed: "1.1.0", available: "1.1.1", path: "plugins/orsr" },
    ] }));
    expect(html).toContain("Available updates: 2 (release v0.2.0)");
    expect(html).toContain("Slov-Lex: 1.1.1 to 1.2.0");
    expect(html).toContain(">Update all<");
    expect(html.match(/>Update</g)).toHaveLength(2);
    expect(html).toContain("Last checked: ");
    expect(html).toContain("Check for updates automatically once a week");
    expect(html).toContain("never right at startup, and installs nothing by itself");
    expect(html).toContain("never overwrites your change without asking");
  });

  test("bez vydania marketplace a bez kontroly: zrozumiteľný stav, nič na aktualizáciu", () => {
    const none = panel(view({ check: { status: "no_release" } }));
    expect(none).toContain("LAWOSS Marketplace has no release yet");
    expect(none).not.toContain(">Update<");
    const never = panel(view({ check: null, settings: { weeklyCheck: false, lastCheckedAt: null } }));
    expect(never).toContain("Not checked yet.");
  });

  test("rozhodnutie o upravených súboroch: predvolene sa úprava ponechá, pri odinštalovaní uloží bokom", () => {
    const changes = [{ path: ".opencode/skills/slovlex-plugin/slovlex/SKILL.md", title: "slovlex", state: "modified" as const }];
    const update = renderToStaticMarkup(<FileDecisionForm title="Slov-Lex" changes={changes} mode="update" onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(update.match(/type="radio"/g)).toHaveLength(3);
    expect(update).toMatch(/checked=""[^>]*\/>Keep my change/);
    expect(update).toContain("Take the new version and save my change aside");
    expect(update).toContain("skills/slovlex-plugin/slovlex/SKILL.md");
    const remove = renderToStaticMarkup(<FileDecisionForm title="Slov-Lex" changes={changes} mode="remove" onConfirm={() => undefined} onCancel={() => undefined} />);
    expect(remove.match(/type="radio"/g)).toHaveLength(2);
    expect(remove).toMatch(/checked=""[^>]*\/>Save my change aside/);
  });

  test("Aktualizovať všetko z upozornenia: plugin s úpravou sa preskočí a nechá na rozhodnutie", async () => {
    const { api } = fakeApi({ [plugin("slovlex").pluginId]: "needs_decision", [plugin("rpo").pluginId]: "fail" });
    const result = await updateAllWithoutConflicts(api, [
      { pluginId: plugin("slovlex").pluginId, name: "Slov-Lex", installed: "1.1.1", available: "1.2.0", path: "plugins/slovlex" },
      { pluginId: plugin("orsr").pluginId, name: "ORSR", installed: "1.1.0", available: "1.1.1", path: "plugins/orsr" },
      { pluginId: plugin("rpo").pluginId, name: "RPO", installed: "1.0.0", available: "1.0.1", path: "plugins/rpo" },
    ]);
    expect(result).toEqual({ updated: ["ORSR"], needsDecision: ["Slov-Lex"], failed: ["RPO"] });
    expect(updatesSignature("v0.2.0", [{ pluginId: "b", name: "B", installed: null, available: "2", path: "p" }, { pluginId: "a", name: "A", installed: null, available: "1", path: "p" }]))
      .toBe("v0.2.0:a@1,b@2");
  });

  test("doterajšia inštalácia len v priečinku: funguje ďalej a ponúkne sa presun", () => {
    const html = renderToStaticMarkup(<MemoryRouter><LegacyInstallsPanel api={fakeApi().api} workspaceId="ws_1" workspaceName="Klient Novák" plugins={[plugin("orsr")]} onChanged={async () => undefined} /></MemoryRouter>);
    expect(html).toContain("Installed only in folder Klient Novák");
    expect(html).toContain("They keep working");
    expect(html).toContain(">Move to all clients<");
    expect(renderToStaticMarkup(<LegacyInstallsPanel api={null} workspaceId="ws_1" workspaceName="X" plugins={[]} onChanged={async () => undefined} />)).toBe("");
  });
});
