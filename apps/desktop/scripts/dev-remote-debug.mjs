/**
 * LAWOSS: dev launcher no longer forces port 9823. Without an override,
 * main.mjs retains upstream automatic CDP for the built-in browser;
 * the explicit setting `off` disables it entirely.
 */

/** Port musí byť celé číslo 1–65535; čokoľvek iné sa ignoruje. */
export function parseRemoteDebugPort(raw) {
  const value = typeof raw === "string" ? raw.trim() : "";
  if (!/^\d+$/.test(value)) return null;
  const port = Number(value);
  return port >= 1 && port <= 65535 ? String(port) : null;
}

/**
 * Premenné prostredia pre ladiaci port: prázdny objekt, keď ho nikto nežiada.
 * @param {NodeJS.ProcessEnv} env
 */
export function remoteDebugEnv(env) {
  const raw = typeof env?.LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT === "string"
    ? env.LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT.trim()
    : "";
  // `off` je pokyn pre main.mjs, aby port neotváral vôbec — nie port.
  if (raw.toLowerCase() === "off") return { LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT: "off" };
  const port = parseRemoteDebugPort(raw);
  return port ? { LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT: port } : {};
}
