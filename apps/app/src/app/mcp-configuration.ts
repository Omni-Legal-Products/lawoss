import { connectorConfigVariables, connectorUsesOAuth, resolveConnectorConfig } from "@legalwork/types/connector-config";
import type { McpServerConfig, McpServerEntry } from "./types";
import type { McpDirectoryInfo } from "./constants";
import { mcpAuthEntryFromServer } from "./mcp-connect-state";

export function editableConnectorConfig(config: McpServerConfig): McpServerConfig {
  return { ...config, ...(!connectorUsesOAuth(config) ? { oauth: false } : {}), ...(config.url?.includes("configure-before-connecting.invalid") ? { url: "${SERVER_URL}" } : {}) };
}
export function connectorNeedsSetup(config: McpServerConfig): boolean {
  return connectorConfigVariables(editableConnectorConfig(config)).length > 0;
}
export function usesBasicCredentialTemplate(config: McpServerConfig): boolean {
  return Object.entries(config.headers ?? {}).some(([name, value]) => /^authorization$/i.test(name) && value === "Basic ${BASIC_AUTH_CREDENTIALS}");
}
export function configuredConnectorEntry(entry: McpServerEntry, config: McpServerConfig, values: Record<string, string>): McpDirectoryInfo {
  const answers = { ...values };
  if (usesBasicCredentialTemplate(config) && answers.BASIC_AUTH_CREDENTIALS) answers.BASIC_AUTH_CREDENTIALS = btoa(String.fromCharCode(...new TextEncoder().encode(answers.BASIC_AUTH_CREDENTIALS)));
  const resolved = resolveConnectorConfig(config, answers);
  if (resolved.type === "remote") {
    const url = new URL(resolved.url ?? "");
    if (!/^https?:$/.test(url.protocol) || /[{}]/.test(resolved.url ?? "")) throw new Error("Enter a complete server URL.");
  }
  return {
    ...mcpAuthEntryFromServer({ ...entry, config: resolved }),
    type: resolved.type,
    url: resolved.url,
    command: resolved.command,
    cwd: resolved.cwd,
    timeout: resolved.timeout,
    environment: resolved.environment,
    headers: resolved.headers,
    oauth: connectorUsesOAuth(resolved) ? resolved.oauth ? true : undefined : false,
    oauthConfig: resolved.oauth || undefined,
    existingConfig: resolved,
  };
}
