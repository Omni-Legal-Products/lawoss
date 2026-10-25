// LAWOSS (UI test dev 25. 10. 2026): N-A5-2 vnútorný komentár modelu v chate, N-A5-7 technické názvy krokov agenta.
import { afterEach, describe, expect, test } from "bun:test";
import type { DynamicToolUIPart, UIMessage } from "ai";
import { setLocale, t, type Language } from "../src/i18n";
import { getToolHistoryLabel, getToolIcon, getToolRunSummary } from "../src/components/tools/tool-presentation";
import { getToolActivityLabel } from "../src/lib/tool-activity";
import { getAssistantRenderGroups } from "../src/components/chat/utils";
import { getReactQueryClient } from "../src/react-app/infra/query-client";
import { __applySessionSyncEventForTest, __createWorkspaceSessionSyncForTest, trackWorkspaceSessionSync, transcriptKey } from "../src/react-app/domains/session/sync/session-sync";
import { snapshotToUIMessages } from "../src/react-app/domains/session/sync/usechat-adapter";
import type { LegalworkSessionSnapshot } from "../src/app/lib/legalwork-server";

afterEach(() => {
  getReactQueryClient().clear();
  setLocale("en");
});

// Presne ako v engine z testu: textová časť GPT-6 Luna vo fáze „commentary“, potom odpoveď vo fáze „final_answer“.
const COMMENTARY = "We have memory links relative to project root; user asks summary with links to documents.##";
const commentary = { id: "prt_commentary", sessionID: "ses_c1", messageID: "msg_c1", type: "text" as const, text: COMMENTARY,
  metadata: { openai: { itemId: "msg_0cd4", phase: "commentary" } } };
const answer = { id: "prt_answer", sessionID: "ses_c1", messageID: "msg_c1", type: "text" as const, text: "## Zhrnutie spisu",
  metadata: { openai: { itemId: "msg_0cd5", phase: "final_answer" } } };

const visibleText = (parts: UIMessage["parts"], showThinking: boolean) =>
  getAssistantRenderGroups(parts, showThinking).flatMap((group) => group.kind === "text" || group.kind === "reasoning" ? [`${group.kind}:${group.text}`] : []);

describe("N-A5-2: komentár modelu nie je odpoveď", () => {
  test("načítaný chat: komentár je uvažovanie, skryté bez Zobraziť uvažovanie", () => {
    const snapshot = {
      session: { id: "ses_c1" }, todos: [], status: { type: "idle" },
      messages: [{ info: { id: "msg_c1", role: "assistant", sessionID: "ses_c1", time: { created: 1 } }, parts: [commentary, answer] }],
    } as unknown as LegalworkSessionSnapshot; // Fixture: len polia, ktoré konverzia číta.
    const parts = snapshotToUIMessages(snapshot)[0]?.parts ?? [];
    expect(parts.map((part) => part.type)).toEqual(["reasoning", "text"]);
    expect(visibleText(parts, false)).toEqual(["text:## Zhrnutie spisu"]);
    expect(visibleText(parts, true)).toEqual([`reasoning:${COMMENTARY}`, "text:## Zhrnutie spisu"]);
  });

  test("živý prenos: komentár počas práce sa neukáže ako text odpovede", () => {
    const input = { workspaceId: "commentary-project", baseUrl: "http://127.0.0.1:1234", legalworkToken: "token" };
    const cleanup = __createWorkspaceSessionSyncForTest(input);
    const release = trackWorkspaceSessionSync(input, "ses_c1");
    try {
      __applySessionSyncEventForTest(input, { type: "message.updated", properties: { info: { id: "msg_c1", role: "assistant", sessionID: "ses_c1", time: { created: 1 } } } } as never);
      __applySessionSyncEventForTest(input, { type: "message.part.updated", properties: { part: commentary } } as never);
      const transcript = getReactQueryClient().getQueryData<UIMessage[]>(transcriptKey(input.workspaceId, "ses_c1")) ?? [];
      const parts = transcript.find((message) => message.id === "msg_c1")?.parts ?? [];
      expect(parts.map((part) => part.type)).toEqual(["reasoning"]);
      expect(visibleText(parts, false)).toEqual([]);
    } finally { release(); cleanup(); }
  });
});

const tool = (toolName: string, input: Record<string, unknown>, done = false): DynamicToolUIPart => done
  ? { type: "dynamic-tool", toolName, toolCallId: `${toolName}-1`, state: "output-available", input, output: "{}" }
  : { type: "dynamic-tool", toolName, toolCallId: `${toolName}-1`, state: "input-available", input };
const read = (filePath: string): DynamicToolUIPart => tool("read", { filePath });

describe("N-A5-7: kroky agenta bez názvov nástrojov", () => {
  const steps: [string, Record<string, unknown>][] = [
    ["lawoss_documents_prepare", { paths: ["a.pdf"] }], ["lawoss_documents_list", {}], ["lawoss_documents_read", { id: "x" }],
    ["lawoss_documents_export", {}], ["lawoss_documents_validate", {}], ["lawoss_files", { operations: [] }],
    ["legalwork_project_remote_folders", {}], ["legalwork_shell", { command: "ls" }], ["storage_read_file", { path: "a.pdf" }],
    ["lawoss_buduci_nastroj", {}],
  ];

  for (const locale of ["sk", "cs", "en", "de"] as Language[]) {
    test(`${locale}: počas behu aj po skončení obyčajný krok, nikdy „lawoss“, „legalwork“, „remote folders“ či „cloud“`, () => {
      setLocale(locale);
      for (const [name, input] of steps) {
        for (const label of [getToolActivityLabel(tool(name, input)), getToolHistoryLabel(tool(name, input, true))]) {
          expect(label.toLowerCase()).not.toMatch(/lawoss|legalwork|remote folders|cloud|cloudov|_/);
        }
      }
    });
  }

  test("sk: konkrétne texty krokov, prepis chatu ses_….md ako predchádzajúci rozhovor", () => {
    setLocale("sk");
    expect(getToolActivityLabel(tool("lawoss_documents_prepare", {}))).toBe("Príprava dokumentov na čítanie");
    expect(getToolHistoryLabel(tool("lawoss_files", {}, true))).toBe("Zmena súborov");
    expect(getToolActivityLabel(tool("legalwork_project_remote_folders", {}))).toBe("Zisťovanie pripojených priečinkov");
    expect(getToolActivityLabel(tool("storage_read_file", {}))).toBe("Čítanie súboru");
    expect(getToolActivityLabel(tool("legalwork_shell", { command: "ls" }))).toBe(t("tool_activity.running_command"));
    expect(getToolActivityLabel(read("/prax/Klienti/C001/.legalwork/ses_e8cd4536effeWZzSPl2kgqHfe1.md"))).toBe("Čítanie predchádzajúceho rozhovoru");
    // Bežný súbor ostáva s menom.
    expect(getToolActivityLabel(read("/prax/Klienti/C001/zmluva.pdf"))).toBe(t("tool_activity.reading_file", { file: "zmluva.pdf" }));
  });
});

describe("review N-A5-2/7", () => {
  test("legalwork_shell s popisom (povinný) ukáže popis, nie „legalwork shell“, a je príkaz", () => {
    setLocale("sk");
    const input = { command: "python format.py", description: "Formátujem zmluvu podľa vzoru kancelárie" };
    expect(getToolActivityLabel(tool("legalwork_shell", input))).toBe("Formátujem zmluvu podľa vzoru kancelárie");
    expect(getToolHistoryLabel(tool("legalwork_shell", input, true))).toBe("Formátujem zmluvu podľa vzoru kancelárie");
    expect(getToolIcon(tool("legalwork_shell", input, true))).toBe(getToolIcon(tool("bash", { command: "ls" }, true)));
  });

  test("zmena súborov nie je „prehľadané súbory“, príprava dokumentov je čítanie", () => {
    setLocale("sk");
    expect(getToolRunSummary([tool("lawoss_files", {}, true), tool("lawoss_documents_prepare", {}, true)])).toBe(`${t("tool_run.summary.edit")} · ${t("tool_run.summary.read")}`);
  });

  test("hotová správa, ktorej jediný text je komentár, ho ukáže ako odpoveď", () => {
    const snapshot = {
      session: { id: "ses_c2" }, todos: [], status: { type: "idle" },
      messages: [{ info: { id: "msg_c2", role: "assistant", sessionID: "ses_c2", time: { created: 1, completed: 2 } }, parts: [{ ...commentary, messageID: "msg_c2" }] }],
    } as unknown as LegalworkSessionSnapshot; // Fixture: len polia, ktoré konverzia číta.
    expect(snapshotToUIMessages(snapshot)[0]?.parts.map((part) => part.type)).toEqual(["text"]);
    // Komentár pod iným menom poskytovateľa (Azure a iné kompatibilné) je tiež komentár.
    const azure = { ...commentary, metadata: { azure: { phase: "commentary" } } };
    const pending = { ...snapshot, messages: [{ ...snapshot.messages[0]!, info: { ...snapshot.messages[0]!.info, time: { created: 1 } }, parts: [azure] }] } as unknown as LegalworkSessionSnapshot;
    expect(snapshotToUIMessages(pending)[0]?.parts.map((part) => part.type)).toEqual(["reasoning"]);
  });
});

