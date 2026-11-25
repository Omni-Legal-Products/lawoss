/**
 * Visible Codex subscription models and their priority service tier, verified in
 * the 2026-11-25 Codex model inventory. Availability still depends on the account.
 * The native catalog supplies the selectable IDs and routes each Fast alias.
 */
export const CHATGPT_SUBSCRIPTION_MODELS = new Set([
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
  "gpt-6.1-terra",
  "gpt-6.2-sol",
  "gpt-6.2-astra",
]);

/**
 * Odporúčaný model na testovanie (MČ 5. 10. 2026: „Luna“), v poradí prednosti.
 * `gpt-6-luna`: Codex ho vedie ako aktuálny rýchly a lacný model (priorita 4,
 * „Fast and affordable model for easier tasks“), `gpt-5.6-luna` ako starší
 * (priorita 7, „Older fast and efficient model“). Starší katalóg OpenCode
 * `gpt-6-luna` nemá, vtedy sa vezme `gpt-5.6-luna`.
 */
export const CHATGPT_RECOMMENDED_MODELS = ["gpt-6-luna", "gpt-5.6-luna"];

/**
 * Zdroj poskytovateľa v tvare OpenCode 1.x z integrácie enginu 2.1.4, ktorý pole `source` nemá. Rozhoduje aktívne
 * pripojenie (prvé v `connections`, ako `integration.connection.active` enginu): prihlásenie OAuth je `custom`
 * (predplatné ChatGPT, metóda `chatgpt-token-sharing`), uložený kľúč `api`, premenná prostredia `env`, bez
 * pripojenia `config`.
 */
export function nativeConnectionSource(integration) {
  const active = integration?.connections?.[0];
  if (!active) return "config";
  if (active.type === "env") return "env";
  return active.method === "oauth" ? "custom" : "api";
}

/**
 * OpenAI pripojené cez predplatné ChatGPT. OpenCode dáva poskytovateľovi zdroj `custom`,
 * keď ho pripojí loader pluginu z OAuth záznamu; API kľúč má zdroj `api`, premenná
 * prostredia `env`, konfigurácia `config` (overené na OpenCode 1.18.29 so syntetickým
 * `auth.json`). Tie ostávajú bez zmeny. Na engine v2 zdroj dopočíta `nativeConnectionSource`.
 */
export function isChatgptSubscription(provider) {
  return provider?.id === "openai" && provider?.source === "custom";
}

// This non-wire setting is set only on definitions the engine bound to the
// active subscription. The host projects it as read-only display metadata.
export const NATIVE_SUBSCRIPTION_MARKER = "lawossSubscriptionModel";

/** Base models and their priority aliases from a bound inventory, or the offline fallback. */
export function isSubscriptionModel(key, model) {
  const id = model?.modelID ?? model?.api?.id ?? model?.id ?? key;
  const verified = model?.legalwork?.subscriptionModel === true || model?.settings?.[NATIVE_SUBSCRIPTION_MARKER] === true;
  return (verified || CHATGPT_SUBSCRIPTION_MODELS.has(id)) && (key === id || key === `${id}-fast`);
}

/** Keep account-bound and known offline subscription choices on the OAuth route. */
export function subscriptionModels(provider) {
  const models = provider?.models ?? {};
  if (!isChatgptSubscription(provider)) return models;
  return Object.fromEntries(Object.entries(models).filter(([key, model]) => isSubscriptionModel(key, model)));
}

/** Prvý odporúčaný model, ktorý je v zozname, inak `undefined`. */
export function recommendedSubscriptionModel(models) {
  return CHATGPT_RECOMMENDED_MODELS.find((id) => Object.prototype.hasOwnProperty.call(models ?? {}, id));
}
