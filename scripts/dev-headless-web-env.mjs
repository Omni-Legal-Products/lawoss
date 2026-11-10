/**
 * Client env for `dev:headless-web`. The host token is added only when the server URL is loopback AND the Vite
 * server itself listens on loopback: Vite inlines `VITE_*` into the JavaScript it serves, so with remote access
 * (Vite on 0.0.0.0) anyone on the network could read the host token from the page.
 */

const LOOPBACK_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]"]);

/** A listen host such as `127.0.0.1`, `localhost` or `::1`; `0.0.0.0`, `::` and any other address are not loopback. */
export function isLoopbackListenHost(input) {
  return LOOPBACK_HOSTS.has(String(input ?? "").trim().toLowerCase());
}

export function isLoopbackClientUrl(input) {
  const trimmed = String(input ?? "").trim();
  if (!trimmed) return false;
  try {
    const hostname = new URL(trimmed).hostname.toLowerCase();
    return LOOPBACK_HOSTS.has(hostname);
  } catch {
    return false;
  }
}

/**
 * Vite env for the headless web client. The collaborator token is always set.
 * The host token is added when the client talks to loopback and Vite listens only
 * on loopback, so Dnes can read the practice. A public client URL or a Vite server
 * reachable from the network does not receive it.
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
  if (isLoopbackClientUrl(viteEnv.VITE_LEGALWORK_URL) && isLoopbackListenHost(viteHost) && !viteEnv.VITE_LEGALWORK_HOST_TOKEN) {
    viteEnv.VITE_LEGALWORK_HOST_TOKEN = legalworkHostToken;
  }
  return viteEnv;
}
