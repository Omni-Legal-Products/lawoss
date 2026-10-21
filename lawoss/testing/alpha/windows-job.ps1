$ErrorActionPreference = 'Stop'
[Console]::Error.WriteLine('LAWOSS_WINDOWS_JOB_CHECKPOINT:entry')
[Console]::InputEncoding = [System.Text.UTF8Encoding]::new($false, $true)
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
$nonce = ''
$stage = 'job-start-failed'
$job = $null
try {
  # The parent writes only this bounded configuration before waiting for ready.
  # The target receives neither this stdin nor the supervisor protocol stdout.
  $line = [Console]::In.ReadLine()
  if ($null -eq $line -or $line.Length -gt 131072) { throw 'configuration' }
  $configuration = $line | ConvertFrom-Json
  $nonce = [string]$configuration.nonce
  if ($configuration.schema -ne 1 -or $nonce -cnotmatch '^[a-f0-9]{64}$') { throw 'configuration' }
  [Console]::Error.WriteLine('LAWOSS_WINDOWS_JOB_CHECKPOINT:configured')
  Add-Type @'
using System;
using System.Diagnostics;
using System.IO;
using System.Runtime.InteropServices;
using System.Text;
using System.Threading;

public sealed class AlphaWindowsJob : IDisposable {
  const uint KILL_ON_JOB_CLOSE = 0x2000;
  const uint EXTENDED_STARTUPINFO_PRESENT = 0x00080000;
  const uint CREATE_UNICODE_ENVIRONMENT = 0x00000400;
  const uint STARTF_USESTDHANDLES = 0x00000100;
  const uint WAIT_OBJECT_0 = 0, WAIT_TIMEOUT = 258;
  static readonly IntPtr INVALID_HANDLE_VALUE = new IntPtr(-1);
  static readonly int SupervisorPid = Process.GetCurrentProcess().Id;
  IntPtr job, process;
  public uint Pid { get; private set; }
  public string CreationFileTime { get; private set; }

  [StructLayout(LayoutKind.Sequential)] struct SECURITY_ATTRIBUTES { public int Length; public IntPtr Descriptor; [MarshalAs(UnmanagedType.Bool)] public bool Inherit; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] struct STARTUPINFO {
    public int cb; public string reserved, desktop, title; public uint x,y,xSize,ySize,xCount,yCount,fill,flags; public ushort show,reservedSize;
    public IntPtr reservedBytes,input,output,error;
  }
  [StructLayout(LayoutKind.Sequential)] struct STARTUPINFOEX { public STARTUPINFO Startup; public IntPtr Attributes; }
  [StructLayout(LayoutKind.Sequential)] struct PROCESS_INFORMATION { public IntPtr Process,Thread; public uint Pid,Tid; }
  [StructLayout(LayoutKind.Sequential)] struct BASIC_LIMITS {
    public long ProcessTime,JobTime; public uint Flags; public UIntPtr MinimumWorkingSet,MaximumWorkingSet; public uint ActiveLimit;
    public UIntPtr Affinity; public uint Priority,Scheduling;
  }
  [StructLayout(LayoutKind.Sequential)] struct IO_COUNTERS { public ulong ReadCount,WriteCount,OtherCount,ReadBytes,WriteBytes,OtherBytes; }
  [StructLayout(LayoutKind.Sequential)] struct EXTENDED_LIMITS { public BASIC_LIMITS Basic; public IO_COUNTERS Io; public UIntPtr ProcessMemory,JobMemory,PeakProcessMemory,PeakJobMemory; }
  [StructLayout(LayoutKind.Sequential)] struct ACCOUNTING { public long User,Kernel,PeriodUser,PeriodKernel; public uint Faults,Total,Active,Terminated; }
  [StructLayout(LayoutKind.Sequential)] struct FILETIME { public uint Low,High; }
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateJobObjectW(IntPtr attributes, string name);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetInformationJobObject(IntPtr job, int kind, ref EXTENDED_LIMITS limits, uint size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool QueryInformationJobObject(IntPtr job, int kind, out ACCOUNTING accounting, uint size, IntPtr returned);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool TerminateJobObject(IntPtr job, uint code);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool SetHandleInformation(IntPtr handle, uint mask, uint flags);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetHandleInformation(IntPtr handle, out uint flags);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern IntPtr CreateFileW(string name, uint access, uint sharing, ref SECURITY_ATTRIBUTES attributes, uint creation, uint flags, IntPtr template);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool InitializeProcThreadAttributeList(IntPtr list, int count, uint flags, ref IntPtr size);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool UpdateProcThreadAttribute(IntPtr list, uint flags, IntPtr attribute, IntPtr value, IntPtr size, IntPtr previous, IntPtr returned);
  [DllImport("kernel32.dll")] static extern void DeleteProcThreadAttributeList(IntPtr list);
  [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)] static extern bool CreateProcessW(string application, StringBuilder command, IntPtr processAttributes, IntPtr threadAttributes, bool inheritHandles, uint flags, IntPtr environment, string cwd, ref STARTUPINFOEX startup, out PROCESS_INFORMATION information);
  [DllImport("kernel32.dll", SetLastError=true)] static extern uint WaitForSingleObject(IntPtr handle, uint milliseconds);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool GetProcessTimes(IntPtr process, out FILETIME creation, out FILETIME exit, out FILETIME kernel, out FILETIME user);
  [DllImport("kernel32.dll", SetLastError=true)] static extern bool CloseHandle(IntPtr handle);

  static void Require(bool success) { if (!success) throw new InvalidOperationException("native-job-operation-failed"); }
  static string Quote(string value) {
    StringBuilder result = new StringBuilder("\""); int slashes = 0;
    foreach (char c in value) {
      if (c == '\\') { slashes++; continue; }
      if (c == '"') { result.Append('\\', slashes * 2 + 1); result.Append(c); }
      else { result.Append('\\', slashes); result.Append(c); }
      slashes = 0;
    }
    result.Append('\\', slashes * 2); return result.Append('"').ToString();
  }
  public static AlphaWindowsJob Start(string executable, string[] arguments, string cwd, string[] environment) {
    AlphaWindowsJob owner = new AlphaWindowsJob();
    IntPtr attributes = IntPtr.Zero, jobs = IntPtr.Zero, handles = IntPtr.Zero, env = IntPtr.Zero, input = INVALID_HANDLE_VALUE, output = INVALID_HANDLE_VALUE;
    bool initialized = false; PROCESS_INFORMATION child = new PROCESS_INFORMATION();
    try {
      owner.job = CreateJobObjectW(IntPtr.Zero, null); Require(owner.job != IntPtr.Zero);
      Require(SetHandleInformation(owner.job, 1, 0)); uint handleFlags; Require(GetHandleInformation(owner.job, out handleFlags) && (handleFlags & 1) == 0);
      EXTENDED_LIMITS limits = new EXTENDED_LIMITS(); limits.Basic.Flags = KILL_ON_JOB_CLOSE;
      Require(SetInformationJobObject(owner.job, 9, ref limits, (uint)Marshal.SizeOf(typeof(EXTENDED_LIMITS))));
      SECURITY_ATTRIBUTES security = new SECURITY_ATTRIBUTES(); security.Length = Marshal.SizeOf(typeof(SECURITY_ATTRIBUTES)); security.Inherit = true;
      input = CreateFileW("NUL", 0x80000000, 3, ref security, 3, 0, IntPtr.Zero); Require(input != INVALID_HANDLE_VALUE);
      output = CreateFileW("NUL", 0x40000000, 3, ref security, 3, 0, IntPtr.Zero); Require(output != INVALID_HANDLE_VALUE);
      IntPtr size = IntPtr.Zero; InitializeProcThreadAttributeList(IntPtr.Zero, 2, 0, ref size); Require(size != IntPtr.Zero);
      attributes = Marshal.AllocHGlobal(size); Require(InitializeProcThreadAttributeList(attributes, 2, 0, ref size)); initialized = true;
      jobs = Marshal.AllocHGlobal(IntPtr.Size); Marshal.WriteIntPtr(jobs, owner.job);
      // PROC_THREAD_ATTRIBUTE_JOB_LIST: assignment occurs atomically at creation.
      Require(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x00020013), jobs, new IntPtr(IntPtr.Size), IntPtr.Zero, IntPtr.Zero));
      handles = Marshal.AllocHGlobal(IntPtr.Size * 2); Marshal.WriteIntPtr(handles, input); Marshal.WriteIntPtr(handles, IntPtr.Size, output);
      // The sole inherited handles are NUL. Control pipes and the job stay private.
      Require(UpdateProcThreadAttribute(attributes, 0, new IntPtr(0x00020002), handles, new IntPtr(IntPtr.Size * 2), IntPtr.Zero, IntPtr.Zero));
      STARTUPINFOEX startup = new STARTUPINFOEX(); startup.Startup.cb = Marshal.SizeOf(typeof(STARTUPINFOEX)); startup.Attributes = attributes;
      startup.Startup.flags = STARTF_USESTDHANDLES; startup.Startup.input = input; startup.Startup.output = output; startup.Startup.error = output;
      StringBuilder command = new StringBuilder(Quote(executable)); foreach (string argument in arguments) command.Append(' ').Append(Quote(argument));
      Require(command.Length < 32767);
      Array.Sort(environment, StringComparer.OrdinalIgnoreCase);
      env = Marshal.StringToHGlobalUni(String.Join("\0", environment) + "\0\0");
      // No breakaway flag, suspended/postcreate assignment, or taskkill fallback.
      Require(CreateProcessW(executable, command, IntPtr.Zero, IntPtr.Zero, true, EXTENDED_STARTUPINFO_PRESENT | CREATE_UNICODE_ENVIRONMENT, env, cwd, ref startup, out child));
      owner.process = child.Process; owner.Pid = child.Pid;
      Require(CloseHandle(child.Thread)); child.Thread = IntPtr.Zero;
      FILETIME creation, exit, kernel, user; Require(GetProcessTimes(owner.process, out creation, out exit, out kernel, out user));
      owner.CreationFileTime = (((ulong)creation.High << 32) | creation.Low).ToString(System.Globalization.CultureInfo.InvariantCulture);
      return owner;
    } catch { owner.Dispose(); throw; }
    finally {
      if (child.Thread != IntPtr.Zero) CloseHandle(child.Thread);
      if (initialized) DeleteProcThreadAttributeList(attributes);
      if (attributes != IntPtr.Zero) Marshal.FreeHGlobal(attributes);
      if (jobs != IntPtr.Zero) Marshal.FreeHGlobal(jobs);
      if (handles != IntPtr.Zero) Marshal.FreeHGlobal(handles);
      if (env != IntPtr.Zero) Marshal.FreeHGlobal(env);
      if (input != INVALID_HANDLE_VALUE) CloseHandle(input);
      if (output != INVALID_HANDLE_VALUE) CloseHandle(output);
    }
  }
  public bool RootRunning() { uint value = WaitForSingleObject(process, 0); Require(value == WAIT_OBJECT_0 || value == WAIT_TIMEOUT); return value == WAIT_TIMEOUT; }
  public uint ActiveProcesses() { ACCOUNTING info; Require(QueryInformationJobObject(job, 1, out info, (uint)Marshal.SizeOf(typeof(ACCOUNTING)), IntPtr.Zero)); return info.Active; }
  public void Stop(int timeout) {
    Require(TerminateJobObject(job, 1)); Stopwatch clock = Stopwatch.StartNew();
    while (clock.ElapsedMilliseconds < timeout) {
      if (ActiveProcesses() == 0 && !RootRunning()) return;
      Thread.Sleep(10);
    }
    throw new InvalidOperationException("native-job-drain-timeout");
  }
  public void Dispose() {
    if (process != IntPtr.Zero) { IntPtr captured = process; process = IntPtr.Zero; Require(CloseHandle(captured)); }
    if (job != IntPtr.Zero) { IntPtr captured = job; job = IntPtr.Zero; Require(CloseHandle(captured)); }
  }
  void Publish(string kind, string nonce) {
    Console.Out.WriteLine("{\"schema\":1,\"nonce\":\"" + nonce + "\",\"event\":\"" + kind + "\",\"supervisorPid\":" + SupervisorPid + ",\"pid\":" + Pid + ",\"rootRunning\":" + (RootRunning() ? "true" : "false") + ",\"activeProcesses\":" + ActiveProcesses() + ",\"creationFileTime\":\"" + CreationFileTime + "\"}");
    Console.Out.Flush();
  }
  public static void Supervise(AlphaWindowsJob owner, string nonce, int timeout) {
    owner.Publish("ready", nonce);
    // A distinct reader is opened only after config consumption, before ready
    // allows the parent to send another line. App stdin is NUL, never this pipe.
    using (StreamReader input = new StreamReader(Console.OpenStandardInput(), new UTF8Encoding(false, true))) {
      var pending = input.ReadLineAsync();
      for (;;) {
        if (pending.Wait(100)) {
          if (pending.Result != "stop " + nonce) throw new InvalidOperationException("native-job-control-refused");
          owner.Stop(timeout);
          uint capturedPid = owner.Pid;
          // Both native oracles are established before closing the last job handle.
          Require(owner.ActiveProcesses() == 0 && !owner.RootRunning());
          owner.Dispose();
          Console.Out.WriteLine("{\"schema\":1,\"nonce\":\"" + nonce + "\",\"event\":\"stopped\",\"supervisorPid\":" + SupervisorPid + ",\"pid\":" + capturedPid + ",\"activeProcesses\":0,\"rootExited\":true}");
          Console.Out.Flush(); return;
        }
        owner.Publish("state", nonce);
      }
    }
  }
}
'@
  [Console]::Error.WriteLine('LAWOSS_WINDOWS_JOB_CHECKPOINT:compiled')
  $environment = @($configuration.env.PSObject.Properties | ForEach-Object { $_.Name + '=' + [string]$_.Value })
  $job = [AlphaWindowsJob]::Start([string]$configuration.executable, [string[]]@($configuration.args), [string]$configuration.cwd, [string[]]$environment)
  [Console]::Error.WriteLine('LAWOSS_WINDOWS_JOB_CHECKPOINT:created')
  $stage = 'job-stop-failed'
  [AlphaWindowsJob]::Supervise($job, $nonce, [int]$configuration.timeoutMs)
  exit 0
} catch {
  # Fixed finite failure only; never echo compiler/native exception content.
  [Console]::Out.WriteLine('{"schema":1,"nonce":"' + $nonce + '","event":"error","supervisorPid":' + $PID + ',"code":"' + $stage + '"}')
  [Console]::Out.Flush()
  exit 125
} finally {
  if ($null -ne $job) { $job.Dispose() }
}
