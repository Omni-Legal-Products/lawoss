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
    // LAWOSS v2: engine 2.1.4 posiela fázu poskytovateľa v `native` udalosti `session.text.ended`.
    const event = (type: string, data: Record<string, unknown>) => ({ id: `evt_${type}`, created: 1, type, durable: { aggregateID: "ses_c1", seq: 1, version: 1 }, data: { sessionID: "ses_c1", ...data } }) as never;
    try {
      __applySessionSyncEventForTest(input, event("session.step.started", { assistantMessageID: "msg_c1", model: { id: "gpt-6-luna", providerID: "openai" } }));
      __applySessionSyncEventForTest(input, event("session.text.started", { assistantMessageID: "msg_c1", ordinal: 0 }));
      __applySessionSyncEventForTest(input, event("session.text.ended", { assistantMessageID: "msg_c1", ordinal: 0, text: COMMENTARY, native: commentary.metadata.openai }));
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

  test("#269: krok s nástrojom je hotová správa, jeho komentár ostane po znovuotvorení uvažovaním", () => {
    // opencode ukladá každý krok s nástrojom ako hotovú správu s finish „tool-calls“; odpoveď príde v ďalšej správe.
    const step = { id: "prt_step", sessionID: "ses_c3", messageID: "msg_c3", type: "step-start" };
    const read = { id: "prt_tool", sessionID: "ses_c3", messageID: "msg_c3", type: "tool", tool: "read", callID: "call_1",
      state: { status: "completed", input: { filePath: "a.md" }, output: "", title: "", metadata: {}, time: { start: 1, end: 2 } } };
    const message = (id: string, finish: string, parts: unknown[], error?: unknown) => ({
      info: { id, role: "assistant", sessionID: "ses_c3", finish, ...(error ? { error } : {}), time: { created: 1, completed: 2 } }, parts,
    });
    const snapshot = {
      session: { id: "ses_c3" }, todos: [], status: { type: "idle" },
      messages: [
        message("msg_c3", "tool-calls", [step, { ...commentary, messageID: "msg_c3" }, read]),
        message("msg_c4", "unknown", [{ ...commentary, id: "prt_c4", messageID: "msg_c4" }]),
        message("msg_c5", "stop", [{ ...answer, messageID: "msg_c5" }]),
      ],
    } as unknown as LegalworkSessionSnapshot; // Fixture: len polia, ktoré konverzia číta.
    const messages = snapshotToUIMessages(snapshot);
    expect(messages.flatMap((entry) => visibleText(entry.parts, false))).toEqual(["text:## Zhrnutie spisu"]);
    expect(messages[0]?.parts.filter((part) => part.type === "text" || part.type === "reasoning").map((part) => part.type)).toEqual(["reasoning"]);

    // Ťah, ktorý skončil hneď po komentári (limit krokov, chyba), komentár ukáže ako odpoveď.
    for (const [finish, error] of [["length", undefined], ["tool-calls", { name: "MessageAbortedError" }]] as const) {
      const last = { ...snapshot, messages: [message("msg_c6", finish, [{ ...commentary, messageID: "msg_c6" }], error)] } as unknown as LegalworkSessionSnapshot;
      expect(snapshotToUIMessages(last)[0]?.parts.map((part) => part.type)).toEqual(["text"]);
    }
  });
});


describe("doplnky z LAWOSS Marketplace (test inštalácie 3. 11. 2026)", () => {
  test("sk: dopyt do Slov-Lex nie je „Čítanie súborov“, ale zdroj podľa názvu doplnku", () => {
    setLocale("sk");
    expect(getToolActivityLabel(tool("slovlex_get_law", { number: "40/1964" }))).toBe("Dopyt do zdroja Slov-Lex");
    expect(getToolHistoryLabel(tool("slovlex_get_law", {}, true))).toBe("Zdroj: Slov-Lex");
    expect(getToolHistoryLabel(tool("rpo_rpo_search", {}, true))).toBe("Zdroj: Register právnických osôb");
    expect(getToolRunSummary([tool("rpo_rpo_search", {}, true), tool("slovlex_get_law", {}, true)])).toBe(t("tool_run.summary.search"));
    expect(getToolIcon(tool("slovlex_get_law", {}, true))).toBe(getToolIcon(tool("grep", { pattern: "x" }, true)));
  });

  test("server s iným menom než doplnok a najdlhšia zhoda", () => {
    setLocale("cs");
    expect(getToolHistoryLabel(tool("fs_opendata_mcp_vat_status", {}, true))).toBe("Zdroj: Finanční správa SR");
    expect(getToolHistoryLabel(tool("cz_eu-registry_search", {}, true))).toBe("Zdroj: České registry");
    expect(getToolHistoryLabel(tool("ruz_get_statement", {}, true))).toBe("Zdroj: Registr účetních závěrek SR");
  });

  test("nástroj bez zhody so serverom marketplace ostáva podľa upstream vzoru", () => {
    setLocale("sk");
    expect(getToolRunSummary([tool("ruzovy_get_list", {}, true)])).toBe(t("tool_run.summary.read"));
  });
});

describe("režim kódu: kroky vo vnútri execute (test pred spustením alfy 12. 11. 2026)", () => {
  const execute = (toolNames: string[], done = true): DynamicToolUIPart => done
    ? { type: "dynamic-tool", toolName: "execute", toolCallId: "exec", state: "output-available", input: {}, output: "", callProviderMetadata: { opencode: { toolNames, executedTools: toolNames } } }
    : { type: "dynamic-tool", toolName: "execute", toolCallId: "exec", state: "input-available", input: {}, callProviderMetadata: { opencode: { toolNames } } };

  test("sk: registre ako zdroj, hľadanie nástroja skryté, pamäť po slovensky", () => {
    setLocale("sk");
    expect(getToolHistoryLabel(execute(["search", "orsr.orsr_get_company_data_by_query", "slovlex.get_paragraph"])))
      .toBe("Zdroj: Obchodný register SR · Zdroj: Slov-Lex");
    expect(getToolHistoryLabel(execute(["search"]))).toBe(t("tool_run.summary.tool"));
    expect(getToolActivityLabel(execute(["lawoss_memory_deadline"], false))).toBe(t("lawoss.tool.memory_deadline"));
    expect(getToolActivityLabel(execute(["slovlex.get_paragraph"], false))).toBe("Dopyt do zdroja Slov-Lex");
  });

  test("sk: execute bez vnorených nástrojov (čaká na kartu) nie je „Spúšťanie execute“", () => {
    setLocale("sk");
    expect(getToolActivityLabel(execute([], false))).toBe("Pracujem");
  });

  test("neznámy nástroj ostane čitateľným menom", () => {
    setLocale("sk");
    expect(getToolHistoryLabel(execute(["browser.click"]))).toBe("Browser click");
  });
});
