// LAWOSS (test inštalácie 3. 11. 2026): konektory doplnkov z LAWOSS Marketplace podľa mena MCP servera.
import { describe, expect, test } from "bun:test";
import { MARKETPLACE_SNAPSHOT } from "../src/lawoss/domains/marketplace/catalog";
import { MARKETPLACE_MCP_SERVERS, marketplaceConnector, marketplaceToolConnector } from "../src/lawoss/domains/marketplace/mcp-servers";

describe("MCP servery doplnkov z LAWOSS Marketplace", () => {
  test("každý server patrí doplnku s MCP v snapshote a každý taký doplnok má server", () => {
    const mcpPlugins = MARKETPLACE_SNAPSHOT.plugins.filter((plugin) => plugin.kind !== "skill-only").map((plugin) => plugin.name);
    const mapped = MARKETPLACE_MCP_SERVERS.map((server) => marketplaceConnector(server, "sk")?.plugin);
    expect(mapped.every((plugin) => plugin !== undefined && mcpPlugins.includes(plugin))).toBe(true);
    expect([...new Set(mapped)].sort()).toEqual([...mcpPlugins].sort());
  });

  test("názov a popis v jazyku appky, cudzí server ani vlastnosť objektu nie je doplnok", () => {
    expect(marketplaceConnector("slovlex", "sk")?.title).toBe("Slov-Lex");
    expect(marketplaceConnector("fs_opendata_mcp", "en")?.plugin).toBe("fs-opendata-mcp");
    expect(marketplaceConnector("cz_isir", "cs")?.plugin).toBe("cz-agents");
    for (const name of ["moj-konektor", "toString", "__proto__", "fs-opendata-mcp"]) expect(marketplaceConnector(name, "sk")).toBeNull();
  });

  test("nástroj `<server>_<nástroj>` patrí najdlhšiemu zhodnému serveru", () => {
    expect(marketplaceToolConnector("rpo_rpo_search", "sk")?.plugin).toBe("rpo");
    expect(marketplaceToolConnector("cz_eu-registry_lookup", "sk")?.plugin).toBe("cz-agents");
    expect(marketplaceToolConnector("ruzovy_get", "sk")).toBeNull();
    expect(marketplaceToolConnector("slovlex", "sk")).toBeNull();
  });
});
