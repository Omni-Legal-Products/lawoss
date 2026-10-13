import { spawn, type ChildProcess, type SpawnOptions } from "node:child_process";
import { fileURLToPath } from "node:url";
import { killProcessTree } from "../process-tree.js";

/**
 * Pre testy: pomocné procesy (engine opencode, mock OAuth server), ktoré
 * neprežijú test ani proces testov.
 *
 * `child.kill()` v afterAll nestačil. Pošle SIGTERM a na koniec nečaká; engine
 * opencode občas pri SIGTERM elegantné vypínanie nedokončí a beží ďalej. A keď
 * proces testov zomrie skôr (SIGTERM, SIGHUP, SIGKILL, timeout nástroja),
 * afterAll sa nespustí vôbec. Potomok sa presunie pod launchd/init a 9. 10. 2026
 * tak po testoch ostalo desať enginov s rodičom 1.
 *
 * Mimo Windows preto potomok beží vo vlastnej skupine procesov (s ním aj jeho
 * podprocesy), `stopOwnedChild` po SIGTERM počká a potom pošle SIGKILL, pri
 * bežnom skončení testov ho zabije hák `exit` a pri páde procesu testov strážca
 * `owned-child-watchdog.mjs`. Na Windows ostáva `taskkill /T /F`.
 */

const STOP_TIMEOUT_MS = 3000;
const WATCHDOG = fileURLToPath(new URL("./owned-child-watchdog.mjs", import.meta.url));
const isWindows = process.platform === "win32";
const owned = new Set<ChildProcess>();
let exitHookInstalled = false;

const hasExited = (child: ChildProcess) => child.exitCode !== null || child.signalCode !== null;

function signalGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // Skupina už nemá žiadny proces.
  }
}

function installExitHook(): void {
  if (exitHookInstalled) return;
  exitHookInstalled = true;
  process.on("exit", () => {
    for (const child of owned) {
      if (child.pid) signalGroup(child.pid, "SIGKILL");
    }
  });
}

function startWatchdog(pid: number): void {
  const watchdog = spawn(process.execPath, [WATCHDOG, String(process.pid), String(pid)], {
    detached: true,
    stdio: "ignore",
  });
  watchdog.on("error", () => {});
  watchdog.unref();
}

/** Ako `spawn`, len potomka po teste vždy ukončí `stopOwnedChild`, hák `exit` alebo strážca. */
export function spawnOwnedChild(command: string, args: readonly string[], options: SpawnOptions = {}): ChildProcess {
  const child = spawn(command, args, { stdio: "ignore", ...options, detached: !isWindows });
  const pid = child.pid;
  if (!pid) return child;
  owned.add(child);
  child.once("exit", () => owned.delete(child));
  if (!isWindows) {
    installExitHook();
    startWatchdog(pid);
  }
  return child;
}

function waitForExit(child: ChildProcess, timeoutMs: number): Promise<boolean> {
  if (hasExited(child)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const timer = setTimeout(() => {
      child.off("exit", onExit);
      resolve(hasExited(child));
    }, timeoutMs);
    const onExit = () => {
      clearTimeout(timer);
      resolve(true);
    };
    child.once("exit", onExit);
  });
}

/**
 * Ukončí potomka zo `spawnOwnedChild` a počká na jeho koniec: SIGTERM pre celú
 * skupinu, po `timeoutMs` SIGKILL. Keď proces nezanikne ani potom, vyhodí chybu,
 * aby test neskončil ticho s bežiacim procesom.
 */
export async function stopOwnedChild(child: ChildProcess | undefined, timeoutMs = STOP_TIMEOUT_MS): Promise<void> {
  const pid = child?.pid;
  if (!child || !pid) return;
  if (isWindows) {
    if (!hasExited(child)) await killProcessTree(pid);
    child.kill("SIGKILL");
  } else {
    signalGroup(pid, "SIGTERM");
    await waitForExit(child, timeoutMs);
    // SIGKILL vždy: vypínanie sa mohlo zaseknúť alebo v skupine ostali podprocesy.
    signalGroup(pid, "SIGKILL");
  }
  if (!(await waitForExit(child, timeoutMs))) {
    throw new Error(`Test process ${pid} did not exit after SIGKILL`);
  }
}
