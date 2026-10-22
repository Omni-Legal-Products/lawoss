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

For a protected Linux preflight failure, use the finite `preflight` boundary/tool/check and exact outer error code. The fixed stage is `/var/lib/lawoss-ci-<32 lowercase hex>`; its full parent ancestry must pass unchanged trust checks. A `stage-trust/ancestors` metadata refusal may additionally carry `stageTrust`: the fixed `var-lib`, `var` or `root` ancestor and first rejected `symlink/owner/writable/type/canonical` predicate (canonical applies only to `var-lib`). Keep historical `optTrust` records unchanged; the actual fb16 x64 first refusal identified writable `/opt`, and does not prove this new parent or an ARM worker. This detail comes from the existing admission reads; missing detail does not identify a predicate. A pre-creation failure does not establish a native launch or policy load; default `not-required` is not a measured restriction decision. Subprocess failures remain the existing generic protected-installation error. Preserve unknown causes and the original exception; this observation never grants installation or startup acceptance.

For missing Windows discovery, inspect the failure-only finite `mainLog` categories after verified native closure. Isolated Windows alpha launches explicitly opt into twenty-five once-only checkpoints in the existing private log: main configuration, icons, service/runtime construction, single-instance lock result, ready registration/entry, and entered/returned pairs around Actaport bundle/environment, runtime preparation, workspace/config/workflow migration and UI bridge startup. Only exact whole-line markers become `startup-*` categories; `returned` can follow an already handled rejection and does not assert success. This is not a timing trace. Main awaits UI bridge startup before scheduling runtime bootstrap, but catches its rejection, so missing discovery does not prove bootstrap never began. Log observations can narrow a reached boundary but cannot authenticate a root cause. Raw logs remain private. Current checkpoint behavior still requires a native Windows observation.

Keep Windows cold prerequisite results separate from installed startup: the isolated JSON probe uses another fresh runner and cannot warm the original ownership suite. Its checkpoint delivery timings do not identify the cause of a startup timeout.

Development-native ISIR startup has a separate cold MCP readiness gate: `engine.mcp` and `instance-request/headers/body/verified` describe its existing 300s request, before the 90s selected-directory `request/headers/body/verified` proof. A health response does not complete either gate. Initial readiness failures retain their diagnostic log window; finite log observations and completed bootstrap spans do not establish the cause, native closure or installed-alpha acceptance.

After Linux installation preflight, `operationFailure` freezes only the existing failed operation enum and own primitive allowlisted error code before wrapper cleanup. It can distinguish stage creation/binding, copy, protected-tree validation, root mode, installed-tree verification, policy steps and native use. This is not a path or root-cause report. Extractor dual failures retain both errors in `AggregateError`, primary first and as cause; outer cleanup EACCES alone cannot identify an earlier failed guard. No native permission or policy relaxation follows from these observations.

The final-artifact startup probe binds its existing before/captured/after observations and retained evidence observation to the same native window source ID and renderer `performance.timeOrigin`. A same-URL document reload or changed window refuses publication. The public capture records only a finite verified/same/same binding; exact IDs and time origin stay in private evidence. No requests, retries or deadlines are added. This correspondence check does not prove compositor presentation or clear visual review: inspect the actual pixels, preserve Connecting-only images and keep their original pending receipt. Older receipts remain unchanged.
