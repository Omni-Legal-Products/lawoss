import { app, screen } from "electron";
import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { resolveKeyMonitorPath } from "./system-key-monitor.mjs";

// One background process, with no window titles, content or input events.
const WINDOWS_FOCUS_SCRIPT = String.raw`
Add-Type -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public static class LegalWorkFocusedDisplay {
  [StructLayout(LayoutKind.Sequential)]
  public struct Rect { public int left, top, right, bottom; }
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out Rect rect);
  [DllImport("user32.dll")] public static extern bool SetProcessDPIAware();
}
'@
[LegalWorkFocusedDisplay]::SetProcessDPIAware() | Out-Null
$previous = ''
while ($true) {
  $rect = New-Object LegalWorkFocusedDisplay+Rect
  $window = [LegalWorkFocusedDisplay]::GetForegroundWindow()
  $json = '{"displayId":null}'
  if ($window -ne [IntPtr]::Zero -and [LegalWorkFocusedDisplay]::GetWindowRect($window, [ref]$rect)) {
    $json = @{ x=$rect.left; y=$rect.top; width=($rect.right-$rect.left); height=($rect.bottom-$rect.top) } | ConvertTo-Json -Compress
  }
  if ($json -ne $previous) { [Console]::WriteLine($json); $previous=$json }
  Start-Sleep -Milliseconds 250
}
`;

/** @param {(displayId: number | null) => void} onChange */
export function watchFocusedDisplay(onChange) {
  let stopped = false;
  let restartTimer = null;
  /** @type {import("node:child_process").ChildProcess | null} */
  let child = null;
  let previous;
  const update = id => {
    if (!stopped && previous !== id) { previous = id; onChange(id); }
  };
  const start = () => {
    if (stopped) return;
    let command;
    let args;
    if (process.platform === "darwin") {
      command = resolveKeyMonitorPath(app);
      if (!existsSync(command)) { update(null); return; }
      args = ["--watch-focused-display"];
    } else if (process.platform === "win32") {
      command = "powershell.exe";
      args = ["-NoProfile", "-NonInteractive", "-Command", WINDOWS_FOCUS_SCRIPT];
    } else { update(null); return; }
    let buffer = "";
    const spawned = spawn(command, args, { stdio: ["ignore", "pipe", "ignore"], windowsHide: true });
    child = spawned;
    spawned.stdout.on("data", chunk => {
      if (stopped || child !== spawned) return;
      buffer += String(chunk);
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const value = JSON.parse(line);
          if (value.displayId === null || Number.isInteger(value.displayId)) update(value.displayId);
          else if ([value.x, value.y, value.width, value.height].every(Number.isFinite) && value.width > 0 && value.height > 0) {
            // Win32 reports physical pixels, including on mixed-DPI displays.
            update(screen.getDisplayMatching(screen.screenToDipRect(null, value)).id);
          }
        } catch { /* Ignore incomplete or unsupported helper output. */ }
      }
    });
    const exited = () => {
      if (stopped || child !== spawned) return;
      child = null;
      update(null);
      restartTimer = setTimeout(start, 1_000);
      restartTimer.unref?.();
    };
    spawned.once("error", exited);
    spawned.once("exit", exited);
  };
  start();
  return () => {
    stopped = true;
    clearTimeout(restartTimer);
    child?.kill();
    child = null;
  };
}
