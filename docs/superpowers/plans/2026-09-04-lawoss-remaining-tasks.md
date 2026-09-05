# LAWOSS remaining tasks implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the user-approved LAWOSS fixes for document authorship, one-click/resumable onboarding, team usage guidance, and the OKF review handoff.

**Architecture:** Extend the existing `LocalPreferences` persistence with a small pure document-author helper shared by the React DOCX editor and the Office fallback. Keep onboarding state local to the LAWOSS welcome route and persist only the selected lane/step; reuse the existing folder picker and workspace/provider flow. Add original Markdown handoff documents under `docs/`.

**Tech Stack:** React, TypeScript, Bun tests, Vite, localStorage, Office.js structural types, Markdown.

**Spec:** [`docs/superpowers/specs/2026-09-04-lawoss-remaining-tasks-spec.md`](../specs/2026-09-04-lawoss-remaining-tasks-spec.md)

## Global Constraints

- Preserve the current checkout's unrelated work and do not rewrite existing documents.
- Keep the existing Slovak LAWOSS copy and analytics consent semantics.
- Every new behavior gets a focused test before implementation (TDD).
- Verify with focused Bun tests, app typecheck, and app build before claiming completion.
- Native Word comments retain Word's current Office identity because the Office API used here does not expose a writable author property; document this limitation precisely.

---

## Task 1: Add a persisted document-author preference

- [x] Add a pure helper that normalizes names, reads the existing preferences payload, and falls back to `LegalWork`.
- [x] Add failing tests for default, trimming, length limiting, invalid payload, and persistence compatibility.
- [x] Add `documentAuthor` to `LocalPreferences` and `INITIAL_PREFS`.
- [x] Add the Personalisation UI field and save behavior, including the Word identity limitation note.
- [x] Wire the configured name into `ArtifactDocxEditor` and the Office OOXML revision fallback.
- [x] Add/adjust tests for the generated OOXML author value.

## Task 2: Make LAWOSS onboarding explicit and resumable

- [x] Add failing tests for the two onboarding lanes and the persisted last step.
- [x] Add a small pure onboarding-state helper with safe parsing and a versioned localStorage key.
- [x] Update `LawossWelcomePage` to show a recommended lane and a detailed lane, with the detailed folder route exposed only when selected.
- [x] Persist lane/step selection from `WelcomeRoute`; resume it after reload without changing workspace creation semantics.
- [x] Remove the internal TODO/coordination copy from the user-facing welcome screen.
- [x] Add focused regression tests for the helper and check responsive styling against existing LAWOSS tokens.

## Task 3: Publish team handoff artifacts

- [x] Add `docs/lawoss-usage.md` with first-use, ordinary-work, and advanced-agent guidance.
- [x] Add `docs/lawoss-okf-review-checklist.md` with D1-D9/O1/O2/O6 questions and MVP acceptance criteria.
- [x] Ensure the documents distinguish implemented behavior from decisions still requiring team approval.

## Task 4: Verify and share

- [x] Run focused tests, app typecheck, and app build.
- [x] Inspect the final diff and remove accidental changes.
- [x] Commit on `codex/mf-remaining-tasks` with a clear message.
- [x] Push the branch to `origin` so the team can inspect it and create/update a PR if repository credentials permit.
