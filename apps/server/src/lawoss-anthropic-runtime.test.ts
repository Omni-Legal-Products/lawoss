import { describe, expect, test } from "bun:test";
import { dirname } from "node:path";

import { buildLegalworkRuntimeConfigObject } from "./legalwork-runtime-config.js";
import { legalworkPluginPath } from "./legalwork-extensions-plugin-path.js";

/**
 * Vstupná podmienka alfy (call 11. 9. 2026): engine musí ponúkať Anthropic
 * (API kľúč aj OAuth „Claude Pro/Max") a LAWOSS ho nesmie zakázať.
 */
describe("LAWOSS: Anthropic v runtime konfigurácii enginu", () => {
  test("pribalený auth plugin je zapísaný a Anthropic nie je medzi zakázanými poskytovateľmi", async () => {
    const config = await buildLegalworkRuntimeConfigObject();
    const plugins = Array.isArray(config.plugins) ? config.plugins : [];
    // Engine v2: pribalený port (`lawoss-anthropic-auth`), nie npm balík v1, ktorý by engine sťahoval pri štarte.
    expect(plugins).toContain(dirname(legalworkPluginPath("lawoss-anthropic-auth")));
    expect(plugins).not.toContain("opencode-anthropic-auth");
    // Engine v2: a disabled provider is a native `provider.use` denial.
    const policies = Array.isArray(config.policies) ? config.policies : [];
    expect(policies).toContainEqual({ action: "provider.use", resource: "opencode", effect: "deny" });
    expect(policies).not.toContainEqual({ action: "provider.use", resource: "anthropic", effect: "deny" });
  });
});
