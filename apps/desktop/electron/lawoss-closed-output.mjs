// Hlavný proces Electronu (aj server v ňom) píše do stdout/stderr: console.*,
// log servera, správa o nezachytenej výnimke v main.mjs. Pri `pnpm dev`,
// natívnych testoch alebo launcheri sú to rúry k procesu, ktorý appku spustil.
// Keď ten skončí skôr, ďalší zápis vyšle `error` s EPIPE. Node console chybu
// zachytí len počas synchrónneho volania, takže EPIPE prišlo bez poslucháča
// ako nezachytená výnimka; jej hlásenie cez console.error vyvolalo ďalšiu
// a Electron ukázal „Uncaught Exception: write EPIPE“ alebo spadol.
// Zatvorený výstup tu nič neshodí; iné chyby streamu sa vyhodia ďalej.

const CLOSED_OUTPUT = new Set(["EPIPE", "ERR_STREAM_DESTROYED", "ERR_STREAM_WRITE_AFTER_END"]);

export function isClosedOutputError(error) {
  return typeof error?.code === "string" && CLOSED_OUTPUT.has(error.code);
}

export function ignoreClosedOutput(streams = [process.stdout, process.stderr]) {
  for (const stream of streams) {
    stream?.on("error", (error) => {
      if (isClosedOutputError(error)) return;
      throw error;
    });
  }
}
