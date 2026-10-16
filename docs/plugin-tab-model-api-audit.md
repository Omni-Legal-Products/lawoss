# Plugins tab and model-api support

Reviewed October 13, 2026 against freshly fetched `model-api` **origin/main**, commit [`598d396803fe3ebbe903c0b45f5ddbec65478030`](https://github.com/eigenweltlabs/model-api/commit/598d396803fe3ebbe903c0b45f5ddbec65478030). The local model-api checkout is behind that commit and has unrelated work in progress; this audit reads the remote commit directly without checking out or modifying its files.

## Desktop change

Integrations now has **Plugins / Connectors / Skills / File storage**, using the existing HubTabs, search/source controls, toolbar and library rows. Plugins lists imported workflow bundles and their named contents. Standalone skill and connector import records stay out of this list. The global Imported packages manager remains available for all import records, including standalone imports, preserving their complete uninstall path. Engine plugins are available only through a developer-mode More action, separate from workflow bundles.

The desktop uses its existing local package registry and install/remove API. No model-api change is required for this local library. Complete bundle imports open Plugins; standalone skills open Skills; a single connector opens its setup as before. Updates use the existing previewed reimport flow. The library exposes no plugin-wide switch because the runtime does not yet implement one.

## What latest model-api main supports

- The database enum and generic Hub API already accept `plugin`; a new table or enum value is not automatically necessary. The documented payload is an engine spec (`{ spec }`) or engine files (`{ files }`). [Database schema](https://github.com/eigenweltlabs/model-api/blob/598d396803fe3ebbe903c0b45f5ddbec65478030/apps/platform/src/db/schema.ts#L281).
- The admin's Integrations tabs contain Connectors and Skills. `plugin` is excluded from `ADDABLE_KINDS`, so an admin cannot provision one with automatic/optional installation. The source explicitly reserves engine plugins for developers. [Hub kinds and tabs](https://github.com/eigenweltlabs/model-api/blob/598d396803fe3ebbe903c0b45f5ddbec65478030/apps/platform/src/lib/hub-kinds.ts#L24).
- Admin payload validation covers connectors, skills/workflows and review sets. It has no workflow-plugin bundle schema. [Payload validation](https://github.com/eigenweltlabs/model-api/blob/598d396803fe3ebbe903c0b45f5ddbec65478030/apps/platform/src/services/hub-items.ts#L60).
- LegalWork's managed Firm Hub catalogue includes connectors, skills, workflows and review sets, excluding plugins. Its older `plugin` installation route calls the engine plugin installer or writes engine files to `.opencode/plugins`; it does not register a workflow bundle's skills, connectors, agents and commands. See `packages/types/src/firm-hub.ts`, `apps/server/src/firm-hub.ts` and the plugin branch of `apps/server/src/server.ts`.

## Changes needed for team workflow plugins

1. Define a versioned workflow-bundle payload distinct from legacy engine specs/files. Keep existing engine records compatible. Validate the bundle manifest, source paths, sizes and supported components; inspect decoded connector configuration so credentials stay outside the shared bundle.
2. Add a platform Plugins tab and bundle upload/review form. Permit this bundle format through admin publishing with the existing automatic/optional installation, organization permissions and subscription controls. Extending the current validation requires a dedicated plugin schema rather than the skill-schema fallback.
3. Add workflow bundles to LegalWork's managed Firm Hub catalogue. Route their installation through the existing package import/install pipeline with a stable team identity, component ownership and compatibility preview, instead of the engine-code installer. Retain individual connector authentication.
4. Implement team update/removal across the entire bundle: prune removed components, restore the prior version on failure, and enforce automatic versus optional membership consistently. Reflect that state in the Plugins library and the owned Skills/Connectors rows.

Until that coordinated work exists, selecting Team in the desktop Plugins library explicitly says team plugins are not available. It does not offer the legacy engine installer as a workflow-bundle installation path. This change does not modify or deploy model-api.
