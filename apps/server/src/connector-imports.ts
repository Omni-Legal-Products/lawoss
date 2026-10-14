import { createHash } from "node:crypto";
import { lstat, readFile } from "node:fs/promises";
import { basename, isAbsolute, join, resolve } from "node:path";
import { parse as parseToml } from "smol-toml";
import type { PluginImportCandidate, PluginImportConnector, PluginImportProvider } from "@legalwork/types/plugin-import";
import { ApiError } from "./errors.js";
import { isCredentialHeader } from "./connector-config.js";

const MAX_CONFIG_BYTES = 16 * 1024 * 1024;
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function own(value: unknown, key: string): unknown { return record(value) && Object.hasOwn(value, key) ? value[key] : undefined; }

async function readConfig(path: string): Promise<Record<string, unknown>> {
  const info = await lstat(path);
  if (!info.isFile() || info.isSymbolicLink() || info.size > MAX_CONFIG_BYTES) throw new Error("Not an ordinary connector configuration file.");
  const text = await readFile(path, "utf8");
  if (Buffer.byteLength(text) > MAX_CONFIG_BYTES) throw new Error("Connector configuration is too large.");
  const parsed: unknown = /\.toml$/i.test(path) ? parseToml(text) : JSON.parse(text);
  if (!record(parsed)) throw new Error("Expected a configuration object.");
  return parsed;
}

function servers(config: Record<string, unknown>, provider: PluginImportProvider, project?: string): unknown {
  if (project !== undefined) return own(own(own(config, "projects"), project), "mcpServers");
  return own(config, provider === "chatgpt" ? "mcp_servers" : "mcpServers");
}

/** Only metadata leaves discovery. Credentials and unrelated application settings stay local. */
export async function discoverConnectorImports(provider: PluginImportProvider, workspaceRoot: string, home: string, codex: string, claude: string): Promise<PluginImportCandidate[]> {
  const sources: Array<{ path: string; label: string }> = provider === "chatgpt" ? [
    { path: join(codex, "config.toml"), label: "Codex · User settings" },
    { path: join(workspaceRoot, ".codex/config.toml"), label: `Codex · ${basename(workspaceRoot)}` },
  ] : [
    { path: join(home, ".claude.json"), label: "Claude Code · User settings" },
    { path: join(claude, ".claude.json"), label: "Claude Code · User settings" },
    { path: join(workspaceRoot, ".mcp.json"), label: `Claude Code · ${basename(workspaceRoot)}` },
    { path: join(home, "Library/Application Support/Claude/claude_desktop_config.json"), label: "Claude Desktop" },
    { path: join(process.env.APPDATA || join(home, "AppData/Roaming"), "Claude/claude_desktop_config.json"), label: "Claude Desktop" },
    { path: join(home, ".config/Claude/claude_desktop_config.json"), label: "Claude Desktop" },
  ];
  const candidates: PluginImportCandidate[] = [];
  const seen = new Set<string>();
  for (const { path, label } of sources) {
    if (seen.size >= 100 || candidates.length >= 100) break;
    const absolute = resolve(path);
    if (seen.has(absolute)) continue;
    seen.add(absolute);
    try {
      const config = await readConfig(absolute);
      const add = (project?: string) => {
        const entries = servers(config, provider, project);
        if (!record(entries)) return;
        for (const [name, entry] of Object.entries(entries)) {
          if (candidates.length >= 100) return;
          if (!record(entry) || !(typeof entry.url === "string" || typeof entry.command === "string" || Array.isArray(entry.command))) continue;
          candidates.push({ path: absolute, name, version: null, kind: "connector", connector: { name, ...(project !== undefined ? { project } : {}) }, description: project !== undefined ? `Claude Code · ${basename(project)}` : label });
        }
      };
      add();
      if (record(config.projects)) for (const project of Object.keys(config.projects).slice(0, 100)) {
        if (!isAbsolute(project)) continue;
        if (provider === "claude") add(project);
        sources.push({ path: join(project, provider === "chatgpt" ? ".codex/config.toml" : ".mcp.json"), label: `${provider === "chatgpt" ? "Codex" : "Claude Code"} · ${basename(project)}` });
      }
    } catch { /* Missing or malformed source configs must not hide other imports. */ }
  }
  return candidates;
}

export function normalizeImportedConnector(original: Record<string, unknown>, warnings: string[]): Record<string, unknown> {
  const config = { ...original };
  const env = record(original.env) ? { ...original.env } : {};
  if (Array.isArray(original.env_vars)) for (const name of original.env_vars) if (typeof name === "string" && !Object.hasOwn(env, name)) env[name] = `\${${name}}`;
  if (Object.keys(env).length) config.env = env;
  const headers = { ...(record(original.http_headers) ? original.http_headers : {}), ...(record(original.headers) ? original.headers : {}) };
  if (record(original.env_http_headers)) for (const [header, name] of Object.entries(original.env_http_headers)) if (typeof name === "string") headers[header] = `\${${name}}`;
  if (typeof original.bearer_token_env_var === "string") headers.Authorization = `Bearer \${${original.bearer_token_env_var}}`;
  if (Object.keys(headers).length) config.headers = headers;
  if (record(original.oauth)) {
    const oauth = original.oauth;
    config.oauth = {
      ...(typeof (oauth.clientId ?? oauth.client_id) === "string" ? { clientId: oauth.clientId ?? oauth.client_id } : {}),
      ...(typeof (oauth.clientSecret ?? oauth.client_secret) === "string" ? { clientSecret: oauth.clientSecret ?? oauth.client_secret } : {}),
      ...(typeof oauth.scope === "string" ? { scope: oauth.scope } : {}),
      ...(typeof (oauth.callbackPort ?? oauth.callback_port) === "number" ? { callbackPort: oauth.callbackPort ?? oauth.callback_port } : {}),
      ...(typeof (oauth.redirectUri ?? oauth.callbackUrl ?? oauth.callback_url) === "string" ? { redirectUri: oauth.redirectUri ?? oauth.callbackUrl ?? oauth.callback_url } : {}),
    };
  }
  if (original.oauth === undefined && Object.keys(headers).some(isCredentialHeader)) config.oauth = false;
  // Context7 normalizes OAuth callbacks to localhost during authorization and
  // token exchange. Use the same host when its automatic client is registered.
  // https://upstash.com/blog/mcp-oauth-implementation
  if (typeof config.url === "string" && config.oauth !== false) {
    const oauth = record(config.oauth) ? config.oauth : {};
    if (!oauth.clientId && !oauth.redirectUri) {
      try {
        const url = new URL(config.url);
        if (url.hostname === "mcp.context7.com" && /^\/mcp(?:\/oauth)?\/?$/.test(url.pathname)) {
          const port = typeof oauth.callbackPort === "number" ? oauth.callbackPort : 19876;
          config.oauth = { ...oauth, redirectUri: `http://localhost:${port}/mcp/oauth/callback` };
        }
      } catch { /* Unresolved URL templates are handled by connector setup. */ }
    }
  }
  if (typeof original.timeout !== "number" && typeof original.startup_timeout_sec === "number") config.timeout = original.startup_timeout_sec * 1000;
  if (original.http_headers_helper) config.headersHelper = original.http_headers_helper;
  if (original.auth === "chatgpt") warnings.push("ChatGPT-only authentication is not supported for this connector.");
  const policies = ["enabled_tools", "disabled_tools", "tools", "default_tools_approval_mode"];
  if (policies.some(key => original[key] !== undefined)) warnings.push("Codex tool restrictions and approval rules will not carry over. LegalWork's tool permissions apply instead.");
  return config;
}

/** Convert only the selected MCP entry into a small package for the existing review/install pipeline. */
export async function connectorImportBundle(provider: PluginImportProvider, path: string, connector: PluginImportConnector) {
  let source: Record<string, unknown>;
  try { source = await readConfig(path); }
  catch { throw new ApiError(400, "invalid_connector_import", "Could not read this connector configuration. Rescan and select an ordinary JSON or TOML configuration file."); }
  const original = own(servers(source, provider, connector.project), connector.name);
  if (!record(original)) throw new ApiError(400, "invalid_connector_import", "This connector is no longer in its source configuration. Rescan and choose it again.");
  const warnings: string[] = [];
  const config = normalizeImportedConnector(original, warnings);
  config.enabled = false;
  if (original.type === "sdk") throw new ApiError(400, "invalid_connector_import", "This connector requires its original SDK host and cannot run as a standalone MCP server.");
  const name = `connector-${connector.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").slice(0, 32)}-${createHash("sha256").update(JSON.stringify({ provider, path: resolve(path), connector })).digest("hex").slice(0, 12)}`;
  const displayName = connector.name.replace(/[-_]+/g, " ").replace(/\b\w/g, letter => letter.toUpperCase());
  const files: Record<string, string> = {
    [provider === "chatgpt" ? ".codex-plugin/plugin.json" : ".claude-plugin/plugin.json"]: JSON.stringify({ name, interface: { displayName }, description: "Imported MCP connector" }),
    ".mcp.json": JSON.stringify({ mcpServers: { [connector.name]: config } }),
    "LEGALWORK-CONNECTOR-SOURCE.json": JSON.stringify({ provider, path: resolve(path), connector, config: original }, null, 2),
  };
  return { files, warnings };
}
