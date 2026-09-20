export function LawossOkfHandoff(input: { directory: string }): Promise<{
  event?: (input: { event: { type: string; properties?: { sessionID?: string } } }) => Promise<void>;
  "experimental.session.compacting"?: (input: { sessionID: string }, output: { context: string[]; prompt?: string }) => Promise<void>;
  "experimental.chat.system.transform"?: (input: { sessionID?: string }, output: { system: string[] }) => Promise<void>;
}>;
