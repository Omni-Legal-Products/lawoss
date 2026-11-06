import { z } from "zod";

/**
 * A sync event says only that projects, tasks, the firm's policy or its hub changed; whoever hears it
 * pulls, or re-reads, what changed. `resync` comes first on every
 * connection: what happened before it may have been missed. The platform
 * sends them to a LegalWork server (GET /api/sync/events), and a LegalWork
 * server to the app windows showing it (GET /sync/events).
 */
const SyncPokeSchema = z.object({
  projects: z.boolean().optional(),
  tasks: z.boolean().optional(),
  policy: z.boolean().optional(),
  hub: z.boolean().optional(),
  sessions: z.boolean().optional(),
  approvals: z.boolean().optional(),
  resync: z.boolean().optional(),
});
export type SyncPoke = z.infer<typeof SyncPokeSchema>;

/** An event's data as a sync event, or null when it is none. */
export function syncPokeOf(data: string): SyncPoke | null {
  try {
    const poke = SyncPokeSchema.safeParse(JSON.parse(data));
    return poke.success ? poke.data : null;
  } catch {
    return null;
  }
}

/** Feed it a server-sent event stream's text as it comes; it hands on each event's data. */
export function serverSentEvents(onData: (data: string) => void): (text: string) => void {
  // The unfinished event is kept as pieces and joined only once a boundary is found, so a stream
  // cut into tiny pieces is not re-flattened and re-scanned from its start on every piece.
  let pending: string[] = [];
  let pendingLength = 0;
  let endsWithNewline = false;
  let afterCarriageReturn = false; // the last piece ended in "\r", already read as a line end
  return (piece) => {
    if (afterCarriageReturn && piece.startsWith("\n")) {
      piece = piece.slice(1); // "\r" | "\n" is one "\r\n"
      afterCarriageReturn = false;
    }
    if (piece === "") return;
    afterCarriageReturn = piece.endsWith("\r");
    const text = piece.replace(/\r\n?/g, "\n");
    if (!(endsWithNewline && text.startsWith("\n")) && !text.includes("\n\n")) {
      pending.push(text);
      pendingLength += text.length;
      endsWithNewline = text.endsWith("\n");
      return;
    }
    const buffer = pending.join("") + text;
    let start = 0;
    for (let end = buffer.indexOf("\n\n", Math.max(0, pendingLength - 1)); end >= 0; end = buffer.indexOf("\n\n", start)) {
      const data = buffer
        .slice(start, end)
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      start = end + 2;
      if (data.length > 0) onData(data.join("\n"));
    }
    const rest = buffer.slice(start);
    pending = rest === "" ? [] : [rest];
    pendingLength = rest.length;
    endsWithNewline = rest.endsWith("\n");
  };
}
