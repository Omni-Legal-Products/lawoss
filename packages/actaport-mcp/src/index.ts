import { readFile, stat } from "node:fs/promises";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import { ActaportError, createTokenProvider, credentialsSchema, type TokenProvider } from "./auth.js";
import { ActaportClient } from "./client.js";
import { createActaportServer } from "./server.js";
import { parseToolsets, selectedOperationIds, toolsetsSchema } from "./toolsets.js";

const bridgeSchema = z.object({ baseUrl: z.url(), token: z.string().min(32) });
const accessSchema = z.object({ accessToken: z.string().min(1), expiresAt: z.number(), allowWrites: z.boolean(), toolsets: toolsetsSchema.default([]) });

async function main() {
  const connectionFile = process.env.ACTAPORT_CONNECTION_FILE;
  const credentialsFile = process.env.ACTAPORT_CREDENTIALS_FILE;
  let allowWrites = process.env.ACTAPORT_ALLOW_WRITES === "1";
  let toolsets = parseToolsets(connectionFile ? undefined : process.env.ACTAPORT_TOOLSETS);
  let provider: TokenProvider;
  if (connectionFile) {
    const descriptor = bridgeSchema.parse(JSON.parse(await readFile(connectionFile, "utf8")));
    const url = new URL(descriptor.baseUrl);
    if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error("Invalid Actaport connection bridge.");
    provider = async (force = false) => {
      const response = await fetch(new URL("token", url), { method: "POST", redirect: "error", signal: AbortSignal.timeout(35_000),
        headers: { Authorization: `Bearer ${descriptor.token}`, "Content-Type": "application/json" }, body: JSON.stringify({ force }) });
      if (!response.ok) throw new ActaportError("reconnect_required", "Open Actaport connection settings in LegalWork to restore access.");
      const result = accessSchema.parse(await response.json());
      // Enforce the current setting on every call, including already-running MCP processes.
      allowWrites = result.allowWrites;
      toolsets = result.toolsets;
      return result;
    };
    await provider();
  } else if (credentialsFile) {
    const info = await stat(credentialsFile);
    if (!info.isFile() || info.size > 16_384 || process.platform !== "win32" && (info.mode & 0o077) !== 0) throw new Error("Credential file must be private (chmod 600) and contain only API credentials.");
    provider = createTokenProvider(credentialsSchema.parse(JSON.parse(await readFile(credentialsFile, "utf8"))));
  } else throw new Error("Connect Actaport in LegalWork, or set ACTAPORT_CREDENTIALS_FILE to a private credential file.");
  const client = new ActaportClient(provider, { fileRoot: process.env.ACTAPORT_FILE_ROOT,
    get allowWrites() { return allowWrites; },
    isOperationEnabled: (operation) => selectedOperationIds(toolsets, true).has(operation.operationId) });
  const server = createActaportServer(client, { allowWrites, toolsets });
  await server.connect(new StdioServerTransport());
  const close = async () => { await server.close(); process.exit(0); };
  process.on("SIGTERM", close);
  process.on("SIGINT", close);
}

main().catch(() => {
  process.stderr.write("Actaport MCP could not start. Check the connection settings or private credential file.\n");
  process.exitCode = 1;
});
