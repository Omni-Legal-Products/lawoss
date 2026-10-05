import { spawn } from "node:child_process";
import path from "node:path";

// Strop pre taskkill; zastavenie appky ani reštart enginu naň nesmie čakať donekonečna.
const TASKKILL_TIMEOUT_MS = 5000;

/**
 * LAWOSS: plná cesta k `taskkill.exe`. Holý názov programu hľadá Windows najprv
 * v aktuálnom pracovnom priečinku a až potom v PATH, preto nie cez PATH.
 *
 * @param {NodeJS.ProcessEnv} [env]
 */
export function taskkillPath(env = process.env) {
  const root = String(env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? "").trim() || "C:\\Windows";
  return path.win32.join(root, "System32", "taskkill.exe");
}

/**
 * LAWOSS: na Windows ukončí proces aj so všetkými jeho potomkami (`taskkill /T /F`).
 *
 * `child.kill()` na Windows zavolá TerminateProcess len na priameho potomka. Keď
 * appka končí alebo reštartuje engine počas behu nástroja agenta, python, soffice
 * či node z nástroja bežia ďalej a držia zámky na súboroch v priečinku klienta.
 * taskkill hľadá potomkov podľa PID rodiča, preto ho treba zavolať, kým priamy
 * potomok ešte žije, teda pred `child.kill()`.
 *
 * Mimo Windows nerobí nič a vráti `false`; macOS a Linux ostávajú pri postupe
 * upstreamu. Nikdy nevyhodí výnimku a výstup taskkill zahodí. Rovnaká funkcia je
 * v `apps/server/src/lawoss/process-tree.ts`.
 *
 * @param {number | null | undefined} pid
 * @param {{ platform?: NodeJS.Platform, env?: NodeJS.ProcessEnv, spawn?: Function, timeoutMs?: number }} [options]
 * @returns {Promise<boolean>} `true`, keď taskkill skončil s kódom 0
 */
export function killProcessTree(pid, { platform = process.platform, env = process.env, spawn: spawnProcess = spawn, timeoutMs = TASKKILL_TIMEOUT_MS } = {}) {
  if (platform !== "win32" || !Number.isInteger(pid) || pid <= 0) return Promise.resolve(false);
  return new Promise((resolve) => {
    let taskkill = null;
    let settled = false;
    /** @param {boolean} killed */
    const finish = (killed) => {
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
      taskkill = spawnProcess(taskkillPath(env), ["/pid", String(pid), "/T", "/F"], { stdio: "ignore", windowsHide: true });
      taskkill.once("error", () => finish(false));
      taskkill.once("exit", (/** @type {number | null} */ code) => finish(code === 0));
    } catch {
      finish(false);
    }
  });
}
