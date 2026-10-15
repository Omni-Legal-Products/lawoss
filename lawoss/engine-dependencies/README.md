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
Windows cross-drive relative strings use captured `=D:` drive cwd or the native
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
