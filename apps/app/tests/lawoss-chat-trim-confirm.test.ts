import { afterEach, describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import type { UIMessage } from "ai";
import { setLocale, t } from "../src/i18n";
import { chatTrimCopy, chatTrimSummary, confirmChatTrim } from "../src/lawoss/chat/trim-confirm";

const user = (id: string, text: string): UIMessage => ({ id, role: "user", parts: [{ type: "text", text }] });
const tool = (toolName: string, state: "output-available" | "output-error" = "output-available") =>
  state === "output-available"
    ? { type: "dynamic-tool" as const, toolName, toolCallId: `${toolName}-call`, state, input: {}, output: "ok" }
    : { type: "dynamic-tool" as const, toolName, toolCallId: `${toolName}-call`, state, input: {}, errorText: "zamietnuté" };
const assistant = (id: string, parts: UIMessage["parts"]): UIMessage => ({ id, role: "assistant", parts });

const longQuestion = "Presuň zmluvu o dielo do spisu M005 a premenuj ju podľa dátumu podpisu, prosím, ešte dnes";
const messages: UIMessage[] = [
  user("u1", "Zhrň spis M004"),
  assistant("a1", [{ type: "text", text: "Zhrnutie…" }, tool("read")]),
  user("u2", longQuestion),
  assistant("a2", [tool("lawoss_files"), tool("edit", "output-error")]),
  assistant("a3", [tool("inapp_markdown_create"), tool("bash"), { type: "text", text: "Hotovo." }]),
];

afterEach(() => setLocale("en"));

describe("skrátenie rozhovoru (N-A7-9)", () => {
  test("tlačidlo nesľubuje vrátenie súborov v žiadnom jazyku", () => {
    const expected = { sk: "Skrátiť rozhovor odtiaľto", cs: "Zkrátit konverzaci odsud", en: "Trim conversation from here", de: "Unterhaltung ab hier kürzen" } as const;
    for (const [locale, label] of Object.entries(expected)) {
      setLocale(locale as keyof typeof expected);
      expect(t("message_list.revert")).toBe(label);
    }
  });

  test("pod otázkou reže od nej, pod odpoveďou od otázky nad ňou", () => {
    expect(chatTrimSummary(messages, "u2").boundaryId).toBe("u2");
    expect(chatTrimSummary(messages, "a3").boundaryId).toBe("u2");
    expect(chatTrimSummary(messages, "a1").boundaryId).toBe("u1");
  });

  test("ukáže začiatok otázky a spočíta len hotové zmeny súborov v odstránenej časti", () => {
    const summary = chatTrimSummary(messages, "a3");
    expect(summary.question).toBe(`${longQuestion.slice(0, 60).trimEnd()}…`);
    expect(summary.fileChanges).toBe(2);
    expect(chatTrimSummary(messages, "a1").fileChanges).toBe(2);
    expect(chatTrimSummary([user("u1", "Ahoj"), assistant("a1", [tool("read")])], "u1")).toMatchObject({ question: "Ahoj", fileChanges: 0 });
  });

  test("dávka lawoss_files sa ráta po vykonaných zmenách, nie ako jedno volanie (N-A8-5)", () => {
    const operations = ["a", "b", "c", "d", "e"].map((name) => ({ operation: "move", from: `00_Na_zatriedenie/${name}.txt`, to: `Korespondencia/${name}.txt` }));
    const batch = (statuses: string[] | null, output?: string) => ({
      type: "dynamic-tool" as const, toolName: "lawoss_files", toolCallId: "batch-call", state: "output-available" as const, input: { operations },
      output: output ?? JSON.stringify({ results: (statuses ?? []).map((status, index) => ({ ...operations[index], kind: "file", status })), complete: statuses?.every((status) => status === "done") }),
    });
    const count = (part: UIMessage["parts"][number]) => chatTrimSummary([user("u1", "Presuň všetky .txt"), assistant("a1", [part])], "a1").fileChanges;
    expect(count(batch(["done", "done", "done", "done", "done"]))).toBe(5);
    expect(count(batch(["done", "done", "failed", "not_run", "not_run"]))).toBe(2);
    expect(count(batch(["failed", "not_run", "not_run", "not_run", "not_run"]))).toBe(0);
    expect(count(batch(null, "nečitateľný výsledok"))).toBe(5);
    expect(count({ type: "dynamic-tool", toolName: "lawoss_files", toolCallId: "rejected", state: "output-error", input: { operations }, errorText: "zamietnuté" })).toBe(0);
    setLocale("sk");
    expect(chatTrimCopy({ mode: "trim", question: "x", fileChanges: count(batch(["done", "done", "done", "done", "done"])) }).changed).toStartWith("Agent v tejto časti urobil 5 zmien súborov.");
  });

  test("okno po slovensky hovorí, že súbory sa nezmenia a správy sa nedajú obnoviť", () => {
    setLocale("sk");
    const copy = chatTrimCopy({ mode: "trim", question: "Zhrň spis M004", fileChanges: 2 });
    expect(copy.title).toBe("Skrátiť rozhovor?");
    expect(copy.description).toBe("Z rozhovoru odstránim otázku „Zhrň spis M004“ a všetko, čo nasleduje. Odstránené správy sa nedajú obnoviť.");
    expect(copy.files).toStartWith("Súbory sa nezmenia.");
    expect(copy.changed).toStartWith("Agent v tejto časti urobil 2 zmeny súborov.");
    expect(copy.fork).toBe("Rozvetviť do nového chatu");
    expect(copy.confirm).toBe("Skrátiť rozhovor");
    expect(chatTrimCopy({ mode: "trim", question: "x", fileChanges: 0 }).changed).toBeNull();
    const edit = chatTrimCopy({ mode: "edit", question: "x", fileChanges: 0 });
    expect([edit.title, edit.confirm, edit.fork]).toEqual(["Upraviť správu?", "Upraviť", null]);
    expect(edit.description).toContain("Súbory sa nezmenia.");
  });

  test("bez potvrdenia sa nič neskráti; úprava rozvetvenie neponúka", async () => {
    const asked: unknown[] = [];
    const answer = (choice: "cancel" | "fork" | "trim") => async (request: unknown) => { asked.push(request); return choice; };
    expect(await confirmChatTrim(messages, "a3", "trim", answer("cancel"))).toEqual({ choice: "cancel", boundaryId: "u2" });
    expect(await confirmChatTrim(messages, "a3", "trim", answer("fork"))).toEqual({ choice: "fork", boundaryId: "u2" });
    expect(await confirmChatTrim(messages, "u2", "edit", answer("fork"))).toEqual({ choice: "cancel", boundaryId: "u2" });
    expect(asked[0]).toEqual({ mode: "trim", question: `${longQuestion.slice(0, 60).trimEnd()}…`, fileChanges: 2 });
  });

  test("appka sa pýta pred skrátením aj pred úpravou správy a okno je pripojené", () => {
    const surface = readFileSync(new URL("../src/react-app/domains/session/surface/session-surface.tsx", import.meta.url), "utf8");
    const handler = (name: string) => surface.slice(surface.indexOf(`const ${name} = useCallback`), surface.indexOf("}, [", surface.indexOf(`const ${name} = useCallback`)));
    for (const [name, mode] of [["handleRevertToUserMessage", "trim"], ["handleEditUserMessage", "edit"]] as const) {
      const body = handler(name);
      const asked = body.indexOf(`confirmChatTrim(renderedMessages, messageId, "${mode}")`);
      expect(asked).toBeGreaterThan(-1);
      expect(asked).toBeLessThan(body.indexOf("props.onRevertToMessage?.("));
    }
    const providers = readFileSync(new URL("../src/react-app/shell/providers.tsx", import.meta.url), "utf8");
    expect(providers).toContain("<ChatTrimConfirmHost />");
  });
});
