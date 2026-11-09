import { connectorDefinitions } from "../connectors/schema.js";
import { savedConnectorConnections } from "../connectors/broker.js";
import { connectorWriteSetting } from "../connectors/settings.js";
import { createConnectorRequest, createAuthorizedConnectorRequest } from "../connectors/request.js";
import type { TeamStorage } from "./team.js";
import { ApiError } from "../errors.js";
import type { ServerConfig } from "../types.js";
import type { StorageInput } from "@legalwork/types/file-storage";
import type { StoredStorage } from "./store.js";
import { adapterBindings } from "./service.js";
import { googleStorageAdapter, isCloudStorage, microsoftStorageAdapter } from "./cloud-drives.js";

export const isConnectorStorageId = (id: string) => id.startsWith("connector:");
/** Accounts already exist in the connector vault. These are views, never new authentication grants. */
export class ConnectorStorageAccounts {
  constructor(private config: ServerConfig, private team?: TeamStorage) {}
  async list(workspaceId: string): Promise<StoredStorage[]> {
    const groups = await Promise.all(connectorDefinitions.filter((provider) => provider.kind === "files").map(async (provider) => {
      const accounts = await savedConnectorConnections(this.config, provider.id);
      if (accounts.length !== 1 || accounts[0].needsReconnect) return [];
      const account = accounts[0];
      const setting = await connectorWriteSetting(this.config, provider.id);
      return [{ id: `connector:${provider.id}:${account.id}`, workspaceId, name: provider.name,
        config: { kind: "oauth", provider: provider.id, accountId: account.id, root: "" },
        readOnly: !setting.writeAccess || setting.readOnly, enabled: true, secrets: {},
        updatedAt: Date.parse(account.createdAt ?? "") || 0,
      } satisfies StoredStorage];
    }));
    return groups.flat();
  }
  async validate(input: StorageInput) {
    if (!isCloudStorage(input.config)) return;
    const config = input.config;
    const accounts = await savedConnectorConnections(this.config, config.provider);
    const account = accounts.length === 1 ? accounts[0] : undefined;
    if (!account || account.needsReconnect || config.accountId !== account.id) throw new ApiError(409, "storage_disconnected", "Reconnect the original account in File Storage, or add a folder view for the new account.");
  }
  async bind<T extends StorageInput & { team?: StoredStorage["team"]; workspaceId?: string; id?: string }>(source: T): Promise<T> {
    const item = { ...source };
    const config = item.config;
    if (!isCloudStorage(config)) return item;
    const setting = await connectorWriteSetting(this.config, config.provider);
    item.readOnly = item.readOnly || !setting.writeAccess || setting.readOnly;
    adapterBindings.set(item, async () => {
      let accountId = config.accountId;
      const team = this.team, grant = item.team, workspaceId = item.workspaceId;
      const shared = grant && config.sharingMode === "team";
      if (grant && (!team || !workspaceId || !item.id)) throw new ApiError(403, "storage_team_unavailable", "The team connection is unavailable.");
      if (grant && !shared) {
        const accounts = await savedConnectorConnections(this.config, config.provider);
        if (accounts.length !== 1 || accounts[0].needsReconnect)
          throw new ApiError(409, "storage_signin_required", "Connect your own account in File Storage to use this team location.");
        accountId = accounts[0].id;
      }
      const effective = { ...config, accountId };
      if (!shared) await this.validate({ ...item, config: effective });
      const request = shared && team && workspaceId ? await createAuthorizedConnectorRequest(this.config, config.provider, {
        token: (force) => team.accessToken(workspaceId, item.id!, grant.version, force),
        assertCurrent: async (writing) => {
          const current = (await team.list(workspaceId)).connections.find((entry) => entry.id === item.id);
          if (!current?.team?.installed || !current.enabled || current.team.version !== grant.version)
            throw new ApiError(409, "storage_team_unavailable", "This team connection changed. Refresh Memory Drive.");
          if (writing && current.readOnly) throw new ApiError(403, "storage_read_only", "This team storage is read-only.");
        },
      }) : await createConnectorRequest(this.config, config.provider, accountId);
      const view = { ...effective, ...(grant ? { accountId: item.id } : {}) };
      return config.provider === "google-drive" ? googleStorageAdapter(view, request) : microsoftStorageAdapter(view, request);
    });
    return item;
  }
}
