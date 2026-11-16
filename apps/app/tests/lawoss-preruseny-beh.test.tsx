// LAWOSS (N-A9-16, test 2. 11. 2026): beh prerušený zatvorením appky po reštarte nič nehovoril.
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { MessageList } from "../src/components/chat/message-list";
import { MessageListProvider } from "../src/components/chat/message-list-provider";
import { setLocale, t } from "../src/i18n";
import { InterruptedRunNotice, interruptedReason, interruptedRun, questionBefore } from "../src/lawoss/chat/interrupted-run";
import { snapshotToUIMessages } from "../src/react-app/domains/session/sync/usechat-adapter";
import type { LegalworkSessionSnapshot } from "../src/app/lib/legalwork-server";

afterEach(() => setLocale("en"));

const user = { info: { id: "msg_u1", role: "user", sessionID: "ses_p", time: { created: 1 } }, parts: [] };
const tool = { id: "prt_t1", sessionID: "ses_p", messageID: "msg_a1", type: "tool", callID: "call_1", tool: "read",
  state: { status: "completed", input: { filePath: "a.md" }, output: "", title: "", metadata: {}, time: { start: 2, end: 3 } } };
const assistant = (time: Record<string, number>, extra: Record<string, unknown> = {}) =>
  ({ info: { id: "msg_a1", role: "assistant", sessionID: "ses_p", parentID: "msg_u1", time, ...extra }, parts: [tool] });
const snapshot = (messages: unknown[], status: "idle" | "busy" = "idle", engineRestartedAt?: number) =>
  ({ session: { id: "ses_p" }, todos: [], status: { type: status }, messages, ...(engineRestartedAt ? { engineRestartedAt } : {}) }) as unknown as LegalworkSessionSnapshot; // Fixture: len polia, ktoré konverzia číta.
const flagged = (value: LegalworkSessionSnapshot) => snapshotToUIMessages(value).filter((message) => interruptedReason(message) !== null).map((message) => message.id);

describe("N-A9-16: prerušený beh po reštarte", () => {
  test("rozhodnutie: len nedokončená odpoveď spred načítania appky, posledná len pri nečinnosti", () => {
    const loadedAt = 1_000;
    expect(interruptedRun({ role: "assistant", time: { created: 500 } }, { last: true, idle: true, loadedAt })).toBe("app_closed");
    expect(interruptedRun({ role: "assistant", time: { created: 500 } }, { last: true, idle: false, loadedAt })).toBeNull();
    expect(interruptedRun({ role: "assistant", time: { created: 500 } }, { last: false, idle: false, loadedAt })).toBe("app_closed");
    expect(interruptedRun({ role: "assistant", time: { created: 1_500 } }, { last: true, idle: true, loadedAt })).toBeNull();
    expect(interruptedRun({ role: "assistant", time: { created: 500, completed: 600 } }, { last: true, idle: true, loadedAt })).toBeNull();
    expect(interruptedRun({ role: "assistant", time: { created: 500 }, error: { name: "MessageAbortedError" } }, { last: true, idle: true, loadedAt })).toBeNull();
    expect(interruptedRun({ role: "user", time: { created: 500 } }, { last: true, idle: true, loadedAt })).toBeNull();
    expect(interruptedRun({ role: "assistant" }, { last: true, idle: true, loadedAt })).toBeNull();
  });

  test("snapshot po reštarte označí odpoveď, beh v práci ani dokončená odpoveď nie", () => {
    expect(flagged(snapshot([user, assistant({ created: 2 })]))).toEqual(["msg_a1"]);
    expect(flagged(snapshot([user, assistant({ created: 2 })], "busy"))).toEqual([]);
    expect(flagged(snapshot([user, assistant({ created: 2, completed: 4 })]))).toEqual([]);
    expect(flagged(snapshot([user, assistant({ created: Date.now() + 60_000 })]))).toEqual([]);
  });

  test("zastavená odpoveď ostáva pri pôvodnom hlásení, bez druhého upozornenia", () => {
    const messages = snapshotToUIMessages(snapshot([user, assistant({ created: 2 }, { error: { name: "MessageAbortedError", data: {} } })]));
    expect(messages.filter((message) => interruptedReason(message) !== null)).toEqual([]);
    expect(messages.some((message) => message.id.startsWith("session-error"))).toBe(true);
  });

  test("prázdna prerušená odpoveď (ako v engine po zabití procesu) nesie príznak, veta po slovensky", () => {
    setLocale("sk");
    const empty = { ...assistant({ created: 2 }), parts: [] };
    expect(flagged(snapshot([user, empty]))).toEqual(["msg_a1"]);
    expect(renderToStaticMarkup(<InterruptedRunNotice reason="app_closed" />)).toContain(t("lawoss.chat.interrupted_run"));
    expect(t("lawoss.chat.interrupted_run")).toStartWith("Odpoveď sa nedokončila");
  });

  test("zoznam správ: veta pod krokmi aj pri prázdnej prerušenej odpovedi, nie pri dokončenej", () => {
    setLocale("sk");
    const render = (messages: UIMessage[]) => renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MessageListProvider workspaceId="w" sessionId="ses_p" showThinking={false} developerMode={false} displaySuggestions={false}
          providerConnectedCount={0} dispatchAction={() => {}} setPrompt={() => {}} onRevertToUserMessage={() => {}}
          onForkAtMessage={() => {}} onEditUserMessage={() => {}}>
          <MessageList messages={messages} status="ready" />
        </MessageListProvider>
      </QueryClientProvider>,
    );
    const steps = { ...assistant({ created: 2, completed: 3 }), info: { ...assistant({}).info, id: "msg_a0", time: { created: 2, completed: 3 } } };
    const empty = { ...assistant({ created: 4 }), parts: [] };
    expect(render(snapshotToUIMessages(snapshot([user, steps, empty])))).toContain(t("lawoss.chat.interrupted_run"));
    expect(render(snapshotToUIMessages(snapshot([user, empty])))).toContain(t("lawoss.chat.interrupted_run"));
    expect(render(snapshotToUIMessages(snapshot([user, steps])))).not.toContain(t("lawoss.chat.interrupted_run"));
  });
});

describe("#473: odpoveď prerušená reštartom agenta, kým appka beží", () => {
  test("rozhodnutie: nedokončená odpoveď spred reštartu enginu, posledná len pri nečinnosti", () => {
    const input = { loadedAt: 1_000, engineRestartedAt: 5_000 };
    expect(interruptedRun({ role: "assistant", time: { created: 2_000 } }, { last: true, idle: true, ...input })).toBe("engine_restart");
    expect(interruptedRun({ role: "assistant", time: { created: 2_000 } }, { last: true, idle: false, ...input })).toBeNull();
    expect(interruptedRun({ role: "assistant", time: { created: 6_000 } }, { last: true, idle: true, ...input })).toBeNull();
    expect(interruptedRun({ role: "assistant", time: { created: 2_000, completed: 3_000 } }, { last: true, idle: true, ...input })).toBeNull();
    expect(interruptedRun({ role: "assistant", time: { created: 500 } }, { last: true, idle: true, ...input })).toBe("app_closed");
  });

  test("snapshot s časom reštartu enginu označí useknutú odpoveď, novú ani bežiacu nie", () => {
    const now = Date.now();
    const cut = { ...assistant({ created: now + 1_000 }), parts: [] };
    expect(flagged(snapshot([user, cut], "idle", now + 2_000))).toEqual(["msg_a1"]);
    expect(flagged(snapshot([user, cut], "busy", now + 2_000))).toEqual([]);
    expect(flagged(snapshot([user, cut], "idle", now + 500))).toEqual([]);
    expect(flagged(snapshot([user, cut]))).toEqual([]);
  });

  test("zoznam správ: veta o reštarte agenta a tlačidlo, ktoré vloží otázku znova", () => {
    setLocale("sk");
    const now = Date.now();
    const question = { info: { id: "msg_u1", role: "user", sessionID: "ses_p", time: { created: now } }, parts: [{ id: "prt_u1", sessionID: "ses_p", messageID: "msg_u1", type: "text", text: "Vymenuj dôkazné prostriedky." }] };
    const cut = { ...assistant({ created: now + 1_000 }), parts: [] };
    const prompts: string[] = [];
    const messages = snapshotToUIMessages(snapshot([question, cut], "idle", now + 2_000));
    const html = renderToStaticMarkup(
      <QueryClientProvider client={new QueryClient()}>
        <MessageListProvider workspaceId="w" sessionId="ses_p" showThinking={false} developerMode={false} displaySuggestions={false}
          providerConnectedCount={0} dispatchAction={() => {}} setPrompt={(prompt) => { prompts.push(prompt); }} onRevertToUserMessage={() => {}}
          onForkAtMessage={() => {}} onEditUserMessage={() => {}}>
          <MessageList messages={messages} status="ready" />
        </MessageListProvider>
      </QueryClientProvider>,
    );
    expect(t("lawoss.chat.interrupted_restart")).toStartWith("Odpoveď sa prerušila, agent sa reštartoval");
    expect(html).toContain(t("lawoss.chat.interrupted_restart"));
    expect(html).not.toContain(t("lawoss.chat.interrupted_run"));
    expect(html).toContain(t("lawoss.chat.interrupted_retry"));
    expect(questionBefore(messages, messages.length - 1)).toBe("Vymenuj dôkazné prostriedky.");
    expect(questionBefore(messages, 0)).toBeNull();
  });
});
