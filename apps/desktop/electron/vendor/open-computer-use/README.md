# Windows Open Computer Use capture build

These Windows executables are built from [Open Computer Use v1.1.0](https://github.com/iFurySt/open-codex-computer-use/tree/v1.1.0) (`41de9f79fe63d06beefa15df38122a8bb811a9d1`) with `windows-covered-window.patch`. The upstream project is MIT licensed; its license is included here.

The patch changes `get_app_state` to capture the target HWND with `PrintWindow(PW_RENDERFULLCONTENT)` instead of copying the visible desktop rectangle. It keeps the target in the background, aligns Win32 coordinates with UI Automation at display scaling, and omits a failed or flat background capture instead of returning pixels from a different app. The existing screen-copy path remains available when the target is in the foreground.

To rebuild with Go 1.25.0, check out the upstream tag and run
`git apply --unidiff-zero windows-covered-window.patch` at its repository root.
Then run these commands from `apps/OpenComputerUseWindows`:

```powershell
$env:GOOS = "windows"
$env:GOARCH = "amd64"
go build -trimpath -buildvcs=false -ldflags "-s -w" -o open-computer-use-windows-amd64.exe .
$env:GOARCH = "arm64"
go build -trimpath -buildvcs=false -ldflags "-s -w" -o open-computer-use-windows-arm64.exe .
```

| File | SHA-256 |
| --- | --- |
| `open-computer-use-windows-amd64.exe` | `302ec6f4b8cc2cf768641f8d0326d14740ed366e304c4d1efe4401da4d4ffe46` |
| `open-computer-use-windows-arm64.exe` | `6f28edd710cfb0bd77fcfbc4cf00e35ede73f146caa075a40e541af268921de9` |

On Windows 10 x64, a covered LegalWork Electron window returned the covering Codex pixels with stock v1.1.0 and the LegalWork pixels with this build. The ARM64 binary was cross-compiled but has not been run on ARM64 hardware. A target that does not render through `PrintWindow` may still lack a background screenshot; this patch does not change its accessibility tree.
