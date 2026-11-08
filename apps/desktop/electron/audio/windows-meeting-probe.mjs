import { spawn } from "node:child_process";
import path from "node:path";

const NATIVE_APPS = {
  "zoom.exe": "us.zoom.xos",
  "teams.exe": "com.microsoft.teams",
  "ms-teams.exe": "com.microsoft.teams2",
  "slack.exe": "com.tinyspeck.slackmacgap",
  "webex.exe": "com.cisco.webex",
  "ciscocollabhost.exe": "com.cisco.webex",
  "webexmta.exe": "com.cisco.webex",
  "atmgr.exe": "com.cisco.webexmeetingsapp",
};
const BROWSERS = {
  "chrome.exe": "com.google.Chrome",
  "msedge.exe": "com.microsoft.edgemac",
  "firefox.exe": "org.mozilla.firefox",
};

/** Normalize OS metadata into the existing cross-platform meeting matcher. */
export function windowsMeetingProcesses(processes) {
  if (!Array.isArray(processes)) return [];
  return processes.slice(0, 64).flatMap(process => {
    if (!process || process.inputActive !== true || typeof process.executable !== "string") return [];
    const executable = path.win32.basename(process.executable).toLowerCase();
    const bundleId = NATIVE_APPS[executable] ?? BROWSERS[executable];
    if (typeof bundleId !== "string") return [];
    const documents = Array.isArray(process.documents) ? process.documents.slice(0, 8).flatMap(document => {
      if (!document || typeof document.title !== "string" || typeof document.url !== "string") return [];
      return [{ title: document.title.slice(0, 1024), url: document.url.slice(0, 4096) }];
    }) : [];
    return [{ bundleId, inputActive: true, documents }];
  });
}

// Compile once in the helper, then query it only when detection is enabled.
// The COM interfaces are read-only session controls: no IAudioClient, audio
// buffers, registry history, microphone activation, or changes to audio routing.
export const WINDOWS_MEETING_SCRIPT = String.raw`
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$source = @'
using System;
using System.Collections.Generic;
using System.Diagnostics;
using System.Runtime.InteropServices;
using System.Text;
using System.Windows.Automation;

public static class LegalWorkMeetingActivity {
  [ComImport, Guid("BCDE0395-E52F-467C-8E3D-C4579291692E")] private class DeviceEnumerator {}
  [ComImport, Guid("A95664D2-9614-4F35-A746-DE8DB63617E6"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IDevices {
    [PreserveSig] int EnumAudioEndpoints(int flow, uint state, out ICollection devices);
  }
  [ComImport, Guid("0BD7A1BE-7A1A-44DB-8397-CC5392387B5E"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface ICollection {
    [PreserveSig] int GetCount(out uint count);
    [PreserveSig] int Item(uint index, out IDevice device);
  }
  [ComImport, Guid("D666063F-1587-4E43-81F1-B948E807363F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IDevice {
    [PreserveSig] int Activate(ref Guid iid, uint context, IntPtr parameters, [MarshalAs(UnmanagedType.IUnknown)] out object value);
  }
  [ComImport, Guid("77AA99A0-1BD6-484F-8BC7-2C654C9A9B6F"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IManager {
    [PreserveSig] int GetAudioSessionControl(IntPtr guid, uint flags, out IntPtr control);
    [PreserveSig] int GetSimpleAudioVolume(IntPtr guid, uint flags, out IntPtr volume);
    [PreserveSig] int GetSessionEnumerator(out ISessions sessions);
  }
  [ComImport, Guid("E2F5BB11-0570-40CA-ACDD-3AA01277DEE8"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface ISessions {
    [PreserveSig] int GetCount(out int count);
    [PreserveSig] int GetSession(int index, [MarshalAs(UnmanagedType.IUnknown)] out object control);
  }
  // Include the inherited slots before GetProcessId (IAudioSessionControl2).
  [ComImport, Guid("BFB7FF88-7239-4FC9-8FA2-07C950BE9C6D"), InterfaceType(ComInterfaceType.InterfaceIsIUnknown)]
  private interface IControl {
    [PreserveSig] int GetState(out int state);
    [PreserveSig] int GetDisplayName(out IntPtr value);
    [PreserveSig] int SetDisplayName(IntPtr value, IntPtr context);
    [PreserveSig] int GetIconPath(out IntPtr value);
    [PreserveSig] int SetIconPath(IntPtr value, IntPtr context);
    [PreserveSig] int GetGroupingParam(out Guid value);
    [PreserveSig] int SetGroupingParam(ref Guid value, IntPtr context);
    [PreserveSig] int RegisterAudioSessionNotification(IntPtr events);
    [PreserveSig] int UnregisterAudioSessionNotification(IntPtr events);
    [PreserveSig] int GetSessionIdentifier(out IntPtr value);
    [PreserveSig] int GetSessionInstanceIdentifier(out IntPtr value);
    [PreserveSig] int GetProcessId(out uint pid);
  }
  [StructLayout(LayoutKind.Sequential, CharSet = CharSet.Unicode)]
  private struct ProcessEntry {
    public uint size, usage, pid;
    public UIntPtr heap;
    public uint module, threads, parent;
    public int priority;
    public uint flags;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst = 260)] public string executable;
  }
  private delegate bool WindowCallback(IntPtr window, IntPtr parameter);
  [DllImport("kernel32.dll", SetLastError = true)] private static extern IntPtr CreateToolhelp32Snapshot(uint flags, uint pid);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool Process32First(IntPtr snapshot, ref ProcessEntry entry);
  [DllImport("kernel32.dll", CharSet = CharSet.Unicode)] private static extern bool Process32Next(IntPtr snapshot, ref ProcessEntry entry);
  [DllImport("kernel32.dll")] private static extern bool CloseHandle(IntPtr handle);
  [DllImport("user32.dll")] private static extern bool EnumWindows(WindowCallback callback, IntPtr parameter);
  [DllImport("user32.dll")] private static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] private static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] private static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll", CharSet = CharSet.Unicode)] private static extern int GetWindowText(IntPtr window, StringBuilder text, int count);

  public class Document { public string title = ""; public string url = ""; }
  public class InputProcess { public string executable; public bool inputActive = true; public Document[] documents = new Document[0]; }
  public class Result { public bool supported; public InputProcess[] processes = new InputProcess[0]; }
  private static void Release(object value) { if (value != null && Marshal.IsComObject(value)) Marshal.ReleaseComObject(value); }
  private static void Check(int result) { Marshal.ThrowExceptionForHR(result); }

  private static HashSet<uint> CaptureProcesses() {
    var pids = new HashSet<uint>();
    IDevices enumerator = null;
    ICollection devices = null;
    try {
      enumerator = (IDevices)new DeviceEnumerator();
      Check(enumerator.EnumAudioEndpoints(1 /* eCapture */, 1 /* DEVICE_STATE_ACTIVE */, out devices));
      uint count; Check(devices.GetCount(out count));
      for (uint i = 0; i < count && i < 64; i++) {
        IDevice device = null; object managerObject = null; ISessions sessions = null;
        try {
          Check(devices.Item(i, out device));
          Guid iid = typeof(IManager).GUID;
          Check(device.Activate(ref iid, 23 /* CLSCTX_ALL */, IntPtr.Zero, out managerObject));
          Check(((IManager)managerObject).GetSessionEnumerator(out sessions));
          int total; Check(sessions.GetCount(out total));
          for (int j = 0; j < total && j < 256; j++) {
            object controlObject = null;
            try {
              Check(sessions.GetSession(j, out controlObject));
              var control = (IControl)controlObject;
              int state; uint pid;
              if (control.GetState(out state) >= 0 && state == 1 /* AudioSessionStateActive */ && control.GetProcessId(out pid) >= 0 && pid > 0) pids.Add(pid);
            } catch (COMException) { /* A session can disappear during enumeration. */ }
            finally { Release(controlObject); }
          }
        } catch (COMException) { /* A disconnected input must not hide other inputs. */ }
        finally { Release(sessions); Release(managerObject); Release(device); }
      }
    } finally { Release(devices); Release(enumerator); }
    return pids;
  }

  private static Dictionary<uint, ProcessEntry> Processes() {
    var entries = new Dictionary<uint, ProcessEntry>();
    IntPtr snapshot = CreateToolhelp32Snapshot(2 /* TH32CS_SNAPPROCESS */, 0);
    if (snapshot == new IntPtr(-1)) return entries;
    try {
      var entry = new ProcessEntry(); entry.size = (uint)Marshal.SizeOf(typeof(ProcessEntry));
      if (Process32First(snapshot, ref entry)) do { entries[entry.pid] = entry; } while (entries.Count < 8192 && Process32Next(snapshot, ref entry));
    } finally { CloseHandle(snapshot); }
    return entries;
  }

  // Address controls outside web documents only. Do not read page text,
  // selected tabs, conversation contents, or a browser's browsing history.
  private class ChromeNode { public AutomationElement element; public int depth; public bool toolbar; }
  private static string Address(IntPtr window, Stopwatch budget) {
    var queue = new Queue<ChromeNode>();
    queue.Enqueue(new ChromeNode { element = AutomationElement.FromHandle(window) });
    int visited = 0;
    while (queue.Count > 0 && visited++ < 80 && budget.ElapsedMilliseconds < 800) {
      var item = queue.Dequeue();
      var info = item.element.Current;
      if (info.ControlType == ControlType.Document || info.ControlType == ControlType.List || info.ControlType == ControlType.Tab || info.IsOffscreen || info.ClassName == "Chrome_RenderWidgetHostHWND" || info.ClassName == "MozillaContentWindowClass") continue;
      if (item.toolbar && info.ControlType == ControlType.Edit && !info.IsPassword) {
        object pattern;
        if (item.element.TryGetCurrentPattern(ValuePattern.Pattern, out pattern)) {
          string text = ((ValuePattern)pattern).Current.Value;
          Uri uri;
          if (!String.IsNullOrEmpty(text) && text.Length <= 4096 && Uri.TryCreate(text.Contains("://") ? text : "https://" + text, UriKind.Absolute, out uri) && (uri.Scheme == "https" || uri.Scheme == "http")) {
            var safe = new UriBuilder(uri); safe.Query = ""; safe.Fragment = ""; safe.UserName = ""; safe.Password = "";
            return safe.Uri.AbsoluteUri;
          }
        }
      }
      if (item.depth >= 5) continue;
      var walker = TreeWalker.ControlViewWalker;
      var child = walker.GetFirstChild(item.element);
      for (int i = 0; child != null && i < 20 && budget.ElapsedMilliseconds < 800; i++) {
        queue.Enqueue(new ChromeNode { element = child, depth = item.depth + 1, toolbar = item.toolbar || info.ControlType == ControlType.ToolBar });
        child = walker.GetNextSibling(child);
      }
    }
    return "";
  }

  private static Document[] Documents(uint owner, Stopwatch budget) {
    var documents = new List<Document>();
    EnumWindows(delegate(IntPtr window, IntPtr parameter) {
      if (documents.Count >= 8 || budget.ElapsedMilliseconds >= 800) return false;
      uint pid; GetWindowThreadProcessId(window, out pid);
      if (pid != owner || !IsWindowVisible(window) || IsIconic(window)) return true;
      var title = new StringBuilder(1024); GetWindowText(window, title, title.Capacity);
      var document = new Document(); document.title = title.ToString();
      try { document.url = Address(window, budget); } catch (Exception) { /* Keep title matching if UI Automation is unavailable. */ }
      documents.Add(document);
      return true;
    }, IntPtr.Zero);
    return documents.ToArray();
  }

  public static Result Read(string[] nativeApps, string[] browsers) {
    var result = new Result();
    try {
      var active = CaptureProcesses();
      var native = new HashSet<string>(nativeApps, StringComparer.OrdinalIgnoreCase);
      var browser = new HashSet<string>(browsers, StringComparer.OrdinalIgnoreCase);
      var processes = Processes();
      var seen = new HashSet<uint>();
      var inputs = new List<InputProcess>();
      var budget = Stopwatch.StartNew();
      foreach (uint input in active) {
        uint pid = input, owner = 0; ProcessEntry entry; string executable = null;
        for (int depth = 0; depth < 8 && processes.TryGetValue(pid, out entry); depth++) {
          if (native.Contains(entry.executable)) { owner = pid; executable = entry.executable; break; }
          if (browser.Contains(entry.executable)) { owner = pid; executable = entry.executable; }
          if (entry.parent == pid || entry.parent == 0) break;
          pid = entry.parent;
        }
        if (owner == 0 || !seen.Add(owner)) continue;
        var value = new InputProcess(); value.executable = executable;
        if (browser.Contains(executable)) value.documents = Documents(owner, budget);
        inputs.Add(value);
      }
      result.supported = true; result.processes = inputs.ToArray();
    } catch (Exception) { /* Audio services or enterprise policy may be unavailable. */ }
    return result;
  }
}
'@
Add-Type -AssemblyName 'UIAutomationClient','UIAutomationTypes','WindowsBase'
$references = @('System.dll','System.Core.dll',[System.Windows.Automation.AutomationElement].Assembly.Location,[System.Windows.Automation.ControlType].Assembly.Location,[System.Windows.DependencyObject].Assembly.Location)
Add-Type -TypeDefinition $source -ReferencedAssemblies $references
[Console]::WriteLine('ready')
while ($null -ne ($line = [Console]::ReadLine())) {
  if ($line -ne 'poll') { continue }
  $result = [LegalWorkMeetingActivity]::Read(@(${Object.keys(NATIVE_APPS).map(name => `'${name}'`).join(",")}), @(${Object.keys(BROWSERS).map(name => `'${name}'`).join(",")}))
  [Console]::WriteLine(($result | ConvertTo-Json -Depth 6 -Compress))
}
`;

const unavailable = () => ({ supported: false, processes: [] });

/** One hidden, reusable metadata helper; no shell/compiler is launched per poll. */
export class WindowsMeetingProbe {
  /** @param {{spawn?: (file: string, args: string[], options: import("node:child_process").SpawnOptions) => import("node:child_process").ChildProcess, now?: () => number, startupTimeoutMs?: number, pollTimeoutMs?: number, retryDelayMs?: number}} [options] */
  constructor({ spawn: spawnProcess = spawn, now = Date.now, startupTimeoutMs = 8000, pollTimeoutMs = 2000, retryDelayMs = 30000 } = {}) {
    this.spawn = spawnProcess;
    this.now = now;
    this.startupTimeoutMs = startupTimeoutMs;
    this.pollTimeoutMs = pollTimeoutMs;
    this.retryDelayMs = retryDelayMs;
    this.child = null;
    this.pending = null;
    this.ready = false;
    this.retryAt = 0;
  }

  poll() {
    if (this.pending) return this.pending.promise;
    if (this.now() < this.retryAt) return Promise.resolve(unavailable());
    let resolveResult = (_value) => {};
    const promise = new Promise(resolve => { resolveResult = resolve; });
    this.pending = { promise, resolve: resolveResult, sent: false, timer: setTimeout(() => this.fail(), this.ready ? this.pollTimeoutMs : this.startupTimeoutMs) };
    try {
      if (!this.child) this.start();
      this.request();
    } catch { this.fail(); }
    return promise;
  }

  start() {
    const executable = path.win32.join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const child = this.spawn(executable, ["-NoLogo", "-NoProfile", "-NonInteractive", "-Mta", "-Command", WINDOWS_MEETING_SCRIPT], { windowsHide: true, stdio: ["pipe", "pipe", "pipe"] });
    this.child = child;
    let buffer = "";
    child.stdout.setEncoding("utf8");
    child.stdout.on("data", data => {
      if (this.child !== child) return;
      buffer += data;
      if (buffer.length > 128 * 1024) { this.fail(); return; }
      let end;
      while ((end = buffer.indexOf("\n")) >= 0) {
        const line = buffer.slice(0, end).trim(); buffer = buffer.slice(end + 1);
        if (line === "ready" && !this.ready) { this.ready = true; this.request(); continue; }
        if (!line) continue;
        try {
          const value = JSON.parse(line);
          if (!this.pending?.sent || typeof value.supported !== "boolean" || !Array.isArray(value.processes)) { this.fail(); return; }
          this.finish({ supported: value.supported, processes: value.supported ? windowsMeetingProcesses(value.processes) : [] });
        } catch { this.fail(); return; }
      }
    });
    // Drain diagnostics without logging command text or user window metadata.
    child.stderr.resume();
    child.stdin.on("error", () => { if (this.child === child) this.fail(); });
    child.once("error", () => { if (this.child === child) this.fail(); });
    child.once("exit", () => { if (this.child === child) this.fail(); });
  }

  request() {
    if (!this.ready || !this.pending || this.pending.sent) return;
    this.pending.sent = true;
    clearTimeout(this.pending.timer);
    this.pending.timer = setTimeout(() => this.fail(), this.pollTimeoutMs);
    this.child.stdin.write("poll\n");
  }

  finish(result) {
    const pending = this.pending;
    this.pending = null;
    if (!pending) return;
    clearTimeout(pending.timer);
    pending.resolve(result);
  }

  fail() { this.retryAt = this.now() + this.retryDelayMs; this.stop(); }
  stop() {
    const child = this.child;
    this.child = null; this.ready = false;
    this.finish(unavailable());
    try { child?.kill(); } catch { /* It may already have exited. */ }
  }
  dispose() { this.retryAt = 0; this.stop(); }
}
