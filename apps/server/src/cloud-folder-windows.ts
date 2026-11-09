import { execFile } from "node:child_process";
import { join } from "node:path";

// Fixed code only. Project paths travel as JSON on stdin, never as PowerShell.
const script = String.raw`
$ErrorActionPreference='Stop'
$ProgressPreference='SilentlyContinue'
[Console]::InputEncoding=[Text.Encoding]::UTF8
[Console]::OutputEncoding=[Text.Encoding]::UTF8
Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
public static class CloudFolder {
  [DllImport("cldapi.dll", CharSet=CharSet.Unicode)]
  public static extern int CfGetSyncRootInfoByPath(string path, int infoClass, out long info, uint length, out uint returned);
}
'@
function Read-Key([string]$key) {
  if (Test-Path -LiteralPath $key) { Get-Item -LiteralPath $key }
}
function Contains-Path([string]$root, [string]$path) {
  if ([string]::IsNullOrWhiteSpace($root)) { return $false }
  $root=[Environment]::ExpandEnvironmentVariables($root)
  if ($root -match '^[A-Za-z]:?$') { $root=$root.Substring(0,1)+':\' }
  if (-not [IO.Path]::IsPathRooted($root)) { return $false }
  $root=[IO.Path]::GetFullPath($root).TrimEnd('\','/')
  return $path.TrimEnd('\','/').Equals($root,[StringComparison]::OrdinalIgnoreCase) -or $path.StartsWith($root+'\',[StringComparison]::OrdinalIgnoreCase)
}
$path=[IO.Path]::GetFullPath((ConvertFrom-Json ([Console]::In.ReadToEnd())))
# Explorer's provider registrations still identify configured cloud folders
# when their client or the cloud-file filter is not running yet.
$providers=Read-Key 'HKLM:\Software\Microsoft\Windows\CurrentVersion\Explorer\SyncRootManager'
if ($providers) {
  $sid=[Security.Principal.WindowsIdentity]::GetCurrent().User.Value
  foreach ($provider in (Get-ChildItem -LiteralPath $providers.PSPath)) {
    $parts=$provider.PSChildName.Split('!')
    if ($parts.Length -gt 1 -and $parts[1] -ne $sid) { continue }
    $roots=Read-Key ($provider.PSPath+'\UserSyncRoots')
    if ($roots -and (Contains-Path ($roots.GetValue($sid)) $path)) { 'true'; exit }
  }
}
# Google Drive's live mount registrations also cover drive letters chosen in
# its UI and multiple accounts. Do not assume G: or a folder display name.
$share=Read-Key 'HKCU:\Software\Google\DriveFS\Share'
if ($share) {
  $keys=@($share)+@(Get-ChildItem -LiteralPath $share.PSPath -Recurse)
  foreach ($key in $keys) {
    if (Contains-Path ($key.GetValue('MountPoint')) $path) { 'true'; exit }
  }
}
# Documented administrator/user mount configuration, highest priority first.
foreach ($location in @('HKLM:\Software\Policies\Google\DriveFS','HKCU:\Software\Google\DriveFS','HKLM:\Software\Google\DriveFS')) {
  $key=Read-Key $location
  if ($key) {
    $mount=$key.GetValue('DefaultMountPoint')
    if ($mount) {
      if (Contains-Path $mount $path) { 'true'; exit }
      break
    }
  }
}
# Box documents a configurable parent directory; the mount itself is Box.
# Require client installation evidence before treating the default as a root.
$box=Read-Key 'HKLM:\Software\Box\Box'
if ($box -or (Test-Path -LiteralPath (Join-Path $env:LOCALAPPDATA 'Box\Box'))) {
  if (Contains-Path (Join-Path $env:USERPROFILE 'Box') $path) { 'true'; exit }
  if ($box) {
    $parent=$box.GetValue('CustomBoxLocation')
    if ($parent -and (Contains-Path (Join-Path ([Environment]::ExpandEnvironmentVariables($parent)) 'Box') $path)) { 'true'; exit }
  }
}
# Covers OneDrive/SharePoint, iCloud, Dropbox and other CFAPI providers,
# regardless of hydration state. This call never opens document contents.
[long]$info=0
[uint32]$returned=0
$hr=[CloudFolder]::CfGetSyncRootInfoByPath($path,0,[ref]$info,8,[ref]$returned)
if ($hr -eq 0) { 'true' }
# HRESULT_FROM_WIN32: not under a cloud root, file/path missing, or CFAPI not
# supported on this volume (e.g. no cloud filter attached on clean Windows).
# Provider registrations/configuration above also cover non-CFAPI clients.
elseif ($hr -in @(-2147024506,-2147024894,-2147024893,-2147024895)) { 'false' }
else { [Runtime.InteropServices.Marshal]::ThrowExceptionForHR($hr) }
`;

export async function isWindowsCloudFolder(path: string): Promise<boolean> {
  const executable = join(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
  const stdout = await new Promise<string>((resolveOutput, reject) => {
    const child = execFile(executable, ["-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
      { windowsHide: true, timeout: 15_000, encoding: "utf8" },
      (error, output, stderr) => error ? reject(Object.assign(error, { stderr })) : resolveOutput(output));
    child.stdin?.on("error", reject);
    child.stdin?.end(JSON.stringify(path));
  });
  const result = stdout.trim();
  if (result !== "true" && result !== "false") throw new Error("Unexpected Windows cloud folder response");
  return result === "true";
}
