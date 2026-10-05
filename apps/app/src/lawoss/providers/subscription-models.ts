import type { ProviderListResponse } from "@opencode-ai/sdk/v2/client";

type Provider = ProviderListResponse["all"][number];

/**
 * Modely, ktoré prihlásenie cez predplatné ChatGPT (OAuth, nie API kľúč) skutočne obslúži.
 *
 * OpenCode pri OAuth sám zužuje katalóg (plugin `openai`, `provider.models`), jeho zoznam
 * však zaostáva: v 1.18.29 ponúka aj `gpt-5.4`, `gpt-5.4-mini` a `gpt-5.3-codex-spark`,
 * ktoré Codex backend pre účet ChatGPT odmietne s HTTP 400 (D1, 5. 10. 2026).
 *
 * Zdroj: zoznam modelov, ktorý Codex backend vrátil pre účet ChatGPT
 * (`~/.codex/models_cache.json`, `fetched_at` 2026-10-05, codex 0.160.0, viditeľnosť `list`).
 * Overené pre jeden účet; iné plány (Plus, Team, Edu) môžu mať menej modelov, preto
 * odmietnutie modelu aj tak dostane zrozumiteľnú hlášku (`subscriptionModelErrorKey`).
 * `gpt-5.5` chýba zámerne: Codex ho ukončuje 14. 10. 2026, teda počas alfy.
 *
 * Porovnáva sa `api.id`, nie kľúč katalógu: varianty `-fast` (priority tier) zdieľajú
 * `api.id` so základným modelom. Zoznam obsahuje aj modely, ktoré pripnutý OpenCode
 * zatiaľ nemá, aby ich zvýšenie verzie nepotrebovalo zmenu kódu.
 */
export const CHATGPT_SUBSCRIPTION_MODELS: ReadonlySet<string> = new Set([
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
]);

const OPENAI_PROVIDER_ID = "openai";

/**
 * OpenAI pripojené cez predplatné ChatGPT. OpenCode dáva poskytovateľovi zdroj `custom`,
 * keď ho pripojí loader pluginu z OAuth záznamu; API kľúč má zdroj `api`, premenná
 * prostredia `env`, konfigurácia `config` (overené na OpenCode 1.18.29 so syntetickým
 * `auth.json`). Tie ostávajú bez zmeny.
 */
export function isChatgptSubscription(provider: Pick<Provider, "id" | "source">): boolean {
  return provider.id === OPENAI_PROVIDER_ID && provider.source === "custom";
}

function filterProvider(provider: Provider): Provider {
  if (!isChatgptSubscription(provider)) return provider;
  const models = Object.fromEntries(
    Object.entries(provider.models ?? {}).filter(([, model]) => CHATGPT_SUBSCRIPTION_MODELS.has(model.api?.id ?? model.id)),
  );
  // Prázdny prienik by poskytovateľa potichu skryl (bez modelov nie je „pripojený“).
  // Vtedy radšej ponechať zoznam OpenCode; odmietnutie pokryje zrozumiteľná hláška.
  return Object.keys(models).length > 0 ? { ...provider, models } : provider;
}

/**
 * Zoznam poskytovateľov, v ktorom má ChatGPT predplatné len použiteľné modely.
 * Predvolený model OpenCode sa zahodí, ak ukazuje na vyradený, aby automatický
 * výber vzal prvý použiteľný.
 */
export function filterSubscriptionModels(value: ProviderListResponse): ProviderListResponse {
  if (!value.all.some(isChatgptSubscription)) return value;
  const all = value.all.map(filterProvider);
  const defaults = { ...value.default };
  for (const provider of all) {
    const id = defaults[provider.id];
    if (id !== undefined && isChatgptSubscription(provider) && !provider.models[id]) delete defaults[provider.id];
  }
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
