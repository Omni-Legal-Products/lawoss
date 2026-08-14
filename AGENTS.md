# AGENTS.md

LAWOSS is a Czech and Slovak legal practice fork of LegalWork. It helps lawyers run agents, skills, and MCP connectors in a local-first desktop environment.

This file is the single source of truth for people and AI agents working in this repository. `CLAUDE.md` must always contain identical instructions.

## Repository relationship

- Product code lives in this repository.
- Decisions, ADRs, research, specifications, and planning live in [lawOSS-like-SK-CZ](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ). **Both repositories are in the same organisation since 2026-08-14**, so issues can be transferred natively between them.
- The upstream repository is [eigenweltlabs/legalwork](https://github.com/eigenweltlabs/legalwork).
- `origin` must point to `Omni-Legal-Products/lawoss` and `upstream` must point to `eigenweltlabs/legalwork`.
- Sync from upstream release tags, not from arbitrary development commits.

## From idea to implementation

Work reaches this repository **only after it has been decided elsewhere.**

| Repository | What lives there | What does **not** |
|---|---|---|
| [`lawOSS-like-SK-CZ`](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ) | ideas, ADRs, specifications, research, meeting notes — **the source of truth for decisions** | implementation issues, bug reports |
| **`lawoss`** *(this one)* | code, implementation issues and PRs, builds, releases | deciding **whether** a feature gets built |

Rules:

1. An issue here **must link back** to the spec or ADR that authorised it. An implementation issue without that link is missing its decision — open it in the coordination repository instead.
2. **Never copy a spec into this repository.** Link to it. A duplicate drifts.
3. If an issue lands in the wrong repository, do **not** re-create it — use *Issue → ⋯ → Transfer issue*. It works both ways within the organisation and preserves comments and history.
4. Creating these issues is **not automated on purpose**: it would require a PAT stored as a secret for a handful of approved items per week. A human or their agent walks the approved items after each call. Revisit if the volume grows.

## Core philosophy

- **Local-first, cloud-ready:** sensitive legal data should stay on the user's machine unless the user knowingly selects a remote model or worker.
- **Human gate:** an agent may prepare and recommend, but a lawyer must approve legally consequential actions.
- **Portable domain layer:** LAWOSS prompts, skills, templates, and MCP configuration must remain usable outside this fork where practical.
- **Upstream-first:** offer generally useful fixes and localization improvements to LegalWork upstream.
- **Small downstream diff:** prefer adding files to modifying upstream files.

## Three change zones

| Zone | Scope | Rule |
|---|---|---|
| Green | `lawoss/**`, `apps/app/src/i18n/locales/sk.ts`, `apps/app/src/i18n/locales/cs.ts`, LAWOSS documentation | Preferred location for LAWOSS work. Keep CZ and SK structures explicit. |
| Yellow | Branding, icons, locale registration, and exceptional changes to upstream files | Every modified upstream file must be recorded in `PATCHES.md` in the same PR. Keep the table below ten active rows where possible. |
| Red | `legalwork-legalmemory-knowledge`, `apps/server/src/extensions/`, `opencodeVersion` in `constants.json`, history rewrites | Do not change without a new approved ADR in the coordination repository. |

## Git workflow

- The default branch is `dev`, matching upstream.
- Never push directly to `dev`. Every change goes through a pull request.
- Every PR requires at least one approval and passing required checks.
- Use short-lived branches: `feat/*`, `fix/*`, `loc/*`, `sync/*`, or `chore/*`.
- Use Slovak conventional commit messages, for example `feat: pridať založenie spisu`.
- Never force-push shared branches or rewrite published history.
- Before syncing or pushing, fetch both `origin` and `upstream`.
- Upstream sync branches use `sync/upstream-vX.Y.Z` and merge a release tag.
- Version LAWOSS releases as `v<upstream>-lawoss.<n>`.

## Pull request expectations

- Link the approved specification or ADR when the change implements a LAWOSS feature.
- Run relevant tests and report exact commands and results.
- Include a screenshot or short recording for visible UI changes.
- Update `PATCHES.md` whenever an upstream file changes.
- Keep changes focused. Do not mix cleanup or refactoring with requested work.
- Do not merge when CI is failing or when the required review is missing.

## TypeScript and package management

- Use strict TypeScript.
- Never use `any`, typecasts, or `as` unless necessary and justified.
- Prefer functional patterns, short focused functions, DRY, KISS, and YAGNI.
- Use pnpm. Never use npm or yarn.
- Use components from `@/components` when possible.
- Prefer shadcn/ui with Base UI for new components.
- Assume end users are non-technical lawyers.

## Legal and security constraints

- Never commit client data, privileged information, secrets, API keys, certificates, or signing credentials.
- Do not use upstream free models with client, privileged, or matter data.
- Treat technical validity and legal correctness as separate review gates.
- Czech and Slovak legal behavior must be modeled separately where the law differs.
- Do not silently translate Slovak legal concepts into Czech concepts or the reverse.
- Any workflow that sends, signs, files, deletes, or irreversibly changes data requires an explicit human confirmation gate.

## Upstream sync

1. Fetch upstream and tags.
2. Read the upstream release notes.
3. Create `sync/upstream-vX.Y.Z` from `dev`.
4. Merge the exact upstream release tag.
5. Resolve conflicts using `PATCHES.md` as the checklist.
6. Run CI and a desktop smoke test.
7. Open a PR and obtain one approval.
8. Release as `vX.Y.Z-lawoss.1` after merge.

If maintaining a downstream patch becomes disproportionately expensive, prefer removing or redesigning it as a new file or upstream contribution.
