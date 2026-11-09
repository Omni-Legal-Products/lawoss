import { afterEach, expect, spyOn, test } from "bun:test";
import { createOpencodeClient } from "@opencode-ai/sdk/v2/client";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { createProviderAuthStore } from "../src/react-app/domains/connections/provider-auth/store";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { setLocale, t } from "../src/i18n";
import { EigenweltSignInTimeoutError } from "../src/app/lib/eigenwelt-sign-in";

const cleanups: Array<() => void> = [];
afterEach(() => {
  cleanups.splice(0).forEach((cleanup) => cleanup());
  getReactQueryClient().clear();
  setLocale("en");
});

function signInFixture(saveStatus: number, reloadStatus = 200, reloadDelayMs = 0, waitResponse?: () => Response) {
  const requests: string[] = [];
  let scheduledReloads = 0;
  const server = Bun.serve({
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      requests.push(`${request.method} ${path}`);
      if (path.startsWith("/api/eigenwelt/oauth/wait/")) {
        if (waitResponse) return waitResponse();
        return Response.json({ apiKey: "test-key", baseURL: "https://example.test/v1", models: [], platformToken: "test-token" });
      }
      if (path.endsWith("/eigenwelt/connection")) {
        return saveStatus === 200
          ? Response.json({})
          : Response.json({ code: "workspace_not_found", message: "Workspace not found" }, { status: saveStatus });
      }
      if (path.endsWith("/engine/reload")) {
        if (reloadDelayMs) await Bun.sleep(reloadDelayMs);
        if (reloadStatus === 404) return Response.json({ code: "workspace_not_found", message: "Workspace not found" }, { status: 404 });
        return reloadStatus === 200
          ? Response.json({ ok: true })
          : Response.json({ code: "opencode_unavailable", message: "Engine is still starting" }, { status: reloadStatus });
      }
      if (path === "/instance/dispose") return Response.json(true);
      if (path === "/global/health") return Response.json({ healthy: true });
      if (path === "/config") return Response.json({});
      if (path === "/provider") return Response.json({ all: [], connected: [], default: {} });
      return new Response("Unexpected route", { status: 500 });
    },
  });
  cleanups.push(() => server.stop(true));
  const client = createOpencodeClient({ baseUrl: server.url.href });
  const legalworkClient = createLegalworkServerClient({ baseUrl: server.url.href });
  const store = createProviderAuthStore({
    client: () => client,
    baseUrl: () => server.url.href,
    providers: () => [],
    providerDefaults: () => ({}),
    providerConnectedIds: () => [],
    disabledProviders: () => [],
    selectedWorkspaceDisplay: () => ({ id: "ws", name: "Workspace", path: "/tmp/sign-in", preset: "default", workspaceType: "local" }),
    selectedWorkspaceRoot: () => "/tmp/sign-in",
    runtimeWorkspaceId: () => "ws",
    legalworkServer: { getSnapshot: () => ({
      legalworkServerStatus: "connected",
      legalworkServerClient: legalworkClient,
      legalworkServerCapabilities: { config: { read: true, write: true } },
    }) },
    setProviders: () => undefined,
    setProviderDefaults: () => undefined,
    setProviderConnectedIds: () => undefined,
    setDisabledProviders: () => undefined,
    markOpencodeConfigReloadRequired: () => { scheduledReloads += 1; },
  });
  return { store, requests, scheduledReloads: () => scheduledReloads };
}

test("a failed account save fails sign-in before attempting any engine reload", async () => {
  const fixture = signInFixture(404);
  await expect(fixture.store.completeEigenweltSignIn("test-session")).rejects.toThrow("Workspace not found");
  expect(fixture.store.getSnapshot().providerAuthError).toContain("Workspace not found");
  expect(fixture.requests).toEqual([
    "GET /api/eigenwelt/oauth/wait/test-session",
    "PUT /workspace/ws/eigenwelt/connection",
  ]);
  expect(fixture.scheduledReloads()).toBe(0);
});

test("checkout can continue past ten minutes and still connect", async () => {
  const startedAt = Date.now();
  const clock = spyOn(Date, "now").mockReturnValue(startedAt);
  cleanups.push(() => clock.mockRestore());
  let polls = 0;
  const fixture = signInFixture(200, 200, 0, () => {
    if (++polls === 1) {
      clock.mockReturnValue(startedAt + 11 * 60 * 1000);
      return Response.json({ pending: true });
    }
    return Response.json({ apiKey: "test-key", baseURL: "https://example.test/v1", models: [] });
  });
  await expect(fixture.store.completeEigenweltSignIn("long-checkout")).resolves.toMatchObject({ connected: true });
  expect(polls).toBe(2);
});

test("the app explains how to restart when its hour-long wait expires", async () => {
  const startedAt = Date.now();
  const clock = spyOn(Date, "now").mockReturnValue(startedAt);
  cleanups.push(() => clock.mockRestore());
  const fixture = signInFixture(200, 200, 0, () => {
    clock.mockReturnValue(startedAt + 60 * 60 * 1000 + 1);
    return Response.json({ pending: true });
  });
  const expired = fixture.store.completeEigenweltSignIn("expired-checkout");
  await expect(expired).rejects.toBeInstanceOf(EigenweltSignInTimeoutError);
  await expect(expired).rejects.toThrow(t("providers.eigenwelt_signin_timeout"));
  expect(fixture.store.getSnapshot().providerAuthError).toContain("restart");
  expect(fixture.requests).toEqual(["GET /api/eigenwelt/oauth/wait/expired-checkout"]);
});

const languages: Array<"en" | "de"> = ["en", "de"];
test.each(languages)("server expiry displays the customer restart instructions in %s", async language => {
  setLocale(language);
  const fixture = signInFixture(200, 200, 0, () => Response.json({
    code: "eigenwelt_signin_timeout", message: "Raw server timeout",
  }, { status: 410 }));
  const message = t("providers.eigenwelt_signin_timeout");
  const expired = fixture.store.completeEigenweltSignIn("expired-checkout");
  await expect(expired).rejects.toBeInstanceOf(EigenweltSignInTimeoutError);
  await expect(expired).rejects.toThrow(message);
  expect(fixture.store.getSnapshot().providerAuthError).toBe(message);
  // 🟡 LAWOSS: brand substitution shows LAWOSS in user-facing copy.
  expect(message).toContain("LAWOSS");
  expect(message).not.toContain("Provider");
});

test("a successful account save reloads once without scheduling a second reload", async () => {
  const fixture = signInFixture(200);
  await expect(fixture.store.completeEigenweltSignIn("test-session")).resolves.toMatchObject({ connected: true });
  expect(fixture.requests.filter((path) => path.endsWith("/engine/reload"))).toHaveLength(1);
  expect(fixture.requests.some((path) => path.endsWith("/instance/dispose"))).toBe(false);
  expect(fixture.scheduledReloads()).toBe(0);
});

test("a removed workspace cannot be recovered by disposing the instance", async () => {
  const fixture = signInFixture(200, 404);
  await expect(fixture.store.completeEigenweltSignIn("test-session")).rejects.toThrow("Workspace not found");
  expect(fixture.requests).toEqual([
    "GET /api/eigenwelt/oauth/wait/test-session",
    "PUT /workspace/ws/eigenwelt/connection",
    "POST /workspace/ws/engine/reload",
  ]);
  expect(fixture.scheduledReloads()).toBe(0);
});

test("cold engine readiness may exceed the ordinary API timeout without a second dispose", async () => {
  const fixture = signInFixture(200, 200, 10_250);
  await expect(fixture.store.completeEigenweltSignIn("test-session")).resolves.toMatchObject({ connected: true });
  expect(fixture.requests.filter((path) => path.endsWith("/engine/reload"))).toHaveLength(1);
  expect(fixture.requests.some((path) => path.endsWith("/instance/dispose"))).toBe(false);
}, 15_000);

test("a transient server reload failure still uses direct engine recovery", async () => {
  const fixture = signInFixture(200, 503);
  await expect(fixture.store.completeEigenweltSignIn("test-session")).resolves.toMatchObject({ connected: true });
  expect(fixture.requests.filter((path) => path.endsWith("/engine/reload"))).toHaveLength(1);
  expect(fixture.requests.filter((path) => path.endsWith("/instance/dispose"))).toHaveLength(1);
  expect(fixture.scheduledReloads()).toBe(0);
});
