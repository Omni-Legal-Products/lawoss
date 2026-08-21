# LAWOSS downstream patches

This file records every LAWOSS modification to a file inherited from `eigenweltlabs/legalwork`.

New LAWOSS-owned files do not need an entry. Every pull request that changes an upstream file must add or update its row here.

| Upstream file | LAWOSS change | Reason | Owner | PR |
|---|---|---|---|---|
| `README.md` | LAWOSS project presentation, roadmap, team, safety notes, and upstream attribution | Product identity and contributor orientation | MČ | Initial setup PR |
| `AGENTS.md` | LAWOSS workflow, three-zone model, CZ/SK legal constraints, and upstream sync rules | Sustainable fork governance | MČ | Initial setup PR |
| `apps/app/src/react-app/kernel/local-provider.tsx` | Persist the configured attorney name with local preferences | Make DOCX authorship user-configurable | MF | Pending PR |
| `apps/app/src/react-app/domains/settings/pages/shell-view.tsx` | Add the document-author setting to Customization | Give lawyers control over DOCX authorship | MF | Pending PR |
| `apps/app/src/react-app/domains/settings/pages/general-view.tsx` | Mention document authorship in the Customization overview | Make the new setting discoverable | MF | Pending PR |
| `apps/app/src/react-app/domains/settings/shell/settings-page.tsx` | Mention document authorship in the Customization tab description | Make the new setting discoverable | MF | Pending PR |
| `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx` | Pass the configured attorney name into the DOCX editor | Apply the setting to tracked changes and comments | MF | Pending PR |
| `apps/app/src/react-app/domains/session/artifacts/artifact-docx-editor.tsx` | Resolve blank author values to the safe default | Prevent blank authorship metadata | MF | Pending PR |

## Review checklist for upstream sync

- Confirm that every active row still applies after the merge.
- Reapply only the smallest required downstream change.
- Remove rows for patches accepted upstream or no longer needed.
- Add a row before merging any new modification to an upstream file.
