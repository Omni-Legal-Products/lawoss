# Startup and recovery

An installed LAWOSS starts on its native host, preserves its synthetic workspace after restart and exposes failures truthfully.

## Sub-features

- `startup`: embedded SHA, OS/arch, executable, owned profile and visible initial screen.
- `restart`: same client, matter, memory and preferences after an actual stop/relaunch.
- `error-recovery`: unavailable directory/provider produces an explicit error and recovers after restoration.

## How to get to it (user POV)

Start the installed application, open the selected client and matter, then quit and reopen. Directory failures occur when the selected synthetic directory becomes unavailable.

## Driving it with native alpha runner

Preconditions: exact final artifact, synthetic profile and native capture capability.

- Run the helper. `startup` records live identity and a native owned-window image.
- Record the selected client/matter/settings before the `restart` prompt; verify them after the runner relaunches the same artifact/profile.
- Temporarily move only a disposable synthetic client folder, observe the error, restore it and verify the client reappears. Test invalid provider state without sending real content.

## Gotchas

Startup is not all-feature acceptance. Keep failing cleanup leases. Windows descendant closure or missing native capture support blocks a receipt; a renderer screenshot cannot prove a native picker.

For Linux AppImage, verify the final AppRun and desktop-entry arguments as well as the direct installed binary. The pinned builder regression covers actual generated launcher policy and preserves explicit caller arguments; it does not prove native sandbox availability. A SUID-helper failure remains FAIL until a supported installation and actual sandbox-enabled startup succeed. A metadata-verified capture still needs visual review of the native pixels.

The hosted Linux probe now lends an exact-byte/mode root-protected installation to the same acceptance core and, where required, adds only the exact executable's userns policy. Root application launches and global policy changes remain refused. Treat root-tree/copy contract tests separately from positive native startup; confirm owned policy/stage teardown before any success marker.

For missing Windows discovery, inspect the failure-only finite `mainLog` categories after verified native closure. Discovery precedes runtime bootstrap and main-window creation; log observations can narrow the earlier boundary but cannot authenticate a root cause. Raw logs remain private.

Keep Windows cold prerequisite results separate from installed startup: the isolated JSON probe uses another fresh runner and cannot warm the original ownership suite. Its checkpoint delivery timings do not identify the cause of a startup timeout.
