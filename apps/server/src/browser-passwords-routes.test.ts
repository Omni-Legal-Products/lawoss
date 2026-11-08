import { expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { browserPasswords } from "./browser-passwords.js";
import type { ServerConfig } from "./types.js";
import { registerBrowserPasswordRoutes } from "./routes/browser-passwords.js";
import { matchRoute, type Route } from "./routes/registry.js";
import { ApprovalService } from "./approvals.js";
import { ReloadEventStore } from "./events.js";
import { TokenService } from "./tokens.js";
import { ApiError } from "./errors.js";

test("password routes declare host-only access, persist in the shared vault, omit values and honor the write gate", async () => {
  const root = await mkdtemp(join(tmpdir(), "password-routes-"));
  const config: ServerConfig = {
    host: "127.0.0.1", port: 0, token: "test-client", hostToken: "test-host", configPath: join(root, "server.json"),
    approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false,
    startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false,
  };
  const routes: Route[] = [];
  registerBrowserPasswordRoutes({ routes, config, jsonResponse: (data, status) => Response.json(data, { status }), readJsonBody: request => request.json(),
    ensureWritable: value => { if (value.readOnly) throw new ApiError(403, "read_only", "Read-only"); } });
  expect(routes).toHaveLength(3);
  expect(routes.every(route => route.auth === "host-token")).toBe(true);
  const approvals = new ApprovalService(config.approval), reloadEvents = new ReloadEventStore(), tokens = new TokenService(config);
  const call = async (method: string, suffix = "", body?: unknown) => {
    const path = `/browser-passwords${suffix}`, route = matchRoute(routes, method, new URL(`http://localhost${path}`).pathname);
    if (!route) throw new Error("Missing password route");
    const request = new Request(`http://localhost${path}`, { method, ...(body ? { body: JSON.stringify(body), headers: { "content-type": "application/json" } } : {}) });
    return route.handler({ request, url: new URL(request.url), params: route.params, config, approvals, reloadEvents, tokens });
  };
  const payload = { label: "Portal", origin: "https://portal.example.org/login", username: "user", password: "synthetic-route-password" };
  try {
    const saved = await call("PUT", "", payload);
    expect(saved.status).toBe(200);
    const text = await saved.text();
    expect(text).not.toContain(payload.password);
    const { item } = z.object({ item: z.object({ id: z.string().uuid(), origin: z.string() }) }).parse(JSON.parse(text));
    expect(item.origin).toBe("https://portal.example.org");
    const list = await (await call("GET")).text();
    expect(list).toContain(item.id);
    expect(list).not.toContain(payload.password);
    expect(await (await call("GET", "?origin=https%3A%2F%2Fauth.example.org")).json()).toMatchObject({ items: [{ id: item.id }] });
    expect(await (await call("GET", "?origin=https%3A%2F%2Funrelated.example.net")).json()).toEqual({ items: [] });
    await expect(call("GET", "?origin=http%3A%2F%2Finsecure.example.org")).rejects.toThrow("Use HTTPS");
    expect((await browserPasswords(config).get(item.id)).password).toBe(payload.password);
    const updated = await call("PUT", "", { ...payload, id: item.id, label: "Updated", password: "" });
    expect(updated.status).toBe(200);
    expect((await browserPasswords(config).get(item.id)).password).toBe(payload.password);
    config.readOnly = true;
    await expect(call("PUT", "", payload)).rejects.toThrow("Read-only");
    await expect(call("DELETE", `/${item.id}`)).rejects.toThrow("Read-only");
    config.readOnly = false;
    expect((await call("DELETE", `/${item.id}`)).status).toBe(200);
    expect(await (await call("GET")).json()).toEqual({ items: [] });
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
