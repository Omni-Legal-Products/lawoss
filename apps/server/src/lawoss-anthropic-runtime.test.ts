import { describe, expect, test } from "bun:test";

import { buildLegalworkRuntimeConfigObject } from "./legalwork-runtime-config.js";

/**
 * Vstupná podmienka alfy (call 11. 9. 2026): engine musí ponúkať Anthropic
 * (API kľúč aj OAuth „Claude Pro/Max") a LAWOSS ho nesmie zakázať.
 */
describe("LAWOSS: Anthropic v runtime konfigurácii enginu", () => {
  test("auth plugin je zapísaný a Anthropic nie je medzi zakázanými poskytovateľmi", async () => {
    const config = await buildLegalworkRuntimeConfigObject();
    const plugins = Array.isArray(config.plugins) ? config.plugins : [];
    expect(plugins).toContain("opencode-anthropic-auth");
    // Engine v2: a disabled provider is a native `provider.use` denial.
    const policies = Array.isArray(config.policies) ? config.policies : [];
    expect(policies).toContainEqual({ action: "provider.use", resource: "opencode", effect: "deny" });
    expect(policies).not.toContainEqual({ action: "provider.use", resource: "anthropic", effect: "deny" });
  });
});
