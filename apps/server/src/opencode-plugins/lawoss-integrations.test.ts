// LAWOSS #434: na otázku o integráciách agent uvedie registre a doplnky (MCP klienta) s ich stavom, nie katalóg cloudových konektorov.
import { afterEach, describe, expect, test } from "bun:test";
import MemoryTools from "./lawoss-memory-tools.js";
import { annotateExtensionListing, INTEGRATIONS_SYSTEM, integrationStates } from "./lawoss-integrations.js";
import { nativePluginTools } from "./native-plugin-test-support.js";

const closers: Array<() => Promise<void>> = [];
afterEach(async () => { for (const close of closers.splice(0)) await close(); });

describe("#434 integrácie advokáta", () => {
  test("lawoss_integrations vymenuje všetky MCP priečinka chatu so stavom, bez karty a len v priečinku chatu", async () => {
    const plugin = await nativePluginTools(MemoryTools, { sessionID: "ses_1", directory: "/prax/Klienti/K1" });
    closers.push(plugin.close);
    plugin.runtime.mcp({
      orsr: { status: "connected" }, judikaty: { status: "connected" }, ruz: { status: "failed", error: "spawn npx ENOENT" } as { status: string },
      slovlex: { status: "disabled" }, kalkulacky: { status: "needs_auth" },
    });
    const asked: unknown[] = [];
    const result = JSON.parse(await plugin.tool.lawoss_integrations!.execute({}, { sessionID: "ses_1", directory: "/prax/Klienti/K1", ask: async (input) => { asked.push(input); } }));
    expect(result.count).toBe(5);
    expect(result.integrations).toEqual([
      { name: "judikaty", state: "connected" },
      { name: "kalkulacky", state: "needs sign-in" },
      { name: "orsr", state: "connected" },
      { name: "ruz", state: "not working", detail: "spawn npx ENOENT" },
      { name: "slovlex", state: "turned off" },
    ]);
    expect(asked).toEqual([]);
    expect(plugin.runtime.permissions.length).toBe(0);
    expect(plugin.runtime.mcpRequests).toEqual([{ location: { directory: "/prax/Klienti/K1" } }]);
  });

  test("bez nainštalovaného registra to povie a ukáže, kde ich pridať", async () => {
    const plugin = await nativePluginTools(MemoryTools, { sessionID: "ses_1", directory: "/prax/Klienti/K1" });
    closers.push(plugin.close);
    const result = JSON.parse(await plugin.tool.lawoss_integrations!.execute({}));
    expect(result).toMatchObject({ count: 0, integrations: [] });
    expect(result.note).toContain("LAWOSS Marketplace");
  });

  test("pevný text pre model: registre cez lawoss_integrations, cloudové konektory nie sú dostupné integrácie", () => {
    expect(INTEGRATIONS_SYSTEM).toContain("call lawoss_integrations");
    expect(INTEGRATIONS_SYSTEM).toContain("do not list or offer them as available integrations");
    expect(INTEGRATIONS_SYSTEM).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  test("výsledok katalógu rozšírení dostane poznámku, akcie ostanú bez zmeny", async () => {
    const plugin = await nativePluginTools(MemoryTools, { sessionID: "ses_1", directory: "/prax/Klienti/K1" });
    closers.push(plugin.close);
    const listing = JSON.stringify({ ok: true, actions: [{ extensionId: "gmail", action: "search" }] });
    const event = { tool: "legalwork_extension_list_actions", status: "completed", result: { content: listing } };
    await plugin.runtime.hook("tool", "execute.after", event);
    expect(event.result.content.startsWith(listing)).toBe(true);
    expect(event.result.content).toContain("not a list of the lawyer's integrations");
    const other = { tool: "read", status: "completed", result: { content: "x" } };
    await plugin.runtime.hook("tool", "execute.after", other);
    expect(other.result.content).toBe("x");
    expect(annotateExtensionListing({ content: [{ type: "text", text: "a" }] }).content).toHaveLength(2);
  });

  test("neznámy stav enginu ostane viditeľný", () => {
    expect(integrationStates([{ name: "x", status: { status: "weird" } }, { name: "y", status: null }])).toEqual([{ name: "x", state: "weird" }, { name: "y", state: "unknown" }]);
  });
});
