# AI state and Czech/Slovak interface

The application communicates actual provider state and preserves the selected interface language across views and native dialogs.

## Sub-features

- `ai-state`: skipped AI, missing/invalid provider, explicit synthetic connection and declared AI-boundary modes.
- `locales`: Czech and Slovak menus, settings, native dialogs, errors and persistent selection.

## How to get to it (user POV)

Use onboarding and Settings → AI providers; use Settings → Appearance for language. Reopen a real file/folder dialog after switching.

## Driving it with native alpha runner

Preconditions: synthetic profiles with no inherited credentials. Add only explicitly authorized test-provider configuration.

- Inspect missing/invalid provider states, then configure the test provider and wait for an actual completed answer. Revoke it and verify the error state.
- Toggle only the supported AI-boundary setting and exercise its documented behavior in each state. Preserve the existing policy and human confirmations.
- Through the UI, select Czech then Slovak; inspect settings, sidebar, native picker and representative error. Restart and verify the last selection persists.
- Shipping diagnostic navigation actions are `route.settings.providers` and `route.settings.appearance`; `observe()` must still identify the owned instance before use.

## Gotchas

An installed connector, stored key or provider menu is not a verified connection. Public synthetic inference and technical alpha PASS grant no authorization for protected client data.
