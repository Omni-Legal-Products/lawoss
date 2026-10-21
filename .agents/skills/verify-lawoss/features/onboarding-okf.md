# Onboarding and OKF

A lawyer identifies themselves, optionally skips AI, chooses a folder and confirms the preview before LAWOSS creates a client and matter.

## Sub-features

- `onboarding`: Ty → AI → Folder with truthful provider state.
- `native-picker`: cancellation, reopening and selection through the real system dialog.
- `okf`: ordinary folder conversion and existing OKF recognition; confirmed scaffold with preserved originals.

## How to get to it (user POV)

Use the first-run screen or the sidebar's add-folder/client entry point. Also attach an existing synthetic OKF client.

## Driving it with native alpha runner

Preconditions: a disposable copy of a selected pinned synthetic office/client and a clean or independently migrated profile.

- Enter a synthetic lawyer name, jurisdiction and language. Skip AI and verify no model/provider is silently selected.
- Open and cancel the actual picker. Compare folder contents and workspace registration before/after; neither should change. Reopen and select the fixture.
- Inspect the proposed changes, cancel once, then confirm. Verify the visible client/matter and exact new files with the current OKF CLI; hash original documents before and after.
- Repeat for existing OKF; preserve its documents and recognize its existing identity.

## Gotchas

The historical OKF-choice screen is absent. Programmatic assignment of the directory bypasses the native-picker scenario. A large fixture's ground truth must stay outside the app's selected source.
