import { describe, expect, test } from "bun:test";

import { buildLegalworkRuntimeConfigObject } from "./legalwork-runtime-config.js";

/**
 * Vstupná podmienka alfy (call 11. 9. 2026): engine musí ponúkať Anthropic
 * (API kľúč aj OAuth „Claude Pro/Max") a LAWOSS ho nesmie zakázať.
 */
describe("LAWOSS: Anthropic v runtime konfigurácii enginu", () => {
  test("auth plugin je zapísaný a Anthropic nie je medzi zakázanými poskytovateľmi", async () => {
    const config = await buildLegalworkRuntimeConfigObject();
    const plugins = Array.isArray(config.plugin) ? config.plugin : [];
    expect(plugins).toContain("opencode-anthropic-auth");
    const disabled = Array.isArray(config.disabled_providers) ? config.disabled_providers : [];
    expect(disabled).toContain("opencode");
    expect(disabled).not.toContain("anthropic");
  });
});
