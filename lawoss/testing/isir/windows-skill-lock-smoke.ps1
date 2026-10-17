$ErrorActionPreference = 'Stop'
$fixture = Join-Path ([IO.Path]::GetTempPath()) ('lawoss-auth-boundary-' + [Guid]::NewGuid().ToString('N'))
$stream = $null
$child = $null
try {
  [IO.Directory]::CreateDirectory($fixture) | Out-Null
  $file = Join-Path $fixture 'SKILL.md'
  [IO.File]::WriteAllText($file, 'Synthetic lock probe only')
  $stream = [IO.File]::Open($file, [IO.FileMode]::Open, [IO.FileAccess]::Read, [IO.FileShare]::None)
  $info = [Diagnostics.ProcessStartInfo]::new()
  $info.FileName = (Get-Process -Id $PID).Path
  $info.UseShellExecute = $false
  $info.RedirectStandardInput = $true
  $info.RedirectStandardOutput = $true
  $info.RedirectStandardError = $true
  foreach ($argument in @('-NoLogo', '-NoProfile', '-NonInteractive', '-File', (Join-Path $PSScriptRoot '../../../apps/server/src/lawoss/test-support/windows-skill-locks.ps1'))) {
    $info.ArgumentList.Add($argument)
  }
  $child = [Diagnostics.Process]::Start($info)
  $child.StandardInput.WriteLine((@{ files=@($file); ownPid=$PID } | ConvertTo-Json -Compress))
  $child.StandardInput.Close()
  if (!$child.WaitForExit(10000)) {
    $child.Kill($true)
    $child.WaitForExit()
    throw 'Owned Restart Manager smoke deadline exceeded'
  }
  $receipt = $child.StandardOutput.ReadToEnd() | ConvertFrom-Json
  if ($child.ExitCode -ne 0 -or $receipt.status -ne 'complete' -or $receipt.win32Status -ne 0 -or $receipt.files -ne 1 -or $receipt.owners.ownTest -lt 1) {
    throw 'Owned Restart Manager smoke did not identify its synthetic file owner'
  }
  Write-Output 'PASS read-only Restart Manager identifies an owned synthetic file lock'
} finally {
  if ($null -ne $child) { $child.Dispose() }
  if ($null -ne $stream) { $stream.Dispose() }
  if ([IO.Directory]::Exists($fixture)) { [IO.Directory]::Delete($fixture, $true) }
}
