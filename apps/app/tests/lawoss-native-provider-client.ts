import type { Client, ProviderListView } from "../src/app/types";

/**
 * LAWOSS test fixture: a minimal engine v2 client that serves a provider view through the native
 * provider, model, integration and MCP endpoints, so `fetchProviderList` builds the view itself.
 * Sources map back to native connections: `custom` is an OAuth sign-in (ChatGPT subscription),
 * `api` a saved key, `env` an environment variable, `config` no connection.
 */
export function nativeProviderClient(view: ProviderListView): Client {
  const location = { directory: "/synthetic" };
  const connections = (source: ProviderListView["all"][number]["source"]) =>
    source === "custom" ? [{ type: "credential", id: "oauth", label: "OAuth", method: "oauth" }]
      : source === "api" ? [{ type: "credential", id: "key", label: "Key", method: "key" }]
      : source === "env" ? [{ type: "env", name: "API_KEY" }] : [];
  const [defaultProvider, defaultModel] = Object.entries(view.default)[0] ?? [];
  const fake = {
    provider: { list: async () => ({ location, data: view.all.filter(provider => view.connected.includes(provider.id)).map(provider => ({ id: provider.id, name: provider.name, integrationID: provider.id })) }) },
    model: {
      list: async () => ({ location, data: view.all.flatMap(provider => Object.entries(provider.models).map(([id, model]) => ({ ...model, id, providerID: provider.id }))) }),
      default: async () => ({ location, data: defaultProvider && defaultModel ? { id: defaultModel, providerID: defaultProvider } : null }),
    },
    integration: { list: async () => ({ location, data: view.all.map(provider => ({ id: provider.id, name: provider.name, methods: [], connections: connections(provider.source) })) }) },
    mcp: { list: async () => ({ location, data: [] }) },
  };
  // Partial native client, limited to the endpoints the provider list reads.
  return fake as unknown as Client;
}
