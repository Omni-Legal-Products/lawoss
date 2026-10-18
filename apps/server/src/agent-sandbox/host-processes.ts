import { execFile } from "node:child_process";
import { promisify } from "node:util";
const exec = promisify(execFile);
function signal(pid: number, value: NodeJS.Signals) {
  try { process.kill(pid, value); } catch (error) {
    if (!(error instanceof Error) || !("code" in error) || error.code !== "ESRCH") throw error;
  }
}

/** Freeze before walking: killing the parent first would reparent detached
 * children and lose their ancestry. This is cleanup, not a security boundary:
 * code with full host access can already have daemonized or scheduled work. */
export async function stopHostProcessTree(pid: number): Promise<void> {
  signal(-pid, "SIGSTOP");
  signal(pid, "SIGSTOP");
  const stopped = new Set([pid]);
  try {
    for (;;) {
      const { stdout } = await exec("/bin/ps", ["-axo", "pid=,ppid="], { timeout: 2000, maxBuffer: 4 * 1024 * 1024 });
      const children = stdout.trim().split("\n").map(line => line.trim().split(/\s+/).map(Number));
      let added = false;
      for (const [child, parent] of children) {
        if (child > 1 && parent && stopped.has(parent) && !stopped.has(child)) {
          signal(child, "SIGSTOP"); stopped.add(child); added = true;
        }
      }
      if (!added) break;
    }
  } finally {
    // Keep every ancestor frozen until all discovered children are terminated.
    for (const child of [...stopped].reverse()) signal(child, "SIGKILL");
    signal(-pid, "SIGKILL");
  }
}
