# Open Computer Use integration

LegalWork's Integrations catalog includes **Open Computer Use** for Mac and
Windows. It connects the upstream [Open Computer Use runtime](https://github.com/iFurySt/open-codex-computer-use)
to OpenCode as a local stdio MCP named `open-computer-use`.

This replaces the former Mac-only `computer-use` integration and bundled
LegalWork helper. On startup, LegalWork removes saved connections that launch
that retired helper. Other custom MCPs are preserved. Connect Open Computer Use
and grant its own Mac permissions to use the replacement.

## Setup

1. Open a local project in LegalWork Desktop, then **Settings → Integrations**.
2. Open **Open Computer Use** and choose **Install and connect**.
3. On Mac, grant **Open Computer Use** Accessibility and Screen Recording in
   System Settings. Return to LegalWork, check setup and connect.
4. Start a chat and ask the agent to inspect an open desktop app. OpenCode receives
   the upstream tools, including app discovery, accessibility state, screenshots,
   clicking, typing, keyboard shortcuts, scrolling and dragging.

Mac requires macOS 14 or later. Windows support is upstream's experimental
runtime, so the catalog marks this integration as Preview. Run it in a signed-in
desktop session and open target apps first. Background control depends on what
the application exposes through accessibility; the runtime can recover hidden
Mac windows by bringing them forward.

## Installation and updates

LegalWork downloads the native **v1.1.0** GitHub release for Mac. Windows x64 and
ARM64 use the bundled [covered-window capture build](../apps/desktop/electron/vendor/open-computer-use/README.md)
from the same upstream tag. The Mac archive and Windows executable must each match
their pinned SHA-256 digest before installation. Installation uses a temporary directory
and publishes the complete runtime by renaming it into LegalWork's user-data
`integrations/open-computer-use` directory. Connect stores an absolute executable
path and a private agent socket namespace in the LegalWork server's MCP config
and hot-adds the same configuration to OpenCode.

If Open Computer Use was already connected on Windows, disconnect and reconnect
it after updating LegalWork so the saved MCP command uses the patched runtime.

No global Node, pnpm, npm or Python installation is required. Installation and
desktop control are unavailable for remote projects. Disconnecting removes the
MCP configuration through the existing connector flow; it leaves the downloaded
runtime available for reconnection.

To update the runtime, update the pinned version, asset names and digests in
`apps/desktop/electron/open-computer-use.mjs`. Rebuild or remove the bundled
Windows patch when upstream includes covered-window capture, and change its
installation-directory suffix so existing Windows installations are replaced.
Update the manifest's package version and verify both platforms. A new upstream
version uses its own installation directory and agent namespace.

## Verification

```sh
node --test apps/desktop/electron/open-computer-use.test.mjs
pnpm --filter @legalwork/app exec bun test tests/extension-items.test.ts tests/mcp-connect-state.test.ts
pnpm --filter @legalwork/app test:i18n
pnpm --filter @legalwork/app typecheck
pnpm --filter @legalwork/desktop typecheck:electron
node apps/desktop/scripts/open-computer-use-smoke.mjs --opencode /absolute/path/to/opencode
```

The smoke test verifies and installs both bundled Windows executables, verifies the signed
Mac app on Mac, enumerates the native MCP tools and connects the host runtime to
an isolated OpenCode instance. It does not run a model or perform desktop actions.
Actual Mac actions require granting this helper its own permissions. Windows
actions must be verified on a Windows desktop.
