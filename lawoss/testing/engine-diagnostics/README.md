# Temporary Windows selected-instance diagnostic

Source-only Task 40 from the reliability plan; temporary nonmergeable branch
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
The PowerShell bridge itself remains **unexecuted on Windows** in source review.

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
Its public source/engine identity fields are expected pins; `sourceVerified` and
`engineVerified` separately say whether those validations completed. It contains
fixed phase/failure enums, timing/count fields, health/body/scope booleans and
cleanup status. No synthetic/user paths, raw URLs, env, headers, bodies, errors,
profiles, source contents, roots or binaries are artifacts. Fixed public source
filenames identify the source hash pins.

- `REPRODUCED`: production health verified, then the actual helper reached its
  selected deadline; diagnostic exits 1. It does not identify a cause.
- `NOT_REPRODUCED`: full authenticated selected body and directory scope verified,
  with clean closure; diagnostic exits 0. This is not native app acceptance.
- `UNKNOWN`: refusal, acquisition/setup/other readiness failure, unexpected
  provider call or unconfirmed cleanup. Primary failure survives cleanup failure.

The real Windows feedback loop and its original 90-second outcome remain pending.
No application, provider, acquisition, engine, CI or publication run is implied by
local source validation. Broader app tests are outside this four-file diagnostic.
