# LAWOSS downstream patches

This file records every LAWOSS modification to a file inherited from `eigenweltlabs/legalwork`.

New LAWOSS-owned files do not need an entry. Every pull request that changes an upstream file must add or update its row here.

| Upstream file | LAWOSS change | Reason | Owner | PR |
|---|---|---|---|---|
| `README.md` | LAWOSS project presentation, roadmap, team, safety notes, and upstream attribution | Product identity and contributor orientation | MČ | Initial setup PR |
| `AGENTS.md` | LAWOSS workflow, three-zone model, CZ/SK legal constraints, and upstream sync rules | Sustainable fork governance | MČ | Initial setup PR |
| `apps/app/src/app/index.css` | +1 `@import` (LAWOSS token override after upstream tokens); +3 fontsource imports (Plex Mono 400/500, Playfair); `--chart-1..5` values remapped to brand palette; `--radius` 0.625rem → 0.25rem (squared, issue #22) | Fáza A reskin via cascade, zero structural change | MČ | design/faza-a-tokeny |
| `apps/app/src/app/theme.ts` | Default theme `light` → `dark` (2 fallback returns + comment), value-only | Dark is the designed LAWOSS theme | MČ | design/faza-a-tokeny |
| `apps/app/package.json` | +2 deps: `@fontsource/ibm-plex-mono`, `@fontsource-variable/playfair-display` | Fonts for legal identifiers and the seal | MČ | design/faza-a-tokeny |
| `apps/app/src/index.react.tsx` | +1 import + 1 call `bootstrapLawoss()` (one-time dark migration) before upstream theme bootstrap | Existing profiles stored the old light default | MČ | design/faza-b0-branding |
| `apps/app/src/react-app/shell/shell-config.tsx` | Default `appName`/`sidebarBrandName` `LegalWork` → `LAWOSS` (value-only) | LAWOSS branding | MČ | design/faza-b0-branding |
| `apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx` | Brand mark import → `lawoss/brand/lawoss-mark.svg` (1 line) | LAWOSS branding | MČ | design/faza-b0-branding |
| `apps/app/index.html` | `<title>` `LegalWork` → `LAWOSS` | LAWOSS branding | MČ | design/faza-b0-branding |
| `apps/desktop/electron-builder.yml` | `productName` → `LAWOSS`; icon files in `resources/icons/**` replaced by LAWOSS badge (binary) | LAWOSS branding; `appId` intentionally unchanged (keychain/user-data continuity — separate ADR if ever) | MČ | design/faza-b0-branding |

## Review checklist for upstream sync

- Confirm that every active row still applies after the merge.
- Reapply only the smallest required downstream change.
- Remove rows for patches accepted upstream or no longer needed.
- Add a row before merging any new modification to an upstream file.
