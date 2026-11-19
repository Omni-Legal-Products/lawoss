/**
 * LAWOSS #574: overí kľúč API vstavaného poskytovateľa pred uložením.
 * Zoznam modelov OpenRouter je verejný a kľúč nekontroluje, preto sa pýtame
 * koncového bodu `GET /api/v1/key`, ktorý vracia 401 pre neplatný kľúč.
 * Kľúč ani telo odpovede sa nikdy nevracajú ani nelogujú; von ide len výsledok.
 */
export type ProviderKeyCheck = "valid" | "rejected" | "unverified" | "unchecked";

export const PROVIDER_KEY_ENDPOINTS: Readonly<Record<string, string>> = {
  openrouter: "https://openrouter.ai/api/v1/key",
};

export async function checkProviderKey(
  providerId: string,
  apiKey: string,
  endpoints: Readonly<Record<string, string>> = PROVIDER_KEY_ENDPOINTS,
): Promise<ProviderKeyCheck> {
  const endpoint = Object.hasOwn(endpoints, providerId) ? endpoints[providerId] : undefined;
  if (!endpoint) return "unchecked";
  try {
    const response = await fetch(endpoint, {
      headers: { Accept: "application/json", Authorization: `Bearer ${apiKey}` },
      redirect: "error",
      signal: AbortSignal.timeout(10_000),
    });
    await response.body?.cancel().catch(() => {});
    if (response.ok) return "valid";
    return response.status === 401 ? "rejected" : "unverified";
  } catch {
    return "unverified";
  }
}
