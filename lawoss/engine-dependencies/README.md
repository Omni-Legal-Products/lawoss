# Captured engine configuration roles

`discoverConfigRoles` enumerates the pinned engine's configuration dependency
roles for one **current managed-local instance**. It does not prepare dependencies
or initialize the engine. No runtime caller is connected in this component.

```js
const result = await discoverConfigRoles({
  instanceDirectory, // current selected local scope, not a historical workspace path
  engineCwd,         // actual child cwd, absolute and captured by its owner
  homeDirectory,     // native home captured by a worker under the SAME final child env
  environment,       // complete final child environment; copied before the first await
  deadline,          // original absolute Date.now() deadline, at most 2^31-1 ms away
  signal,            // optional caller AbortSignal
});
const enginePaths = result.roles.map(role => role.path);
```

Each record has `path` (exact logical spelling), `physicalPath` (absolute spelling
anchored to the captured **engine cwd**), and `roles` (all provenance roles at that
exact string). `physicalPath` is **not** a realpath identity, permission, ownership
claim or installer lock key. Symlink aliases remain distinct logical records.
`directory` is the source-canonical instance directory; `worktree` is the engine's
Git boundary, or filesystem root on the source's non-repository fallback.
Canonical current directory, workspace identity and filesystem permission differ.

Ordered string-unique roles are:

- `global`: `join(XDG_CONFIG_HOME || join(nativeHome, '.config'), 'opencode')`, always.
- `project`: existing `.opencode` entries, near to far through worktree inclusive,
  unless `OPENCODE_DISABLE_PROJECT_CONFIG` is case-insensitive `true` or `1`.
- `home`: existing `join(OPENCODE_TEST_HOME ?? nativeHome, '.opencode')`, regardless
  of the project flag. The caller must preserve inheritance and never introduce a
  production test home.
- `explicit`: truthy `OPENCODE_CONFIG_DIR`, regardless of existence. It does not
  replace global. `OPENCODE_CONFIG` and its parent confer no role independently.

Existence is metadata, not directory type: an ordinary `.opencode` file counts
because the pinned source counts it. A later preparer must refuse unsupported
mutation targets. Relative G/H/E strings retain logical spelling while metadata
and `physicalPath` resolve from the actual engine cwd, never the selected scope.
Windows cross-drive relative strings look up captured `=D:` drive keys
case-insensitively and use that drive cwd or the native
same-drive/root fallback; malformed captured drive cwd refuses with `INVALID_INPUT`.
The caller must supply the effective environment keys used by the child.

Source basis: paired engine commit `16747470f976aca3d362ad730bcd3fe82ecc2c9a`:
`packages/opencode/src/config/paths.ts:23–40`, `packages/core/src/global.ts:17–29`,
`fs-util.ts:168–182,228–264`, `git.ts:184–202,954–988`, `project.ts:110–120`, and
`flag/flag.ts:3–5,54–55`. XDG behavior is exact `xdg-basedir@5.1.0/index.js`
(integrity-verified source retained in Task20's review evidence), including relative
and empty values. Windows drive anchoring additionally follows Node 24.21's
`node:path` win32 resolver with captured inputs. Actual Bun/Windows parity remains
a separate execution gate; the win32 tests here are explicitly path **models**.

Discovery only performs canonical-directory metadata, ancestor `.git`/`.opencode`
existence, home `.opencode` existence, and these sequential read-only queries from
the nearest marker parent: `git rev-parse --show-toplevel`, `--git-dir`,
`--git-common-dir`. All three execute even after an ordinary query failure. A
failed top-level query uses the marker parent if the other two succeed; either of
the latter failing selects filesystem root. Missing Git and ordinary command or
marker-lookup errors retain the source fallback. Project/home metadata failures
remain explicit. No config, package, lock, npmrc or plugin contents are read by
this helper, and no directories are created.

One deadline/cancellation scope covers all work. Native Git stdout is capped at
64 KiB per query; stderr is discarded. Abort, budget, resource exhaustion, malformed
query results and output overflow are typed content-free refusals, never false
fallback authority. The exact owned Git child is killed once when needed and its
`close` event is awaited before return. An earlier output refusal survives a later
abort during close. No retries or extended query timeout are introduced.

The optional second argument supports narrow `filesystem` metadata methods
(`realpath`, `realpathNative`, `exists`), `gitQuery`, and explicit `pathModel` seams.
A Git adapter receives fixed `args`, `cwd`, the frozen captured `environment`, the
same `deadline`, and operation `signal`. It must settle on cancellation only after
closing its owned resources. These seams do not authorize arbitrary commands,
installation or discovery outside the declared metadata scope.

Future integration must supply each current local instance and the same final
child environment/cwd/home, gate **all** current and later workspace activations
before first instance use, and skip explicit remote/unmanaged engines. Global and
home roles are ordinary user configuration; explicit may be user- or app-owned,
which cannot be proved here. Outside-storage identity mapping belongs to the
captured owner, not this selector. No storage keys or historical roots are guessed.
SDK installation, shared-target locking/recovery, runtime hooks and actual native
startup remain future work.

Run only this new suite using the selected Node 24.21 executable:

```sh
node --test lawoss/engine-dependencies/config-roles.test.mjs
```

Tests create private fixtures only below `.work/test-fixtures`, sanitize HOME/XDG/
Git configuration, use real host metadata and isolated Git init/linked-worktree
fixtures, and verify actual owned-child close. No SDK generation, package install,
network, provider, profile, application or CI run is needed for this suite.

## Standalone engine npm configuration (Node 22)

`loadEngineNpmConfig({ directory, environment, engineExecPath, engineNpmPath,
nativeHome })` in `npm-config.mjs` loads genuine `@npmcli/config@10.8.1` with
the engine's explicit executable and npm source directory. All paths are native
absolute paths. The complete captured environment is copied synchronously; the
caller must pass the same environment to its eventual engine. `nativeHome` is the
helper's actual native home, checked when HOME is empty/absent, never injected.
This component neither installs target dependencies nor connects a runtime caller.

The exact upstream constructor tuple preserves builtin/global/user/project/env
precedence, PREFIX/Unix DESTDIR defaults, user-selected registry/cache/auth/omit/
offline settings, and prefix-derived globalconfig. No helper path or helper CLI
arguments substitute for engine context. Return values may contain credentials:
pass them directly to the future Arborist owner, never serialize or log them.
Finite content-free errors are `INVALID_INPUT`, `NATIVE_HOME_MISMATCH`,
`TOOLING_UNAVAILABLE`, and `CONFIG_LOAD_FAILED`. Config records read failures in
layer `loadError` even when load resolves: ENOENT/ENOTDIR are ordinary missing
npmrc paths, other read failures refuse. Actual Config validation rejects invalid
typed configuration/auth; its INI parser is permissive, so text it accepts is not
invented into a parse failure. The existing instance-local `invalidHandler`
records only a boolean refusal flag, preventing raw invalid-value/credential
validation events without throwing inside nopt's global callback. Genuine Config
load/validation and legacy-auth rejection remain active; refused instances never
escape. This does not globally silence upstream source metadata/read-path
diagnostics: future production transport/logging must not forward library events.
There is no builtin-byte adapter or fallback `{}`.

**Do not wire a managed caller yet:** compiled engine npmPath/import.meta.url,
virtual builtin npmrc provenance and plain Node visibility remain unproved.
Native Windows execution and application packaging are separate pending gates.

`runtime-tools/` is a new private isolated future-runtime tooling closure, separate
from the existing Node24 build tools: exact `@npmcli/arborist@9.4.0` and
`@npmcli/config@10.8.1`, pnpm11.4.0, runtime Node22.23.2. Arborist is not evaluated
by configuration preflight. Its genuine generated lock records integrity for all
115 acquired packages, including direct integrity values:

- Arborist: `sha512-4Bm8hNixJG/sii1PMnag0V9i/sGOX9VRzFrUiZMSBJpGlLR38f+Btl85d07G9GL56xO0l0OZjvrGNYsDYp0xKA==`
- Config: `sha512-MAYk9IlIGiyC0c9fnjdBSQfIFPZT0g1MfeSiD1UXTq2zJOLX55jS9/sETJHqw/7LN18JjITrhYfgCfapbmZHiQ==`

Acquisition used the authorized cached pnpm11.4 CLI under Node24.21.0 once,
ignore-workspace/ignore-scripts, public npm registry and isolated `.work` HOME,
config/cache/store, then one fresh frozen/offline replay (115 reused, zero
network downloads). This proves lock replay, not that these tools ship in any
application. No SDK payload, candidate, build-tool lock or root workspace changed.

Run the new configuration suite with the verified shipped Node22.23.2 executable:

```sh
/path/to/verified/node22 --test lawoss/engine-dependencies/npm-config.test.mjs
```

Tests use only `.work/test-fixtures` synthetic profiles/targets and real Config,
compare the exact engine tuple against the helper tuple, preserve target bytes
and create no target node_modules. macOS execution does not prove Windows parity.

The PR workflow `.github/workflows/engine-npm-config.yml` runs that exact test
command under actual Node22.23.2 on Windows 2022 and Ubuntu 24.04. It first
installs only the frozen `runtime-tools/` closure with pnpm11.4.0 under captured
Node24.21.0 and an owned installer HOME/config/cache/store. The subsequent
Node22 step runs the native suite; its authenticated CI conclusion is the
execution gate. Native results remain pending until the workflow is published
and completes. This does not establish application packaging or startup.

## Standalone dependency lease (no production caller)

`dependency-lease.mjs` exports
`withEngineDependencyLease({ stateDirectory, logicalDirectories, deadline, signal }, operation)`.
Supply the captured absolute engine `Global.state`, all known exact logical
`input.dir` spellings for one physical target, and the original absolute wall-clock
deadline in milliseconds. The callback receives a composed AbortSignal. No target
or profile discovery, configuration loading, package installation or tree mutation
is performed by this component.

The wire protocol is adapted from opencode commit
`16747470f976aca3d362ad730bcd3fe82ecc2c9a`,
`packages/core/src/util/effect-flock.ts` and `flock.ts` (MIT, retained in
`LICENSE.opencode`): `state/locks/sha1("npm-install:" + exactDir).lock`, exclusive
0700 directory, exclusive heartbeat and UUID/pid/hostname/createdAt metadata,
60-second stale detection with heartbeat → metadata → directory fallback,
20-second heartbeat, `.breaker` with a stale recheck and token-checked release.
Known aliases are deduplicated and sorted without path normalization; locks are
released in reverse order. Acquisition shares one monotonic budget capped at five
minutes and the caller's initial remaining deadline. Retry starts at 100 ms,
multiplies by 1.7 and caps at 2 seconds, bounded by the remaining budget.

Cancellation is cooperative. **The callback must settle only after all its owned
work and helper children have closed.** The lease awaits callback settlement and
in-flight heartbeat writes before release, including cleanup after the deadline.
It cannot force-stop callback work or prove descendant termination. Heartbeat
faults cancel/refuse work; metadata mismatch or invalid/oversized metadata refuses
release. Initialization failure retains uncertain state for stale recovery rather
than deleting potentially foreign files. Callback and cleanup failures are retained
together. Metadata reads allocate at most a fixed 65,537-byte buffer; heartbeat
updates use an opened file handle to avoid delayed pathname writes into successors.

This remains the engine's advisory filesystem protocol: token check and directory
removal are not atomic against noncooperating writers. Unknown aliases and different
state roots do not share exclusion. The tests use a labeled synthetic protocol peer
with real Node child IPC ready/release/close receipts; they do **not** establish
compiled-engine/Effect interoperability. Actual engine startup is a separate gate.

```sh
/path/to/verified/node22 --test lawoss/engine-dependencies/dependency-lease.test.mjs
```

The explicit Windows/Ubuntu Node22 workflow also selects this suite. Local tests
are not Windows acceptance; that gate requires the published workflow's result.

## Standalone preserving target preparation (source phase, Node 22)

`prepareEngineDependencyTarget(input)` prepares **one existing explicitly authorized
configuration directory**, returning `{ status: 'ready', code: 'READY',
verifiedSdkNodes }` or `{ status: 'blocked', code }`. The caller must block dependent
startup on every non-ready result. There is no runtime caller, discovery, target
root creation, installer CLI, profile redirection, or SDK-only artifact copy path.

Input contains `directory` (native absolute target), captured `stateDirectory`,
all known exact `logicalDirectories` aliases for this target, `engineExecPath`,
`engineNpmPath`, `nativeHome`, complete `environment`, original absolute `deadline`,
optional `signal`, and an existing trusted app-owned `recoveryParent` outside the
target. Authority comes from the owner, never from pathname, role or writability.
The environment and alias array are copied synchronously. This slice rejects
symlink target roots, symlink/hardlinked/nonregular metadata, non-directory or
symlink node_modules, workspaces, npm-shrinkwrap precedence, malformed manifests,
locks other than package-lock v2/v3, and captured global-install mode (which has
different save/tree semantics; refusal never rewrites that policy). Intermediate symlink ancestors are bound
by repeated realpath/device/inode observations, not claimed universally atomic.

The exact existing shared lease is acquired before target reads, configuration or
mutation. Genuine Config10.8.1 loads the explicit engine tuple. Genuine tools-local
Arborist9.4.0 is identity checked without evaluating it during preflight; ancestor
fallback is refused. Shared identity code preserves Config's original error and
nativeHome boundary. There are no registry/auth/cache/omit/offline/prefix overrides.
Arborist receives the pinned source constructor flags `binLinks:true`,
`progress:false`, `savePrefix:''`, `ignoreScripts:true`, and genuine reify receives
`add:['@opencode-ai/plugin@1.18.29'], save:true, saveType:'prod'`. When exactly
1.18.29 is already declared in dependencies and a supported existing lock is
present, `add:[]` repairs that graph without requesting a fresh packument. Both
branches must pass the same physical checks; neither accepts declarations alone.

Success requires fresh `loadActual({forceActual:true})`, exact installed SDK/root
lock versions, required SDK dependency edges and physical package manifests,
concrete node/import/require/default/types public entrypoint files (wildcards and
custom conditions are not expanded), required non-omitted root edges, and preserved
custom declarations in all four sections plus nondependency manifest fields.
Only SDK declarations and absent-versus-empty dependency section normalization are
allowed. User omit policies remain active; omitted dev/peer and optional nodes are
not forced into existence. This is structural tree readiness, not an exhaustive
file-integrity audit or an executed Bun/native import receipt. No user package code
is imported by verification. The merged lock is genuine Arborist output, never a
union/replacement of the old lock with the accepted SDK-only lock.

Each admitted attempt retains a unique private recovery directory: original
package.json (max 1 MiB), package-lock.json (max 16 MiB), SHA-256/absence/inode
records, and observed or failed metadata. Reads have fixed bound+1 allocations
and verify opened/path identities. Files use exclusive 0600 creation; mkdtemp
uses 0700 on Unix. No Windows ACL guarantee is made. On target replacement,
original evidence is retained and successor metadata is not read for recovery.
Failures include a finite result record; raw primary, recovery and lease cleanup
errors survive only in the non-enumerable `result.private.cause`, alongside
`result.private.recoveryDirectory`. **Do not serialize/forward this private member,
config values, library diagnostics or recovery contents into product transport.**
No proc-log listener or global logging mute is installed. Trusted-owner retention
and manual recovery policy remain future work; this helper never removes recovery,
rolls back metadata, copies whole node_modules, or deletes a shared tree.

Identity/hash checks catch some drift. Advisory aliases/state roots cannot exclude
unknown aliases or noncooperating writers; in-place reify can already have written
before a postcondition refuses. This is not a transaction or a universal guarantee
against lost edits. Signal is passed through constructor/reify/loadActual options;
library cancellation support is incomplete. The helper awaits reify settlement
before releasing the lease, including cancellation, and never races/drops it to
meet a deadline. External git descendant termination, a hard callback-return
budget and production transport remain separate required gates.

The optional second argument `{ arboristFactory(Class, options) }` supports narrow
controlled failure tests. It never substitutes for the fresh genuine loadActual
verification, and injected results are not genuine installation evidence.

```sh
/path/to/verified/node22 --test lawoss/engine-dependencies/npm-config.test.mjs lawoss/engine-dependencies/prepare-target.test.mjs
```

Ordinary target tests use synthetic owned `.work/test-fixtures` only and deny
sockets. The four genuine-cache tests require an explicitly supplied
`LAWOSS_TEST_ACCEPTED_SDK_CACHE` pointing to an existing accepted cacache root;
otherwise they are visibly skipped. Each clones that source read-only into a new
fixture's configured cache/_cacache. Tests never acquire tools/SDK over the network
or transplant an SDK lock into an existing custom graph. The first genuine test
creates a custom-only lock with real Arborist, then merges exact SDK offline,
preserves four sections/metadata, and repairs a removed SDK subtree. Other genuine
tests cover post-reify controlled corruption, omit=dev, and initially absent
metadata in an existing root. Failure/cancellation/token/replacement seams are
explicitly controlled tests. No Windows/Linux or production packaging acceptance
is implied by local source tests. Compiled builtin context, owned-child transport,
CLI distribution, native merged graph imports and original application gates remain
unresolved before any production hook.

## Disposable native merged-graph CI acceptance

`node lawoss/engine-dependencies/native-merged-validation.mjs` is a CI-only
Node22.23.2 supervisor. The existing Windows/Ubuntu workflow retains its frozen
Node24/pnpm runtime-tools installation, runs the separate offline guard suite,
then invokes this supervisor once. No production caller or installer hook exists.

The supervisor initializes one private canonical `.work/native-merged-*` root,
with an empty HOME/npmrc/cache, and invokes one isolated exact-Node22 acquisition
worker through the existing bounded `runChild`. It admits the immutable SDK and
build-tool inputs before and after acquisition, verifies the runtime-tools lock,
and binds all genuine transitive APIs below the local runtime-tools installation.
The worker fetches exactly 32 accepted integrity-checked tarballs, then 64 real
registry representations (full JSON plus pacote's exact corgi Accept). Metadata
is never fabricated, filtered, rewritten or used to refresh the accepted lock.
Both representations must match the accepted version's dist URL and integrity,
and all 64 genuine offline pacote readbacks must succeed before acceptance.

One original absolute 300-second acquisition deadline is shared by the parent,
worker, tarballs, metadata and readbacks. Requests are sequential, retry-free,
strict TLS, redirect-refusing and bounded to 45 seconds. Tarballs are limited to
32 MiB each / 256 MiB aggregate; decoded metadata to 64 MiB each / 128 MiB
aggregate, including chunks with no Content-Length. HTTP cache tee writes may
have seen the crossing chunk: this is not a byte-exact filesystem quota. The
public cache API cannot join an aborted tee in process. The disposable worker's
actual close is the containment boundary; cleanup waits for it, including the
existing runner's two-second termination grace. No universal descendant claim
is made. Windows termination is not cooperative SIGTERM cleanup.

Only after a closed, successful worker and an exact small acquisition receipt
does an owned fixed preload set `LAWOSS_TEST_ACCEPTED_SDK_CACHE`. The unchanged
Config/lease/target suites then run under Node22 and the existing socket guard.
Source registration counts are derived without executing the suites (currently
8 + 25 + 14 = 47); actual TAP must have exactly that many passes, zero failures,
skips, cancellations or TODOs. Four genuine-cache target cases must therefore
run. Test fixtures remain separately owned beneath their existing `.work` roots;
the supervisor deletes only its own cache root after child close. It does not
remove another test's fixtures, upload caches, or forward raw child diagnostics.
Primary and cleanup errors remain nonserializable in memory. The acquisition
success receipt (unchanged hashes/versions/counts/byte schema) is now emitted
immediately after a positively closed successful worker and strict validation,
even if later tests or cleanup fail. It proves acquisition only. The unchanged
`phase: tests` success receipt is emitted only after successful tests and cleanup.

Public failure is exactly `{schema:1, phase, status:"failed", code, childClosed,
exitCode, signal, worker, tests}`. `phase` is initialize|admission|acquisition|
tests|cleanup|complete; `code` is the source allowlisted finite refusal code
(unknown errors become NATIVE_VALIDATION_FAILED); `childClosed` is true|false|
"unknown"; `exitCode` is an observed integer 0..255 or null; `signal` is none|
SIGTERM|SIGKILL|SIGINT|other|unknown. Child fields describe the last observed
child, not descendants or proof of a cleanup cause. Unknown close retains the
owned root. A partially initialized root without verified identity likewise
remains untouched; transactional initialization is not claimed.

`worker` is null or exactly `{schema:1,status:"failed",stage,code,tarballs,
metadata,offline}`. The worker exclusively writes `native-operation.json` in
its existing trusted workspace on caught failure. Stages are admission|tarballs|
metadata|offline|revalidation; counts are completed observations (tarballs 0..32,
metadata/offline 0..64), never acceptance. Receipt write failure stays private
alongside the primary error. Parent reads only after positive actual worker
close, with a 4096-byte bound, regular/single-link checks and before/open/after
identity checks. Missing, malformed or pre-catch failure receipts stay null;
no stderr parsing is added and no receipt can turn a failed worker successful.

`tests` is null unless failed-child bounded stdout contains a complete strict
TAP plan and consistent numeric counters. Its exact shape is `{plan,tests,
suites,pass,fail,cancelled,skipped,todo,failures:[{source,registration,line,column}]}`.
Each failure has a top-level numeric registration; `source` is config|lease|
target|unknown. Only exact paths to the fixed three sources and actual test
declaration lines admit positive line/column numbers (column <=4096); otherwise
both are null. No title, arbitrary location, message, stack, actual/expected,
raw TAP or stderr is emitted. Partial TAP stays null and proves no acceptance.
Cancellation/skip/TODO summaries also stay unknown in this failure-only parser.
The unchanged acceptance parser and all original 47 oracles remain authoritative.

Public registry metadata is mutable. If it chooses new transitives absent from
the accepted tarballs, genuine offline reify must fail; no lock union, synthetic
packument, retry, skip or SDK-only transplant is permitted. Source guard tests
use controlled streams/children and real offline tooling admission/cache misses;
they do not prove a real cold cache or native merged graph. Actual Windows and
Ubuntu green CI remains required after fresh source review. No SDK distribution,
license, application startup or packaging acceptance follows from this helper.

```sh
node --test lawoss/engine-dependencies/native-merged-validation.test.mjs
```

The decoded metadata body bound is 64 MiB: measured public plugin/SDK full
representations were about 27–28 MB, so the previous 16 MiB bound rejected
valid registry responses. This provides headroom while retaining streaming
checks before retention, the 128 MiB aggregate budget and existing time bounds.
Mutable registry growth can still exceed these limits; this is not a guarantee
of successful genuine SDK acquisition or offline validation.

## Portable build distribution

`package-runtime.mjs` stages the five runtime helper modules, this README,
`LICENSE.opencode`, frozen runtime-tools manifests and the complete genuine
pnpm-installed production tool closure. Package contents and licenses are kept;
this copying is not a complete third-party notice audit. The source engine pin,
source SHA-256 hashes and pre-manifest tree digest are in `build-manifest.json`.
The accepted runtime-tools lock hash is pinned in the build helper. Updating it
requires deliberate review of that constant. No SDK payload is distributed.

Run under exact host Node 24.21.0, passing absolute paths:

```sh
node package-runtime.mjs OUTPUT SCRATCH SCRATCH/store GENUINE_PNPM_CLI offline
```

`online` explicitly permits frozen tool acquisition in production builds.
Offline validation never invokes Corepack or a PATH shim. The genuine pnpm
11.4.0 package/bin identity and CLI version are checked; installation uses
hoisted layout, copies, no bin links, no scripts and private HOME/npmrc/cache.
The scratch root must be new or carry this builder's ownership marker; use
`prepareScratch` before copying an existing tool store into it. Existing output
must carry the same marker. Caller-supplied parents must be trusted build-owned
locations. This is not protection against a hostile concurrent filesystem or
installer. Generated pnpm layout metadata containing build paths is removed;
package contents are retained. pnpm 11 hoisted still emits root .bin links despite
the disabled bin-links setting, so that unused generated directory is removed.
Recursive lstat rejects all remaining links and special files.

Desktop build preparation runs after existing Node preparation and ships the
whole tree as `resources/engine-dependencies` outside asar. It uses the host
Node, never the foreign target Node in a cross-architecture build. Set
`LAWOSS_BUILD_PNPM_CLI` if `npm_execpath` is not the genuine pinned pnpm CLI.
These helpers are still unwired: compiled npmPath, production callers and
transport remain separate work.

`relocation-smoke.mjs STAGED OWNED_PARENT` runs under actual Node 22.23.2.
It copies to a fresh path containing spaces/#/%, temporarily hides the original
marked stage, constructs/loads Config and Arborist with a minimal environment,
imports all runtime modules and verifies every loaded CommonJS physical path
stays inside the relocated tree. It does not prepare user dependencies or fetch
SDK packages. It restores the original stage after positive child close.
Native Windows/Ubuntu CI and actual desktop packaging remain separate gates.


### Captured managed SDK authority plan (S3)

`managed-sdk-authority.mjs` exports the standalone read-only
`planManagedSdkConfigRoles` API. Its private inputs are the closed product-code
identity, eligible managed sandbox scope, one final environment/cwd/native-home/
Global.state capture, explicit active-lifetime G/E root grants and the original
deadline/signal. The caller must establish capture and grant provenance; a valid
data shape, same UID or familiar path does not establish authority.

The frozen result is `planned`, `incomplete` or `not-applicable`. It retains both
G and E, every logical lease spelling, applicable extra P/H roles, physical
identity/alias observations and absent-target suffixes under a granted ancestor.
Existing dependency entries stay unadmitted; extra or ungranted roles keep
coverage incomplete. The module creates no directories, locks or SDK planes and
has no runtime caller. S4 must acquire leases and revalidate grants before any
mutation; modeled Windows paths are not native ownership evidence.

Focused verification uses the existing Node test runner:
`node --test lawoss/engine-dependencies/config-roles.test.mjs lawoss/engine-dependencies/managed-sdk-authority.test.mjs lawoss/build/plugin-payload/product-identity.test.mjs`.

## Accepted-version metadata fixture policy

`native-merged-cache-projection.mjs` is a pure prerequisite for a derived
offline test cache. The owner must first admit exact SDK lock/public-manifest
bytes and pinned npm APIs. Projection preserves accepted-version JSON values,
keeps only that candidate and existing matching tags, and checks the complete
32-package graph against the lock and available27 public manifests. Five
foreign native manifests remain absent; only the three witnessed optional
plugin peers may be missing. Source whitespace is represented by separate raw
body hashes, not a claim of lexical JSON preservation.

The fixed cache adapter has actual full/corgi offline byte-readback coverage
with public cacache and pinned make-fetch-happen. A shared URL key does not
prove both representations. These supplemental tests do not execute the
original47 or repair the active cache.

The offline projection worker now builds a separately labelled fixture from
an independently copied raw cache. It requires actual Node22.23.2, the fixed
network guard, the original acquisition deadline and all32 archive/SRI,
64 representation,64 exact-byte fetch and64 fresh pacote checks. Raw evidence
stays unchanged. Fixed bounded records bind the nonce, source fingerprint,
physical identities, inventories and byte totals. Runtime-tool source metadata
may have stable shared links; owned cache/records and SDK/build inputs retain
their single-link requirements. Canonical hashes preserve every finite opaque
JSON Number, while control schemas require bounded safe integers.

`verifyProjectionArtifacts` performs read-only content admission after the
parent has independently observed direct-child close and exit0. Worker stdout
and a manifest cannot attest that close. Cancellation joins started operations
and descriptor closes; the worker never recursively deletes the workspace.
The parent integration and its shared300s budget remain separate work. Initial
46 supplemental tests and the focused31-test fix run have independent review;
full source-layout admission, genuine32/64/64/64 execution and unchanged47
retained-input replay remain unperformed. This is a CI fixture worker, not the
future application SDK seeder or installed-app acceptance.
