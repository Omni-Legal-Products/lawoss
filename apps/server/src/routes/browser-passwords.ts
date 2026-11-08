import { browserPasswordOrigin, browserPasswords } from "../browser-passwords.js";
import type { ServerConfig } from "../types.js";
import { addRoute, type Route } from "./registry.js";

export function registerBrowserPasswordRoutes(options: {
  routes: Route[];
  config: ServerConfig;
  jsonResponse: (data: unknown, status?: number) => Response;
  readJsonBody: (request: Request) => Promise<Record<string, unknown>>;
  ensureWritable: (config: ServerConfig) => void;
}) {
  const { routes, config, jsonResponse, readJsonBody, ensureWritable } = options;
  const passwords = browserPasswords(config);
  // Management is host-only; metadata responses never contain stored values.
  addRoute(routes, "GET", "/browser-passwords", "host-token", async ctx => {
    const origin = new URL(ctx.request.url).searchParams.get("origin");
    return jsonResponse({ items: await passwords.list(origin === null ? undefined : browserPasswordOrigin(origin)) });
  });
  addRoute(routes, "PUT", "/browser-passwords", "host-token", async ctx => {
    ensureWritable(config);
    return jsonResponse({ item: await passwords.save(await readJsonBody(ctx.request)) });
  });
  addRoute(routes, "DELETE", "/browser-passwords/:id", "host-token", async ctx => {
    ensureWritable(config);
    await passwords.delete(ctx.params.id);
    return jsonResponse({ ok: true });
  });
}
