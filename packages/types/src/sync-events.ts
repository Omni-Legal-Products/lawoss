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
  groups: z.boolean().optional(),
  reload: z.boolean().optional(),
  metadata: z.boolean().optional(),
  reviews: z.boolean().optional(),
  suggestions: z.boolean().optional(),
  sandbox: z.boolean().optional(),
  views: z.boolean().optional(),
  queues: z.boolean().optional(),
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

/**
 * The longest event kept while it is unfinished; a longer one is dropped whole, however the stream was cut. Counted
 * as string length after line ends are normalized: a guard on memory, not a protocol limit.
 */
export const maxEventBytes = 16 * 1024 * 1024;
const PIECES_BEFORE_COMPACTION = 256;

/** Feed it a server-sent event stream's text as it comes; it hands on each event's data. */
export function serverSentEvents(onData: (data: string) => void, limit = maxEventBytes): (text: string) => void {
  // The unfinished event is kept as pieces and joined only once a boundary is found, so a stream
  // cut into tiny pieces is not re-flattened and re-scanned from its start on every piece.
  let pending: string[] = [];
  let pendingLength = 0;
  let compacted = 0; // how many leading pieces are already compacted runs; each character is compacted once
  let endsWithNewline = false;
  let afterCarriageReturn = false; // the last piece ended in "\r", already read as a line end
  let dropping = false; // the unfinished event went over the limit: skip to its boundary
  // A final "\n" may be half of the boundary, which an event's length does not include.
  const overLimit = (length: number) => length - (endsWithNewline ? 1 : 0) > limit;
  const drop = () => {
    pending = [];
    pendingLength = 0;
    compacted = 0;
    dropping = true;
  };
  const accept = (text: string) => {
    if (!(endsWithNewline && text.startsWith("\n")) && !text.includes("\n\n")) {
      pendingLength += text.length;
      endsWithNewline = text.endsWith("\n");
      if (overLimit(pendingLength)) {
        drop();
        return;
      }
      pending.push(text);
      // Tiny pieces cost far more than their characters. Only the run since the last compaction is joined:
      // joining the whole list every time would copy the event over and over and make this quadratic.
      if (pending.length - compacted > PIECES_BEFORE_COMPACTION) {
        pending.push(pending.splice(compacted).join(""));
        compacted = pending.length;
      }
      return;
    }
    const buffer = pending.join("") + text;
    let start = 0;
    for (let end = buffer.indexOf("\n\n", Math.max(0, pendingLength - 1)); end >= 0; end = buffer.indexOf("\n\n", start)) {
      const data = end - start > limit ? [] : buffer
        .slice(start, end)
        .split("\n")
        .filter((line) => line.startsWith("data:"))
        .map((line) => line.slice(5).trimStart());
      start = end + 2;
      if (data.length > 0) onData(data.join("\n"));
    }
    const rest = buffer.slice(start);
    endsWithNewline = rest.endsWith("\n");
    if (overLimit(rest.length)) {
      drop();
      return;
    }
    pending = rest === "" ? [] : [rest];
    pendingLength = rest.length;
    compacted = 0;
  };
  return (piece) => {
    if (afterCarriageReturn && piece.startsWith("\n")) {
      piece = piece.slice(1); // "\r" | "\n" is one "\r\n"
      afterCarriageReturn = false;
    }
    if (piece === "") return;
    afterCarriageReturn = piece.endsWith("\r");
    const text = piece.replace(/\r\n?/g, "\n");
    if (!dropping) {
      accept(text);
      return;
    }
    const found = text.indexOf("\n\n");
    const resume = endsWithNewline && text.startsWith("\n") ? 1 : found === -1 ? -1 : found + 2;
    if (resume === -1) {
      endsWithNewline = text.endsWith("\n");
      return;
    }
    dropping = false;
    endsWithNewline = false;
    if (resume < text.length) accept(text.slice(resume));
  };
}
