import { describe, expect, test } from "bun:test";
import { activatePlugin } from "../src/lawoss/domains/marketplace/activation";
import { MARKETPLACE_CATALOG } from "../src/lawoss/domains/marketplace/catalog";

describe("marketplace activation", () => {
  test("uses the reviewed immutable source and reports installer failure", async () => {
    const entry = MARKETPLACE_CATALOG.find((item) => item.id === "orsr")!;
    const requests: unknown[] = [];
    const client = { installClaudePlugin: async (workspace: string, payload: unknown) => { requests.push({workspace,payload}); throw new Error("Download failed"); } };
    await expect(activatePlugin(client, "ws-alpha", entry)).rejects.toThrow("Download failed");
    expect(requests).toEqual([{ workspace: "ws-alpha", payload: { url: "https://github.com/Omni-Legal-Products/lawoss-marketplace/tree/deff09cf87c6e81bfbeebadf675a67b698920be6/plugins/orsr", ref: "deff09cf87c6e81bfbeebadf675a67b698920be6" } }]);
  });
  test("unsupported entry never calls installation", async () => {
    let called = false;
    const client = { installClaudePlugin: async () => { called = true; return {preview: {warnings: []}}; } };
    await expect(activatePlugin(client, "ws", { ...MARKETPLACE_CATALOG[0], install: {scope: "workspace", action: "preview-only"} })).rejects.toThrow();
    expect(called).toBe(false);
  });
});
