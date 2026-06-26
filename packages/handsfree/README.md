# LegalWork Computer Use

Native macOS computer-use runtime for LegalWork. Packaged builds wrap it in a
bundled `Computer Use.app` so Accessibility and Screen Recording permissions
attach to the helper app rather than a transient Node/Swift process.

## What it does

The reusable background-control layer:

- Semantic AX snapshots with compact refs (`{e1}`).
- Strict background mode — no foreground cursor/HID fallback.
- Target-window screenshots via `CGWindowListCreateImage(.optionIncludingWindow)`.
- Background input via `CGEvent.postToPid` with window-addressing fields.
- Background activation via per-process event taps + AppKit/center-click primers.
- Non-UI orchestration: realtime tool schemas/instructions and the GPT computer-use loop.

Control is non-interrupting — AX first, then `CGEvent.postToPid` addressed to the
target process/window, so the user's frontmost app stays frontmost while the
target accepts events. A lightweight second-cursor overlay shows where the agent
acts (visual only; strict mode never moves the real cursor). Foreground HID
fallback runs only when strict mode is off.

## Usage

```bash
# Build the native stdio server
pnpm --filter @legalwork/handsfree check:native

# Run as an MCP adapter
pnpm --filter @legalwork/handsfree exec legalwork-handsfree-computer-use mcp
```

The core runtime is MCP-independent: `ComputerUseRuntime` exposes a small direct
surface (`snapshot`, `click`, `typeText`, `pressKey`, `scroll`, `wait`,
`setValue`, `performAction`); `MCPServer` is a thin stdio wrapper.
