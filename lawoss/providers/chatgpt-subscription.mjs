/**
 * Modely, ktoré prihlásenie cez predplatné ChatGPT (OAuth, nie API kľúč) skutočne obslúži.
 * Jeden zdroj pre appku (zoznam poskytovateľov) aj server (tabuľková revízia).
 *
 * OpenCode pri OAuth sám zužuje katalóg (plugin `openai`, `provider.models`), jeho zoznam
 * však zaostáva: v 1.18.29 ponúka aj `gpt-5.4`, `gpt-5.4-mini` a `gpt-5.3-codex-spark`,
 * ktoré Codex backend pre účet ChatGPT odmietne s HTTP 400 (D1, 5. 10. 2026).
 *
 * Zdroj: zoznam modelov, ktorý Codex backend vrátil pre účet ChatGPT
 * (`~/.codex/models_cache.json`, `fetched_at` 2026-10-05, codex 0.160.0, viditeľnosť `list`).
 * Overené pre jeden účet; iné plány (Plus, Team, Edu) môžu mať menej modelov.
 * `gpt-5.5` chýba zámerne: Codex ho ukončuje 14. 10. 2026, teda počas alfy.
 * Zoznam obsahuje aj modely, ktoré pripnutý OpenCode v starom katalógu nemá, aby zvýšenie
 * verzie alebo obnova katalógu nepotrebovali zmenu kódu.
 */
export const CHATGPT_SUBSCRIPTION_MODELS = new Set([
  "gpt-5.6-luna",
  "gpt-5.6-sol",
  "gpt-5.6-terra",
  "gpt-6-astra",
  "gpt-6-sol",
  "gpt-6-luna",
  "gpt-6.1-sol",
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
 * OpenAI pripojené cez predplatné ChatGPT. OpenCode dáva poskytovateľovi zdroj `custom`,
 * keď ho pripojí loader pluginu z OAuth záznamu; API kľúč má zdroj `api`, premenná
 * prostredia `env`, konfigurácia `config` (overené na OpenCode 1.18.29 so syntetickým
 * `auth.json`). Tie ostávajú bez zmeny.
 */
export function isChatgptSubscription(provider) {
  return provider?.id === "openai" && provider?.source === "custom";
}

/**
 * Model z povoleného zoznamu, bez variantov rýchlosti (`-fast`, `-flex`, `-ultrafast`):
 * tie OpenCode skladá z toho istého `api.id` s iným `serviceTier` a pre advokáta
 * znamenajú len vyššiu spotrebu predplatného (MČ 5. 10. 2026).
 */
export function isSubscriptionModel(key, model) {
  const id = model?.api?.id ?? model?.id ?? key;
  return key === id && CHATGPT_SUBSCRIPTION_MODELS.has(id);
}

/**
 * Modely poskytovateľa, ktoré predplatné prijme. Prázdny prienik by poskytovateľa potichu
 * skryl (bez modelov nie je „pripojený“); vtedy ostáva zoznam OpenCode a odmietnutie
 * pokryje zrozumiteľná hláška.
 */
export function subscriptionModels(provider) {
  const models = provider?.models ?? {};
  if (!isChatgptSubscription(provider)) return models;
  const allowed = Object.fromEntries(Object.entries(models).filter(([key, model]) => isSubscriptionModel(key, model)));
  return Object.keys(allowed).length > 0 ? allowed : models;
}

/** Prvý odporúčaný model, ktorý je v zozname, inak `undefined`. */
export function recommendedSubscriptionModel(models) {
  return CHATGPT_RECOMMENDED_MODELS.find((id) => Object.prototype.hasOwnProperty.call(models ?? {}, id));
}
