# Temporary Windows selected-instance diagnostic

Task 41 source-only setup observations extend Task 40 from the reliability plan; temporary nonmergeable branch
`chore/windows-instance-repro-20261016`, based on
`9e31ec38ead353d44e1f2ab38bac87494373d07d`. This is a smaller feedback loop for
Windows global-health success followed by selected `/path` startup timeout.
It does not change the engine or fix the application.

The controller imports the actual `createManagedOpencodeServer` TypeScript source
with Node **24.21.0** built-in stripping. A scoped `registerHooks` resolver handles
only its two exact `.js` → `.ts` dependency aliases. No dependencies, transpiler,
Bun, SDK payload, Electron build or package install are required. Source/catalog
SHA-256 pins are checked before acquisition and again before engine spawn.

The factory retains its original constructor defaults, retries, args, generated
Basic auth, network flags and registered `/global/health` readiness validation.
Only after that validation succeeds, the original `awaitDirectoryInstance`
helper makes one authenticated `/path` request for the one empty workspace,
with its complete-body and directory-scope checks and **90-second** deadline.
The diagnostic bounds health bodies to 16 KiB, selected bodies to 64 KiB, and
combined engine stdout/stderr to 64 KiB before production buffering. Raw engine
streams and errors are never published. The spawn observer preserves the original
receiver, argument objects and return value, and observes only the exact canonical
engine command. Production shutdown runs before waiting separately for every
owned engine child's `close`, which is stronger than observing `exit` alone.

## Source validation (no engine or network)

```sh
node --test --test-reporter=tap lawoss/testing/engine-diagnostics/windows-instance-repro.test.mjs
node --check lawoss/testing/engine-diagnostics/windows-instance-repro.mjs
node --check lawoss/testing/engine-diagnostics/windows-instance-repro.test.mjs
```

Use Node 24.21.0. Tests call the real factory and readiness helper with fake
children/transports and shortened test-only selected deadlines. They neither
fetch nor execute an engine. The factory's local free-port reservation is real;
network HTTP transport, engine and Windows `taskkill` children are fake. A fake
acquisition test writes only a disposable temporary fixture. The first
behavioral RED caught an inherited credential sentinel reaching the actual
factory; corrected code scrubs the standalone parent environment before the
factory's `...process.env` spread. Test failures compare content-free environment
booleans rather than printing credentials. These tests do not reproduce Windows
or establish a Windows pass.

## Future admitted VM run

Only after independent source review and root authorization:

```sh
node lawoss/testing/engine-diagnostics/windows-instance-repro.mjs --run-ci
```

The preserved `Storage OAuth review builds` workflow has the original input
schema but one branch-only `windows-2022` / 10-minute manual job. Explicit
`platform=windows-2022`, first run attempt, matching branch prefix and exact
Node/source pins are mandatory. Default `all`, `dev`, tags, PR events and other
platforms refuse before acquisition or engine spawn. Import and default CLI
invocation are inert. The CLI accepts no executable, source, output or timeout
overrides.

One fixed public original release URL is encoded in source:
`anomalyco/opencode` v1.18.29, `opencode-windows-x64-baseline.zip`;
source `16747470f976aca3d362ad730bcd3fe82ecc2c9a`;
executable SHA-256
`32675fbf8fcb804c6ee4e048ff0926cd64bf54d1b6185bf2c09e93a2662dd69d`.
Acquisition has no retries, at most two HTTPS redirects to the fixed GitHub/CDN
host allowlist, a 120-second deadline and a 192 MiB compressed cap. Windows'
built-in .NET ZipArchive, through fixed PowerShell source, accepts exactly one
regular `opencode.exe` member, streams at most 256 MiB to a fixed owned filename
`opencode-x86_64-pc-windows-msvc.exe`, and never extracts archive entry paths.
Extra, directory, link, traversal, oversized or hash-mismatched entries refuse.
The Task 40 Windows attempt failed during acquisition with `ARCHIVE_MISMATCH`,
engine spawn count zero and total elapsed 31,691 ms. That total does not measure
extraction time or establish timeout, malformed ZIP, or any application cause.
The new Task 41 bridge/control remains **unexecuted on Windows** in source review.
No additional Windows run, archive download or native extraction is authorized
by these source changes.

The original ZIP is independently SHA-256 checked before original extraction:
`81ea8263923572e3e40cbd22f89d0008efa567b8a812389db042082b03bd2582`.
This expected pin does not retroactively authenticate Task 40's downloaded bytes.
`archiveVerified` reports completion separately from executable verification.

After admission, source verification and fresh owned-root creation, the controller
first writes a fixed tiny regular one-member ZIP containing `opencode.exe` and a
harmless marker. It uses the **same** `extractArchive` function, native PowerShell
command, EXTRACT script, sanitized environment and 30-second extraction plus
7-second close limits as the original attempt. It checks exact extracted marker
bytes and positive process close before the public original download. The marker
file is never executed. Control failure blocks public download and engine startup.
Pure fake-child tests exercise this actual bridge/controller seam; they do not
execute PowerShell/.NET or establish a Windows control pass.

Task 42's source candidate replaces the assembly and byte-buffer cmdlets with
direct CLR calls. Task 41's native control reached `started` and was terminated
by its extraction timer before `assembly-ready`; the exact inner cause remains
unknown. Task 42 has not been run on Windows and is not an application fix.

The accepted boundary is a dedicated ephemeral GitHub Windows VM with public
synthetic data and no supplied user/provider auth. Fresh owned HOME, USERPROFILE,
APPDATA, LOCALAPPDATA, XDG, temp, database and config paths are used. After public
CI admission/acquisition, the standalone diagnostic parent environment is
replaced before the real factory runs: only required native OS keys and explicit
synthetic keys survive. The public pinned catalog is copied into the owned root.
The config mirrors native `isir-native/synthetic` with the non-secret
`synthetic-local-only` token and an owned localhost 503 provider stub; unexpected
calls are counted and fail. No prompts, sessions, generation or paid providers
are requested. Hooks, fetch, logging functions and ambient env are restored.

This is **not a process filesystem or network sandbox**. Synthetic paths and
disable flags do not enforce outside-root write or egress denial. No Windows
security settings are changed. A missing close receipt keeps roots and reports
`UNKNOWN`; VM teardown is an outer backstop and is never proof of process closure.
The controller does not send numeric PID/group signals after a leader exits.
Production Windows cleanup retains its original owned-child lifetime behavior.

## Receipt and interpretation

Only `windows-instance-receipt.json` is uploaded, after controller finalization
and a separate `--validate-receipt` closed-schema/size check (maximum 32 KiB).
Schema version **2** adds separate `control` and `extraction` finite observations.
Its public source/engine/archive identity fields are expected pins; `sourceVerified` and
`engineVerified` separately say whether those validations completed. It contains
fixed phase/failure enums, timing/count fields, health/body/scope booleans and
cleanup status. No synthetic/user paths, raw URLs, env, headers, bodies, errors,
profiles, source contents, roots or binaries are artifacts. Fixed public source
filenames identify the source hash pins.

Each extraction observation records native spawn error, timer-fired flag, positive
close, normalized close kind/code/signal, process-only monotonic elapsed time
(with a separate measured flag, from spawn attempt through close/backstop),
source-issued progress/failure phase, independent disposal failure and bounded
stdout/stderr byte counts. Progress marks `started`, then the direct CLR assembly
load must return before `assembly-ready`, archive open, metadata admitted, output
open, copy complete and dispose complete.
Strict ordered finite protocol is capped at 4,096 stdout bytes before buffering;
stderr is counted before discard up to a 65,536-byte cap. Unknown, duplicate,
malformed, extra and out-of-order protocol refuses. A source-issued category is
an observation of this script, never a cause inferred from raw error text. A
marker does not prove unseen work. Complete protocol, exit zero, positive close
and no timer event are all required for extraction success. Unconfirmed close
retains roots; late events cannot revise a finalized observation. No numeric
PID/group is signaled. Control and original evidence never substitute for each
other. Download, ZIP verification, extraction and control phases remain distinct;
`*Measured` booleans distinguish finalized zero-duration measurements from work
not measured, including failed phases.

Deferred M1 semantic-validation boundary: receipt validation still checks shape
more strongly than full evidence consistency/finalization. A hypothetical
`NOT_REPRODUCED` state can pass without all source/engine/body/request/lifecycle
proof, and an empty unfinished preflight state is accepted. New extraction PASS
and verified-control/engine guards constrain some new fields, but do not close
that whole predicate. No actual-producer contradiction is demonstrated. Root
independently checks actual receipt invariants; M1 remains for final whole-branch
review.

- `REPRODUCED`: production health verified, then the actual helper reached its
  selected deadline; diagnostic exits 1. It does not identify a cause.
- `NOT_REPRODUCED`: full authenticated selected body and directory scope verified,
  with clean closure; diagnostic exits 0. This is not native app acceptance.
- `UNKNOWN`: refusal, acquisition/setup/other readiness failure, unexpected
  provider call or unconfirmed cleanup. Primary failure survives cleanup failure. Separate finite booleans retain engine
close rejection, unconfirmed engine close, provider close rejection and root
removal failure. Any unsuccessful owned shutdown forces UNKNOWN and retains
owned roots even when the engine later emits close. Provider call count is frozen
after awaited shutdown/drain, including its finally path on rejection; calls
serviced during shutdown cannot preserve either positive outcome.

The real Windows feedback loop and its original 90-second outcome remain pending.
No application, provider, acquisition, engine, CI or publication run is implied by
local source validation. Broader app tests are outside this four-file diagnostic.

Task43 adds a separate, source-only prepared coupled headless app-start diagnostic
(`windows-app-start-{repro,host,embedded-observer,repro.test}.mjs`). Its temporary
workflow now admits only `chore/windows-app-start-repro-*`, with exact Node24.21.0,
pnpm11.4.0/Bun1.4.2 frozen dependencies and the genuine server build, followed by
locked Electron43.7.5 RUN_AS_NODE import/SQLite preflight before original-engine
acquisition. The one actual manager/store case preserves the factory defaults,
90000ms selected helper, 60000ms normal-stop observation and 7000ms engine pipe
observation. Only strict `windows-app-start-receipt.json` (<=32768B) is publishable;
pending/rejected/missing closure retains UNKNOWN and its root. Build provenance,
Electron installer cache and roots remain private. Local pure/fake checks are
source preparation only; real build/preflight/manager integration and one manual
Windows run require subsequent review/authorization. Full Windows app remains
RED unchanged, full-native acceptance false and cause UNKNOWN.
The automatic failure-only desktop doctor keeps its real original-EXE results,
with diagnostic 15000ms / 65536B per-stream sync bounds on its exact two argv
forms. Any doctor invocation retains UNKNOWN/root; these synchronous probes do
not provide the engine pipe-close evidence required for a closed result.
Task43 source-review fix1 requires coherent nonzero completed automatic MCP
observations for either positive outcome. The receipt states both120000ms
app-start and300000ms outer-host observation caps. A controller-owned fixed
outer deadline also gates host removal; pending work retains the diagnostic
hooks, child/fetch bounds and output quarantine. Late identity failures have a
separate field and preserve actually observed closure/removal and primary or
cleanup errors. Quarantine counts strings and binary byteLength; arbitrary
console arguments are counted without coercion or serialization (cap1000).

Task44 adds a version1 publication envelope at that same sole public path and
artifact: `{schema:1, experiment:"windows-app-start-diagnostic", mode, payload}`.
`APP_START` wraps the unchanged app receipt; `BUILD_PREREQUISITE` contains only
closed finite build observations for the actual23 ordered prerequisite phases,
captured pnpm/Node/Bun file checks and seven commands. Node/Bun executable
admission is128MiB in the shared initial/recheck tool path; pnpm remains64MiB.
This is a ceiling, not an expected size or authenticity proof.
Build success writes only its private manifest; failure can exclusively publish
one finalized build receipt after CI admission and an absent-path check. The
app branch requires build success and refuses existing public evidence. The
always-run validator binds mode to actual build/app step conclusions before
the sole uploader: failed build + skipped app for BUILD, successful build +
executed app for APP. Missing receipt exports `present=false`; it is UNKNOWN,
not a passed diagnostic. Old bare payloads are refused at this new CLI boundary.
A separately approved source-first external reader must qualify the new union
before any later run/body acquisition; the historical Task43 reader stays frozen.

Build observations never claim app execution, native facts, causal reproduction
or tree-wide closure. Unmeasured identity/size fields remain null; over-limit
file sizes are clamped at the admitted maximum+1 with `sizeExact:false`. First
command failures, independent spawn/exit/close/timer/output flags and primary vs
publication errors remain distinct. A timeout freezes observation without killing
or joining the pending child; retained roots/resources and cause remain UNKNOWN.
A stuck child or infrastructure timeout can prevent validation/upload entirely.
No artifact delivery, Windows installation/build pass or native acceptance is
established by pure/fake source checks. Full Windows app remains RED unchanged.
