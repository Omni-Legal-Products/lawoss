import { LegalworkServerError } from "@/app/lib/legalwork-server";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

type ListModels = (input: { baseURL: string; apiKey: string }) => Promise<string[]>;

/**
 * LAWOSS #502: before saving a built-in OpenAI key, list models with it through the
 * existing worker discovery route. Only an explicit 401 rejects the key; a missing
 * worker, network failure or a restricted key without model-list scope still saves.
 * LAWOSS #524: OpenAI answers such a restricted project key with 401 too ("Missing scopes:
 * api.model.read"), although it works for chat; the worker reports it as
 * `model_discovery_scope_missing`, which is not a rejection.
 */
export async function openAiKeyRejected(providerId: string, apiKey: string, listModels: ListModels) {
  if (providerId !== "openai") return false;
  try {
    await listModels({ baseURL: OPENAI_BASE_URL, apiKey });
    return false;
  } catch (error) {
    return error instanceof LegalworkServerError && error.code === "model_discovery_unauthorized";
  }
}
