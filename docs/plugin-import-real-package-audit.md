# Real package import audit

Tested on 19 October 2026, on `codex/portable-import-lifecycle`, based on `dev` at `e3900fa4`.

This supplements the synthetic regression tests. A package passing import checks is not proof that every instruction, provider account or tool call works in LegalWork.

## Actual installed sources

Discovery and planning ran against 69 original local bundles, without changing them or executing their instructions:

| Source | Bundles | Ready | Setup required | Partial | Unsupported | Rejected by size/file limit |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Claude official marketplace | 40 | 10 | 10 | 1 | 19 | 0 |
| OpenAI ChatGPT/Codex installed bundles | 29 | 3 | 0 | 0 | 25 | 1 |

These are planner classifications, not 69 successful functional tests. The OpenAI sources include curated, remote-curated, bundled and primary-runtime packages. They are not a sample of every private ChatGPT Work installation. `openai-templates` exceeded the existing 64 MB / 5,000 file boundary and was rejected.

The first pass found false readiness for host-dependent packages and exceptions for optional skill directories. After the changes below, unsupported browser/desktop/runtime bundles are classified instead of crashing or appearing usable.

## Installation lifecycle on actual packages

Five original packages passed in an isolated runtime database and workspace:

| Source | Package | Imported components | Installed resource files |
| --- | --- | ---: | ---: |
| Claude | Frontend Design | 1 | 7 |
| Claude | Math Olympiad | 1 | 25 |
| Claude | Feature Dev | 4 | 8 |
| OpenAI | PDF, version `26.1015.12040` | 1 | 12 |
| OpenAI | Visualize, version `1.0.49` | 1 | 30 |

For each package, the test resolved and prepared review, installed it, compared supporting file bytes with the plan, reimported the same source, restored the retained snapshot, and removed the package. Resource counts include the generated import report; that report was excluded from source-byte comparisons. Test state was removed afterward. The original source bundles were unchanged.

This checks lifecycle and asset preservation. It does not execute the skills, prove an upstream version upgrade, or exercise every operating system. Separate synthetic tests cover version changes, local edits, rollback failure recovery and persistent plugin data.

## Public repository adapter

The actual GitHub adapter downloaded the immutable `anthropics/knowledge-work-plugins` snapshot at `33eeda1e8fd856455b05479d13a0f85b5f803744` and planned both `legal` (14 components) and `productivity` (11 components). Both were partial: several remote connectors still needed live review and Google Calendar/Gmail entries lacked usable connector configurations. They were not counted as ready or installed in this check.

Downloads of `openai/plugins` at `0722921d5542fc593105c27bd52630babd8b8c2a`, selecting `plugins/build-web-apps` and `plugins/github`, returned HTTP 429. Fresh downloads from this repository remain unverified; the local OpenAI bundles above were tested instead. The importer now explains rate limiting and offers retry or importing a local folder/archive.

## Actual connector endpoints and engine

Anonymous MCP initialization and OAuth metadata probes ran against these public endpoints without account tokens:

| Endpoint | Observed response | What this establishes |
| --- | --- | --- |
| `https://mcp.context7.com/mcp` | MCP HTTP 200 | Anonymous initialization worked at this endpoint |
| `https://mcp.linear.app/mcp` | HTTP 401, OAuth metadata available | Authentication is required; dynamic registration and client metadata identities were advertised |
| `https://api.githubcopilot.com/mcp/` | HTTP 401, OAuth metadata available | Authentication is required; dynamic registration and client metadata identities were not advertised |
| `https://mcp.figma.com/mcp` | HTTP 401, OAuth metadata available | Authentication is required; dynamic registration was advertised |

Separately, the actual Claude Context7 plugin was prepared against its declared OAuth endpoint. Review returned `setup / sign_in`. The real bundled OpenCode engine (`1.18.29`), with isolated configuration and state, returned `needs_auth` for that prepared connector. This matches the review; it is not a successful account connection. Preparation performed dynamic client registration, but no browser consent, account grant or token exchange occurred.

The real-engine automated OAuth tests exercise PKCE, callback, token exchange and client identity against a mock provider. Real provider consent, account credentials, seats, provider approval, authenticated IP restrictions and resulting tool permissions remain unverified.

## Corrections prompted by these checks

- Normalize default directory declarations such as `./skills/` before checking optional absent folders.
- Block connectors requiring the source desktop's IPC/runtime environment.
- Block tool access and approval policies that LegalWork cannot preserve, rather than widening permissions during normalization.
- Identify explicit setup commands that configure the original app, artifact runtime dependencies, and original-host tool references in imported instructions.
- Explain GitHub HTTP 429 as a rate limit rather than suggesting invalid repository access.
- Mirror the server's new `semver` dependency in the desktop package. The first Windows CI run caught this packaging omission; the packaged dependency checks now pass locally.

Instruction checks recognize explicit APIs, commands and declared requirements. They are conservative checks, not a semantic proof that arbitrary natural-language instructions are portable.

## Import list visibility

Discovery now uses the same static planner with bounded manifest, connector and Markdown reads, without loading executable/binary assets or contacting providers. Packages with no supported components or a known required host/permission incompatibility are omitted. Blocked bundled connectors are omitted independently; mixed packages with usable components remain visible for partial-import review. Dependency availability and live connection prerequisites are still checked during review.

On the actual installed sources, Google Contacts no longer appears. PDF, Visualize, Frontend Design, Math Olympiad and Feature Dev remain visible. Discovery completed in 153 ms for ChatGPT and 170 ms for Claude on the test machine. All 50 discovery/import/lifecycle tests across the four affected server suites and the production server build passed after this change.

Identical standalone connector copies from different projects/configuration files now appear once, with the source application label rather than project names. Comparison stays on the server and uses the same effective source configuration as import, including credentials, permissions, OAuth callback settings and local working-directory context. No configuration fingerprints or secrets are sent to the client. Different setups and project-relative programs remain separate. The four actual identical Claude Linear configurations now produce one `Claude Code` entry. All 53 affected server tests and the production build pass; the duplicate regression failed before the fix.

## Repeatable regression checks

```sh
OPENCODE_TEST_BINARY=/path/to/bundled/opencode pnpm --filter legalwork-server exec bun test src/plugin-imports.test.ts src/plugin-import-checks.test.ts src/plugin-import-runtime.test.ts src/connector-imports.test.ts src/bundled-connector-imports.test.ts src/plugin-import-lifecycle.test.ts src/plugin-import-source.test.ts src/claude-plugin-bundle.e2e.test.ts src/mcp.oauth-flow.e2e.test.ts
node --test apps/desktop/electron/packaged-server-deps.test.mjs
pnpm install --frozen-lockfile
```

Results after the corrections: 87 server/runtime tests passed, 2 desktop dependency checks passed, and the frozen installation passed. Local-source audit and lifecycle checks used the actual installed packages through `discoverPluginImports`, `resolvePluginImports`, `preparePluginImport`, `reviewedPluginImport`, `installPluginImport`, `rollbackPluginImport` and `removeCloudPlugin`, with temporary workspace/configuration paths. No third-party package contents are included in this repository.
