import type { McpServerSource } from "../../app/types";

export type McpConfigExportEntry = {
  name: string;
  config: unknown;
  source?: McpServerSource;
  disabledByTools?: boolean;
};

type McpExportDisabledReason = "config" | "tools";

type McpLocalConfigExport = {
  type: "local";
  command: string[];
  cwd?: string;
  environment?: Record<string, string>;
  enabled?: boolean;
  timeout?: number;
};

type McpRemoteConfigExport = {
  type: "remote";
  url: string;
  enabled?: boolean;
  headers?: Record<string, string>;
  oauth?: false | {
    clientId?: string;
    clientSecret?: string;
    scope?: string;
    callbackPort?: number;
    redirectUri?: string;
  };
  timeout?: number;
};

export type McpConfigExport = {
  payload: { mcp: Record<string, McpLocalConfigExport | McpRemoteConfigExport> };
  json: string;
  selected: Array<{
    name: string;
    source?: McpServerSource;
    disabledReasons: McpExportDisabledReason[];
  }>;
};

const LOCAL_FIELDS = new Set(["type", "command", "cwd", "environment", "enabled", "timeout"]);
const REMOTE_FIELDS = new Set(["type", "url", "enabled", "headers", "oauth", "timeout"]);
const OAUTH_FIELDS = new Set(["clientId", "clientSecret", "scope", "callbackPort", "redirectUri"]);

function compareCodeUnits(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function own(value: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(value, key);
}

function fail(name: string, detail: string): never {
  throw new Error(`MCP ${name}: ${detail}`);
}

function rejectUnknownFields(name: string, value: Record<string, unknown>, supported: ReadonlySet<string>, prefix = ""): void {
  const unknown = Object.keys(value).filter((key) => !supported.has(key)).sort(compareCodeUnits)[0];
  if (unknown) fail(name, `unsupported ${prefix}field ${unknown}`);
}

function stringMap(name: string, field: string, value: unknown): Record<string, string> {
  if (!isObject(value)) fail(name, `${field} must be an object of strings`);
  const result: Record<string, string> = Object.create(null);
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    const item = value[key];
    if (typeof item !== "string") fail(name, `${field}.${key} must be a string`);
    result[key] = item;
  }
  return result;
}

function optionalBoolean(name: string, config: Record<string, unknown>, field: string): boolean | undefined {
  if (!own(config, field)) return undefined;
  const value = config[field];
  if (typeof value !== "boolean") fail(name, `${field} must be a boolean`);
  return value;
}

function optionalFiniteNumber(name: string, config: Record<string, unknown>, field: string): number | undefined {
  if (!own(config, field)) return undefined;
  const value = config[field];
  if (typeof value !== "number" || !Number.isFinite(value)) fail(name, `${field} must be a finite number`);
  return value;
}

function localConfig(name: string, config: Record<string, unknown>): McpLocalConfigExport {
  rejectUnknownFields(name, config, LOCAL_FIELDS);
  const command = config.command;
  if (!Array.isArray(command) || command.length === 0 || command.some((part) => typeof part !== "string" || part.trim().length === 0)) {
    fail(name, "command must be a non-empty string array");
  }
  if (own(config, "cwd") && typeof config.cwd !== "string") fail(name, "cwd must be a string");

  const result: McpLocalConfigExport = { type: "local", command: [...command] };
  if (typeof config.cwd === "string") result.cwd = config.cwd;
  if (own(config, "environment")) result.environment = stringMap(name, "environment", config.environment);
  const enabled = optionalBoolean(name, config, "enabled");
  if (enabled !== undefined) result.enabled = enabled;
  const timeout = optionalFiniteNumber(name, config, "timeout");
  if (timeout !== undefined) result.timeout = timeout;
  return result;
}

function remoteUrl(name: string, value: unknown): string {
  if (typeof value !== "string" || value.length === 0) fail(name, "url must be a non-empty string");
  const normalized = value.trim();
  if (value !== normalized) fail(name, "url must not include surrounding whitespace");
  if (!/^https?:\/\//i.test(normalized)) fail(name, "url must start with http(s)://");
  if (/[{}]/.test(normalized)) fail(name, "url contains an unfilled placeholder");
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") fail(name, "url must use http(s)");
  } catch (error) {
    if (error instanceof Error && error.message.startsWith(`MCP ${name}:`)) throw error;
    fail(name, "url must be a valid URL");
  }
  return normalized;
}

function oauthConfig(name: string, value: unknown): McpRemoteConfigExport["oauth"] {
  if (value === false) return false;
  if (!isObject(value)) fail(name, "oauth must be false or an object");
  rejectUnknownFields(name, value, OAUTH_FIELDS, "oauth ");
  const result: Exclude<McpRemoteConfigExport["oauth"], false | undefined> = {};
  for (const field of ["clientId", "clientSecret", "scope"] as const) {
    if (!own(value, field)) continue;
    if (typeof value[field] !== "string") fail(name, `oauth.${field} must be a string`);
    result[field] = value[field];
  }
  if (own(value, "callbackPort")) {
    if (typeof value.callbackPort !== "number" || !Number.isFinite(value.callbackPort)) {
      fail(name, "oauth.callbackPort must be a finite number");
    }
    result.callbackPort = value.callbackPort;
  }
  if (own(value, "redirectUri")) {
    if (typeof value.redirectUri !== "string") fail(name, "oauth.redirectUri must be a string");
    result.redirectUri = value.redirectUri;
  }
  return result;
}

function remoteConfig(name: string, config: Record<string, unknown>): McpRemoteConfigExport {
  rejectUnknownFields(name, config, REMOTE_FIELDS);
  const result: McpRemoteConfigExport = { type: "remote", url: remoteUrl(name, config.url) };
  const enabled = optionalBoolean(name, config, "enabled");
  if (enabled !== undefined) result.enabled = enabled;
  if (own(config, "headers")) result.headers = stringMap(name, "headers", config.headers);
  if (own(config, "oauth")) result.oauth = oauthConfig(name, config.oauth);
  const timeout = optionalFiniteNumber(name, config, "timeout");
  if (timeout !== undefined) result.timeout = timeout;
  return result;
}

function canonicalConfig(name: string, value: unknown): McpLocalConfigExport | McpRemoteConfigExport {
  if (!isObject(value)) fail(name, "config must be an object");
  if (!own(value, "type")) fail(name, "missing type/config");
  if (value.type === "local") return localConfig(name, value);
  if (value.type === "remote") return remoteConfig(name, value);
  fail(name, "type must be local or remote");
}

export function buildMcpConfigExport(
  entries: readonly McpConfigExportEntry[],
  selectedNames: readonly string[],
): McpConfigExport {
  if (selectedNames.length === 0) throw new Error("Select at least one MCP connector");

  const byName = new Map<string, McpConfigExportEntry>();
  for (const entry of entries) {
    if (byName.has(entry.name)) fail(entry.name, "duplicate effective entry");
    byName.set(entry.name, entry);
  }

  const names = [...new Set(selectedNames)].sort(compareCodeUnits);
  const mcp: Record<string, McpLocalConfigExport | McpRemoteConfigExport> = Object.create(null);
  const selected: McpConfigExport["selected"] = [];
  for (const name of names) {
    const entry = byName.get(name);
    if (!entry) fail(name, "selected connector was not found");
    if (typeof entry.disabledByTools !== "boolean") fail(name, "effective disabled state is unknown");

    const config = canonicalConfig(name, entry.config);
    const disabledReasons: McpExportDisabledReason[] = [];
    if (config.enabled === false) disabledReasons.push("config");
    if (entry.disabledByTools) {
      disabledReasons.push("tools");
      config.enabled = false;
    }
    mcp[name] = config;
    selected.push({ name, source: entry.source, disabledReasons });
  }

  const payload = { mcp };
  return { payload, json: `${JSON.stringify(payload, null, 2)}\n`, selected };
}
