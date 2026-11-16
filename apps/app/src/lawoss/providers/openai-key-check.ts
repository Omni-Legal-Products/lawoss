import { LegalworkServerError } from "@/app/lib/legalwork-server";

const OPENAI_BASE_URL = "https://api.openai.com/v1";

type ListModels = (input: { baseURL: string; apiKey: string }) => Promise<string[]>;

/**
 * LAWOSS #502: before saving a built-in OpenAI key, list models with it through the
 * existing worker discovery route. Only an explicit 401 rejects the key; a missing
 * worker, network failure or a restricted key without model-list scope (403) still saves.
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
