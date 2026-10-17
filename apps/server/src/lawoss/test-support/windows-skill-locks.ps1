$ErrorActionPreference = 'Stop'
try {
  $requestData = [Console]::In.ReadToEnd() | ConvertFrom-Json
  if ($requestData.files.Count -gt 16 -or $requestData.ownPid -le 0) { throw 'Invalid diagnostic input' }
  Add-Type -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
using System.Diagnostics;
public static class SyntheticSkillLocks {
  [StructLayout(LayoutKind.Sequential)] public struct UniqueProcess { public int Id; public System.Runtime.InteropServices.ComTypes.FILETIME Started; }
  [StructLayout(LayoutKind.Sequential, CharSet=CharSet.Unicode)] public struct ProcessInfo {
    public UniqueProcess Process;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=256)] public string AppName;
    [MarshalAs(UnmanagedType.ByValTStr, SizeConst=64)] public string ServiceName;
    public uint Type, Status, Session;
    [MarshalAs(UnmanagedType.Bool)] public bool Restartable;
  }
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern uint RmStartSession(out uint session, uint flags, StringBuilder key);
  [DllImport("rstrtmgr.dll", CharSet=CharSet.Unicode)] static extern uint RmRegisterResources(uint session, uint files, string[] names, uint applications, IntPtr processes, uint services, IntPtr serviceNames);
  [DllImport("rstrtmgr.dll")] static extern uint RmGetList(uint session, out uint needed, ref uint count, [In,Out] ProcessInfo[] processes, out uint reasons);
  [DllImport("rstrtmgr.dll")] static extern uint RmEndSession(uint session);
  public sealed class Receipt {
    public uint Code; public int Files, OwnTest, Bun, Node, Antimalware, Indexer, Shell, Other;
  }
  public static Receipt Inspect(string[] files, int ownPid) {
    var result = new Receipt { Files = files.Length };
    if (files.Length == 0) return result;
    uint session;
    result.Code = RmStartSession(out session, 0, new StringBuilder(33));
    if (result.Code != 0) return result;
    try {
      result.Code = RmRegisterResources(session, (uint)files.Length, files, 0, IntPtr.Zero, 0, IntPtr.Zero);
      if (result.Code != 0) return result;
      uint needed, count = 0, reasons;
      result.Code = RmGetList(session, out needed, ref count, null, out reasons);
      if (result.Code == 0) return result;
      if (result.Code != 234 || needed > 128) return result;
      var processes = new ProcessInfo[needed]; count = needed;
      result.Code = RmGetList(session, out needed, ref count, processes, out reasons);
      if (result.Code != 0) return result;
      for (var index = 0; index < count; index++) {
        var processId = processes[index].Process.Id;
        if (processId == ownPid) { result.OwnTest++; continue; }
        string name;
        try { using (var process = Process.GetProcessById(processId)) name = process.ProcessName.ToLowerInvariant(); }
        catch { result.Other++; continue; }
        switch (name) {
          case "bun": result.Bun++; break;
          case "node": result.Node++; break;
          case "msmpeng": result.Antimalware++; break;
          case "searchindexer": result.Indexer++; break;
          case "explorer": result.Shell++; break;
          default: result.Other++; break;
        }
      }
      return result;
    } finally { RmEndSession(session); }
  }
}
'@ | Out-Null
  $receiptData = [SyntheticSkillLocks]::Inspect([string[]]$requestData.files, [int]$requestData.ownPid)
  # Never serialize native process metadata or the request itself.
  @{ status='complete'; win32Status=[int]$receiptData.Code; files=$receiptData.Files;
    owners=@{ ownTest=$receiptData.OwnTest; bun=$receiptData.Bun; node=$receiptData.Node;
      antimalware=$receiptData.Antimalware; indexer=$receiptData.Indexer; shell=$receiptData.Shell; other=$receiptData.Other }
  } | ConvertTo-Json -Compress
} catch {
  # Error text may contain paths. The parent also discards stderr entirely.
  @{ status='unavailable' } | ConvertTo-Json -Compress
}
