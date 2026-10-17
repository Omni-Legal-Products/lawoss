import { afterEach, expect, test } from "bun:test";
import { LegalWorkExtensionsPreview } from "../opencode-plugins/legalwork-extensions-preview.js";
import { connectorDefinitions } from "@legalwork/types/connectors";

const originalFetch = globalThis.fetch;
const savedEnv = ["LEGALWORK_SERVER_URL", "LEGALWORK_WIKI_AGENT_TOKEN", "LEGALWORK_CONNECTOR_TOKEN"].map((key) => ({ key, value: process.env[key] }));
afterEach(() => {
  globalThis.fetch = originalFetch;
  for (const { key, value } of savedEnv) { if (value === undefined) delete process.env[key]; else process.env[key] = value; }
});

test("passes the runtime capability only for registered connector actions and never returns it", async () => {
  process.env.LEGALWORK_SERVER_URL = "http://legalwork.test";
  process.env.LEGALWORK_WIKI_AGENT_TOKEN = "runtime-client";
  process.env.LEGALWORK_CONNECTOR_TOKEN = "private-mail-capability";
  const headers: Headers[] = [];
  globalThis.fetch = Object.assign(async (_input: Parameters<typeof fetch>[0], init?: Parameters<typeof fetch>[1]) => {
    headers.push(new Headers(init?.headers));
    return Response.json({ ok: true, result: { connected: true } });
  }, { preconnect: originalFetch.preconnect });
  const plugin = await LegalWorkExtensionsPreview();
  for (const extensionId of [...connectorDefinitions.map((item) => item.id), "google-workspace"]) {
    const result = await plugin.tool.legalwork_extension_call.execute({ extensionId, action: "status" }, { sessionID: "session", directory: "/synthetic/matter" });
    expect(result).not.toContain("private-mail-capability");
  }
  // The engine names its chat and never sends a server-wide bearer token.
  expect(headers.every((header) => header.get("x-legalwork-wiki-agent-session") === "session" && header.get("authorization") === null)).toBe(true);
  expect(headers.map((header) => header.get("x-legalwork-connector-token"))).toEqual([...connectorDefinitions.map(() => "private-mail-capability"), null]);
});
