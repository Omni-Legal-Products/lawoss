import { describe, expect, test } from "bun:test";
import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

import type { ProviderListItem } from "../src/app/types";
import { compareProviders, filterProviderList } from "../src/app/utils/providers";
import { HIDDEN_QUICK_CONNECT_SERVERS } from "../src/lawoss/feature-flags";
import {
  OPENCODE_ZEN_PROVIDER_ID,
  RETIRED_FREE_PROVIDER_IDS,
  getConnectedProviderItems,
} from "../src/react-app/infra/provider-list-query";

/** Tvar záznamu, ako ho vracia engine v `/provider` (modely tu nie sú podstatné). */
const provider = (id: string, name: string, env: string[]): ProviderListItem => ({
  id,
  name,
  source: "api",
  env,
  options: {},
  models: {},
});

/**
 * Vstupná podmienka alfy (call 11. 9. 2026): pripojenie modelov Anthropic
 * funguje. Anthropic prichádza z katalógu enginu (models.dev + plugin
 * `opencode-anthropic-auth`); LAWOSS ho nesmie odfiltrovať ani zrušiť.
 */
describe("LAWOSS: Anthropic ako poskytovateľ modelov", () => {
  const engineList: ProviderListResponse = {
    all: [
      provider("openrouter", "OpenRouter", ["OPENROUTER_API_KEY"]),
      provider("anthropic", "Anthropic", ["ANTHROPIC_API_KEY"]),
      provider(OPENCODE_ZEN_PROVIDER_ID, "OpenCode Zen", []),
    ],
    connected: ["anthropic", "openrouter"],
    default: { anthropic: "claude-sonnet-4-6" },
  };

  test("prejde rovnakým filtrom ako OpenRouter — zakázaný je len zrušený bezplatný Zen", () => {
    const filtered = filterProviderList(engineList, [OPENCODE_ZEN_PROVIDER_ID]);
    expect(filtered.all.map((item) => item.id)).toEqual(["openrouter", "anthropic"]);
    expect(getConnectedProviderItems(filtered).map((item) => item.id).sort()).toEqual(["anthropic", "openrouter"]);
    expect(filtered.default.anthropic).toBe("claude-sonnet-4-6");
  });

  test("nie je zrušený ani skrytý žiadnym LAWOSS prepínačom", () => {
    expect(RETIRED_FREE_PROVIDER_IDS.has("anthropic")).toBe(false);
    // Prepínač rýchleho pripojenia je pre MCP servery, nie pre modely.
    expect(HIDDEN_QUICK_CONNECT_SERVERS.has("anthropic")).toBe(false);
  });

  test("vo výbere poskytovateľov je pripnutý pred OpenRouter", () => {
    const ordered = [provider("openrouter", "OpenRouter", []), provider("anthropic", "Anthropic", [])]
      .sort(compareProviders)
      .map((item) => item.id);
    expect(ordered).toEqual(["anthropic", "openrouter"]);
  });
});
