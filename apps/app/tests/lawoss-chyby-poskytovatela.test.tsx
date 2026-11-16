// LAWOSS #502: chyba poskytovateľa v chate preložená s akciou, overenie kľúča OpenAI, preložené voľby pripojenia.
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { MessageList } from "../src/components/chat/message-list";
import { MessageListProvider } from "../src/components/chat/message-list-provider";
import { setLocale, t } from "../src/i18n";
import { snapshotToUIMessages } from "../src/react-app/domains/session/sync/usechat-adapter";
import { __applySessionSyncEventForTest, __createWorkspaceSessionSyncForTest, trackWorkspaceSessionSync, transcriptKey } from "../src/react-app/domains/session/sync/session-sync";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { useSessionActivityStore } from "../src/react-app/domains/session/status/session-activity-store";
import type { LegalworkSessionSnapshot } from "../src/app/lib/legalwork-server";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { createProviderAuthStore } from "../src/react-app/domains/connections/provider-auth/store";
import { createClient } from "../src/app/lib/opencode";
import { providerMethodLabel } from "../src/lawoss/providers/method-labels";

afterEach(() => setLocale("en"));

const RAW = "Incorrect API key provided: sk-test-****0000. You can find your API key at https://platform.openai.com/account/api-keys.";
const authError = { type: "provider.auth", message: RAW, status: 401 };

const user = { info: { id: "msg_u1", role: "user", sessionID: "ses_k", time: { created: 1 } }, parts: [] };
const failed = (error: unknown) => ({ info: { id: "msg_a1", role: "assistant", sessionID: "ses_k", parentID: "msg_u1", providerID: "openai", modelID: "gpt-5-mini", time: { created: 2, completed: 3 }, error }, parts: [] });
const snapshot = (messages: unknown[]) =>
  ({ session: { id: "ses_k" }, todos: [], status: { type: "idle" }, messages }) as unknown as LegalworkSessionSnapshot; // Fixture: len polia, ktoré konverzia číta.

function renderChat(messages: UIMessage[], workspaceId = "w", sessionId = "ses_k") {
  return renderToStaticMarkup(
    <QueryClientProvider client={new QueryClient()}>
      <MessageListProvider workspaceId={workspaceId} sessionId={sessionId} showThinking={false} developerMode={false} displaySuggestions={false}
        providerConnectedCount={0} dispatchAction={() => {}} setPrompt={() => {}} onRevertToUserMessage={() => {}}
        onForkAtMessage={() => {}} onEditUserMessage={() => {}}>
        <MessageList messages={messages} status="ready" onOpenAiSettings={() => {}} />
      </MessageListProvider>
    </QueryClientProvider>,
  );
}

function expectTranslatedAuthCard(html: string) {
  expect(html).toContain(t("lawoss.provider_error.auth"));
  expect(html).toContain(t("lawoss.provider_error.open_settings"));
  const details = html.indexOf("<details");
  expect(details).toBeGreaterThan(-1);
  expect(html.indexOf("Incorrect API key provided")).toBeGreaterThan(details);
}

describe("#502 chyba poskytovateľa v chate", () => {
  test("načítaný chat: provider.auth je po slovensky s akciou, surový text len v podrobnostiach", () => {
    setLocale("sk");
    expect(t("lawoss.provider_error.auth")).toStartWith("Poskytovateľ AI odmietol");
    expectTranslatedAuthCard(renderChat(snapshotToUIMessages(snapshot([user, failed(authError)]))));
  });

  test("živá udalosť session.execution.failed: rovnaká karta, stav relácie nesie preložený text", () => {
    setLocale("sk");
    const input = { workspaceId: "provider-502", baseUrl: "http://127.0.0.1:1", legalworkToken: "test" }, sessionID = "ses_live";
    const dispose = __createWorkspaceSessionSyncForTest(input), release = trackWorkspaceSessionSync(input, sessionID);
    const cache = getReactQueryClient(), activity = useSessionActivityStore.getState();
    try {
      __applySessionSyncEventForTest(input, { type: "session.execution.started", id: "start", created: 1, data: { sessionID } });
      __applySessionSyncEventForTest(input, { type: "session.step.started", id: "step", created: 2, data: { sessionID, assistantMessageID: "reply", agent: "legalwork", model: { providerID: "openai", id: "gpt-5-mini" }, started: 2 } });
      __applySessionSyncEventForTest(input, { type: "session.execution.failed", id: "failure", created: 3, data: { sessionID, error: authError } });
      expect(activity.getSessionError(input.workspaceId, sessionID)).toBe(t("lawoss.provider_error.auth"));
      const transcript = cache.getQueryData<UIMessage[]>(transcriptKey(input.workspaceId, sessionID)) ?? [];
      expectTranslatedAuthCard(renderChat(transcript, input.workspaceId, sessionID));
    } finally { release(); dispose(); activity.removeSession(input.workspaceId, sessionID); cache.clear(); }
  });

  test("nedostupný model (provider.no-route) má vlastnú vetu, iné chyby ostávajú ako doteraz", () => {
    setLocale("sk");
    const noRoute = renderChat(snapshotToUIMessages(snapshot([user, failed({ type: "provider.no-route", message: "Model gpt-x is not available" })])));
    expect(noRoute).toContain(t("session_route.model_unavailable"));
    expect(noRoute).toContain(t("lawoss.provider_error.open_settings"));
    const other = renderChat(snapshotToUIMessages(snapshot([user, failed({ type: "provider.transport", message: "socket hang up" })])));
    expect(other).toContain("socket hang up");
    expect(other).not.toContain(t("lawoss.provider_error.open_settings"));
  });
});

describe("#502 voľby pripojenia OpenAI", () => {
  test("známe metódy enginu sú preložené, neznáme ostávajú podľa enginu", () => {
    setLocale("sk");
    expect(providerMethodLabel({ type: "oauth", label: "Sign in with ChatGPT", methodID: "chatgpt-token-sharing" })).toBe(t("lawoss.provider_method.chatgpt_sign_in"));
    expect(providerMethodLabel({ type: "oauth", label: "Codex browser (legacy)", methodID: "chatgpt-browser" })).toBe(t("lawoss.provider_method.codex_browser"));
    expect(providerMethodLabel({ type: "oauth", label: "Codex device code (legacy)", methodID: "chatgpt-headless" })).toBe(t("lawoss.provider_method.codex_device"));
    expect(t("lawoss.provider_method.codex_device")).not.toContain("device code");
    expect(providerMethodLabel({ type: "oauth", label: "Claude Pro/Max", methodID: "claude-pro" })).toBe("Claude Pro/Max");
    expect(providerMethodLabel({ type: "api", label: "" })).toBe(t("providers.api_key_label"));
  });
});

describe("#502 overenie kľúča OpenAI pri uložení", () => {
  function fixture(modelsStatus: number) {
    const calls: string[] = [];
    const server = Bun.serve({ port: 0, async fetch(request) {
      const path = new URL(request.url).pathname;
      calls.push(path);
      if (path.endsWith("/provider-models")) {
        return modelsStatus === 200 ? Response.json({ models: ["gpt-5-mini"] })
          : Response.json({ code: modelsStatus === 401 ? "model_discovery_unauthorized" : "model_discovery_failed", message: `Model endpoint returned HTTP ${modelsStatus}.` }, { status: 502 });
      }
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
    return { calls, store, stop: () => { store.dispose(); server.stop(true); } };
  }
  const saved = (calls: string[]) => calls.some((path) => path.includes("/opencode/") && path.includes("integration"));

  test("kľúč, ktorý OpenAI odmietne (401), sa neuloží a hláška je preložená", async () => {
    setLocale("sk");
    const { calls, store, stop } = fixture(401);
    try {
      await expect(store.submitProviderApiKey("openai", "sk-test-invalid-0000")).rejects.toThrow(t("lawoss.provider_error.key_rejected"));
      expect(calls.some((path) => path.endsWith("/provider-models"))).toBe(true);
      expect(saved(calls)).toBe(false);
    } finally { stop(); }
  });

  test("nedostupné overenie (sieť, 403 bez oprávnenia na zoznam modelov) uloženie neblokuje", async () => {
    for (const status of [200, 403]) {
      const { calls, store, stop } = fixture(status);
      try {
        await store.submitProviderApiKey("openai", "sk-test-valid-0000").catch(() => {});
        expect(saved(calls)).toBe(true);
      } finally { stop(); }
    }
  });
});
