import type { StorageConnection } from "@legalwork/types/file-storage";
import { connectorDefinitions, connectorIsConnected, type ConnectorStatus } from "@legalwork/types/connectors";
import type { HubScope } from "./hub-scope-context";

export function storageConnectionsForScope(connections: StorageConnection[], scope: HubScope) {
  return connections.filter((connection) =>
    scope === "team" ? Boolean(connection.team) : !connection.team || connection.team.installed,
  );
}

/** Team installation and the member's saved sign-in are independent. */
export function storageNeedsSignIn(connection: StorageConnection, status?: ConnectorStatus) {
  const config = connection.config;
  if (!status || !connection.enabled || config.kind !== "oauth" || config.sharingMode === "team"
    || !connectorDefinitions.some(provider => provider.kind === "files" && provider.id === config.provider)) return false;
  const provider = status.connectors.find(provider => provider.id === config.provider);
  return !provider || !connectorIsConnected(provider)
    || Boolean(!connection.team && config.accountId && provider.connections[0].id !== config.accountId);
}
