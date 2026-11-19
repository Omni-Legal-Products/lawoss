import type { ServerConfig } from "../types.js";

/** LAWOSS #561: the embedder stops the managed engine before the HTTP server.
 * Releasing first ends the native event streams the server relays as a normal
 * end of stream; an engine that dies during the run still errors them. */
const releases = new WeakMap<ServerConfig, AbortController>();

export function startEngineEventsLifetime(config: ServerConfig): AbortController {
  const release = new AbortController();
  releases.set(config, release);
  return release;
}

export function untilEngineEventsReleased(config: ServerConfig, signal: AbortSignal): AbortSignal {
  const release = releases.get(config);
  return release ? AbortSignal.any([signal, release.signal]) : signal;
}
