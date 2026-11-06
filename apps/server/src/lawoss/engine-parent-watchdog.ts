import { spawn, type ChildProcess } from "node:child_process";

/**
 * LAWOSS: rozpočet RAM 2 GB (issue #367). Keď hlavný proces appky padne
 * (SIGKILL, pád Electronu, nedostatok pamäte), engine OpenCode a všetky jeho
 * MCP bežia ďalej ako siroty: meranie s 10 klientmi a balíkom SK základ
 * nechalo po páde 67 procesov s ~4,3 GB.
 *
 * Vedľa enginu beží malý `sh` (~1 MB), ktorý číta rúru od rodiča. Rúru drží
 * len tento proces; keď zanikne, `read` dostane EOF a strážca pošle enginu
 * SIGTERM (engine pri ňom ukončí aj svoje MCP), po odklade SIGKILL jemu aj
 * jeho priamym potomkom. PID enginu ostáva bez zmeny.
 *
 * Len macOS a Linux: Windows ukončuje strom cez taskkill (lawoss/process-tree.ts).
 */
const WATCHDOG_SCRIPT = [
  "read _ignored",
  'kill -TERM "$1" 2>/dev/null || exit 0',
  'sleep "$2"',
  'pkill -KILL -P "$1" 2>/dev/null',
  'kill -KILL "$1" 2>/dev/null',
  "exit 0",
].join("\n");

export type EngineParentWatchdog = { stop(): void };

export function watchEngineParent(
  engine: Pick<ChildProcess, "pid" | "once">,
  options: { platform?: NodeJS.Platform; graceSeconds?: number; spawnProcess?: typeof spawn } = {},
): EngineParentWatchdog {
  const platform = options.platform ?? process.platform;
  const pid = engine.pid;
  if (platform === "win32" || !Number.isInteger(pid) || !pid || pid <= 0) return { stop: () => undefined };
  let watchdog: ChildProcess | null = null;
  try {
    watchdog = (options.spawnProcess ?? spawn)("/bin/sh", ["-c", WATCHDOG_SCRIPT, "lawoss-engine-watchdog", String(pid), String(options.graceSeconds ?? 5)], {
      stdio: ["pipe", "ignore", "ignore"],
      // Vlastná skupina procesov: signál pre skupinu appky (napr. Ctrl+C v termináli) ho neukončí skôr ako engine.
      detached: true,
    });
  } catch {
    return { stop: () => undefined };
  }
  watchdog.on("error", () => undefined);
  watchdog.stdin?.on("error", () => undefined);
  // Strážca nesmie držať event loop rodiča pri bežnom ukončení.
  watchdog.unref();
  const stdin = watchdog.stdin;
  if (stdin && "unref" in stdin && typeof stdin.unref === "function") stdin.unref();
  const stop = () => {
    const current = watchdog;
    watchdog = null;
    if (!current || current.exitCode !== null || current.signalCode !== null) return;
    // Najprv zabiť strážcu, až potom zavrieť rúru: inak by EOF ukončil engine sám.
    try { current.kill("SIGKILL"); } catch { /* Already gone. */ }
    current.stdin?.destroy();
  };
  // Keď engine skončí sám, strážca odíde hneď (PID sa nesmie použiť znova).
  engine.once("exit", stop);
  return { stop };
}
