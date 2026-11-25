import type { Plugin } from "@opencode/plugin";
import type { ProviderEditor } from "@opencode/plugin/promise/provider";
import { Model } from "@opencode/schema/model";
import { z } from "zod";
import { NATIVE_SUBSCRIPTION_MARKER } from "../../../../lawoss/providers/chatgpt-subscription.mjs";

// OpenCode 2.1.4 applies this fixed inventory before external provider plugins.
// Match the exact fingerprint before supplementing it. A future native account
// inventory is authoritative even when it offers just one model.
const pinnedBase = ["gpt-5.5", "gpt-5.6-luna", "gpt-5.6-sol", "gpt-5.6-terra", "gpt-6-astra", "gpt-6-luna", "gpt-6-sol", "gpt-6.1-sol"];
const pinned = new Set(pinnedBase.flatMap(id => [id, `${id}-fast`]));
const catalogModel = z.object({
  slug: z.string().min(1), display_name: z.string().min(1), visibility: z.string(), supported_in_api: z.boolean(),
  context_window: z.number().int().positive(), input_modalities: z.array(z.string()),
  supported_reasoning_levels: z.array(z.object({ effort: z.string().min(1) })).optional(),
  service_tiers: z.array(z.object({ id: z.string() })).optional(), additional_speed_tiers: z.array(z.string()).optional(),
});
type SubscriptionModel = { id: string; name: string; context: number; inputs: string[]; efforts: string[]; fast?: boolean };
type AccountInventory = { connectionID: string; models: SubscriptionModel[] };
const additions: SubscriptionModel[] = [
  { id: "gpt-6.1-terra", name: "GPT-6.1 Terra", context: 500_000 },
  { id: "gpt-6.2-sol", name: "GPT-6.2 Sol", context: 500_000 },
  { id: "gpt-6.2-astra", name: "GPT-6.2 Astra", context: 272_000 },
].map(model => ({ ...model, inputs: ["text", "image"], efforts: ["low", "medium", "high", "xhigh", "max", "ultra"], fast: true }));

/** Read only the active credential's native model metadata. No model-list HTTP request. */
export async function subscriptionAccountInventory(ctx: Plugin.Context): Promise<AccountInventory | undefined> {
  const connection = await ctx.integration.connection.active("openai");
  if (connection?.type !== "credential" || connection.method !== "oauth") return;
  const credential = await ctx.integration.connection.resolve(connection);
  if (credential?.type !== "oauth" || credential.methodID !== "chatgpt-token-sharing") return;
  const inventory = credential.metadata?.models;
  if (!Array.isArray(inventory)) return;
  const models = inventory.flatMap(value => {
    const parsed = catalogModel.safeParse(value);
    if (!parsed.success || parsed.data.visibility !== "list" || !parsed.data.supported_in_api) return [];
    const model = parsed.data;
    return [{
      id: model.slug, name: model.display_name, context: model.context_window, inputs: model.input_modalities,
      efforts: model.supported_reasoning_levels?.map(level => level.effort) ?? [],
      fast: model.service_tiers ? model.service_tiers.some(tier => tier.id === "priority") : model.additional_speed_tiers?.includes("fast"),
    }];
  });
  return { connectionID: connection.id, models };
}

export function restoreChatGptModels(editor: ProviderEditor, cached?: AccountInventory) {
  const record = editor.get("openai");
  const connection = record?.sourceConnection;
  if (!record || connection?.type !== "credential" || connection.method !== "oauth") return;
  const account = cached?.connectionID === connection.id ? cached.models : undefined;
  const fallback = record.models.size === pinned.size && [...pinned].every(key => record.models.has(key));
  if (!account && !fallback) {
    for (const model of record.models.values()) {
      if (model.id !== model.modelID && !(model.id === `${model.modelID}-fast` && model.body?.service_tier === "priority")) continue;
      editor.models.update("openai", model.id, value => { value.settings = { ...value.settings, [NATIVE_SUBSCRIPTION_MARKER]: true }; });
    }
    return;
  }

  const selected = new Set<string>();
  for (const entry of account ?? additions) {
    const fast = entry.fast ?? record.models.get(`${entry.id}-fast`)?.body?.service_tier === "priority";
    for (const priority of fast ? [false, true] : [false]) {
      const key = priority ? `${entry.id}-fast` : entry.id;
      selected.add(key);
      const previous = record.models.get(key);
      editor.models.update("openai", key, model => {
        model.modelID = Model.ID.make(entry.id);
        model.name = priority ? `${entry.name} Fast` : entry.name;
        model.limit = { context: entry.context, output: Math.min(entry.context, previous?.limit.output ?? (account ? model.limit.output : 128_000)) };
        model.capabilities = { tools: true, input: entry.inputs, output: ["text"], temperature: false };
        model.variants = entry.efforts.map(effort => ({ id: Model.VariantID.make(effort), settings: { reasoningEffort: effort } }));
        model.settings = { ...model.settings, [NATIVE_SUBSCRIPTION_MARKER]: true };
        if (priority) model.body = { ...model.body, service_tier: "priority" };
      });
    }
  }
  if (account) for (const key of record.models.keys()) if (!selected.has(key)) editor.models.remove("openai", key);
}
