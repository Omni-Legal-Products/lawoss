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

The app currently ships a deterministic bundled catalog and renders an
installation preview only. Opening a detail or preview does not install,
connect, update or execute anything.

## Future GitHub registry flow

The planned registry flow is:

```text
GitHub marketplace manifest
  → schema/path/license validation
  → pinned catalog entry
  → installation preview
  → explicit human confirmation
  → deterministic installer
```

The future registry may be hosted in the LAWOSS GitHub organisation and should
keep stable, lab, community and private sources distinguishable. The app must
cache the last valid catalog for offline discovery and must not silently replace
a pinned version.

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
