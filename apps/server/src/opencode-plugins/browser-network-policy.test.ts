import { expect, test } from "bun:test";
import { LegalWorkSandbox } from "./legalwork-sandbox.js";
import { LegalWorkExtensionsPreview } from "./legalwork-extensions-preview.js";
import { requireBrowserNetwork } from "./browser-network-policy.js";

test("browser tools use fresh effective chat policy, including native tools and generic UI actions", async () => {
  let settings: unknown = { enabled: true, networkMode: "allow" };
  let status = 200;
  const paths: string[] = [];
  const api = Bun.serve({ port: 0, fetch(request) {
    const path = new URL(request.url).pathname;
    paths.push(path);
    expect(request.headers.get("authorization")).toBe("Bearer fixture");
    if (path === "/workspaces") return Response.json({ items: [{ id: "project", path: "/project" }] });
    if (path === "/workspace/project/sandbox/session/calling-chat") return Response.json(settings, { status });
    return new Response("Unexpected route", { status: 404 });
  } });
  const previous = { url: process.env.LEGALWORK_SERVER_URL, token: process.env.LEGALWORK_SERVER_TOKEN };
  process.env.LEGALWORK_SERVER_URL = api.url.origin;
  process.env.LEGALWORK_SERVER_TOKEN = "fixture";
  try {
    const plugin = await LegalWorkSandbox({ directory: "/project" });
    const before = plugin["tool.execute.before"];
    const tools = ["browser_navigate", "browser_eval", "browser_snapshot", "browser_click", "browser_fill", "browser_screenshot",
      "legalwork_browser_open_url", "legalwork_browser_batch", "legalwork_browser_downloads", "legalwork_browser_set_proxy", "legalwork_browser_clear_proxy", "mcp_browser_navigate"];
    const browserUi = ["browser.open_url", "browser.set_proxy"];
    for (const enabled of [true, false]) {
      for (const networkMode of ["allow", "approve", "block"]) {
        settings = { enabled, networkMode, source: "organization" };
        for (const tool of [...tools, ...browserUi]) {
          const call = before({ tool: browserUi.includes(tool) ? "legalwork_ui_execute_action" : tool, sessionID: "calling-chat" }, {
            args: { actionId: tool, sessionId: "forged-allowed-chat", workspaceId: "other-project", directory: "/other-project" },
          });
          if (enabled && networkMode !== "allow") await expect(call).rejects.toThrow("Browser tools are disabled");
          else await call;
        }
      }
    }
    expect(new Set(paths)).toEqual(new Set(["/workspaces", "/workspace/project/sandbox/session/calling-chat"]));
    const count = paths.length;
    await before({ tool: "read", sessionID: "calling-chat" }, { args: {} });
    await before({ tool: "legalwork_ui_execute_action", sessionID: "calling-chat" }, { args: { actionId: "documents.open" } });
    await before({ tool: "legalwork_webfetch", sessionID: "calling-chat" }, { args: {} });
    expect(paths).toHaveLength(count);
    await expect(before({ tool: "browser_eval" }, { args: {} })).rejects.toThrow("calling session");
    status = 503;
    await expect(before({ tool: "browser_eval", sessionID: "calling-chat" }, { args: {} })).rejects.toThrow("could not be verified");
    status = 200;
    settings = {};
    await expect(requireBrowserNetwork({ directory: "/project", sessionID: "calling-chat" })).rejects.toThrow();
    settings = { enabled: true, networkMode: "approve" };
    const extensions = await LegalWorkExtensionsPreview({ directory: "/project" });
    const context = { directory: "/project", sessionID: "calling-chat" };
    await expect(extensions.tool.legalwork_browser_open_url.execute({ url: "https://example.org" }, context)).rejects.toThrow("disabled");
    await expect(extensions.tool.legalwork_browser_set_proxy.execute({ proxy: "http://example.org:8080" }, context)).rejects.toThrow("disabled");
    await expect(extensions.tool.legalwork_browser_clear_proxy.execute({}, context)).rejects.toThrow("disabled");
    await expect(extensions.tool.legalwork_ui_execute_action.execute({ actionId: "browser.open_url", args: { url: "https://example.org", sessionId: "other-chat" } }, context)).rejects.toThrow("disabled");
  } finally {
    if (previous.url === undefined) delete process.env.LEGALWORK_SERVER_URL; else process.env.LEGALWORK_SERVER_URL = previous.url;
    if (previous.token === undefined) delete process.env.LEGALWORK_SERVER_TOKEN; else process.env.LEGALWORK_SERVER_TOKEN = previous.token;
    api.stop(true);
  }
});
