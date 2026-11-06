// LAWOSS (N-A9-16, test 2. 11. 2026): beh prerušený zatvorením appky po reštarte nič nehovoril.
import { afterEach, describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { UIMessage } from "ai";
import { MessageList } from "../src/components/chat/message-list";
import { MessageListProvider } from "../src/components/chat/message-list-provider";
import { setLocale, t } from "../src/i18n";
import { InterruptedRunNotice, interruptedBeforeLoad, isInterruptedRun } from "../src/lawoss/chat/interrupted-run";
import { snapshotToUIMessages } from "../src/react-app/domains/session/sync/usechat-adapter";
import type { LegalworkSessionSnapshot } from "../src/app/lib/legalwork-server";

afterEach(() => setLocale("en"));

const user = { info: { id: "msg_u1", role: "user", sessionID: "ses_p", time: { created: 1 } }, parts: [] };
const tool = { id: "prt_t1", sessionID: "ses_p", messageID: "msg_a1", type: "tool", callID: "call_1", tool: "read",
  state: { status: "completed", input: { filePath: "a.md" }, output: "", title: "", metadata: {}, time: { start: 2, end: 3 } } };
const assistant = (time: Record<string, number>, extra: Record<string, unknown> = {}) =>
  ({ info: { id: "msg_a1", role: "assistant", sessionID: "ses_p", parentID: "msg_u1", time, ...extra }, parts: [tool] });
const snapshot = (messages: unknown[], status: "idle" | "busy" = "idle") =>
  ({ session: { id: "ses_p" }, todos: [], status: { type: status }, messages }) as unknown as LegalworkSessionSnapshot; // Fixture: len polia, ktoré konverzia číta.
const flagged = (value: LegalworkSessionSnapshot) => snapshotToUIMessages(value).filter(isInterruptedRun).map((message) => message.id);

describe("N-A9-16: prerušený beh po reštarte", () => {
  test("rozhodnutie: len nedokončená odpoveď spred načítania appky, posledná len pri nečinnosti", () => {
    const loadedAt = 1_000;
    expect(interruptedBeforeLoad({ role: "assistant", time: { created: 500 } }, { last: true, idle: true, loadedAt })).toBe(true);
    expect(interruptedBeforeLoad({ role: "assistant", time: { created: 500 } }, { last: true, idle: false, loadedAt })).toBe(false);
    expect(interruptedBeforeLoad({ role: "assistant", time: { created: 500 } }, { last: false, idle: false, loadedAt })).toBe(true);
    expect(interruptedBeforeLoad({ role: "assistant", time: { created: 1_500 } }, { last: true, idle: true, loadedAt })).toBe(false);
    expect(interruptedBeforeLoad({ role: "assistant", time: { created: 500, completed: 600 } }, { last: true, idle: true, loadedAt })).toBe(false);
    expect(interruptedBeforeLoad({ role: "assistant", time: { created: 500 }, error: { name: "MessageAbortedError" } }, { last: true, idle: true, loadedAt })).toBe(false);
    expect(interruptedBeforeLoad({ role: "user", time: { created: 500 } }, { last: true, idle: true, loadedAt })).toBe(false);
    expect(interruptedBeforeLoad({ role: "assistant" }, { last: true, idle: true, loadedAt })).toBe(false);
  });

  test("snapshot po reštarte označí odpoveď, beh v práci ani dokončená odpoveď nie", () => {
    expect(flagged(snapshot([user, assistant({ created: 2 })]))).toEqual(["msg_a1"]);
    expect(flagged(snapshot([user, assistant({ created: 2 })], "busy"))).toEqual([]);
    expect(flagged(snapshot([user, assistant({ created: 2, completed: 4 })]))).toEqual([]);
    expect(flagged(snapshot([user, assistant({ created: Date.now() + 60_000 })]))).toEqual([]);
  });

  test("zastavená odpoveď ostáva pri pôvodnom hlásení, bez druhého upozornenia", () => {
    const messages = snapshotToUIMessages(snapshot([user, assistant({ created: 2 }, { error: { name: "MessageAbortedError", data: {} } })]));
    expect(messages.filter(isInterruptedRun)).toEqual([]);
    expect(messages.some((message) => message.id.startsWith("session-error"))).toBe(true);
  });

  test("prázdna prerušená odpoveď (ako v engine po zabití procesu) nesie príznak, veta po slovensky", () => {
    setLocale("sk");
    const empty = { ...assistant({ created: 2 }), parts: [] };
    expect(flagged(snapshot([user, empty]))).toEqual(["msg_a1"]);
    expect(renderToStaticMarkup(<InterruptedRunNotice />)).toContain(t("lawoss.chat.interrupted_run"));
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
