import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MemoryRouter } from "react-router-dom";
import { renderToStaticMarkup } from "react-dom/server";
import { ScheduledTaskSchema } from "@legalwork/types/scheduled-tasks";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { ScheduledTaskToolCard, parseScheduledTaskCard } from "../src/components/chat/scheduled-task-card";
import { MessageListProvider } from "../src/components/chat/message-list-provider";
import { MessageList } from "../src/components/chat/message-list";
import { parseScheduledRunMessage, scheduledTextMetadata } from "../src/react-app/domains/scheduled-tasks/scheduled-message";
import type { UIMessage } from "ai";

const task = ScheduledTaskSchema.parse({ id: "101ec043-4ef0-4df7-88b6-4690869e8830", workspaceId: "matter", revision: 1,
  title: "Original title", prompt: "Review open work", sessionId: "chat", status: "active", nextRunAt: "2099-10-06T09:00:00Z",
  createdAt: "2026-10-06T09:00:00Z", updatedAt: "2026-10-06T09:00:00Z", schedule: { kind: "once", startAt: "2099-10-06T09:00:00Z", timeZone: "Europe/Berlin" },
});

test("scheduled run messages render the card, including persisted legacy messages", () => {
  const client = createLegalworkServerClient({ baseUrl: "http://scheduled-fixture.invalid", token: "fixture" });
  for (const legacy of [false, true]) {
    const cache = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
    cache.setQueryData(["scheduled-tasks", client.baseUrl], { tasks: [task] });
    cache.setQueryData(["scheduled-task", client.baseUrl, "matter", task.id], { task, runs: [{ sessionId: "chat" }] });
    const metadata = scheduledTextMetadata({ id: "text", metadata: { legalworkScheduledTask: { taskId: task.id, workspaceId: "matter", title: task.title } } });
    const message: UIMessage = { id: "scheduled", role: "user", parts: [{ type: "text", text: `[Scheduled task: ${task.title}]\n\n${task.prompt}`,
      ...(legacy ? {} : { providerMetadata: metadata }) }] };
    expect(parseScheduledRunMessage(message)?.prompt).toBe(task.prompt);
    const noop = () => {};
    const html = renderToStaticMarkup(<QueryClientProvider client={cache}><MemoryRouter>
      <MessageListProvider legalworkClient={client} workspaceId="matter" sessionId="chat" showThinking={false} developerMode={false}
        displaySuggestions={false} providerConnectedCount={1} dispatchAction={noop} setPrompt={noop}
        onRevertToUserMessage={noop} onForkAtMessage={noop} onEditUserMessage={noop}>
        <MessageList messages={[message]} status="ready" />
      </MessageListProvider>
    </MemoryRouter></QueryClientProvider>);
    expect(html).toContain("Scheduled task"); expect(html).toContain(task.title); expect(html).toContain(task.prompt);
    expect(html).toContain(">Open</button>"); expect(html).not.toContain("[Scheduled task:");
    cache.clear();
  }
});

test("ordinary messages and assistant quotations do not become scheduled runs", () => {
  for (const text of ["Schedule a recording review", "Quoted: [Scheduled task: Review]\n\nInstructions", "[Scheduled task: Review]"]) {
    expect(parseScheduledRunMessage({ id: "user", role: "user", parts: [{ type: "text", text }] })).toBeNull();
  }
  expect(parseScheduledRunMessage({ id: "assistant", role: "assistant", parts: [{ type: "text", text: "[Scheduled task: Review]\n\nInstructions" }] })).toBeNull();
});

test("task cards read persisted tool results and reject malformed or failed results", () => {
  expect(parseScheduledTaskCard(JSON.stringify({ ok: true, referenceData: { task } }))).toEqual(task);
  for (const output of ["{", null, { ok: false, error: "Unavailable" }, { task: { ...task, schedule: null } }]) expect(parseScheduledTaskCard(output)).toBeNull();
});

test("Open cards use the current server task, and cannot open from a different project", () => {
  const client = createLegalworkServerClient({ baseUrl: "http://scheduled-fixture.invalid", token: "fixture" });
  for (const workspaceId of ["matter", "other"]) {
    const cache = new QueryClient({ defaultOptions: { queries: { gcTime: 0 } } });
    cache.setQueryData(["scheduled-task", client.baseUrl, "matter", task.id], { task: { ...task, title: "Edited title", projectAccess: "all" }, runs: [] });
    const noop = () => {};
    const html = renderToStaticMarkup(<QueryClientProvider client={cache}><MemoryRouter>
      <MessageListProvider legalworkClient={client} workspaceId={workspaceId} sessionId="chat" showThinking={false} developerMode={false}
        displaySuggestions={false} providerConnectedCount={1} dispatchAction={noop} setPrompt={noop}
        onRevertToUserMessage={noop} onForkAtMessage={noop} onEditUserMessage={noop}>
        <ScheduledTaskToolCard part={{ type: "dynamic-tool", toolName: "legalwork_schedule_create", toolCallId: "create", state: "output-available", input: {}, output: { ok: true, referenceData: { task } } }} />
      </MessageListProvider>
    </MemoryRouter></QueryClientProvider>);
    if (workspaceId === "matter") { expect(html).toContain("Edited title"); expect(html).toContain("All clients"); expect(html).not.toContain('disabled=""'); }
    else { expect(html).toContain('disabled=""'); expect(html).not.toContain("Edited title"); }
    cache.clear();
  }
});
