import type { ModelRef, ProviderListItem } from "@/app/types";

type ProviderModel = ProviderListItem["models"][string];

/**
 * Id fragments of endpoints that cannot drive an agent loop even when the
 * catalogue does not flag them (image, speech, embedding, realtime models).
 */
const NON_CHAT_ID_FRAGMENTS = ["image", "audio", "tts", "transcribe", "realtime", "embed"];

/** `modelID` is the catalogue key — the id that goes into the request. */
export function isAgentCapableModel(modelID: string, model: ProviderModel): boolean {
  if (model.capabilities?.toolcall !== true) return false;
  const id = modelID.toLowerCase();
  return !NON_CHAT_ID_FRAGMENTS.some((fragment) => id.includes(fragment));
}

/**
 * Pick the default model when exactly one provider is connected: the
 * provider's advertised default if it can call tools, else the first
 * tool-capable chat model in catalogue order. Null when there is nothing to
 * choose between (zero or several providers) or nothing usable — the composer
 * then keeps its connect-AI state instead of sending every prompt to a model
 * that fails with HTTP 404 "No endpoints found that support tool use"
 * (OpenRouter's newest catalogue entry was an image model).
 */
export function pickDefaultModel(
  providers: ProviderListItem[],
  advertisedDefaults: Record<string, string> = {},
): ModelRef | null {
  if (providers.length !== 1) return null;
  const provider = providers[0];
  const entries = Object.entries(provider.models ?? {});
  const advertisedID = advertisedDefaults[provider.id];
  const chosen =
    entries.find(([modelID, model]) => modelID === advertisedID && isAgentCapableModel(modelID, model)) ??
    entries.find(([modelID, model]) => isAgentCapableModel(modelID, model));
  return chosen ? { providerID: provider.id, modelID: chosen[0] } : null;
}
