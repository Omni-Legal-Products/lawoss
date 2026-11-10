import type { Writable } from "node:stream";

// Zápis riadku logu servera, ktorý neshodí proces, keď čitateľ výstupu skončil.
// V desktope beží server v hlavnom procese Electronu; jeho stdout je rúra k
// procesu, ktorý appku spustil (pnpm dev, testy, launcher). Keď ten skončí
// skôr ako appka, `write` vyšle `error` s EPIPE. Bez poslucháča je to
// nezachytená výnimka a Electron ukáže „Uncaught Exception: write EPIPE“ alebo
// spadne. Zatvorený výstup sa tu zapamätá a ďalšie riadky sa zahodia; iné
// chyby streamu sa vyhodia ďalej ako doteraz.

const CLOSED_OUTPUT = new Set(["EPIPE", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END"]);

const guarded = new WeakSet<Writable>();
const closed = new WeakSet<Writable>();

function isClosedOutput(error: unknown): boolean {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : undefined;
  return typeof code === "string" && CLOSED_OUTPUT.has(code);
}

function guard(stream: Writable): void {
  if (guarded.has(stream)) return;
  guarded.add(stream);
  stream.on("error", (error) => {
    if (isClosedOutput(error)) {
      closed.add(stream);
      return;
    }
    throw error;
  });
}

export function writeLogLine(line: string, stream: Writable = process.stdout): void {
  if (closed.has(stream) || stream.destroyed || stream.writableEnded) return;
  guard(stream);
  try {
    stream.write(line);
  } catch (error) {
    if (!isClosedOutput(error)) throw error;
    closed.add(stream);
  }
}
