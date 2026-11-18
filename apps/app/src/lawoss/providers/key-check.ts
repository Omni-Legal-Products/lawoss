import { LegalworkServerError } from "@/app/lib/legalwork-server";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";

/**
 * LAWOSS #502, #524, #574: check of a built-in provider's API key before it is saved.
 * Only an explicit rejection by the provider blocks saving. A missing worker, a network
 * failure or an unexpected answer saves the key with a warning, because offline setup
 * must keep working and an unreachable provider says nothing about the key.
 */
export type ProviderKeyVerdict = "valid" | "rejected" | "unverified" | "unchecked";

const OPENAI_BASE_URL = "https://api.openai.com/v1";
/** Providers the worker checks through `POST /workspace/:id/provider-key-check`. */
const WORKER_CHECKED = new Set(["openrouter"]);

type KeyCheckDeps = {
  listModels: (input: { baseURL: string; apiKey: string }) => Promise<string[]>;
  checkKey: (input: { providerId: string; apiKey: string }) => Promise<ProviderKeyVerdict>;
};

/** An API key never contains whitespace; a key with any inside is other pasted text. */
export function normalizeApiKey(raw: string): string {
  const key = raw.trim();
  if (/\s/.test(key)) throw new Error(t("lawoss.provider_key.whitespace"));
  return key;
}

/**
 * OpenAI is checked by listing models. OpenAI answers a restricted project key without
 * `api.model.read` with 401 too, although it works for chat; the worker reports it as
 * `model_discovery_scope_missing`, which is not a rejection (#524).
 */
async function openAiVerdict(apiKey: string, listModels: KeyCheckDeps["listModels"]): Promise<ProviderKeyVerdict> {
  try {
    await listModels({ baseURL: OPENAI_BASE_URL, apiKey });
    return "valid";
  } catch (error) {
    if (!(error instanceof LegalworkServerError)) return "unverified";
    if (error.code === "model_discovery_unauthorized") return "rejected";
    return error.code === "model_discovery_scope_missing" ? "valid" : "unverified";
  }
}

export async function verifyProviderKey(providerId: string, apiKey: string, deps: KeyCheckDeps): Promise<ProviderKeyVerdict> {
  if (providerId === "openai") return openAiVerdict(apiKey, deps.listModels);
  if (!WORKER_CHECKED.has(providerId)) return "unchecked";
  try {
    return await deps.checkKey({ providerId, apiKey });
  } catch {
    return "unverified";
  }
}

/** The key was saved without a check; tell the user where a later failure comes from. */
export function unverifiedKeyNotice(): string {
  const message = t("lawoss.provider_key.unverified");
  toast.warning(message);
  return message;
}
