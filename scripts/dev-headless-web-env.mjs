/** Client env for `dev:headless-web`. The host token is added only for a loopback server URL. */

export function isLoopbackClientUrl(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return false;
  try {
    const hostname = new URL(trimmed).hostname.toLowerCase();
    return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
  } catch {
    return false;
  }
}

/**
 * Vite env for the headless web client. The collaborator token is always set.
 * The host token is added when the client talks to loopback, so Dnes can read
 * the practice. A public client URL does not receive it.
 */
export function headlessWebViteEnv({
  env,
  viteHost,
  webPort,
  legalworkUrl,
  legalworkPort,
  legalworkToken,
  legalworkHostToken,
}) {
  const viteEnv = {
    ...env,
    HOST: viteHost,
    PORT: String(webPort),
    VITE_LEGALWORK_URL: env.VITE_LEGALWORK_URL ?? legalworkUrl,
    VITE_LEGALWORK_PORT: env.VITE_LEGALWORK_PORT ?? String(legalworkPort),
    VITE_LEGALWORK_TOKEN: env.VITE_LEGALWORK_TOKEN ?? legalworkToken,
  };
  if (isLoopbackClientUrl(viteEnv.VITE_LEGALWORK_URL) && !viteEnv.VITE_LEGALWORK_HOST_TOKEN) {
    viteEnv.VITE_LEGALWORK_HOST_TOKEN = legalworkHostToken;
  }
  return viteEnv;
}
