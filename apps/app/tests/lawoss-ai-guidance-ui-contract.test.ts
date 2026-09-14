import { describe, expect, test } from "bun:test";

async function source(path: string): Promise<string> {
  return Bun.file(new URL(path, import.meta.url)).text();
}

describe("LAWOSS AI guidance UI contract", () => {
  test("renders a reusable panel with the three source-aligned regimes", async () => {
    const content = await source("../src/lawoss/domains/ai-guidance/ai-guidance-panel.tsx");

    expect(content).toContain("local");
    expect(content).toContain("dpa");
    expect(content).toContain("consent");
    expect(content).toContain("no-training");
    expect(content).toContain("human");
    expect(content).toContain("AI lawyer");
  });

  test("adds the guidance state to persisted local preferences", async () => {
    const content = await source("../src/react-app/kernel/local-provider.tsx");

    expect(content).toContain("aiDataRegime");
    expect(content).toContain("aiGuidanceAcknowledgedAt");
  });

  test("places the guidance panel on the welcome route", async () => {
    const content = await source("../src/lawoss/domains/onboarding/lawoss-welcome-page.tsx");

    expect(content).toContain("AiGuidancePanel");
    expect(content).toContain("onAiDataRegimeChange");
    expect(content).toContain("onAiGuidanceAcknowledgedChange");
  });
});
