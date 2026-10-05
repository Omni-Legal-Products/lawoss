import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";
import {
  isChatgptSubscription,
  recommendedSubscriptionModel,
  subscriptionModels,
} from "../../../../../lawoss/providers/chatgpt-subscription.mjs";

export {
  CHATGPT_RECOMMENDED_MODELS,
  CHATGPT_SUBSCRIPTION_MODELS,
  isChatgptSubscription,
  isSubscriptionModel,
} from "../../../../../lawoss/providers/chatgpt-subscription.mjs";

type Provider = ProviderListResponse["all"][number];

const OPENAI_PROVIDER_ID = "openai";

/**
 * Zoznam poskytovateľov, v ktorom má predplatné ChatGPT len použiteľné modely
 * (`lawoss/providers/chatgpt-subscription.mjs`). Predvolený model poskytovateľa je
 * odporúčaná Luna; automatický výber (`pickDefaultModel`) ho berie, keď používateľ
 * nemá vlastnú voľbu. Ak Luna chýba a predvolený model OpenCode bol vyradený,
 * predvolený sa zahodí a automatický výber vezme prvý použiteľný.
 */
export function filterSubscriptionModels(value: ProviderListResponse): ProviderListResponse {
  if (!value.all.some(isChatgptSubscription)) return value;
  const defaults = { ...value.default };
  const all = value.all.map((provider: Provider): Provider => {
    if (!isChatgptSubscription(provider)) return provider;
    const models = subscriptionModels(provider);
    const recommended = recommendedSubscriptionModel(models);
    if (recommended) defaults[provider.id] = recommended;
    else if (defaults[provider.id] !== undefined && !models[defaults[provider.id]]) delete defaults[provider.id];
    return { ...provider, models };
  });
  return { ...value, all, default: defaults };
}

type ErrorRecord = Record<string, unknown>;

const isRecord = (value: unknown): value is ErrorRecord => typeof value === "object" && value !== null;
const asRecord = (value: unknown): ErrorRecord | null => (isRecord(value) ? value : null);

const CODEX_ACCOUNT_REJECTION = /not supported when using codex with a chatgpt account/i;
const MODEL_REJECTION = /not supported|unsupported|does not exist|not found|not available/i;

/**
 * Kľúč prekladu pre odmietnutý model predplatného ChatGPT, inak `null`.
 * Presné znenie odpovede Codexu nie je overené na reálnom účte, preto sa okrem známej
 * vety berie aj kombinácia HTTP 400, poskytovateľ `openai` a zmienka o modeli.
 */
export function subscriptionModelErrorKey(error: unknown): string | null {
  const root = asRecord(error);
  if (!root) return typeof error === "string" && CODEX_ACCOUNT_REJECTION.test(error) ? "lawoss.models.subscription_unsupported" : null;
  const data = asRecord(root.data);
  const records = [root, data, asRecord(root.cause), asRecord(asRecord(root.cause)?.data)].filter((record): record is ErrorRecord => record !== null);
  const text = records
    .flatMap((record) => ["message", "responseBody", "body", "detail", "error"].map((key) => record[key]))
    .filter((value): value is string => typeof value === "string")
    .join("\n");
  if (CODEX_ACCOUNT_REJECTION.test(text)) return "lawoss.models.subscription_unsupported";
  const status = records.map((record) => record.statusCode ?? record.status).find((value) => typeof value === "number");
  const provider = records.map((record) => record.providerID ?? record.provider).find((value) => typeof value === "string");
  const openai = provider === OPENAI_PROVIDER_ID || /chatgpt\.com\/backend-api\/codex/i.test(text);
  if (status === 400 && openai && /\bmodel\b/i.test(text) && MODEL_REJECTION.test(text)) return "lawoss.models.subscription_unsupported";
  return null;
}
