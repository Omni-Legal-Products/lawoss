import { expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StdioClientTransport } from "@modelcontextprotocol/sdk/client/stdio.js";

for (const full of [false, true]) test(`bundled Node stdio server exposes ${full ? "all opted-in tools" : "only everyday tools"} and enforces live access`, async () => {
  const root = await mkdtemp(join(tmpdir(), "actaport-bundle-"));
  let allowWrites = true;
  let toolsets = full ? ["records", "finance", "administration", "uploads"] : [];
  const secret = "test-bridge-capability-with-at-least-32-characters";
  const bridge = Bun.serve({ hostname: "127.0.0.1", port: 0, fetch(request) {
    if (request.headers.get("Authorization") !== `Bearer ${secret}`) return new Response(null, { status: 401 });
    return Response.json({ accessToken: "private-test-token", expiresAt: Date.now() + 300_000, allowWrites, toolsets });
  } });
  const descriptor = join(root, "connection.json");
  await writeFile(descriptor, JSON.stringify({ baseUrl: `http://127.0.0.1:${bridge.port}/`, token: secret }), { mode: 0o600 });
  const transport = new StdioClientTransport({ command: "node", args: [fileURLToPath(new URL("../dist/index.mjs", import.meta.url))],
    env: { ACTAPORT_CONNECTION_FILE: descriptor, ACTAPORT_TOOLSETS: "all" }, stderr: "pipe" });
  let stderr = "";
  transport.stderr?.on("data", (chunk) => { stderr += String(chunk); });
  const client = new Client({ name: "bundle-smoke", version: "1" });
  try {
    await client.connect(transport);
    const tools = await client.listTools();
    expect(tools.tools).toHaveLength(full ? 92 : 15);
    if (!full) {
      expect(tools.tools.every((item) => item.annotations?.readOnlyHint)).toBe(true);
      expect(tools.tools.some((item) => item.name === "actaport_search_documents")).toBe(true);
      const hidden = await client.callTool({ name: "actaport_get_rechnungen", arguments: {} });
      expect(JSON.stringify(hidden)).toContain("tool_unavailable");
      return;
    }
    expect(tools.tools.find((item) => item.name === "actaport_create_kontakt")?.annotations?.readOnlyHint).toBe(false);
    allowWrites = false;
    // Revoked writes must fail before reaching the actual Actaport API; no external request is made.
    const result = await client.callTool({ name: "actaport_create_kostenstelle", arguments: {} });
    expect(result.isError).toBe(true);
    expect(JSON.stringify(result)).toContain("read_only");
    expect(JSON.stringify(result)).not.toContain("private-test-token");
    expect(stderr).not.toContain("private-test-token");
    allowWrites = true;
    toolsets = [];
    const disabled = await client.callTool({ name: "actaport_get_rechnungen", arguments: {} });
    expect(disabled.isError).toBe(true);
    expect(JSON.stringify(disabled)).toContain("tool_disabled");
  } finally { await client.close(); bridge.stop(true); await rm(root, { recursive: true, force: true }); }
});
