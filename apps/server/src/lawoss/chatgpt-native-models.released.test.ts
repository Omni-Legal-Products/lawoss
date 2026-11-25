import { expect, test } from "bun:test";
import { join, resolve } from "node:path";
import { waitForNativeFixture } from "../native-mcp.test-support.js";
import { nativeMcpEngine } from "../native-mcp-engine.test-support.js";
import { buildNativePluginFixture } from "../opencode-plugins/native-plugin-build.test-support.js";
import { CHATGPT_SUBSCRIPTION_MODELS, isSubscriptionModel } from "../../../../lawoss/providers/chatgpt-subscription.mjs";

test.skipIf(!process.env.LEGALWORK_TEST_OPENCODE_BIN)("released subscription sends the selected tier and reasoning effort independently", async () => {
  const received: Array<{ model: string; service_tier?: string; reasoning?: { effort?: string } }> = [];
  const receiver = Bun.serve({ hostname: "127.0.0.1", port: 0, async fetch(request) {
    received.push(await request.json());
    return Response.json({ error: { message: "End of synthetic request" } }, { status: 400 });
  } });
  let engine: Awaited<ReturnType<typeof nativeMcpEngine>> | undefined;
  try {
    engine = await nativeMcpEngine(async root => {
      const plugin = join(root, "plugin");
      await buildNativePluginFixture(resolve(import.meta.dir, "../opencode-plugins/legalwork-model-catalog.ts"), join(plugin, "index.js"));
      return {
        plugins: [plugin],
        providers: { openai: { settings: { baseURL: `${receiver.url.origin}/v1`, transport: "http", encoding: "none" } } },
        policies: [{ action: "provider.use", resource: "*", effect: "deny" }, { action: "provider.use", resource: "openai", effect: "allow" }],
      };
    });
    const client = engine.client(), location = engine.location;
    await client.credential.create({ integrationID: "openai", activate: true, value: {
      type: "oauth", methodID: "chatgpt-token-sharing", access: "synthetic-test", refresh: "synthetic-refresh", expires: Date.now() + 3_600_000,
    } });
    const models = (await client.model.list({ location })).data.filter(model => model.providerID === "openai");
    for (const model of CHATGPT_SUBSCRIPTION_MODELS) {
      expect(models.find(entry => entry.id === model)?.modelID).toBe(model);
      expect(models.find(entry => entry.id === `${model}-fast`)).toMatchObject({ modelID: model, body: { service_tier: "priority" } });
    }
    for (const [id, variant] of [["gpt-6.2-sol-fast", "high"], ["gpt-6.2-astra", "low"]]) {
      const session = await client.session.create({ location, model: { providerID: "openai", id, variant } });
      await client.session.prompt({ sessionID: session.id, text: "Synthetic fixture" });
      await client.session.wait({ sessionID: session.id }, { signal: AbortSignal.timeout(15_000) });
      const calls = received.splice(0);
      const body = calls.find(call => call.reasoning?.effort === variant && call.model === id.replace(/-fast$/, ""));
      expect(body).toBeDefined();
      expect(body?.service_tier).toBe(id.endsWith("-fast") ? "priority" : undefined);
    }
    const future = { slug: "future-account-model", display_name: "Synthetic account model", visibility: "list", supported_in_api: true,
      context_window: 32000, input_modalities: ["text"], supported_reasoning_levels: [{ effort: "high" }], service_tiers: [{ id: "priority" }] };
    await client.credential.create({ integrationID: "openai", activate: true, value: {
      type: "oauth", methodID: "chatgpt-token-sharing", access: "synthetic-limited", refresh: "synthetic", expires: Date.now() + 3_600_000,
      metadata: { models: [future, { slug: "incomplete" }, { ...future, slug: "private-hidden", visibility: "hide" }, { ...future, slug: "ui-only", supported_in_api: false }] },
    } });
    const read = async () => (await engine!.client().model.list({ location })).data.filter(model => model.providerID === "openai");
    const limited = await waitForNativeFixture(read, list => list.some(model => model.id === future.slug), "bound account inventory");
    expect(limited.map(model => model.id).sort()).toEqual([future.slug, future.slug + "-fast"]);
    for (const model of limited) expect(isSubscriptionModel(model.id, model)).toBe(true);
    await client.credential.create({ integrationID: "openai", activate: true, value: { type: "key", key: "synthetic-key" } });
    const api = await waitForNativeFixture(read, list => !list.some(model => model.id === future.slug), "API key catalog");
    expect(api.some(model => model.id === "gpt-5.4")).toBe(true);
  } finally {
    await engine?.close();
    receiver.stop(true);
  }
}, 60_000);
