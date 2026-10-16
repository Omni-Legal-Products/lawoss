// Disposable MCP server. Exercise real discovery and tool execution without an
// account, network connector or package installation.
import { z } from "zod";

for await (const line of console) {
  const input = z.object({ id: z.union([z.string(), z.number()]).optional(), method: z.string(), params: z.unknown().optional() }).parse(JSON.parse(line));
  if (input.id === undefined) continue;
  const result = input.method === "initialize"
    ? { protocolVersion: z.object({ protocolVersion: z.string() }).parse(input.params).protocolVersion, capabilities: { tools: {} }, serverInfo: { name: "cache-fixture", version: "1" } }
    : input.method === "tools/list"
      ? { tools: [{ name: "echo", description: "Echo a synthetic cache fixture value", inputSchema: { type: "object", properties: { value: { type: "string" } }, required: ["value"], additionalProperties: false } }] }
      : input.method === "tools/call"
        ? { content: [{ type: "text", text: `MCP fixture: ${z.object({ arguments: z.object({ value: z.string() }) }).parse(input.params).arguments.value}` }] }
        : {};
  console.log(JSON.stringify({ jsonrpc: "2.0", id: input.id, result }));
}
