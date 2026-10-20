import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { AiGuidance } from "../src/lawoss/domains/ai/guidance";

// UI assertions verify presentation and selection only. Server receiver tests own admission evidence.
test("all locales show unsupported processing and require an explicit jurisdiction for reading only", () => {
  for (const locale of ["cs", "sk", "en", "de"] as const) {
    const html = renderToStaticMarkup(<AiGuidance locale={locale} />);
    expect(html).toContain('data-lawoss-ai-governance="unsupported"');
    expect(html).toContain('value="" selected=""');
    expect(html).toContain('disabled=""');
    expect(html).not.toContain('type="checkbox"');
  }
});

test("native guidance uses the resolved live URL and both current credentials for reads and writes", async () => {
  const {createAiGuidanceClient} = await import("../src/lawoss/domains/ai/guidance");
  const received: Array<{path: string; token: string | null; hostToken: string | null; body: unknown}> = [];
  const server = Bun.serve({hostname: "127.0.0.1", port: 0, async fetch(request) {
    received.push({path: new URL(request.url).pathname, token: request.headers.get("authorization"), hostToken: request.headers.get("x-legalwork-host-token"), body: request.method === "POST" ? await request.json() : null});
    return Response.json({reply: "PUBLIC_SYNTHETIC_OK"});
  }});
  try {
    const client = createAiGuidanceClient({normalizedBaseUrl: server.url.origin, resolvedToken: "current-client", resolvedHostToken: "current-native-host", source: "desktop-runtime", hostInfo: null});
    await client.aiGovernance();
    await client.acknowledgeAiGuidance("2026-10-17", "CZ");
    expect((await client.runPublicAiPrompt({providerId: "fixture", modelId: "synthetic", text: "public synthetic"})).reply).toBe("PUBLIC_SYNTHETIC_OK");
    expect(received.map(request => request.path)).toEqual(["/lawoss/ai-governance", "/lawoss/ai-governance/acknowledge", "/lawoss/ai-governance/public-text"]);
    for (const request of received) {expect(request.token).toBe("Bearer current-client"); expect(request.hostToken).toBe("current-native-host");}
    expect(received[2].body).toEqual({providerId: "fixture", modelId: "synthetic", text: "public synthetic"});
  } finally {server.stop(true);}
});
