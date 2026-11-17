/**
 * Revízia #486: aktualizácia pripojenia z doplnku, ktorého záznam vytvoril starší kód bez `connectorDefaults`.
 * Hodnotu advokáta tu nevieme odlíšiť od runtime starej verzie (napr. `command` s cestou do starého
 * `plugin-resources/<digest>`, kam sa dosadil `${CLAUDE_PLUGIN_ROOT}`). Z doterajšieho pripojenia preto ostane len to,
 * čo nastavuje advokát (`environment`, `headers`, `oauth`, adresa doplnená za premenné, vypnutie); príkaz, argumenty,
 * `cwd` a ostatné cesty sú vždy z novej verzie. Kľúč, kde nová verzia dosadila cestu do `plugin-resources`, je runtime.
 * Po aktualizácii sa `connectorDefaults` uložia a ďalšie aktualizácie idú cez trojcestné `mergeConnectorSetup`.
 */
import { connectorConfigVariables } from "../connector-config.js";

const isRecord = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const RESOURCE_PATH = /plugin-resources[\\/]/;

export function legacyConnectorSetup(next: Record<string, unknown>, current: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = { ...next };
  for (const key of ["environment", "headers"]) {
    const configured = current[key];
    if (!isRecord(configured)) continue;
    const defaults = isRecord(next[key]) ? next[key] : {};
    const merged: Record<string, unknown> = { ...defaults };
    for (const [name, value] of Object.entries(configured)) {
      const fallback = defaults[name];
      if (typeof fallback === "string" && RESOURCE_PATH.test(fallback)) continue;
      merged[name] = value;
    }
    result[key] = merged;
  }
  if (current.oauth !== undefined && next.type === "remote") result.oauth = current.oauth;
  if (typeof current.url === "string" && connectorConfigVariables(next.url).length) result.url = current.url;
  if (typeof current.disabled === "boolean") result.disabled = current.disabled;
  if (connectorConfigVariables(result).length) result.disabled = true;
  return result;
}
