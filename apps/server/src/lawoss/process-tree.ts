import { spawn, type SpawnOptions } from "node:child_process";
import path from "node:path";

// Strop pre taskkill; zatvorenie enginu naň nesmie čakať donekonečna.
const TASKKILL_TIMEOUT_MS = 5000;

/** To, čo z procesu taskkill potrebujeme; spĺňa ho `ChildProcess` aj falošný proces v teste. */
type TaskkillProcess = {
  once(event: string, listener: (...args: unknown[]) => void): unknown;
  kill(): unknown;
};

type SpawnTaskkill = (command: string, args: string[], options: SpawnOptions) => TaskkillProcess;

export type KillProcessTreeOptions = {
  platform?: NodeJS.Platform;
  env?: NodeJS.ProcessEnv;
  spawn?: SpawnTaskkill;
  timeoutMs?: number;
};

/**
 * Plná cesta k `taskkill.exe`. Holý názov programu hľadá Windows najprv
 * v aktuálnom pracovnom priečinku a až potom v PATH, preto nie cez PATH.
 */
export function taskkillPath(env: NodeJS.ProcessEnv = process.env): string {
  const root = String(env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? "").trim() || "C:\\Windows";
  return path.win32.join(root, "System32", "taskkill.exe");
}

/**
 * Na Windows ukončí proces aj so všetkými jeho potomkami (`taskkill /T /F`).
 *
 * `child.kill()` na Windows zavolá TerminateProcess len na priameho potomka. Keď
 * sa engine zatvára počas behu nástroja agenta, python, soffice či node z nástroja
 * bežia ďalej a držia zámky na súboroch v priečinku klienta. taskkill hľadá
 * potomkov podľa PID rodiča, preto ho treba zavolať, kým engine ešte žije, teda
 * pred `child.kill()`.
 *
 * Mimo Windows nerobí nič a vráti `false`; macOS a Linux ostávajú pri postupe
 * upstreamu. Nikdy nevyhodí výnimku a výstup taskkill zahodí. Rovnaká funkcia je
 * v `apps/desktop/electron/lawoss-process-tree.mjs`.
 *
 * @returns `true`, keď taskkill skončil s kódom 0
 */
export function killProcessTree(pid: number | null | undefined, options: KillProcessTreeOptions = {}): Promise<boolean> {
  const { platform = process.platform, env = process.env, spawn: spawnTaskkill = spawn, timeoutMs = TASKKILL_TIMEOUT_MS } = options;
  if (platform !== "win32" || typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let taskkill: TaskkillProcess | null = null;
    let settled = false;
    const finish = (killed: boolean) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(killed);
    };
    const timer = setTimeout(() => {
      try {
        taskkill?.kill();
      } catch {
        // taskkill medzitým skončil.
      }
      finish(false);
    }, timeoutMs);
    try {
      taskkill = spawnTaskkill(taskkillPath(env), ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      taskkill.once("error", () => finish(false));
      taskkill.once("exit", (code) => finish(code === 0));
    } catch {
      finish(false);
    }
  });
}
