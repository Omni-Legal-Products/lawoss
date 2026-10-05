import { spawn } from "node:child_process";

function processGroupExists(pid) {
  try {
    process.kill(-pid, 0);
    return true;
  } catch (error) {
    if (error && typeof error === "object" && "code" in error) {
      if (error.code === "ESRCH") return false;
      if (error.code === "EPERM") return true;
    }
    throw error;
  }
}

async function waitForProcessGroupExit(pid, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (processGroupExists(pid) && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  return !processGroupExists(pid);
}

function sendProcessGroupSignal(pid, signal) {
  try {
    process.kill(-pid, signal);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") {
      return;
    }
    throw error;
  }
}

function waitForChildExit(child, timeoutMs) {
  if (child.exitCode !== null || child.signalCode !== null) {
    return Promise.resolve(true);
  }

  return new Promise((resolve) => {
    let timer;
    const finish = (exited) => {
      clearTimeout(timer);
      child.off("exit", onExit);
      child.off("error", onError);
      resolve(exited);
    };
    const onExit = () => finish(true);
    const onError = () => finish(true);

    timer = setTimeout(() => finish(false), timeoutMs);
    child.once("exit", onExit);
    child.once("error", onError);
  });
}

async function stopWindowsProcessTree(child, timeoutMs) {
  if (!child.pid) return;
  const taskkill = spawn(
    "taskkill",
    ["/PID", String(child.pid), "/T", "/F"],
    { stdio: "ignore" },
  );
  await waitForChildExit(taskkill, timeoutMs);

  if (child.exitCode === null && child.signalCode === null) {
    child.kill("SIGKILL");
    await waitForChildExit(child, timeoutMs);
  }
}

export async function stopProcessTree(child, timeoutMs = 3000) {
  if (!child.pid) return;
  if (process.platform === "win32") {
    await stopWindowsProcessTree(child, timeoutMs);
    return;
  }

  sendProcessGroupSignal(child.pid, "SIGTERM");
  if (await waitForProcessGroupExit(child.pid, timeoutMs)) return;

  sendProcessGroupSignal(child.pid, "SIGKILL");
  await waitForProcessGroupExit(child.pid, timeoutMs);
}
