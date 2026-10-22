# Fixed plugin SDK payload (build component)

This standalone component prepares the genuine `@opencode-ai/plugin@1.18.29`
closure using Node **24.21.0** and Arborist **9.4.0**. Its separate build tools use
pnpm **11.4.0**. It changes no application hook, workspace dependency, engine,
provider, profile, packaging workflow or supported target matrix.

`sdk/package-lock.json` is the full Arborist-generated v3 lock, including foreign
optional packages. `sdk/provenance.json` records every version/integrity, declared
license, available license-file hash, and observed **darwin/arm64** artifact.
`sdk/public-package-manifests.json` retains actual installed package manifests.
Several published packages omit a separate license file. `sdk/notices/` supplies
three original source notice texts for nine exact artifacts, including all six
foreign/native optional packages. Its index binds tarball URL/SRI, source revision,
license hash and attribution method; it preserves separate POSIX/Windows publisher
revisions. Plugin/SDK attribution uses complete metadata and selected byte-identical
source comparisons; Kubernetes attribution uses declared SPDX and the generator's
upstream source. These methods and their limits are explicit, without invented
copyright or NOTICE text or a full-build attestation claim.

The worker includes the five fixed files under `third-party-notices/` alongside
all unchanged package LICENSE/COPYING/NOTICE files. Source input hashes and exact
payload inventory are both mandatory: missing, changed, linked, executable or extra
notice files refuse admission. An existing destination is never adopted or repaired.
This supplies source notice data; product packaging must retain it, and a software
license compatibility assessment is not implied.

## Shipped Node consumer admission

`verifyRuntimePayload(root, manifestSha256)` is a separate read-only verifier
for the product's exact **Node 22.23.2**. It requires a payload produced by
**Node 24.21.0**, the same native platform/architecture/libc, all10 guarded
imports, a real roundtrip, the exact target codec mode, the accepted input/full lock, and the
complete unchanged file inventory. The original `verifyPayload` producer gate
still binds the receipt to its executing Node version.

The expected manifest digest must come from a trusted build identity, not from
the adjacent receipt. This interface neither authenticates a caller-provided
digest nor stabilizes a mutable tree after validation. It performs no copying,
SDK imports, installation, engine launch or application-profile mutation.
Production digest transport and config-root provisioning remain unwired.

`runtime-consumer-validation.mjs ABSOLUTE_NODE22 ABSOLUTE_PNPM11_CLI` runs under
Node24.21.0 with `LAWOSS_PR_HEAD` and `LAWOSS_CHECKOUT_SHA` set to exact40hex
identities. It creates a fresh owned `.work/runtime-consumer-validation` workspace;
existing workspaces and summaries are refused. It installs only the frozen
standalone tools using genuine pnpm11.4.0 and private configuration/store, runs
53 producer units, acquires all32 accepted tarballs once, prepares/verifies the
genuine payload offline, then requires all6 consumer integrations under Node22.
The consumer imports all10 SDK entries with network denied and checks the exact
target codec mode. The four native-loaded targets require a corrupted native-binary
fixture to remain refused and expose only the existing loader boundary and
allowlisted code. The two fallback targets instead corrupt a real required SDK
module and require import refusal. It also rejects corrupted files, replacement
receipts, mismatched targets/producers and missing digest/capability proof. No skips count as acceptance.
Source, both executables and the complete payload are rechecked afterward.

The capability table binds to accepted lock SHA256
`59f4b854ddab534533fd878c5a7c325a7a1bc3382294d68111cff005920a4053`:

| Target | Required codec mode |
| --- | --- |
| macOS x64 / ARM64, Linux glibc x64, Windows x64 | `native-loaded` |
| Linux glibc ARM64, Windows ARM64 | `javascript-fallback` |

The accepted msgpackr2.1.0 README and implementation describe native extraction
as optional string-parsing acceleration. The accepted ARM64 Linux3.0.4 package
has only musl-tagged prebuilds, and no Windows ARM64 prebuild is accepted. Thus
these two targets must explicitly report a functional JavaScript codec; this is
not a native-acceleration PASS. Unknown targets, malformed tuples and any changed
lock are refused. Every target still requires full physical integrity, all imports,
guard and roundtrip. Schema2 reports `consumerMode` and truthful `nativeLoaded`
(false for fallback); `nativeCapability` means the exact target contract passed.
The original unbound strict assertion and existing Windows x64/Bun lane stay strict.

When a producer consumer-check fails, `producerProbe` may
report only closed primitive import/native/guard/roundtrip observations and a
fixed native loader scope/code. Accessors, paths, raw errors and command output
are excluded. The `msgpackr-load` scope covers the existing outer require and
roundtrip block; it does not identify an exact failed inner call. Success probe
JSON is unchanged. Historical ARM failures without this tuple remain unknown;
source inspection does not identify their failed field. Native execution of the
new candidate on all six targets, actual engine/Bun use and representative fallback
workload performance remain separate proof obligations.

Only `.work/runtime-consumer-summary.json` is published by the separate
`plugin-sdk-runtime.yml` six-native-target matrix. This finite summary carries
hashes, counts and fixed failure information; it excludes paths, private caches,
package trees, installer output and raw errors. The entry waits for each owned
direct child close through `runChild`; this is not a universal descendant-tree
proof. This lane establishes dependency compatibility only. Product shipping,
licenses, Bun consumption, engine readiness and actual installed journeys remain
separate acceptance gates. It does not modify the engine's audit/config policy.

Build tools and SDK dependencies are separate closures. Acquire tools with the
committed tools manifest/lock, explicit dev-dependency inclusion, disabled scripts,
an explicit public registry,
empty private npm configuration and a dedicated store. For this checkout:

```sh
PAYLOAD_ROOT="$PWD/lawoss/build/plugin-payload"
mkdir -p "$PAYLOAD_ROOT/.work/home"
: > "$PAYLOAD_ROOT/.work/empty-npmrc"
env -i PATH="/Users/vojte/.nvm/versions/node/v24.21.0/bin:/usr/bin:/bin" \
  HOME="$PAYLOAD_ROOT/.work/home" \
  XDG_CONFIG_HOME="$PAYLOAD_ROOT/.work/home/config" \
  npm_config_userconfig="$PAYLOAD_ROOT/.work/empty-npmrc" \
  npm_config_globalconfig="$PAYLOAD_ROOT/.work/empty-npmrc" \
  npm_config_cache="$PAYLOAD_ROOT/.work/pnpm-cache" \
  pnpm --dir "$PAYLOAD_ROOT/tools" install --prod=false --ignore-workspace --ignore-scripts \
  --frozen-lockfile --registry=https://registry.npmjs.org/ \
  --store-dir="$PAYLOAD_ROOT/.work/pnpm-store" \
  --config.cache-dir="$PAYLOAD_ROOT/.work/pnpm-cache" \
  --config.state-dir="$PAYLOAD_ROOT/.work/pnpm-state"
/Users/vojte/.nvm/versions/node/v24.21.0/bin/node "$PAYLOAD_ROOT/tools-preflight.mjs"
```

`tools-preflight.mjs` checks the expected tools-local Arborist entry, a bounded
package manifest with exact name/version, and tools-anchored resolver realpath
identity. It accepts pnpm symlinks/junctions and refuses ancestor-only fallback,
without loading Arborist implementation or SDK code. Importing the module performs
no I/O; the CLI has no path override. Fixed refusals are `TOOLS_LINK_ABSENT`,
`TOOLS_MANIFEST_ABSENT`, `TOOLS_INVALID` and `TOOLS_ADMISSION_FAILED`.
Acceptance proves only the local manifest/version/resolver context, not the full
transitive tool closure.

Tool reproduction uses the same command with `--offline` and a populated store.
The SDK replay needs the separately retained, populated **Arborist** cache;
the pnpm store is not interchangeable. Neither cache is committed. Initialize a
fresh canonical workspace below `.work/`, copy only the trusted Arborist cache
contents into its owned `cache/` (preserving regular files, no external links),
and replay. Existing output/workspaces are refused; no user cache is read.

```sh
NODE=/Users/vojte/.nvm/versions/node/v24.21.0/bin/node
"$NODE" "$PAYLOAD_ROOT/prepare.mjs" init "$PAYLOAD_ROOT/.work/new-validation"
# Supply the separately retained cache to new-validation/cache before replay.
"$NODE" --import "$PAYLOAD_ROOT/network-guard.mjs" \
  "$PAYLOAD_ROOT/prepare.mjs" replay "$PAYLOAD_ROOT/.work/new-validation" payload
"$NODE" --import "$PAYLOAD_ROOT/network-guard.mjs" --test \
  "$PAYLOAD_ROOT/prepare.test.mjs"
PAYLOAD_VALIDATION_WORKSPACE="$PAYLOAD_ROOT/.work/validation" \
  "$NODE" --import "$PAYLOAD_ROOT/network-guard.mjs" --test \
  "$PAYLOAD_ROOT/prepare.test.mjs" "$PAYLOAD_ROOT/integration.test.mjs"
```

`candidate` is a historical first-generation mode. An existing accepted lock
refuses it before spawning; the guard also refuses candidate generation when no
lock exists. There is no refresh, add, update, target override or online fallback.
Tests install the guard at module entry and propagate it explicitly into children
even through the clean environment. Normal unit tests need no network/cache.
Integration tests are opt-in and use only isolated fixtures below `.work/`.

Replay snapshots detached virtual inventory/edges **before** ideal-tree building,
refuses graph drift **before** reification, then reifies offline without saving.
It rechecks unchanged input/lock bytes, full required/applicable-optional physical
closure, actual package metadata, licenses, file hashes, internal `.bin` links,
and isolated ESM imports. Consumers must require `payload-manifest.json` and use
`verifyPayload`; a successful directory existence check is insufficient. The
helper validates in its owned stage and publishes by directory rename only after
the closed receipt, imports and hashes pass. A per-output admission directory
refuses another cooperating writer. Existing outputs are never intentionally
replaced. Failures clean only matching owned stage/admission identities.

The receipt records relative inventory, lock/input hashes, exact Node patch,
native host target, installed closure and target-inert optional absences. Current
proof is host-only: 27 dependencies, ten imports, native msgpackr acceleration
loaded, and relocation with preserved relative links plus spaces/Czech characters.
Peer-dependent `./tui` is not promised without its optional OpenTUI consumers.
The Node socket/DNS guard is **not** an OS firewall or native-code sandbox.
Operations have a 180 s child deadline, 64 KiB captured-output limit, 30,000-entry,
64-level, 256 MiB tree and 32 MiB individual-file limits. Cancellation waits for a
positive direct-child close before stage cleanup; descendant lifecycle is not a
universal process-tree claim. Actual Windows behavior is unverified.

Execution history is deliberately separate from code conformance: a RED test
accidentally generated a second online candidate before the preflight existed.
It was never accepted, matched the original lock hash, and was interrupted.
Its direct-child close/descendant state was not observed; bounded process absence
and normal owned removal do not establish that proof. Earlier test fixtures also
used the OS temp directory; final fixtures use `.work/`. These historical gates
remain failed/unknown in the Task22 report. Neither this component nor its tests
establish production engine startup or full PR157 acceptance.

## Accepted-artifact validation (Task24 source; native CI evidence pending)

`prime-cache.mjs` exposes only `primeAcceptedCache({workspace, signal})` and a
single-workspace CLI. Importing it performs no I/O. It admits the byte-pinned
accepted input/full lock/tools lock, a fresh owned empty cache and a one-shot
`.admit-primer` directory. All 32 non-root accepted records, including foreign
optionals, are checked before the first request. It fetches sequential exact
public HTTPS tarball URLs with identity encoding, no redirects/retries/profile
credentials or packuments, into the already pinned cacache 20.0.4 API. Limits:
32 requests, 32 MiB/archive, 256 MiB total, 45 s/request and one absolute 300 s
budget from admission through final revalidation. Body bytes are counted with
backpressure into only the current hard-capped archive buffer. Public `cacache.put` and `cacache.get.byDigest` promises are
awaited through actual content/index/read settlement, with size/SRI verification.
Cancellation or failure destroys and awaits the owned request/response closures
and joins any already-started cache promise before admission release. No further
request, cache write or verification starts after cancellation/expiry; waiting
for owned I/O settlement is cleanup, not extra work budget or force-cancelled OS
I/O. Archive chunks/body/readback references are cleared promptly. Partial cache
bytes remain with an incomplete receipt;
replay refuses that workspace and retries require a new owned workspace.

`native-validation.mjs` is a separate Windows/x64 Node 24.21.0 entry for the
PR-only workflow. It runs exactly 44 offline units (16 prepare, 11 primer,
17 native-validation), primes a new cache (no retained
SDK cache transplant), runs all four guarded integration cases with zero skips,
then prepares/verifies a separate Node payload. A cold tarball-only cache may
still fail ideal-tree construction; that failure remains red without fetching
metadata or changing the accepted lock. The workflow installs only the frozen
standalone tools with pnpm 11.4.0, explicit `--prod=false`, public registry and
private empty config/store. Before clearing inherited environment it captures
absolute pnpm/Node Application paths and PATH/PATHEXT/SystemRoot/ComSpec. Foreground
installation must produce a fresh actual zero native exit status; invocation
failure or absent/nonzero status fails with `TOOLS_INSTALL_FAILED`. Only then can
the shared manifest preflight run, and its fresh zero exit is also required before
setup succeeds. Native admission repeats that same preflight before recording any
tool identity. Complete summary acceptance still requires all 44 units and four
integration cases, with zero failures, cancellations, skips or todos.

These deterministic setup checks do not establish the unique cause of the prior
49e admission failure: actual installer configuration/tree and missing module
identity remain unknown. Actual Windows command flow and installation under these
flags require a fresh Windows job; local fixtures do not prove that execution.

Bun 1.3.14 consumes the already Node-verified payload using the existing copied
probe, explicit executable, clean synthetic home/XDG/temp environment, a 60 s /
64 KiB child bound and the guard preload. The probe refuses missing admission
**before** SDK imports; the marker is installed only after supported Node JS
socket/DNS/global-fetch interception. Bun compatibility is not yet demonstrated;
there is no unguarded fallback. Ten imports, successful msgpackr roundtrip and
native `loaded` are required; `fallback`/`absent` remain visible failures. Probe
removal is identity checked, and Node verifies unchanged payload inventory again.
The Node receipt is never relabeled as Bun evidence. Executable version,
revision (or unknown), SHA256 and pinned setup origin are recorded separately;
matching standalone semver does not prove identical compiled-engine build.

Only a schema-checked JSON summary (64 KiB maximum, seven-day retention) leaves
the Windows job. It contains exact hashes/tool identities, actual test counts,
acquisition counts/bytes, separate Node/Bun observations and bounded failed stage
/code. Unexecuted assertions remain unknown. No payload, cache, file inventory,
raw output or user/provider data is uploaded. Local offline tests are source and
synthetic-stream evidence only; Windows, Bun, native cold replay and application
startup/production integration remain unverified until their separate gates run.

## Read-only product bundle admission

`inspectProductSdkBundle` in `product-bundle.mjs` statically admits an explicit
`payloadRoot` using `expectedManifestSha256`, `expectedTarget`,
`acceptedLockSha256` and `compatibilityBinding`. The trusted build caller must
independently authenticate that full schema-2 native producer/Node22 consumer
summary. An adjacent manifest or summary cannot provide its own authority.

Admission requires the exact accepted inputs, notices, bounded physical inventory,
target capability and all 27 current compatibility source hashes. It returns a
frozen finite identity; it never imports target SDK/native code or writes files.
Caller data is snapshotted with aggregate value/text limits and repeated-object
refusal before copying. The separate build-only static verifier supports accepted
foreign target bytes; both existing producer and runtime host gates remain strict.

Run `node --test lawoss/build/plugin-payload/product-bundle.test.mjs` for inert
format/data regressions. These fixtures do not prove genuine native compatibility.
The six-target SDK workflow runs them separately before the unchanged genuine
producer/consumer entry. A source change invalidates older compatibility bindings;
fresh native proof is required before a product build caller can use them.

This S1 admission does not install into a profile or start the engine.

## Owned build resource publication

`publishProductSdkResource` in `product-resource.mjs` takes the full trusted S1
input plus an explicit canonical `buildParent` and one-component `outputName`.
It refuses existing outputs, overlapping paths and unowned parents. Under a
publisher lease it copies the SDK with its validated relative links and modes,
adds the nine-file static verifier closure, rechecks copied and source bytes,
then renames its own same-parent stage. Failures preserve primary/cleanup errors;
uncertain publication or replaced ownership retains the affected entries.

The caller must exclusively control the build parent. The lease coordinates this
publisher; Node's directory rename has no atomic no-replace guarantee against
other same-UID writers. Windows POSIX mode fields do not establish ACL privacy.

The frozen result includes `privateIdentityModule` text containing the payload,
target, accepted lock/source and verifier identity. A future trusted build caller
must put this identity inside application code and bind it to the actual final
resource. An adjacent JSON file, manifest or environment variable cannot grant
that authority. This standalone S2 publication primitive has no desktop packaging
caller, actual app.asar binding, profile seeding or engine startup hook yet.

Run both `product-bundle.test.mjs` and `product-resource.test.mjs` for inert data
and real owned-filesystem regressions. A fixture copying foreign-target data does
not execute that target's SDK. The POSIX permission-failure case is explicitly
inapplicable on Windows/root; genuine compatibility remains the separate native
producer/Node22 entry.

## Fresh build generations and signing-safe data capsules

`validateRuntimeConsumer(node, pnpm, { outputParent })` optionally writes its
fixed workspace and summary names under an already initialized SDK workspace.
Explicit parent admission and existing-output refusal precede tool probes and
writes; its identity is checked again before child initialization and summary
publication. Omission keeps the original default path. The CLI accepts the exact
optional pair `--output-parent ABS`. Existing outputs are never refreshed.

`freshProductSdkBuildRoot(root)` holds a cooperating generation lease and returns
an opaque frozen capability. A previous positively owned, idle root is renamed
whole into a unique sibling archive and rechecked; all previous bytes remain.
Unknown roots or leases are refused. Only `completeProductSdkBuildRoot(capability)`
releases that generation after ownership rechecks. The caller must first settle
every child; this filesystem helper does not prove process closure. Uncertain
operations retain their marker. POSIX metadata does not prove Windows ACL privacy.
On failure, `retainFailedProductSdkBuildRoot(capability)` closes this process's
descriptor without unlinking the unresolved marker or permitting a new generation.

`publishProductSdkResource({ ...input, transport: 'tar+gzip' })` publishes
`payload.tgz` and the same static verifier closure. Its frozen private identity
also binds archive format, fixed filename, byte count and SHA-256. The default
`directory` transport remains available; unknown transports refuse before staging.
The archive uses tar7.5.22 from the existing pinned build-tools closure. A genuine
roundtrip must pass the original manifest and complete SDK inventory before the
expanded staged copy is removed. SDK code is never executed by publication.

The data archive keeps original native SDK bytes away from the macOS signer's
individual Mach-O signing pass, while the enclosing app seals the archive.
This build-only creator is not an admission/extraction API for untrusted runtime
archives. Actual asar identity binding, bounded runtime extraction, dependency
seeding and engine startup remain separate unimplemented integration steps.

The workflow runs output-parent/build-root tests separately from the unchanged
53 producer and 6 consumer selection. Capsule tests run after that genuine entry
has installed its exact tools. A portable archive positive runs on every host;
the POSIX link/mode fixture is explicitly skipped on Windows. A local signing
proof never substitutes for six-target installed-application acceptance.

## Private code identity and static ASAR reader

`createProductSdkIdentityModule` writes one closed generated module format for
an explicit SDK/without-SDK mode, the complete application BuildInfo, target and
optional capsule identity. `readProductSdkIdentityModule` parses that exact
format as bounded plain data, freezes its nested objects and never evaluates it.
Neither formatting nor parsing authenticates a compatibility proof or grants
authority to adjacent resource metadata.

The separate `development` mode requires exactly `applicationBuild: null` and
`sdk: null`, while still validating the complete supported target. It preserves
the existing development build-info writer's literal `null` result; it cannot
carry SDK authority. The preparer accepts this only with an explicit
`without-sdk` supplier, rejecting SDK suppliers before filesystem admission.
Both packaged readers require an explicit development expectation. The composed
gate checks public literal null and absent SDK resources, stages no SDK tools,
and returns `status: 'development'`, never verified release identity.

`readPackagedProductSdkIdentity` reads the fixed module member from an actual
physical `app.asar` using the pinned builder's asar3.4.1 parser. It bounds the
header allocation and member range/size first, refuses links/unpacked code,
clears parser caches and checks the supplied build/mode/target and physical
archive/root postflight. The caller exclusively controls this build tree;
multiple pathname opens do not provide hostile-writer atomicity.

`node --test lawoss/build/plugin-payload/product-identity.test.mjs` needs no
installed build tools. The actual-container regressions in
`packaged-identity.test.mjs` additionally require the installed desktop builder.
These identity primitives do not themselves admit an SDK capsule or establish
installed startup. The composed static gate below performs resource admission;
the desktop build wiring described below composes it with these checks.

`prepareProductSdkPackaging({ desktopRoot, target, supplier, applicationBuild })`
composes the owned generation, supplier, capsule and generated private module.
Supplier modes are explicit `accepted`, `native` and `without-sdk`; accepted
foreign data never executes on the build host. Native mode requires a matching
host and Node24, exact producer/consumer/pnpm physical identities and explicit
head/checkout SHAs. It runs the original validator as a fresh isolated child,
admits its complete proof after normal close and rechecks the executable bytes.
An error retains the generation marker and evidence while closing our lease FD.
The child cap does not establish Windows descendant closure on failure.

The return includes the capsule resource and `application-code/identity.mjs`
under the same archived generation. The desktop adapter below now calls this
preparation API; product runtime use is still pending. Native integration receipts
must distinguish a modeled desktop root
from a real packaged app. Packaging fixtures run only after tools installation,
separately from the unchanged53/6 native compatibility selection.

## Static capsule extraction and composed packaging gate

`extractAndVerifyProductSdkCapsule({ resourceRoot, identity, workspace })` accepts
an independently authenticated private-code identity and a fresh SDK-owned
workspace. It checks the exact resource layout, nine-file verifier inventory
and physical archive size/hash without executing resource JavaScript. Pinned
tar7.5.22 lists a bounded gzip stream before path writes. Admission rejects
traversal, duplicate/case aliases, unsafe links and special files; portable names
also protect the reserved private input on case-insensitive target filesystems.
Entry/depth/file/aggregate/metadata/raw stream limits and bounded zero EOF
padding prevent the decoder from doing unlimited work behind a logical limit.

Only the admitted byte-identical archive is copied into a private `wx` stage
and synchronously extracted. The original SDK manifest/notices/full inventory
and resource/workspace identities are rechecked before publication. The returned
payload is build data, not a runtime capability. Primary errors survive; retained
stages/admissions report cleanup uncertainty. Caller cleanup is still required.

`verifyPackagedProductSdk({ resourcesRoot, target, expectedMode,
applicationBuild, validationParent })` composes the actual-ASAR identity reader,
bounded public BuildInfo equality and capsule verification. Explicit without-SDK
mode requires an absent resource and performs no SDK staging. SDK mode requires
an initialized private validation parent outside the resources tree and an absent
fixed `verification` child. Success follows only after repeated private/public
identity checks and one ownership-checked removal of that child. Failures retain
their workspace and never repair or retry cleanup.

Run `product-capsule-validation.test.mjs` with the installed pinned SDK tools.
`packaged-resource.test.mjs` additionally uses the installed desktop builder for
real ASAR fixtures. These are static build checks, including inert foreign data;
actual builder FileSet mapping is tested separately below. Full native desktop
build/signing and runtime integration need their own evidence. No test fixture
stands in for six-target native startup.


## Desktop build wiring

`desktop-packaging.mjs` connects preparation and admission to the desktop build.
`build:electron` defaults to explicit `without-sdk`, including supported
crossbuilds. SDK production requires `--sdk-mode native` plus explicit
`--sdk-consumer-node`, `--sdk-pnpm-cli`, `--sdk-head` and `--sdk-checkout` inputs.
A native failure never falls back to an SDK-free package. The existing writer's
BuildInfo result is used unchanged; only its null development result selects
the separate development identity.

The pinned builder maps only the current owned generation's
`application-code/identity.mjs` to `electron/generated/plugin-sdk/identity.mjs`
inside ASAR. A stale broad source module is excluded. Only `payload.tgz` and the
verifier closure are SDK extraResources; caches, ownership markers, raw SDK trees
and compatibility proofs are not published. The `afterPack` hook asynchronously
imports the adapter and checks it before the existing prerequisite checks and
sidecar early returns. The checked source identity must equal the complete
actual-ASAR identity, current source set, expected build and target.

Since `--prepackaged` skips that hook, all three CI final-distribution commands
are immediately preceded by the same gate CLI:

```sh
node apps/desktop/scripts/check-packaged-plugin-sdk.mjs \
  --asar <packaged-resources>/app.asar --target <one-of-six-triples> --mode sdk
```

Shipping wrappers derive BuildInfo from the current checkout, version, target,
commit epoch, channel and workflow URL, using the existing release-source
predicate. CI independently requires SDK mode and supplies actual native Node22
and pinned pnpm inputs before building under Node24. Actual-ASAR/adapter tests
run after native preparation installs the SDK tools and before original native
ISIR gates. The separate original53/6 compatibility gate stays unchanged.

Run `desktop-packaging.test.mjs` with both the installed desktop builder and SDK
build tools. It exercises actual pinned FileMatchers/copyFiles plus ASAR with
inert data, rejects source/code/resource mismatches and omitted final gates,
and preserves the original18 sidecar assertions. Those fixtures do not establish
full desktop build/signing, installed startup, managed config provisioning or
six-target acceptance. The private SDK resource is not yet consumed at runtime.


### Build-only failure observations

The optional synchronous failure observer on `verifyBuildPayload` and the build-only bundle/publisher/capsule APIs reports frozen closed guard/code categories. Publisher contexts distinguish source admission, copied admission, capsule original and capsule roundtrip. It observes the original operation before error translation, adds no filesystem reads or retries and cannot replace the original failure when it throws. Own primitive error codes are structural observations, not authenticated OS causes.

The expected-valid capsule test fixture prints at most three events only when setup fails, then rethrows the same error. Successful fixtures stay silent. Producer/runtime default callers do not enable the observer. Changes to `validate.mjs`, including diagnostics, invalidate prior source-bound compatibility evidence; refresh native producer/consumer proof for the final source set before claiming current compatibility.
