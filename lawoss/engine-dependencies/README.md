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
