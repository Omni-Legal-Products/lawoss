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

The hosted Linux probe lends a root-protected installation to the same acceptance core. It preserves source and descendant bytes/modes, while the exclusively created install container has an explicit root-owned 0755 policy. Its physical identity is checked before and after root-only normalization so the ordinary-user app can enter it. Where required, the probe adds only the exact executable's userns policy. Root application launches and global policy changes remain refused. Treat root-tree/copy contract tests separately from positive native startup; confirm owned policy/stage teardown before any success marker.

For a protected Linux preflight failure, use the finite `preflight` boundary/tool/check and exact outer error code. The fixed stage is `/var/lib/lawoss-ci-<32 lowercase hex>`; its full parent ancestry must pass unchanged trust checks. A `stage-trust/ancestors` metadata refusal may additionally carry `stageTrust`: the fixed `var-lib`, `var` or `root` ancestor and first rejected `symlink/owner/writable/type/canonical` predicate (canonical applies only to `var-lib`). Keep historical `optTrust` records unchanged; the actual fb16 x64 first refusal identified writable `/opt`, and does not prove this new parent or an ARM worker. This detail comes from the existing admission reads; missing detail does not identify a predicate. A pre-creation failure does not establish a native launch or policy load; default `not-required` is not a measured restriction decision. Subprocess failures remain the existing generic protected-installation error. Preserve unknown causes and the original exception; this observation never grants installation or startup acceptance.

For missing Windows discovery, inspect the failure-only finite `mainLog` categories after verified native closure. Isolated Windows alpha launches explicitly opt into thirty-two once-only checkpoints in the existing private log: main configuration, icons, service/runtime construction, single-instance lock result, ready registration/entry, and entered/returned pairs around Actaport bundle/environment, runtime preparation, workspace/config/workflow migration and UI bridge startup. Only exact whole-line markers become `startup-*` categories; `returned` can follow an already handled rejection and does not assert success. Seven constructor milestones use a private optional nonthrowing callback after the original state/path/sidecar/Office operations, preserving the original getPath order and exact thrown error. `runtime-documents-returned` covers both the original documents lookup and pure projects-directory join; it is not an isolated OS-call timing. Both earlier d794 Windows targets reached only services-returned, with no exact failing constructor call measured. No fallback or extra path query follows from that absence. These bounded synchronous log writes can perturb timing. This is not a timing trace. Main awaits UI bridge startup before scheduling runtime bootstrap, but catches its rejection, so missing discovery does not prove bootstrap never began. Log observations can narrow a reached boundary but cannot authenticate a root cause. Raw logs remain private. Current checkpoint behavior still requires a native Windows observation.

Keep Windows cold prerequisite results separate from installed startup: the isolated JSON probe uses another fresh runner and cannot warm the original ownership suite. Its checkpoint delivery timings do not identify the cause of a startup timeout.

Development-native ISIR startup has a separate cold MCP readiness gate: `engine.mcp` and `instance-request/headers/body/verified` describe its existing 300s request, before the 90s selected-directory `request/headers/body/verified` proof. A health response does not complete either gate. Initial readiness failures retain their diagnostic log window; finite log observations and completed bootstrap spans do not establish the cause, native closure or installed-alpha acceptance.

After Linux installation preflight, `operationFailure` freezes the existing failed operation enum and own primitive allowlisted error code before wrapper cleanup. It can distinguish stage creation/binding, copy, protected-tree validation, root mode, installed-tree verification, policy steps and native use. Only a protected-tree failure with valid owned-root context adds `filesystem`: fixed action (`scandir`, `lstat`, `realpath`, `readlink`, `unknown`), lexical payload-root/descendant/ancestor/unknown scope, and bounded component depth or null. These come from the original error's own data properties; no paths, messages, getters or additional filesystem reads are used. Missing detail stays unknown; lexical scope does not identify a mode, ACL or operating-system cause. Extractor dual failures retain both errors in `AggregateError`, primary first and as cause; outer cleanup EACCES alone cannot identify an earlier failed guard. No native permission or policy relaxation follows from these observations.

After the same original root/ancestor/canonical checks pass, a failed tree validation may also carry `rootAccess`: permission `modeBits` (0..511), `otherRead` and `otherSearch`. They come only from the root's already-read metadata, before the original directory read; observer failures cannot replace validation. This is mode observation, not ACL/effective-access or root-cause proof. The first bc4 Linux x64 failure localized `scandir` to the payload root but predates this field, so its actual mode remains unknown. Preserve the original failure and do not infer a permission repair from a modeled owner-transfer mechanism.

The final-artifact startup probe binds its existing before/captured/after observations and retained evidence observation to the same native window source ID and renderer `performance.timeOrigin`. A same-URL document reload or changed window refuses publication. The public capture records only a finite verified/same/same binding; exact IDs and time origin stay in private evidence. No requests, retries or deadlines are added. This correspondence check does not prove compositor presentation or clear visual review: inspect the actual pixels, preserve Connecting-only images and keep their original pending receipt. Older receipts remain unchanged.


The desktop SDK build gate compares the current owned generation's complete
private identity with actual packed ASAR code, public BuildInfo, current SDK
source set and capsule resources. CI requires explicit SDK mode, invokes this
before original afterPack early returns, and repeats the CLI gate immediately
before each final prepackaged AppImage/NSIS/ZIP command. Development/null/no-SDK
returns development, never verified release identity. These static checks and
inert FileMatcher/ASAR fixtures do not establish installed startup or managed
G/E provisioning; keep their receipts separate from native acceptance evidence.


After the original hosted Windows final-artifact launch fails with verified
native closure, discovery ENOENT and home-returned without documents-returned,
the CLI may run a separate three-case Documents diagnostic. It first emits the
unchanged primary projection and sets exit1; supplemental failure cannot clear
that status. Each fresh case uses the existing Job Object with separate15s
start/observation/stop limits: unchanged alpha environment, owned home/Documents
present, then explicit owned Documents override as a diagnostic control only.
The pinned repository Electron43.7.5 fixture records actual ready state and one
getPath sequence, not product startup. Returned paths are classified lexically
without following outside-root values; nonce-bound private records publish via
owned pending-to-final rename. The public JSON contains only fixed outcomes,
source/executable hashes, original finite boundary and verified/unverified stop.
An unavailable case keeps the aggregate incomplete. Unknown closure retains the
fixture and prevents later children. The original90s readiness and12min NSIS
step stay unchanged. Natural Documents lookup, registry/OneDrive configuration,
normal-user startup and an OS cause remain unverified until actual evidence.
The exact finite Documents JSON upload cannot include profiles, raw logs or
broader paths. Its read-only installed Electron package metadata permits package
store hardlinks with bounded physical/digest postflight; private fixture records
and the executable retain their single-link admission.
