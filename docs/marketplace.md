# LAWOSS Marketplace

LAWOSS Marketplace is a governed catalog of capabilities that an agent may
use. It is not an unrestricted plugin store. Before a capability is connected
or installed, the lawyer should be able to see its source, dependencies, data
access and required human approval.

## Capability types

- **Skill** — instructions and a repeatable working method.
- **MCP** — access to a data source or tool server.
- **CLI** — a local executable used by a controlled workflow.
- **Workflow bundle** — a composed skill, agent, command and optional connector.

These types are shown separately because they have different failure modes and
permission boundaries. A skill does not automatically grant connector access;
an MCP entry does not mean that the connector is currently connected.

## Channels

- **stable** — reviewed LAWOSS capability suitable for normal discovery;
- **lab** — experimental work that needs a separate review before promotion;
- **community** — external or community-provided content that LAWOSS has not
  verified;
- **private** — firm-owned content that is visible only to the intended firm.

An item remains in its channel until a human review promotes it. `lab` and
`community` entries must not be presented as verified merely because they are
listed in the catalog.

## Required manifest information

Each entry needs:

- stable ID and human-readable description;
- type and channel;
- jurisdictions, such as `SK`, `CZ` or `EU`;
- source repository and pinned ref/tag/commit;
- dependencies and required local tools;
- capabilities: `read-only`, `local-write`, `network` or
  `external-action`;
- verification status and date;
- the human gate required before use;
- intended install scope: workspace or global.

## Current installation flow

The app ships a deterministic bundled catalog inside the native Settings
integrations views. Opening an entry or requesting a plugin preview does not
install it. Installation is a separate explicit action; installed and connected
are separate states.

LAWOSS Marketplace plugins can be installed once for all clients or into the
selected workspace. The global installer accepts only plugin paths in
`Omni-Legal-Products/lawoss-marketplace` pinned to a full commit SHA. It reuses
the upstream plugin bundle resolver and installer: skills go into the global
OpenCode configuration directory, MCP configuration into the shared runtime
database row, and the installation record retains source and version provenance.
Plugin runtime resources are downloaded during installation.

The workspace option uses the native plugin preview/import flow and its existing
permissions. Bundled OKF skills use their workspace skill installer. Existing
workspace plugin installations remain usable; moving a Marketplace plugin to
the global scope is an explicit action with decisions for local changes. These
paths do not create a parallel connector manager: native Settings continues to
own permissions, connection state and refresh after installation.

## Release checks, updates and removal

The server checks releases of `Omni-Legal-Products/lawoss-marketplace`, falling
back to the highest semantic-version tag when no release exists. It resolves
the tag to a commit SHA before reading the marketplace manifest. The bundled
catalog remains available offline; the last release-check result is persisted.

Checks run when Marketplace opens, on a manual check, or when the optional
weekly check becomes due. Reopening within 15 minutes reuses the saved result;
a manual check bypasses that cooldown. Weekly checking is enabled by default
and can be disabled. The first evaluation records the start of the interval
without a network request; it does not download plugins at startup. Checks use
only the marketplace repository's GitHub API and raw content endpoints and
never install an update automatically.

An explicit update compares installed files with their recorded SHA-256 hashes.
Modified or missing files require a decision: keep the local version, replace
it, or back it up before taking the new version. Removal and migration also
protect local changes. Backups are retained under `lawoss-zalohy`; a disabled
MCP remains disabled after update or migration.

The host-authenticated API is `/lawoss/marketplace`, with separate check,
settings, install, update, remove and move routes. Its implementation is in
`apps/server/src/lawoss/marketplace-{routes,global,updates}.ts`.

## Verification boundaries

Server tests cover updates, local-edit decisions, backup failures, failed
downloads, migration and removal. An isolated service smoke on 9 October 2026
used the real GitHub `v0.1.0` release, pinned installation, duplicate installation,
and removal with preservation of a local edit. It did not start plugin runtimes
or exercise the visible app. Only one published release/tag existed, so a live
update between two releases was not tested; update behavior is covered by
controlled test fixtures. Installing a connector does not establish that its
credentials are configured or its remote data source is available.

## Safety boundaries

- No model decides whether a package is installed or updated.
- Auto-update is disabled; updates require a new reviewable pin.
- OAuth credentials belong in the platform's secure storage, never in a
  workspace, manifest or prompt.
- Google Workspace, Exchange, ZaKo and other providers need separate approved
  connector/auth designs with least-privilege scopes.
- Sending email, writing to an external system, signing or filing requires an
  explicit human confirmation at the point of action.
- Autogram/VisionKit document detection is a separate local-processing slice;
  it is not implied by listing a document workflow.

Marketplace PRs and relevant CI failures are routed by the existing LAWOSS
GitHub Actions notification workflow to the `LAWOSS APP GH` Telegram topic.
Routine branch pushes remain intentionally quiet.
