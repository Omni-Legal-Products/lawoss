/**
 * Časové limity pre lokálne modely (Ollama, LM Studio, llama.cpp…).
 *
 * OpenCode čaká na hlavičky odpovede a na každý ďalší kúsok streamu predvolene 5 minút
 * (`headerTimeout`, `chunkTimeout`). Lokálny model počas spracovania dlhého promptu
 * (systém + nástroje, desiatky tisíc tokenov) neposiela nič, takže prvá požiadavka na
 * bežnom notebooku vypršala a celé kolo sa opakovalo (D1 2026-10-05). Cloudoví
 * poskytovatelia ostávajú na predvolených hodnotách.
 */
export const LOCAL_PROVIDER_TIMEOUT_MS = 30 * 60_000;

const LOCAL_HOST = /^(?:localhost|127(?:\.\d{1,3}){3}|\[?::1\]?|[^.]+\.local|[\w-]+\.localhost)$/i;

/** Je adresa providera na tomto počítači alebo v lokálnej sieti cez `.local`? */
export function isLocalModelEndpoint(baseURL: string): boolean {
  try {
    return LOCAL_HOST.test(new URL(baseURL.trim()).hostname);
  } catch {
    return false;
  }
}

/** Voľby providera, ktoré sa pridajú k `baseURL` pri lokálnom modeli; pre ostatných nič. */
export function localProviderTimeouts(baseURL: string): { headerTimeout: number; chunkTimeout: number } | Record<string, never> {
  return isLocalModelEndpoint(baseURL)
    ? { headerTimeout: LOCAL_PROVIDER_TIMEOUT_MS, chunkTimeout: LOCAL_PROVIDER_TIMEOUT_MS }
    : {};
}
