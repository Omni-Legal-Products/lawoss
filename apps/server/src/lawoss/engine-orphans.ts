import { spawn, type SpawnOptions } from "node:child_process";
import path from "node:path";

/**
 * #454, rozpočet RAM 2 GB (#367): engine, ktorý spadne (SIGKILL, OOM), po sebe nechá svoje MCP a nástroje
 * ako siroty. Pred štartom náhrady ich treba ukončiť, inak každý reštart pridá novú sadu.
 *
 * - macOS/Linux: engine beží vo vlastnej skupine procesov (`detached`), ktorú dedia jeho potomkovia. Skupina
 *   ostane, kým v nej žije aspoň jeden proces, a jej ID sa medzitým nepridelí inému procesu, takže signál
 *   pre `-pid` zasiahne len sirotky enginu (SIGTERM, po odklade SIGKILL).
 * - Windows: siroty si ponechajú `ParentProcessId` mŕtveho enginu. Potomkovia sa nájdu cez CIM rekurzívne
 *   od PID enginu, len procesy vzniknuté po jeho štarte (proti opätovne použitému PID), a ukončia sa.
 */
export const ORPHAN_TERM_GRACE_MS = 1000;
const WINDOWS_TIMEOUT_MS = 10_000;

/** Voľba spawnu enginu: vlastná skupina procesov mimo Windows (na Windows by `detached` otvorilo konzolu). */
export function engineProcessGroup(platform: NodeJS.Platform = process.platform): Pick<SpawnOptions, "detached"> {
  return platform === "win32" ? {} : { detached: true };
}

type Killer = (pid: number, signal: NodeJS.Signals) => void;
type Spawned = { once(event: string, listener: (...args: unknown[]) => void): unknown; kill(): unknown };

export type ReapOptions = {
  platform?: NodeJS.Platform;
  kill?: Killer;
  graceMs?: number;
  env?: NodeJS.ProcessEnv;
  spawn?: (command: string, args: string[], options: SpawnOptions) => Spawned;
};

const signalGroup = (kill: Killer, pid: number, signal: NodeJS.Signals): boolean => {
  try { kill(-pid, signal); return true; } catch { return false; }
};

/** Skript PowerShellu: potomkovia `pid` vzniknutí po `since` (ms od epochy), rekurzívne, ukončení nasilu. */
export function windowsReapScript(pid: number, since: number): string {
  return [
    "$ErrorActionPreference='SilentlyContinue'",
    `$since=[DateTimeOffset]::FromUnixTimeMilliseconds(${Math.floor(since)}).UtcDateTime`,
    "$all=@(Get-CimInstance Win32_Process)",
    `$ids=@(${pid}); $found=@()`,
    "for($depth=0; $ids.Count -gt 0 -and $depth -lt 8; $depth++){ $next=@(); foreach($p in $all){ if(($ids -contains $p.ParentProcessId) -and $p.CreationDate -and $p.CreationDate.ToUniversalTime() -ge $since -and -not ($found -contains $p.ProcessId)){ $found+=$p.ProcessId; $next+=$p.ProcessId } }; $ids=$next }",
    "foreach($id in $found){ Stop-Process -Id $id -Force }",
  ].join("; ");
}

/** Ukončí siroty spadnutého enginu `pid` spusteného v `startedAt`. Nikdy nevyhodí výnimku. */
export async function reapEngineOrphans(pid: number | undefined, startedAt: number, options: ReapOptions = {}): Promise<void> {
  if (typeof pid !== "number" || !Number.isInteger(pid) || pid <= 0) return;
  const platform = options.platform ?? process.platform;
  if (platform !== "win32") {
    const kill = options.kill ?? ((target, signal) => { process.kill(target, signal); });
    if (!signalGroup(kill, pid, "SIGTERM")) return;
    await new Promise((resolve) => setTimeout(resolve, options.graceMs ?? ORPHAN_TERM_GRACE_MS));
    signalGroup(kill, pid, "SIGKILL");
    return;
  }
  const env = options.env ?? process.env;
  const root = String(env.SystemRoot ?? env.SYSTEMROOT ?? env.windir ?? "").trim() || "C:\\Windows";
  const powershell = path.win32.join(root, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  await new Promise<void>((resolve) => {
    let child: Spawned | null = null;
    const timer = setTimeout(() => { try { child?.kill(); } catch { /* už skončil */ } resolve(); }, WINDOWS_TIMEOUT_MS);
    const done = () => { clearTimeout(timer); resolve(); };
    try {
      child = (options.spawn ?? spawn)(powershell, ["-NoProfile", "-NonInteractive", "-Command", windowsReapScript(pid, startedAt - 1000)], { stdio: "ignore", windowsHide: true });
      child.once("exit", done);
      child.once("error", done);
    } catch { done(); }
  });
}
