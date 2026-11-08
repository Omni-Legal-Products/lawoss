import type { SessionQueue } from "@legalwork/types/session-queue";
import type { UIMessage } from "ai";
import { create } from "zustand";
import type { ComposerDraft } from "@/app/types";

type OutgoingMessage = { scope: string; queueId: string; message: UIMessage; urls: string[] };
export const assistantOutgoingScope = (baseUrl: string, workspaceId: string, sessionId: string) => JSON.stringify([baseUrl, workspaceId, sessionId]);

// Matches native-queue-transport's durable message ID, so confirmation replaces
// the local bubble without remounting it or comparing potentially identical text.
export const outgoingMessageId = (queueId: string) => `msg_${queueId.replaceAll("-", "")}`;
export const useAssistantOutgoingMessages = create<{ entries: OutgoingMessage[] }>(() => ({ entries: [] }));

export function addAssistantOutgoingMessage(scope: string, queueId: string, draft: ComposerDraft) {
  removeAssistantOutgoingMessage(queueId);
  const urls = draft.attachments.map(attachment => URL.createObjectURL(attachment.file));
  const text = draft.parts.map(part => {
    if (part.type === "text") return part.text;
    if (part.type === "paste") return `[pasted text ${part.label}]`;
    if (part.type === "file") return `@${part.label ?? part.path}`;
    if (part.type === "plugin") return `@${part.label}`;
    return `@${part.name}`;
  }).join("");
  const message: UIMessage = {
    id: outgoingMessageId(queueId), role: "user",
    metadata: { localOutgoing: true, opencode: { created: Date.now() } },
    parts: [
      ...draft.attachments.map((attachment, index) => ({ type: "file", filename: attachment.name, mediaType: attachment.mimeType, url: urls[index] } satisfies UIMessage["parts"][number])),
      ...(text ? [{ type: "text", text } satisfies UIMessage["parts"][number]] : []),
    ],
  };
  useAssistantOutgoingMessages.setState(state => ({ entries: [...state.entries, { scope, queueId, message, urls }] }));
}

export function removeAssistantOutgoingMessage(queueId: string) {
  const entries = useAssistantOutgoingMessages.getState().entries;
  const entry = entries.find(item => item.queueId === queueId);
  if (!entry) return;
  entry.urls.forEach(url => URL.revokeObjectURL(url));
  useAssistantOutgoingMessages.setState({ entries: entries.filter(item => item !== entry) });
}

export function moveAssistantOutgoingMessage(queueId: string, scope: string) {
  useAssistantOutgoingMessages.setState(state => ({ entries: state.entries.map(entry => entry.queueId === queueId ? { ...entry, scope } : entry) }));
}

export function mergeAssistantOutgoingMessages(messages: UIMessage[], entries: OutgoingMessage[], scope: string, queue?: SessionQueue) {
  const ids = new Set(messages.map(message => message.id));
  const pending = entries.filter(entry => entry.scope === scope && !ids.has(entry.message.id) && !assistantOutgoingIsQueued(entry.queueId, queue));
  return pending.length ? [...messages, ...pending.map(entry => entry.message)] : messages;
}

export function isLocalOutgoingMessage(message: UIMessage) {
  return Boolean(message.metadata && typeof message.metadata === "object" && "localOutgoing" in message.metadata && message.metadata.localOutgoing === true);
}

/** Only an idle chat with an empty, running queue can preview an immediate send. */
export function canPreviewAssistantSend(queue: SessionQueue | undefined, busy: boolean, editing: boolean, outgoing: boolean) {
  return Boolean(queue && !queue.paused && queue.entries.length === 0 && !busy && !editing && !outgoing);
}

/** The server can discover work that the submitting window has not seen yet. */
export function assistantOutgoingIsQueued(queueId: string, queue?: SessionQueue) {
  return Boolean(queue?.entries.some(entry => entry.id === queueId && entry.status !== "sending" && entry.status !== "accepted"));
}
