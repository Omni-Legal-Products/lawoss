/**
 * LAWOSS: upstream projection of engine v2 messages plus the native metadata of assistant text content, which
 * the upstream projection drops. Without it a model's commentary (`phase: "commentary"`) would show as the answer
 * after reload (N-A5-2). Same ids and order as upstream; text parts gain `metadata.native` and the message keeps
 * the engine's `finish`, which tells a tool step from the end of a turn (`commentaryIsAnswer`, #269).
 */
import { projectMessage as upstreamProjectMessage, type MessageView } from "@legalwork/types/opencode-view";
import { nativeTextMetadata } from "./commentary";

type ProjectArgs = Parameters<typeof upstreamProjectMessage>;
type NativeMessage = ProjectArgs[1];
type Historical = ProjectArgs[2];

export function projectMessage(sessionID: string, message: NativeMessage, historical?: Historical): MessageView[] {
  const views = upstreamProjectMessage(sessionID, message, historical);
  if (message.type !== "assistant") return views;
  const finished = message.finish === undefined ? views : views.map(view => ({ ...view, info: { ...view.info, finish: message.finish } }));
  const natives = new Map<string, unknown>(message.content.flatMap((content, index) =>
    content.type === "text" && "native" in content && content.native ? [[`${message.id}:content:${index}`, content.native] satisfies [string, unknown]] : []));
  if (!natives.size) return finished;
  return finished.map(view => ({ ...view, parts: view.parts.map(part => part.type === "text" && natives.has(part.id)
    ? { ...part, ...nativeTextMetadata(natives.get(part.id)) } : part) }));
}

export function projectMessages(sessionID: string, messages: NativeMessage[], historical?: Record<string, Historical>): MessageView[] {
  return messages.flatMap(message => projectMessage(sessionID, message, historical?.[message.id]));
}
