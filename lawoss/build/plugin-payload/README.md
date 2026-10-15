# Fixed plugin SDK payload (build component)

This standalone component prepares the genuine `@opencode-ai/plugin@1.18.29`
closure using Node **24.21.0** and Arborist **9.4.0**. Its separate build tools use
pnpm **11.4.0**. It changes no application hook, workspace dependency, engine,
provider, profile, packaging workflow or supported target matrix.

`sdk/package-lock.json` is the full Arborist-generated v3 lock, including foreign
optional packages. `sdk/provenance.json` records every version/integrity, declared
license, available license-file hash, and observed **darwin/arm64** artifact.
`sdk/public-package-manifests.json` retains actual installed package manifests.
Four published packages omit a separate license file; their declared licenses
are recorded, and source-license collection remains a redistribution follow-up.

Build tools and SDK dependencies are separate closures. Acquire tools with the
committed tools manifest/lock, disabled scripts, an explicit public registry,
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
  pnpm --dir "$PAYLOAD_ROOT/tools" install --ignore-workspace --ignore-scripts \
  --frozen-lockfile --registry=https://registry.npmjs.org/ \
  --store-dir="$PAYLOAD_ROOT/.work/pnpm-store" \
  --config.cache-dir="$PAYLOAD_ROOT/.work/pnpm-cache" \
  --config.state-dir="$PAYLOAD_ROOT/.work/pnpm-state"
```

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
budget from admission through final revalidation. Body bytes are counted, writes
respect backpressure, and flushed content is read again by digest. Cancellation
or failure destroys and awaits the owned request/stream closures; admission is
released only afterward. Partial cache bytes remain with an incomplete receipt;
replay refuses that workspace and retries require a new owned workspace.

`native-validation.mjs` is a separate Windows/x64 Node 24.21.0 entry for the
PR-only workflow. It runs all offline units, primes a new cache (no retained
SDK cache transplant), runs all four guarded integration cases with zero skips,
then prepares/verifies a separate Node payload. A cold tarball-only cache may
still fail ideal-tree construction; that failure remains red without fetching
metadata or changing the accepted lock. The workflow installs only the frozen
standalone tools with pnpm 11.4.0, public registry and private empty config/store.

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
