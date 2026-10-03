import { expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { startServer } from "./server.js";
import type { ServerConfig } from "./types.js";

// Exercise the native file surface used by loadProfilePreview, not a permissive mock.
test("native file API reads only the named OKF configuration and retains authorization", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-config-read-"));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "test-okf-config-client", hostToken: "test-okf-config-host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root], readOnly: true, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  // The test runtime is Bun; startServer also exposes a Node return type.
  const server = await startServer(config) as { port: number; stop(closeActiveConnections?: boolean): void | Promise<void> };
  try {
    await mkdir(join(root, "Office"));
    const content = "matter_folders:\n  - Drafty\n";
    await writeFile(join(root, "Office", "okf.config"), content);
    await writeFile(join(root, "Office", "unrelated.config"), "private configuration");
    const base = `http://127.0.0.1:${server.port}/workspace/ws_1/files/content?path=`;
    const headers = { Authorization: `Bearer ${config.token}` };
    const response = await fetch(base + encodeURIComponent("Office/okf.config"), { headers });
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ path: "Office/okf.config", content });
    expect((await fetch(base + encodeURIComponent("Office/unrelated.config"), { headers })).status).toBe(400);
    expect((await fetch(base + encodeURIComponent("Office/okf.config"))).status).toBe(401);
    expect((await fetch(base + encodeURIComponent("../okf.config"), { headers })).status).toBe(400);
    const write = await fetch(`http://127.0.0.1:${server.port}/workspace/ws_1/files/content`, {
      method: "POST", headers: { ...headers, "Content-Type": "application/json" },
      body: JSON.stringify({ path: "Office/okf.config", content: "replacement" }),
    });
    expect(write.status).toBe(403);
  } finally {
    await server.stop(true);
    await rm(root, { recursive: true, force: true });
  }
});

test("native config save compares content, protects creation and rejects symlinks", async () => {
  const root = await mkdtemp(join(tmpdir(), "okf-config-write-"));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "test-profile-client", hostToken: "test-profile-host",
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: ["*"],
    workspaces: [{ id: "ws_1", name: "Workspace", path: root, preset: "starter", workspaceType: "local" }],
    authorizedRoots: [root], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  // The test runs under Bun; production also supports Node.
  const server = await startServer(config) as { port: number; stop(closeActiveConnections?: boolean): void | Promise<void> };
  const save = (content: string, expectedContent: string | null, path = "Office/okf.config") => fetch(`http://127.0.0.1:${server.port}/workspace/ws_1/files/content`, {
    method: "POST", headers: { Authorization: `Bearer ${config.token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ path, content, expectedContent }),
  });
  try {
    expect((await save("first", null)).status).toBe(200);
    expect((await save("clobber", null)).status).toBe(409);
    expect((await save("second", "first")).status).toBe(200);
    expect((await save("stale", "first")).status).toBe(409);
    const concurrent = await Promise.all([save("winner one", "second"), save("winner two", "second")]);
    expect(concurrent.map((r) => r.status).sort()).toEqual([200, 409]);
    await writeFile(join(root, "outside.md"), "protected");
    await symlink(join(root, "outside.md"), join(root, "Office", "linked.md"));
    expect((await save("overwrite", "protected", "Office/linked.md")).status).toBe(400);
    expect(await readFile(join(root, "outside.md"), "utf8")).toBe("protected");
    // Recheck after the native approval gate, not only when the save first arrives.
    config.approval.mode = "manual";
    config.approval.timeoutMs = 5000;
    const beforeApproval = await readFile(join(root, "Office", "okf.config"), "utf8");
    const pending = save("approved but stale", beforeApproval);
    const hostHeaders = { "x-legalwork-host-token": config.hostToken, "content-type": "application/json" };
    let approvalId: string | undefined;
    for (let attempt = 0; attempt < 50 && !approvalId; attempt++) {
      const data: { items: { id: string }[] } = await (await fetch(`http://127.0.0.1:${server.port}/approvals`, { headers: hostHeaders })).json();
      approvalId = data.items[0]?.id;
      if (!approvalId) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(approvalId).toBeDefined();
    await writeFile(join(root, "Office", "okf.config"), "external edit during approval");
    await fetch(`http://127.0.0.1:${server.port}/approvals/${approvalId}`, {
      method: "POST", headers: hostHeaders, body: JSON.stringify({ reply: "allow" }),
    });
    expect((await pending).status).toBe(409);
    expect(await readFile(join(root, "Office", "okf.config"), "utf8")).toBe("external edit during approval");
  } finally { await server.stop(true); await rm(root, { recursive: true, force: true }); }
});
