import type { ConnectorConnection } from "./schema.js";
import type { ServerConfig } from "../types.js";
import { ApiError } from "../errors.js";
import { oauthVaultPath, vaultLock } from "../file-storage/oauth/vault.js";
import { connectionProvider } from "./definition.js";

const slotKey = (config: ServerConfig, id: string) => `${oauthVaultPath(config)}:connector-account:${connectionProvider(id)}`;
const pending = new Map<string, { expiresAt: number }>();

export function requireSingleConnectorAccount(connections: Pick<ConnectorConnection, "id">[]) {
  if (connections.length > 1) throw new ApiError(409, "connector_multiple_accounts", "Only one account is supported per connector. Disconnect the extra accounts in Integrations to continue.");
}

export function requireConnectorConnectSlot(connections: ConnectorConnection[], connectionId?: string, method?: "nango" | "custom") {
  requireSingleConnectorAccount(connections);
  if (!connectionId && connections.length) throw new ApiError(409, "connector_already_connected", "This connector already has an account. Reconnect it, or disconnect it before connecting another account.");
  if (connectionId) {
    const connection = connections.find((item) => item.id === connectionId);
    if (!connection) throw new ApiError(404, "connector_connection_not_found", "Connection not found.");
    if (method && (connection.source ?? "nango") !== method) throw new ApiError(409, "connector_connection_method", "Reconnect with this account's existing sign-in method, or disconnect it before changing methods.");
  }
}

export function withConnectorConnectLock<T>(config: ServerConfig, id: string, run: () => Promise<T>) {
  return vaultLock(slotKey(config, id), run);
}

/** Reserve the shared Outlook/mail slot before starting either auth method. */
export function reserveConnectorConnectSlot(config: ServerConfig, id: string) {
  const key = slotKey(config, id);
  const previous = pending.get(key);
  if (previous && previous.expiresAt > Date.now()) throw new ApiError(409, "connector_connection_pending", "Finish or cancel this connector's current sign-in before starting another.");
  const reservation = { expiresAt: Date.now() + 5 * 60_000 };
  pending.set(key, reservation);
  return {
    expiresAt(value: number) { reservation.expiresAt = value; },
    release() { if (pending.get(key) === reservation) pending.delete(key); },
  };
}
