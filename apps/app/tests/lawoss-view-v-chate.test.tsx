// LAWOSS: prehľad (OpenUI) sa vykreslí priamo v karte nástroja v chate (rozhodnutie MČ 10. 11. 2026).
import { expect, test } from "bun:test";
import type { DynamicToolUIPart, UIMessage } from "ai";
import type { ReactNode } from "react";
import { renderToReadableStream } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ViewPreview } from "@legalwork/types/views";
import { t } from "../src/i18n";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { MessageListProvider } from "../src/components/chat/message-list-provider";
import { ViewToolCard } from "../src/react-app/domains/views/view-tool-card";
import { viewGenerationId } from "../src/react-app/domains/views/view-generation";
import { ChatInlineViewBudget, latestViewCallIds } from "../src/lawoss/chat/chat-view-inline";

const baseUrl = "http://127.0.0.1:4001", sessionId = "chat-1", workspaceId = "klient-1";
const program = 'root = Stack([Heading("Prehľad lehôt Alfa", 1), Table([{vec:"Žaloba Omega",stav:"Otvorená"}], [{field:"vec",label:"Vec"},{field:"stav",label:"Stav"}], false)], 1)';
const preview: ViewPreview = { status: "preview", owner: { kind: "workspace", id: workspaceId }, input: { version: 1, title: "Lehoty", mode: "report", catalog: "legalwork-1", program, queries: {} } };
const input = { title: "Lehoty", program };
const done = (toolCallId: string): DynamicToolUIPart => ({ type: "dynamic-tool", toolName: "view_create", toolCallId, state: "output-available", input, output: preview });
const noop = () => {};

async function render(part: DynamicToolUIPart, wrap: (card: ReactNode) => ReactNode = card => card) {
  const cache = new QueryClient();
  // SSR nespúšťa dotazy; údaje náhľadu (bez sieťového volania) sú v cache ako po prvom načítaní.
  const id = viewGenerationId(baseUrl, sessionId, part.toolCallId);
  cache.setQueryData(["view-data", baseUrl, "workspace", workspaceId, id, id, 0], {});
  try {
    const stream = await renderToReadableStream(<QueryClientProvider client={cache}>
      <MessageListProvider legalworkClient={createLegalworkServerClient({ baseUrl })} workspaceId={workspaceId} sessionId={sessionId} showThinking={false} developerMode={false}
        displaySuggestions={false} providerConnectedCount={1} dispatchAction={noop} setPrompt={noop} onRevertToUserMessage={noop} onForkAtMessage={noop} onEditUserMessage={noop}>
        {wrap(<ViewToolCard part={part} />)}
      </MessageListProvider>
    </QueryClientProvider>);
    await stream.allReady;
    return await new Response(stream).text();
  } finally { cache.clear(); }
}

test("dokončený view_create s náhľadom vykreslí prehľad priamo v karte a ponechá tlačidlo Otvoriť", async () => {
  const html = await render(done("call-hotovy"));
  expect(html).toContain("data-chat-inline-view");
  expect(html).toContain("Prehľad lehôt Alfa");
  expect(html).toContain("Žaloba Omega");
  expect(html).toContain("max-h-[420px]");
  expect(html).toContain("overflow-auto");
  expect(html).toContain(t("views.preview_unsaved"));
  expect(html).toMatch(/<button[^>]*>Open</);
  expect(html).not.toContain("lw-saved-view-error");
});

test("rozpracovaný view_create nevykreslí prehľad v chate, len riadok s priebehom", async () => {
  const html = await render({ type: "dynamic-tool", toolName: "view_create", toolCallId: "call-caka", state: "input-available", input });
  expect(html).not.toContain("data-chat-inline-view");
  expect(html).not.toContain("Prehľad lehôt Alfa");
  expect(html).toContain("animate-spin");
  expect(html).toMatch(/<button[^>]*>.*Open</);
});

test("neúspešný view_create nevykreslí prehľad v chate a ukáže chybu", async () => {
  for (const part of [
    { type: "dynamic-tool", toolName: "view_create", toolCallId: "call-chyba-1", state: "output-error", input, errorText: "Program sa nepodarilo overiť" },
    { type: "dynamic-tool", toolName: "view_create", toolCallId: "call-chyba-2", state: "output-available", input, output: { ok: false, error: "Program sa nepodarilo overiť" } },
  ] satisfies DynamicToolUIPart[]) {
    const html = await render(part);
    expect(html).not.toContain("data-chat-inline-view");
    expect(html).not.toContain("Prehľad lehôt Alfa");
    expect(html).toContain("Program sa nepodarilo overiť");
  }
});

test("v dlhom chate sa vykreslia len posledné tri prehľady, staršie ostanú kompaktnou kartou s tlačidlom", async () => {
  const messages: UIMessage[] = ["a", "b", "c", "d", "e"].map(name => ({ id: `m-${name}`, role: "assistant", parts: [{ type: "text", text: name }, done(`call-${name}`)] }));
  messages.push({ id: "m-f", role: "assistant", parts: [{ type: "dynamic-tool", toolName: "view_create", toolCallId: "call-f", state: "input-available", input }] });
  expect(latestViewCallIds(messages)).toEqual(["call-e", "call-d", "call-c"]);
  expect(latestViewCallIds([])).toEqual([]);
  const budget = (card: ReactNode) => <ChatInlineViewBudget messages={messages}>{card}</ChatInlineViewBudget>;
  const old = await render(done("call-a"), budget);
  expect(old).not.toContain("data-chat-inline-view");
  expect(old).toMatch(/<button[^>]*>Open</);
  expect(await render(done("call-e"), budget)).toContain("Prehľad lehôt Alfa");
});
