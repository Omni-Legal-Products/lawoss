import { connectorDefinitions } from "../connectors/schema.js";
import { savedConnectorConnections } from "../connectors/broker.js";
import { connectorWriteSetting } from "../connectors/settings.js";
import { createConnectorRequest } from "../connectors/request.js";
import { ApiError } from "../errors.js";
import type { ServerConfig } from "../types.js";
import type { StorageInput } from "@legalwork/types/file-storage";
import type { StoredStorage } from "./store.js";
import { adapterBindings } from "./service.js";
import { googleStorageAdapter, isCloudStorage, microsoftStorageAdapter } from "./cloud-drives.js";

export const isConnectorStorageId = (id: string) => id.startsWith("connector:");
/** Accounts already exist in the connector vault. These are views, never new authentication grants. */
export class ConnectorStorageAccounts {
  constructor(private config: ServerConfig) {}
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
  async bind<T extends StorageInput & { team?: StoredStorage["team"] }>(item: T): Promise<T> {
    const config = item.config;
    if (!isCloudStorage(config)) return item;
    if (item.team) throw new ApiError(403, "storage_personal_account", "Personal Google and Microsoft accounts cannot be installed as shared team storage.");
    const setting = await connectorWriteSetting(this.config, config.provider);
    item.readOnly = item.readOnly || !setting.writeAccess || setting.readOnly;
    adapterBindings.set(item, async () => {
      await this.validate(item);
      const request = await createConnectorRequest(this.config, config.provider, config.accountId);
      return config.provider === "google-drive" ? googleStorageAdapter(config, request) : microsoftStorageAdapter(config, request);
    });
    return item;
  }
}
