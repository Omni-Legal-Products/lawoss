/**
 * LAWOSS: ladiaci port Electronu (CDP) sa otvára len na vyžiadanie.
 *
 * `scripts/dev.mjs` dosadzoval `LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT = "9823"`,
 * keď premenná nebola nastavená, takže `pnpm dev` vždy otvoril ladiaci port na
 * loopbacku. Kto sa naň pripojí, riadi okno appky aj jej session. `electron-dev.mjs`
 * pritom premennú berie ako opt-in („Set … to enable"), takže default patril sem.
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
  const port = parseRemoteDebugPort(env?.LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT);
  return port ? { LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT: port } : {};
}
