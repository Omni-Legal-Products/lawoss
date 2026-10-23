param([Parameter(Mandatory=$true)][UInt64]$WindowId,
      [Parameter(Mandatory=$true)][UInt32]$OwnerPid,
      [Parameter(Mandatory=$true)][string]$OutputPath)
$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.Drawing
Add-Type @'
using System;
using System.Runtime.InteropServices;
public static class AlphaOwnedWindow {
  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int Left, Top, Right, Bottom; }
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr window, out uint pid);
  [DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr window);
  [DllImport("user32.dll")] public static extern bool IsIconic(IntPtr window);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr window, out RECT rect);
  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr window, IntPtr context, uint flags);
}
'@
$window = [IntPtr]::new([Int64]$WindowId)
[UInt32]$actualOwner = 0
if ([AlphaOwnedWindow]::GetWindowThreadProcessId($window, [ref]$actualOwner) -eq 0 -or $actualOwner -ne $OwnerPid) { throw 'native-window-owner-mismatch' }
if (-not [AlphaOwnedWindow]::IsWindowVisible($window) -or [AlphaOwnedWindow]::IsIconic($window)) { throw 'owned-window-unavailable' }
$rect = [AlphaOwnedWindow+RECT]::new()
if (-not [AlphaOwnedWindow]::GetWindowRect($window, [ref]$rect)) { throw 'owned-window-unavailable' }
$width = $rect.Right - $rect.Left; $height = $rect.Bottom - $rect.Top
if ($width -le 0 -or $height -le 0 -or $width -gt 8192 -or $height -gt 8192 -or ([Int64]$width * $height) -gt 33554432) { throw 'invalid-native-window-size' }
$bitmap = [System.Drawing.Bitmap]::new($width, $height)
$graphics = [System.Drawing.Graphics]::FromImage($bitmap)
try {
  $context = $graphics.GetHdc()
  try { if (-not [AlphaOwnedWindow]::PrintWindow($window, $context, 2)) { throw 'owned-window-unavailable' } }
  finally { $graphics.ReleaseHdc($context) }
  [UInt32]$afterOwner = 0
  if ([AlphaOwnedWindow]::GetWindowThreadProcessId($window, [ref]$afterOwner) -eq 0 -or $afterOwner -ne $OwnerPid) { throw 'native-window-owner-mismatch' }
  $bitmap.Save($OutputPath, [System.Drawing.Imaging.ImageFormat]::Png)
} finally { $graphics.Dispose(); $bitmap.Dispose() }
