import { execFileSync } from "node:child_process";
import { readdir, readlink } from "node:fs/promises";

/** POSIX unlink succeeds with open handles; inspect this process before removal. */
export async function runtimeDbHandles(path: string): Promise<number> {
  if (process.platform === "win32") return 0; // The caller additionally performs real rm on Windows.
  if (process.platform === "linux") {
    const fds = await readdir("/proc/self/fd");
    const targets = await Promise.all(fds.map(fd => readlink(`/proc/self/fd/${fd}`).catch(() => "")));
    return targets.filter(target => target === path || target === `${path} (deleted)`).length;
  }
  let output: string;
  try { output = execFileSync("lsof", ["-a", "-p", String(process.pid), "-F", "n", "--", path], { encoding: "utf8" }); }
  catch (error) {
    if (error && typeof error === "object" && "status" in error && error.status === 1) return 0;
    throw error;
  }
  return output.split("\n").filter(line => line === `n${path}`).length;
}
