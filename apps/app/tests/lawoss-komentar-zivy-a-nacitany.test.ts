// LAWOSS (#269 P3, N-A5-2): živý prenos a znovu otvorený chat ukážu komentár modelu rovnako.
import { afterEach, describe, expect, test } from "bun:test";
import type { UIMessage } from "ai";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { __applySessionSyncEventForTest, __createWorkspaceSessionSyncForTest, seedSessionState, trackWorkspaceSessionSync, transcriptKey } from "../src/react-app/domains/session/sync/session-sync";
import { snapshotToUIMessages } from "../src/react-app/domains/session/sync/usechat-adapter";
import type { LegalworkSessionSnapshot } from "../src/app/lib/legalwork-server";

afterEach(() => {
  getReactQueryClient().clear();
});

const SESSION = "ses_k1";
const MESSAGE = "msg_k1";
// Textová časť GPT-6 Luna vo fáze „commentary“, presne ako ju ukladá engine.
const commentary = { id: "prt_k1", sessionID: SESSION, messageID: MESSAGE, type: "text" as const,
  text: "We have memory links relative to project root; checking the documents.",
  metadata: { openai: { itemId: "msg_0cd4", phase: "commentary" } } };
const step = { id: "prt_step", sessionID: SESSION, messageID: MESSAGE, type: "step-start" as const };
const read = { id: "prt_tool", sessionID: SESSION, messageID: MESSAGE, type: "tool" as const, tool: "read", callID: "call_1",
  state: { status: "completed", input: { filePath: "a.md" }, output: "", title: "", metadata: {}, time: { start: 1, end: 2 } } };

type Info = { finish?: string; error?: unknown; time: { created: number; completed?: number } };
const info = (extra: Partial<Info> = {}) => ({ id: MESSAGE, role: "assistant", sessionID: SESSION, time: { created: 1 }, ...extra });
const textKinds = (parts: UIMessage["parts"]) => parts.flatMap((part) => part.type === "text" || part.type === "reasoning" ? [part.type] : []);

const input = { workspaceId: "komentar-project", baseUrl: "http://127.0.0.1:1234", legalworkToken: "token" };

/** Živý prenos: správa vznikne, príde komentár (prípadne nástroj), potom engine správu uzavrie. */
function live(parts: readonly unknown[], end: Partial<Info>): UIMessage["parts"] {
  const cleanup = __createWorkspaceSessionSyncForTest(input);
  const release = trackWorkspaceSessionSync(input, SESSION);
  try {
    __applySessionSyncEventForTest(input, { type: "message.updated", properties: { info: info() } } as never);
    for (const part of parts) __applySessionSyncEventForTest(input, { type: "message.part.updated", properties: { part } } as never);
    __applySessionSyncEventForTest(input, { type: "message.updated", properties: { info: info(end) } } as never);
    const transcript = getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey(input.workspaceId, SESSION)) ?? [];
    return transcript.find((message) => message.id === MESSAGE)?.parts ?? [];
  } finally { release(); cleanup(); }
}

/** Znovu otvorený chat: rovnaká správa zo snapshotu histórie. */
function reopened(parts: readonly unknown[], end: Partial<Info>): UIMessage["parts"] {
  const snapshot = { session: { id: SESSION }, todos: [], status: { type: "idle" }, messages: [{ info: info(end), parts }] } as unknown as LegalworkSessionSnapshot; // Fixture: len polia, ktoré konverzia číta.
  return snapshotToUIMessages(snapshot)[0]?.parts ?? [];
}

const ended = { time: { created: 1, completed: 2 } };
const cases: [string, readonly unknown[], Partial<Info>, string[]][] = [
  ["limit krokov hneď po komentári", [commentary], { ...ended, finish: "length" }, ["text"]],
  ["prerušenie či chyba hneď po komentári", [step, commentary, read], { ...ended, finish: "tool-calls", error: { name: "MessageAbortedError" } }, ["text"]],
  ["krok s nástrojom, odpoveď príde v ďalšej správe", [step, commentary, read], { ...ended, finish: "tool-calls" }, ["reasoning"]],
  ["krok s finish unknown", [commentary], { ...ended, finish: "unknown" }, ["reasoning"]],
  ["správa ešte beží", [commentary], {}, ["reasoning"]],
];

describe("#269 P3: komentár modelu naživo aj po znovuotvorení rovnako", () => {
  for (const [name, parts, end, expected] of cases) {
    test(name, () => {
      const reloaded = textKinds(reopened(parts, end));
      expect(reloaded).toEqual(expected);
      expect(textKinds(live(parts, end))).toEqual(reloaded);
    });
  }

  test("chat otvorený počas behu: ťah skončí hneď po komentári, komentár sa ukáže ako odpoveď", () => {
    const cleanup = __createWorkspaceSessionSyncForTest(input);
    const release = trackWorkspaceSessionSync(input, SESSION);
    try {
      seedSessionState(input.workspaceId, { session: { id: SESSION }, todos: [], status: { type: "busy" },
        messages: [{ info: info(), parts: [commentary] }] } as unknown as LegalworkSessionSnapshot); // Fixture: len polia, ktoré konverzia číta.
      __applySessionSyncEventForTest(input, { type: "message.updated", properties: { info: info({ ...ended, finish: "length" }) } } as never);
      const transcript = getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey(input.workspaceId, SESSION)) ?? [];
      expect(textKinds(transcript.find((message) => message.id === MESSAGE)?.parts ?? [])).toEqual(["text"]);
    } finally { release(); cleanup(); }
  });
});

describe("#348: neskorý message.part.updated komentára po konci ťahu", () => {
  /** Beží v živej synchronizácii: `prepare` pripraví správu, potom príde neskorá aktualizácia tej istej časti. */
  function afterLateUpdate(prepare: () => void): UIMessage["parts"] {
    const cleanup = __createWorkspaceSessionSyncForTest(input);
    const release = trackWorkspaceSessionSync(input, SESSION);
    try {
      prepare();
      __applySessionSyncEventForTest(input, { type: "message.part.updated", properties: { part: { ...commentary, text: `${commentary.text} Done.` } } } as never);
      const transcript = getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey(input.workspaceId, SESSION)) ?? [];
      return transcript.find((message) => message.id === MESSAGE)?.parts ?? [];
    } finally { release(); cleanup(); }
  }
  const finished = (type: string, end: Partial<Info>) => () => {
    __applySessionSyncEventForTest(input, { type: "message.updated", properties: { info: info() } } as never);
    __applySessionSyncEventForTest(input, { type: "message.part.updated", properties: { part: commentary } } as never);
    __applySessionSyncEventForTest(input, { type: "message.updated", properties: { info: info(end) } } as never);
    const transcript = getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey(input.workspaceId, SESSION)) ?? [];
    expect(textKinds(transcript.find((message) => message.id === MESSAGE)?.parts ?? [])).toEqual([type]);
  };

  test("časť prepnutá na text pri konci ťahu ostane textom a dostane novší obsah", () => {
    const parts = afterLateUpdate(finished("text", { ...ended, finish: "length" }));
    expect(textKinds(parts)).toEqual(["text"]);
    expect(parts[0]).toMatchObject({ text: `${commentary.text} Done.` });
  });

  test("hotová správa z načítaného chatu ostane textom", () => {
    const parts = afterLateUpdate(() => {
      seedSessionState(input.workspaceId, { session: { id: SESSION }, todos: [], status: { type: "idle" },
        messages: [{ info: info({ ...ended, finish: "length" }), parts: [commentary] }] } as unknown as LegalworkSessionSnapshot); // Fixture: len polia, ktoré konverzia číta.
    });
    expect(textKinds(parts)).toEqual(["text"]);
  });

  test("komentár v kroku s nástrojom ostane uvažovaním", () => {
    expect(textKinds(afterLateUpdate(finished("reasoning", { ...ended, finish: "tool-calls" })))).toEqual(["reasoning"]);
  });

  test("správa, ktorá ešte beží, ostane uvažovaním", () => {
    expect(textKinds(afterLateUpdate(finished("reasoning", {})))).toEqual(["reasoning"]);
  });
});
