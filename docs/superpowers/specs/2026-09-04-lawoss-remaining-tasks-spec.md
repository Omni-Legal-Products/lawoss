# LAWOSS: remaining tasks delivery specification

## Goal

Deliver the highest-value unfinished items identified in the LAWOSS team export:

1. let each lawyer configure the name shown on document tracked changes;
2. turn the LAWOSS welcome screen into a resumable, two-lane onboarding flow;
3. publish concise original usage guidance for the team; and
4. capture the OKF architecture review decisions so the team can finish the review without rediscovering the same questions.

## Requirements

### Document author

- Store a trimmed document-author name in the existing local preferences store.
- Use `LegalWork` as the backwards-compatible default.
- Expose the setting in Personalisation with a clear explanation that it affects new tracked changes and comments in the in-app DOCX editor.
- Apply the configured name to new tracked revisions in the DOCX editor and the Office fallback OOXML path.
- Preserve existing documents and existing revisions; changing the preference is not a retroactive rewrite.
- Do not claim that native Word comments can be renamed when the Office API does not expose a setter for that identity. Explain that native Word comments use Word's current Office identity.

### Onboarding

- The first screen must offer an explicit recommended path with safe defaults.
- A secondary detailed path must reveal the existing manual/developer folder route without blocking the recommended path.
- The welcome flow must remember the selected lane and the last unfinished step locally so a reload can resume it.
- The existing workspace creation and provider connection flow remains the source of truth for actual setup; onboarding must not silently invent providers or write files.
- Keep the Slovak copy and existing privacy consent behavior.

### Team guidance

- Add original, concise instructions for first use, a normal legal-work session, and advanced agent/MCP use.
- Add an OKF review checklist covering D1-D9 and O1/O2/O6 with explicit MVP acceptance questions.
- Avoid presenting these documents as completed architectural decisions; they are team review artifacts.

## Non-goals

- No automatic provider/API-key setup.
- No changes to the upstream coordination repository or external PR contents.
- No migration or rewriting of existing DOCX tracked changes.
