import { randomBytes } from "node:crypto";
import type { ServerConfig } from "../types.js";
import { tokensMatch } from "../utils.js";

// A narrow process-local grant for the owner's managed engine, not a host/admin token.
// Never persist it, return it to a client, or accept it on connection-management routes.
const capabilities = new WeakMap<ServerConfig, string>();
export function connectorRuntimeCapability(config: ServerConfig) {
  const existing = capabilities.get(config);
  if (existing) return existing;
  const token = randomBytes(32).toString("base64url");
  capabilities.set(config, token);
  return token;
}
export function hasConnectorRuntimeCapability(config: ServerConfig, request: Request) {
  const expected = capabilities.get(config);
  const supplied = request.headers.get("x-legalwork-connector-token");
  return Boolean(expected && supplied && tokensMatch(supplied, expected));
}
export function hasConnectorHostAuthorization(config: ServerConfig, request: Request) {
  const supplied = request.headers.get("x-legalwork-host-token");
  return Boolean(supplied && tokensMatch(supplied, config.hostToken));
}
