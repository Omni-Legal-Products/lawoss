import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(new URL(path, import.meta.url)).text();
}

describe("LAWOSS AI guidance settings wiring", () => {
  test("AI settings accepts and renders the governed guidance view", async () => {
    const content = await source("../src/react-app/domains/settings/pages/ai-view.tsx");

    expect(content).toContain("aiGuidanceView");
  });

  test("Integrations accepts and renders the compact policy notice", async () => {
    const content = await source("../src/react-app/domains/settings/pages/extensions-view.tsx");

    expect(content).toContain("aiPolicyNotice");
  });

  test("the settings route derives the detector from live entitlements and providers", async () => {
    const content = await source("../src/react-app/shell/settings-route.tsx");

    expect(content).toContain("detectSubscriptionType");
    expect(content).toContain("firmEntitlementsQuery.data?.entitlements");
    expect(content).toContain("aiGuidanceView");
    expect(content).toContain("aiPolicyNotice");
  });
});
