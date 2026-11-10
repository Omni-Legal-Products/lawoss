// LAWOSS (#269 P3, N-A5-2): živý prenos a znovu otvorený chat ukážu komentár modelu rovnako (engine v2).
// Engine 2.1.4 posiela fázu poskytovateľa textu (`phase: "commentary"`) v `native` obsahu správy a pri živom
// prenose v `session.text.ended`; koniec kroku (`session.step.ended`) znovu načíta hotovú správu z enginu.
import { afterEach, describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { __applySessionSyncEventForTest, __createWorkspaceSessionSyncForTest, seedSessionState, snapshotKey, trackWorkspaceSessionSync, transcriptKey } from "../src/react-app/domains/session/sync/session-sync";
import { snapshotToUIMessages } from "../src/react-app/domains/session/sync/usechat-adapter";
import { projectMessages } from "../src/app/lib/opencode-view";
import type { LegalworkSessionSnapshot } from "../src/app/lib/legalwork-server";

afterEach(() => {
  getReactQueryClient().clear();
});

const SESSION = "ses_k1";
const MESSAGE = "msg_k1";
const TEXT = "We have memory links relative to project root; checking the documents.";
// Textový obsah GPT-6 Luna vo fáze „commentary“, ako ho ukladá engine v2 (výrez metadát poskytovateľa v `native`).
const commentary = (text = TEXT) => ({ type: "text" as const, text, native: { itemId: "msg_0cd4", phase: "commentary" } });
const read = { type: "tool" as const, id: "call_1", name: "read", state: { status: "completed" as const, input: { filePath: "a.md" }, content: [{ type: "text" as const, text: "" }] }, time: { created: 1, completed: 2 } };

type Content = ReturnType<typeof commentary> | typeof read;
type End = { finish?: "stop" | "length" | "tool-calls" | "unknown"; error?: { type: string; message: string }; completed?: number };
const native = (content: readonly Content[], end: End) => ({
  id: MESSAGE, type: "assistant" as const, agent: "build", model: { id: "gpt-6-luna", providerID: "openai" }, content: [...content],
  time: { created: 1, ...(end.completed ? { completed: end.completed } : {}) }, ...(end.finish ? { finish: end.finish } : {}), ...(end.error ? { error: end.error } : {}),
});
const textKinds = (parts: UIMessage["parts"]) => parts.flatMap((part) => part.type === "text" || part.type === "reasoning" ? [part.type] : []);
const snapshotOf = (messages: ReturnType<typeof native>[], status: "idle" | "busy") =>
  ({ session: { id: SESSION, title: "Synthetic", version: "1", time: { created: 1, updated: 1 } }, todos: [], status: { type: status },
    messages: projectMessages(SESSION, messages as never) }) as unknown as LegalworkSessionSnapshot; // Fixture: len polia, ktoré konverzia číta.

const input = { workspaceId: "komentar-project", baseUrl: "http://127.0.0.1:1234", legalworkToken: "token" };
const event = (type: string, data: Record<string, unknown>) => ({ id: `evt_${type}`, created: 1, type, durable: { aggregateID: SESSION, seq: 1, version: 1 }, data: { sessionID: SESSION, ...data } }) as never;
const transcriptMessage = () => (getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey(input.workspaceId, SESSION)) ?? []).find(message => message.id === MESSAGE);
const settle = () => new Promise(resolve => setTimeout(resolve, 0));

/** Živý prenos v2: krok sa začne, text skončí s natívnou fázou, krok skončí a hotová správa sa načíta z enginu. */
async function live(content: readonly Content[], end: End, before?: () => void): Promise<UIMessage["parts"]> {
  const current = native(content, end);
  const client = { session: { message: { get: async () => current } } };
  const cleanup = __createWorkspaceSessionSyncForTest(input, client as never); // Falošný klient: len čítanie správy.
  const release = trackWorkspaceSessionSync(input, SESSION);
  try {
    seedSessionState(input.workspaceId, snapshotOf([], "busy"));
    getReactQueryClient().setQueryData(snapshotKey(input.workspaceId, SESSION), snapshotOf([], "busy"));
    __applySessionSyncEventForTest(input, event("session.step.started", { assistantMessageID: MESSAGE, model: { id: "gpt-6-luna", providerID: "openai" } }));
    content.forEach((item, ordinal) => {
      if (item.type !== "text") return;
      __applySessionSyncEventForTest(input, event("session.text.started", { assistantMessageID: MESSAGE, ordinal }));
      __applySessionSyncEventForTest(input, event("session.text.ended", { assistantMessageID: MESSAGE, ordinal, text: item.text, native: item.native }));
    });
    // Ešte pred koncom kroku je komentár uvažovaním (tak ho advokát vidí naživo).
    expect(textKinds(transcriptMessage()?.parts ?? []).filter(kind => kind === "text")).toEqual([]);
    before?.();
    if (end.completed) {
      __applySessionSyncEventForTest(input, event("session.step.ended", { assistantMessageID: MESSAGE }));
      await settle();
    }
    return transcriptMessage()?.parts ?? [];
  } finally { release(); cleanup(); }
}

/** Znovu otvorený chat: rovnaká správa zo snapshotu histórie enginu v2. */
function reopened(content: readonly Content[], end: End): UIMessage["parts"] {
  return snapshotToUIMessages(snapshotOf([native(content, end)], "idle"))[0]?.parts ?? [];
}

const ended = { completed: 2 };
const cases: [string, readonly Content[], End, string[]][] = [
  ["limit krokov hneď po komentári", [commentary()], { ...ended, finish: "length" }, ["text"]],
  ["prerušenie či chyba hneď po komentári", [commentary(), read], { ...ended, finish: "tool-calls", error: { type: "aborted", message: "Aborted" } }, ["text"]],
  ["krok s nástrojom, odpoveď príde v ďalšej správe", [commentary(), read], { ...ended, finish: "tool-calls" }, ["reasoning"]],
  ["krok s finish unknown", [commentary()], { ...ended, finish: "unknown" }, ["reasoning"]],
  ["správa ešte beží", [commentary()], {}, ["reasoning"]],
];

describe("#269 P3: komentár modelu naživo aj po znovuotvorení rovnako (engine v2)", () => {
  for (const [name, content, end, expected] of cases) {
    test(name, async () => {
      const reloaded = textKinds(reopened(content, end));
      expect(reloaded).toEqual(expected);
      expect(textKinds(await live(content, end))).toEqual(reloaded);
    });
  }

  test("chat otvorený počas behu: ťah skončí hneď po komentári, komentár sa ukáže ako odpoveď", async () => {
    const client = { session: { message: { get: async () => native([commentary()], { ...ended, finish: "length" }) } } };
    const cleanup = __createWorkspaceSessionSyncForTest(input, client as never); // Falošný klient: len čítanie správy.
    const release = trackWorkspaceSessionSync(input, SESSION);
    try {
      const running = snapshotOf([native([commentary()], {})], "busy");
      getReactQueryClient().setQueryData(snapshotKey(input.workspaceId, SESSION), running);
      seedSessionState(input.workspaceId, running);
      expect(textKinds(transcriptMessage()?.parts ?? [])).toEqual(["reasoning"]);
      __applySessionSyncEventForTest(input, event("session.step.ended", { assistantMessageID: MESSAGE }));
      await settle();
      expect(textKinds(transcriptMessage()?.parts ?? [])).toEqual(["text"]);
    } finally { release(); cleanup(); }
  });
});

describe("#348: neskoršie načítanie tej istej správy po konci ťahu", () => {
  /** Engine pošle hotovú správu znova (ďalší koniec kroku) s novším textom tej istej časti, stále ako komentár. */
  async function afterLateRead(content: readonly Content[], end: End, seeded: boolean): Promise<UIMessage["parts"]> {
    let current = native(content, end);
    const client = { session: { message: { get: async () => current } } };
    const cleanup = __createWorkspaceSessionSyncForTest(input, client as never); // Falošný klient: len čítanie správy.
    const release = trackWorkspaceSessionSync(input, SESSION);
    try {
      const first = snapshotOf(seeded ? [current] : [], seeded ? "idle" : "busy");
      getReactQueryClient().setQueryData(snapshotKey(input.workspaceId, SESSION), first);
      seedSessionState(input.workspaceId, first);
      if (!seeded) {
        __applySessionSyncEventForTest(input, event("session.step.started", { assistantMessageID: MESSAGE, model: { id: "gpt-6-luna", providerID: "openai" } }));
        __applySessionSyncEventForTest(input, event("session.text.started", { assistantMessageID: MESSAGE, ordinal: 0 }));
        __applySessionSyncEventForTest(input, event("session.text.ended", { assistantMessageID: MESSAGE, ordinal: 0, text: TEXT, native: commentary().native }));
        if (end.completed) { __applySessionSyncEventForTest(input, event("session.step.ended", { assistantMessageID: MESSAGE })); await settle(); }
      }
      current = native([commentary(`${TEXT} Done.`), ...content.slice(1)], end);
      __applySessionSyncEventForTest(input, event("session.step.ended", { assistantMessageID: MESSAGE }));
      await settle();
      return transcriptMessage()?.parts ?? [];
    } finally { release(); cleanup(); }
  }

  test("časť ukázaná pri konci ťahu ako text ostane textom a dostane novší obsah", async () => {
    const parts = await afterLateRead([commentary()], { ...ended, finish: "length" }, false);
    expect(textKinds(parts)).toEqual(["text"]);
    expect(parts.find(part => part.type === "text")).toMatchObject({ text: `${TEXT} Done.` });
  });

  test("hotová správa z načítaného chatu ostane textom", async () => {
    expect(textKinds(await afterLateRead([commentary()], { ...ended, finish: "length" }, true))).toEqual(["text"]);
  });

  test("komentár v kroku s nástrojom ostane uvažovaním", async () => {
    expect(textKinds(await afterLateRead([commentary(), read], { ...ended, finish: "tool-calls" }, false))).toEqual(["reasoning"]);
  });
});
