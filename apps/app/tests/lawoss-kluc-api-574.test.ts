// LAWOSS #574: kľúč API bez okrajových medzier, s medzerou vnútri odmietnutý; kľúč OpenRouter overený pred uložením.
import { afterEach, describe, expect, test } from "bun:test";
import { setLocale, t } from "../src/i18n";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { createProviderAuthStore } from "../src/react-app/domains/connections/provider-auth/store";
import { createClient } from "../src/app/lib/opencode";

afterEach(() => setLocale("en"));

type KeyCheck = "valid" | "rejected" | "unverified" | 404;

function fixture(keyCheck: KeyCheck = "valid") {
  const calls: Array<{ path: string; body: string }> = [];
  const server = Bun.serve({ port: 0, async fetch(request) {
    const path = new URL(request.url).pathname;
    calls.push({ path, body: request.method === "POST" ? await request.text() : "" });
    if (path.endsWith("/provider-key-check")) {
      return keyCheck === 404 ? Response.json({ code: "not_found", message: "Not found" }, { status: 404 }) : Response.json({ result: keyCheck });
    }
    if (path.endsWith("/provider-models")) return Response.json({ models: ["m"] });
    if (path.includes("/integration/")) return new Response(null, { status: 204 });
    return Response.json([]);
  } });
  const base = String(server.url).replace(/\/$/, "");
  const store = createProviderAuthStore({
    client: () => createClient(base + "/opencode"), baseUrl: () => base,
    providers: () => [], providerDefaults: () => ({}), providerConnectedIds: () => [], disabledProviders: () => [],
    selectedWorkspaceDisplay: () => ({ id: "ws", name: "Workspace", path: "/fixture", preset: "starter", workspaceType: "local", displayNameResolved: "Workspace" }),
    selectedWorkspaceRoot: () => "/fixture", runtimeWorkspaceId: () => "ws",
    legalworkServer: { getSnapshot: () => ({ legalworkServerStatus: "connected", legalworkServerClient: createLegalworkServerClient({ baseUrl: base }), legalworkServerCapabilities: null }) },
    setProviders: () => {}, setProviderDefaults: () => {}, setProviderConnectedIds: () => {}, setDisabledProviders: () => {}, markOpencodeConfigReloadRequired: () => {},
  });
  const saves = () => calls.filter(({ path }) => path.includes("/opencode/") && path.endsWith("/connect/key"));
  const checks = () => calls.filter(({ path }) => path.endsWith("/provider-key-check"));
  return { store, saves, checks, stop: () => { store.dispose(); server.stop(true); } };
}

describe("#574 kľúč API pri všetkých poskytovateľoch", () => {
  test("okrajové medzery a zalomenie sa pred uložením odstránia", async () => {
    const { store, saves, stop } = fixture();
    try {
      await store.submitProviderApiKey("anthropic", "  sk-ant-test-0000\n").catch(() => {});
      expect(saves()).toHaveLength(1);
      expect(saves()[0]?.body).toContain("\"sk-ant-test-0000\"");
    } finally { stop(); }
  });

  test("kľúč s medzerou, tabulátorom alebo zalomením vnútri sa odmietne po slovensky a neuloží", async () => {
    setLocale("sk");
    expect(t("lawoss.provider_key.whitespace")).toContain("medzery");
    for (const key of ["Toto je iný text zo schránky", "sk-or-v1-abc\ndef", "sk-ant\tx"]) {
      const { store, saves, checks, stop } = fixture();
      try {
        await expect(store.submitProviderApiKey("openrouter", key)).rejects.toThrow(t("lawoss.provider_key.whitespace"));
        expect(saves()).toHaveLength(0);
        expect(checks()).toHaveLength(0);
      } finally { stop(); }
    }
  });

  test("vlastný poskytovateľ: kľúč s medzerou vnútri sa odmietne a nič sa neuloží", async () => {
    setLocale("sk");
    const { store, saves, stop } = fixture();
    try {
      await expect(store.submitCustomProvider({ providerId: "moj", name: "Môj", baseURL: "https://example.invalid/v1", apiKey: "dva slova", apiType: "chat", models: [{ id: "m" }] } as Parameters<typeof store.submitCustomProvider>[0]))
        .rejects.toThrow(t("lawoss.provider_key.whitespace"));
      expect(saves()).toHaveLength(0);
    } finally { stop(); }
  });

  test("hláška existuje vo všetkých jazykoch rozhrania", () => {
    for (const locale of ["sk", "cs", "en", "de"] as const) {
      setLocale(locale);
      expect(t("lawoss.provider_key.whitespace")).not.toBe("lawoss.provider_key.whitespace");
      expect(t("lawoss.provider_key.unverified")).not.toBe("lawoss.provider_key.unverified");
    }
  });
});

describe("#574 overenie kľúča OpenRouter pred uložením", () => {
  test("kľúč, ktorý OpenRouter odmietne, sa neuloží a hláška je preložená", async () => {
    setLocale("sk");
    const { store, saves, checks, stop } = fixture("rejected");
    try {
      await expect(store.submitProviderApiKey("openrouter", "sk-or-v1-zly")).rejects.toThrow(t("lawoss.provider_error.key_rejected"));
      expect(checks()).toHaveLength(1);
      expect(JSON.parse(checks()[0]?.body ?? "{}")).toEqual({ providerId: "openrouter", apiKey: "sk-or-v1-zly" });
      expect(saves()).toHaveLength(0);
    } finally { stop(); }
  });

  test("platný kľúč sa uloží bez varovania", async () => {
    const { store, saves, stop } = fixture("valid");
    try {
      const result = await store.submitProviderApiKey("openrouter", "sk-or-v1-dobry");
      expect(saves()).toHaveLength(1);
      expect(result).not.toBe(t("lawoss.provider_key.unverified"));
    } finally { stop(); }
  });

  test("neoverený kľúč (bez siete, starší worker) sa uloží s varovaním", async () => {
    setLocale("sk");
    for (const keyCheck of ["unverified", 404] as const) {
      const { store, saves, stop } = fixture(keyCheck);
      try {
        expect(await store.submitProviderApiKey("openrouter", "sk-or-v1-offline")).toBe(t("lawoss.provider_key.unverified"));
        expect(saves()).toHaveLength(1);
      } finally { stop(); }
    }
  });

  test("ostatní vstavaní poskytovatelia (okrem OpenAI) sa na workeri neoverujú", async () => {
    const { store, checks, saves, stop } = fixture("rejected");
    try {
      await store.submitProviderApiKey("anthropic", "sk-ant-x").catch(() => {});
      expect(checks()).toHaveLength(0);
      expect(saves()).toHaveLength(1);
    } finally { stop(); }
  });
});
