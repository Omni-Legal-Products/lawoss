# LAWOSS downstream patches

This file records every LAWOSS modification to a file inherited from `eigenweltlabs/legalwork`.

New LAWOSS-owned files do not need an entry. Every pull request that changes an upstream file must add or update its row here.

| Upstream file | LAWOSS change | Reason | Owner | PR |
|---|---|---|---|---|
| `README.md` | LAWOSS project presentation, roadmap, team, safety notes, and upstream attribution | Product identity and contributor orientation | MČ | Initial setup PR |
| `AGENTS.md` | LAWOSS workflow, three-zone model, CZ/SK legal constraints, and upstream sync rules | Sustainable fork governance | MČ | Initial setup PR |
| `apps/app/src/app/index.css` | +1 `@import` (LAWOSS token override after upstream tokens); +3 fontsource imports (Plex Mono 400/500, Playfair); `--chart-1..5` values remapped to brand palette | Fáza A reskin via cascade, zero structural change | MČ | design/faza-a-tokeny |
| `apps/app/src/app/theme.ts` | Default theme `light` → `dark` (2 fallback returns + comment), value-only | Dark is the designed LAWOSS theme | MČ | design/faza-a-tokeny |
| `apps/app/package.json` | +2 deps: `@fontsource/ibm-plex-mono`, `@fontsource-variable/playfair-display` | Fonts for legal identifiers and the seal | MČ | design/faza-a-tokeny |

## Review checklist for upstream sync

- Confirm that every active row still applies after the merge.
- Reapply only the smallest required downstream change.
- Remove rows for patches accepted upstream or no longer needed.
- Add a row before merging any new modification to an upstream file.
