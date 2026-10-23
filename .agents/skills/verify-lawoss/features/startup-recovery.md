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

A recognized tool-entry refusal may also carry `toolTrust`: first rejected `symlink`, `owner`, `writable` or `type` from the same cached admission metadata; file `type` additionally distinguishes `non-regular` and `link-count`. These fields apply only to the fixed tool-entry steps and original unverified code. The parser keeps its separate parser-trust boundary. Missing detail remains unknown, and a native filesystem error supplies no invented metadata predicate. The original guards and root0755 policy remain unchanged.

A type/link-count entry refusal may also carry frozen `toolTrust.linkCount`:
exact safe counts0..65535 or value65535/capped:true. It comes from the same
original getter and never admits a multiply linked tool. Invalid optional
metadata leaves legacy refusal fields intact. Missing count stays unknown.

For missing Windows discovery, inspect the failure-only finite `mainLog` categories after verified native closure. Isolated Windows alpha launches explicitly opt into thirty-two once-only checkpoints in the existing private log: main configuration, icons, service/runtime construction, single-instance lock result, ready registration/entry, and entered/returned pairs around Actaport bundle/environment, runtime preparation, workspace/config/workflow migration and UI bridge startup. Only exact whole-line markers become `startup-*` categories; `returned` can follow an already handled rejection and does not assert success. Seven constructor milestones use a private optional nonthrowing callback after the original state/path/sidecar/Office operations, preserving the original getPath order and exact thrown error. `runtime-documents-returned` covers both the original documents lookup and pure projects-directory join; it is not an isolated OS-call timing. Both earlier d794 Windows targets reached only services-returned, with no exact failing constructor call measured. No fallback or extra path query follows from that absence. These bounded synchronous log writes can perturb timing. This is not a timing trace. Main awaits UI bridge startup before scheduling runtime bootstrap, but catches its rejection, so missing discovery does not prove bootstrap never began. Log observations can narrow a reached boundary but cannot authenticate a root cause. Raw logs remain private. Current checkpoint behavior still requires a native Windows observation.

Keep Windows cold prerequisite results separate from installed startup: the isolated JSON probe uses another fresh runner and cannot warm the original ownership suite. Its checkpoint delivery timings do not identify the cause of a startup timeout.

Windows decode/compile diagnostics use a separate bounded CALL grammar with `before`, `return` or `error` and capped child-relative elapsed time. Preserve the first before and first terminal for each operation; completed checkpoints and lastCheckpoint retain their original meaning. A before event identifies a source boundary, and a missing terminal remains censored. Parent delivery uses a separate clock origin; subtracting it from child time does not measure one-way latency. Observers freeze before cancellation or ready return. Timer/IO/CLR work can perturb cold behavior; preserve the original cold order, budgets and failures.

The separate Windows qualified-cold experiment is preparation-only until its
root-owned single marked feature push passes the live publication gates. It
runs the unchanged first native closure case once on each of four fresh
x64/ARM64 control/treatment workers; only treatment adds the absolute Utility
import inside the original decode bracket. The public Node24 reporter rejects
noncanonical duplicate owned projections and contradictory file provenance,
then drains; final evidence requires actual child, both pipes and both writers
closed. Retrieve and hash all four finite files from each first cell within 7 days.
Local pure-event and inert CLI tests are transport proof only. Missing/capped
decode returns or dominating host variance make comparison INCONCLUSIVE; a
functional difference alone grants no production fix or historical clearance.
Never rerun the batch to obtain green, and never use its marker as global
single-use authority. Keep all original native failures and startup gates.

Development-native ISIR startup has a separate cold MCP readiness gate: `engine.mcp` and `instance-request/headers/body/verified` describe its existing 300s request, before the 90s selected-directory `request/headers/body/verified` proof. A health response does not complete either gate. Initial readiness failures retain their diagnostic log window; finite log observations and completed bootstrap spans do not establish the cause, native closure or installed-alpha acceptance.

After Linux installation preflight, `operationFailure` freezes the existing failed operation enum and own primitive allowlisted error code before wrapper cleanup. It can distinguish stage creation/binding, copy, protected-tree validation, root mode, installed-tree verification, policy steps and native use. Only a protected-tree failure with valid owned-root context adds `filesystem`: fixed action (`scandir`, `lstat`, `realpath`, `readlink`, `unknown`), lexical payload-root/descendant/ancestor/unknown scope, and bounded component depth or null. These come from the original error's own data properties; no paths, messages, getters or additional filesystem reads are used. Missing detail stays unknown; lexical scope does not identify a mode, ACL or operating-system cause. Extractor dual failures retain both errors in `AggregateError`, primary first and as cause; outer cleanup EACCES alone cannot identify an earlier failed guard. No native permission or policy relaxation follows from these observations.

After the same original root/ancestor/canonical checks pass, a failed tree validation may also carry `rootAccess`: permission `modeBits` (0..511), `otherRead` and `otherSearch`. They come only from the root's already-read metadata, before the original directory read; observer failures cannot replace validation. This is mode observation, not ACL/effective-access or root-cause proof. The first bc4 Linux x64 failure localized `scandir` to the payload root but predates this field, so its actual mode remains unknown. Preserve the original failure and do not infer a permission repair from a modeled owner-transfer mechanism.

Only a thrown error from the original symlink realpath await may add `linkResolution`: bounded scope/depth for the invocation `entry` and already computed `lexicalTarget`. Existing `filesystem` still describes original error.path. These three depths may differ. RootAccess remains the existing fourth operation argument; the optional link snapshot is fifth and is unrelated to the preflight tool argument. Metadata is copied into a closed deep-frozen record after eligibility checks, with proxies/accessors rejected; observation adds no resolution or permission read. A lexical target is neither the physical target nor the denied component. Earlier readlink/containment failures and returned physical escapes do not manufacture this field.

Only the opted-in protected wrapper may add separate `linkTargetContext`
after the original realpath EACCES and old link observer. It samples at most
16 increasing lexical prefixes with lstat, stopping at links, untrusted
directories, wrong types, errors or the cap. Mode bits/ownership/depth and
closed stop categories are post-failure samples, not cached original access
or a denied-component/ACL diagnosis. Root is not reread, resolution is not
retried, and the original error/guards/cleanup stay unchanged. Path-based
sampling can race ancestor replacement; only call count is bounded, not
filesystem latency. Invalid optional context leaves legacy fields intact.
Native Linux collection remains separate from metadata models and source
forwarding checks; these fields grant no permission or startup success.

The final-artifact startup probe binds its existing before/captured/after observations and retained evidence observation to the same native window source ID and renderer `performance.timeOrigin`. A same-URL document reload or changed window refuses publication. The public capture records only a finite verified/same/same binding; exact IDs and time origin stay in private evidence. No requests, retries or deadlines are added. This correspondence check does not prove compositor presentation or clear visual review: inspect the actual pixels, preserve Connecting-only or Ready-only images and keep their original pending receipt. Older receipts remain unchanged.


The desktop SDK build gate compares the current owned generation's complete
private identity with actual packed ASAR code, public BuildInfo, current SDK
source set and capsule resources. Current SDK shipping additionally requires
schema2 and the exact fixed `electron/generated/plugin-sdk/worker.cjs` member,
bound to that generation's bounded source bytes; legacy schema1 parsing alone
cannot pass this gate. The build takes an explicit trusted Bun1.4.2 executable
and joins compiler/pipe closure before completing the generation. Without-SDK
and development modes require absent source/packed worker and no compiler.
CI invokes the gate before original afterPack early returns and immediately
before each final prepackaged AppImage/NSIS/ZIP command. Development/null/no-SDK
is never verified release identity. These checks and actual inert FileMatcher/
ASAR worker fixtures prove build provenance only: final embedded Node signing
identity, authenticated runtime launch and managed G/E provisioning remain
separate requirements. Keep this evidence separate from native acceptance.


An initial desktop SDK mode/target/applicationBuild refusal may produce one closed hook stderr record: first failed predicate, reached/pass/fail states, and prepared/current BuildInfo null states only when that comparison completed. The record is privately keyed to the original Error; earlier getter/canonical/default failures and later source-set/resource refusals have no fabricated tuple record. Hook logging retains the same error and precedes all later mutation; the public CLI stays unchanged. These observations explain a reached guard, without asserting a dirty file, target mismatch, repair or native acceptance.

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
