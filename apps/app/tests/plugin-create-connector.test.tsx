import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { emptyPluginConnectorForm, pluginConnectorConfig, PluginConnectorFields } from "../src/react-app/domains/settings/pages/plugin-connector-fields";

test("remote plugins support OAuth, bearer keys, custom headers and no authentication", () => {
  const form = { ...emptyPluginConnectorForm, url: "example.com/mcp" };
  expect(pluginConnectorConfig(form)).toEqual({ type: "remote", url: "https://example.com/mcp", headers: {}, oauth: {} });
  expect(pluginConnectorConfig({ ...form, clientId: "client", clientSecret: "secret" })).toMatchObject({ oauth: { clientId: "client", clientSecret: "secret" } });
  expect(pluginConnectorConfig({ ...form, auth: "key", apiKey: " token " })).toMatchObject({ headers: { Authorization: "Bearer token" }, oauth: false });
  expect(pluginConnectorConfig({ ...form, auth: "none", headers: [{ name: "X-API-Key", value: "secret" }] })).toMatchObject({ headers: { "X-API-Key": "secret" }, oauth: false });
  expect(() => pluginConnectorConfig({ ...form, url: "file:///etc/passwd" })).toThrow();
  expect(() => pluginConnectorConfig({ ...form, auth: "key" })).toThrow();
  expect(() => pluginConnectorConfig({ ...form, headers: [{ name: "X-Key", value: "one" }, { name: "x-key", value: "two" }] })).toThrow();
});

test("local commands preserve argument boundaries and environment credentials", () => {
  expect(pluginConnectorConfig({ ...emptyPluginConnectorForm, mode: "local", command: "/Applications/My Tool/server", arguments: '--name\na b\n"quoted"', environment: [{ name: "API_KEY", value: "secret" }] })).toEqual({ type: "local", command: ["/Applications/My Tool/server", "--name", "a b", '"quoted"'], environment: { API_KEY: "secret" } });
  expect(pluginConnectorConfig({ ...emptyPluginConnectorForm, mode: "existing" })).toBeUndefined();
});

test("custom plugin exposes URL, local command and optional credential fields", () => {
  const remote = renderToStaticMarkup(<PluginConnectorFields form={emptyPluginConnectorForm} onChange={() => {}} disabled={false} />);
  expect(remote).toContain("MCP URL");
  expect(remote).toContain("Use local command");
  expect(remote).toContain("Authentication &amp; advanced options");
  expect(remote).not.toMatch(/<details[^>]*\bopen/);
  expect(remote).toContain("OAuth client ID (optional)");
  expect(remote).toContain('type="password"');
  const local = renderToStaticMarkup(<PluginConnectorFields form={{ ...emptyPluginConnectorForm, mode: "local" }} onChange={() => {}} disabled={false} />);
  expect(local).toContain("Arguments, one per line");
  expect(local).toContain("Environment variables and credentials (optional)");
});
