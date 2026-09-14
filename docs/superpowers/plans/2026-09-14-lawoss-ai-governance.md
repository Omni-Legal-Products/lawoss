# LAWOSS AI governance onboarding and integrations Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add source-aligned AI handling guidance, explainable subscription detection, integrated settings reminders, and governed private MCP catalog entries to the latest LAWOSS app.

**Architecture:** Add a small pure LAWOSS domain module for AI data regimes and subscription detection. Persist only the lawyer’s selected regime and acknowledgement in the existing local preference store; derive subscription state from the already-live Eigenwelt entitlement query and provider list. Reuse one React guidance panel in the welcome page, AI settings and Integrations, and extend the existing deterministic marketplace catalog with private, source-pinned Gravity entries without inventing a registry upload.

**Tech Stack:** React, TypeScript, Bun tests, Vite, existing `LocalProvider`, React Query, LAWOSS token overrides, existing Firm Hub client and marketplace catalog.

**Spec:** `docs/superpowers/specs/2026-09-14-lawoss-ai-governance-spec.md`

## Global Constraints

- Base all work on remote `dev` revision `790a86c`.
- Preserve LAWOSS’s existing Slovak onboarding copy and analytics-consent semantics.
- Keep local/on-premise, DPA-backed provider use, and client-consent use distinct; never infer one from a subscription plan.
- Do not send, store, or commit client data, provider secrets, API keys, or OAuth tokens.
- Keep “unknown” and “review” states visible; do not label them verified.
- Every production behavior change gets a focused failing test first.
- Use existing `@/components/ui` primitives and LAWOSS semantic tokens; do not introduce a parallel card/button system.
- Update `PATCHES.md` for every changed upstream-owned file.
- Verify with focused Bun tests, app typecheck, app build, `git diff --check`, and visual review of the changed screens.

---

### Task 1: Pure AI policy and subscription detection

**Files:**
- Create: `apps/app/src/lawoss/domains/ai-guidance/ai-guidance-state.ts`
- Test: `apps/app/tests/lawoss-ai-guidance-state.test.ts`

**Interfaces:**
- Produces `AiDataRegime`, `SubscriptionType`, `SubscriptionDetectionInput`, `SubscriptionDetection`, `normalizeAiDataRegime`, `detectSubscriptionType`, `aiRegimeNeedsDpa`, and `aiRegimeNeedsClientConsent`.

- [x] **Step 1: Write failing tests** for safe parsing and detection:

```ts
expect(normalizeAiDataRegime("dpa")).toBe("dpa");
expect(normalizeAiDataRegime("provider")).toBeNull();
expect(aiRegimeNeedsDpa("dpa")).toBe(true);
expect(aiRegimeNeedsClientConsent("consent")).toBe(true);
expect(detectSubscriptionType({ eigenweltConnected: true, plan: "pro", subscriptionStatus: "active", premiumModels: true, connectedProviderIds: [] }).type).toBe("eigenwelt-pro");
expect(detectSubscriptionType({ eigenweltConnected: true, plan: "hub", subscriptionStatus: "active", premiumModels: false, connectedProviderIds: [] }).type).toBe("eigenwelt-hub");
expect(detectSubscriptionType({ eigenweltConnected: false, plan: null, subscriptionStatus: null, premiumModels: false, connectedProviderIds: ["openai"] }).type).toBe("byo");
expect(detectSubscriptionType({ eigenweltConnected: true, plan: null, subscriptionStatus: null, premiumModels: false, connectedProviderIds: [] }).type).toBe("unknown");
```

- [x] **Step 2: Run the focused test and confirm it fails** because the helper module does not exist.

- [x] **Step 3: Implement the minimal pure helper**. Treat `active`, `trialing`, and `past_due` as entitled statuses only when the entitlement payload also identifies the plan; return `confidence: "high"` for valid Eigenwelt plans, `"medium"` for BYO, and `"low"` for unknown. Do not include a DPA or hosting conclusion in the return value.

- [x] **Step 4: Run the focused test and confirm it passes.**

- [x] **Step 5: Commit** with `feat: add lawoss ai policy detection`.

### Task 2: Persist the lawyer’s AI handling choice

**Files:**
- Modify: `apps/app/src/react-app/kernel/local-provider.tsx`
- Test: `apps/app/tests/lawoss-ai-guidance-state.test.ts`

**Interfaces:**
- `LocalPreferences` gains `aiDataRegime: AiDataRegime | null` and `aiGuidanceAcknowledgedAt: string | null`.
- Existing preference payloads remain valid through defaults and normalisation.

- [x] **Step 1: Extend the failing state tests** to assert that the default regime is `null`, an old payload receives `null`, and an invalid persisted value normalises to `null`.

- [x] **Step 2: Run the focused test and confirm the new assertions fail.**

- [x] **Step 3: Add the fields to `INITIAL_PREFS` and normalise them in the existing `LocalProvider` initialiser.** Do not change analytics consent or onboarding completion behavior.

- [x] **Step 4: Run the focused state tests and confirm all pass.**

- [x] **Step 5: Commit** with `feat: persist lawoss ai handling choice`.

### Task 3: Build the reusable guidance panel and onboarding integration

**Files:**
- Create: `apps/app/src/lawoss/domains/ai-guidance/ai-guidance-panel.tsx`
- Modify: `apps/app/src/lawoss/domains/onboarding/lawoss-welcome-page.tsx`
- Modify: `apps/app/src/react-app/shell/welcome-route.tsx`
- Modify: `apps/app/src/i18n/locales/en.ts`
- Modify: `apps/app/src/i18n/locales/sk.ts`
- Modify: `apps/app/src/i18n/locales/cs.ts`
- Test: `apps/app/tests/lawoss-ai-guidance-ui-contract.test.ts`

**Interfaces:**
- `AiGuidancePanel` accepts `regime`, `onRegimeChange`, `acknowledged`, `onAcknowledgedChange`, `subscription`, and `variant: "onboarding" | "settings" | "compact"`.
- `LawossWelcomePage` receives the persisted regime and acknowledgement callbacks from `WelcomeRoute`.

- [x] **Step 1: Write failing source-contract tests** for the panel’s three regimes, DPA reminder, human-verification wording, unknown subscription state, and prohibition on “AI lawyer” positioning.

- [x] **Step 2: Run the UI contract test and confirm it fails.**

- [x] **Step 3: Implement the panel** with existing field, checkbox, badge and button primitives. Use concise Slovak copy with English and Czech translations. The onboarding variant is skippable and does not block workspace creation; if no regime is chosen, show a visible reminder to complete it before entering protected matter data.

- [x] **Step 4: Wire the panel into `LawossWelcomePage`** and update `WelcomeRoute` to read/write the two local preferences. Acknowledgement stores an ISO timestamp; unchecking clears it.

- [x] **Step 5: Run the contract tests and the existing onboarding tests.**

- [x] **Step 6: Commit** with `feat: add lawoss ai guidance onboarding`.

### Task 4: Wire AI settings and Integrations

**Files:**
- Modify: `apps/app/src/react-app/domains/settings/pages/ai-view.tsx`
- Modify: `apps/app/src/react-app/domains/settings/pages/extensions-view.tsx`
- Modify: `apps/app/src/react-app/shell/settings-route.tsx`
- Test: `apps/app/tests/lawoss-ai-settings-wiring.test.ts`
- Modify: `PATCHES.md`

**Interfaces:**
- `AiSettingsView` accepts `aiGuidanceView?: ReactNode`.
- `ExtensionsView` accepts `aiPolicyNotice?: ReactNode` and renders it above the connector surface.
- `settings-route.tsx` derives `SubscriptionDetection` from `firmEntitlementsQuery.data`, `eigenweltConnected`, and `providerConnectedIds`, then supplies the same policy panel to AI and a compact notice to Integrations.

- [x] **Step 1: Write failing source-contract tests** that assert the route passes the guidance view to AI settings, the compact notice to Integrations, and derives subscription data from the live entitlement query/provider list.

- [x] **Step 2: Run the wiring test and confirm it fails.**

- [x] **Step 3: Add the props and render locations** without altering provider connection, Firm Hub entitlement gating, or existing Local/Team navigation.

- [x] **Step 4: Add route-level state callbacks** for changing the regime and acknowledgement using `local.setPrefs`, and include the plan detector’s result in both panel instances.

- [x] **Step 5: Run wiring, settings, onboarding, and marketplace tests.**

- [x] **Step 6: Commit** with `feat: wire lawoss ai guidance into settings`.

### Task 5: Add governed private Gravity MCP catalog entries

**Files:**
- Modify: `apps/app/src/lawoss/domains/marketplace/catalog.ts`
- Modify: `apps/app/src/lawoss/domains/marketplace/marketplace-page.tsx`
- Test: `apps/app/tests/lawoss-marketplace.test.ts`
- Modify: `docs/marketplace.md`
- Modify: `PATCHES.md` if an upstream-owned file is touched

**Interfaces:**
- Add a private catalog entry for the source-pinned Gravity legal MCP suite using repository `BiggusDicckkus/MCP-05.2026` and ref `e21e2d7`.
- The entry must use `channel: "private"`, `verification.status: "review"`, `install.action: "preview-only"`, and explicit read-only/network capabilities.

- [x] **Step 1: Write failing marketplace tests** for the private Gravity entry, pinned source/ref, review status, and absence of any claim that it was uploaded or installed.

- [x] **Step 2: Run the marketplace tests and confirm they fail.**

- [x] **Step 3: Add the private entry and a Marketplace page note** explaining that the current organisation registry endpoint is unavailable and that publication is currently performed through the authenticated Firm Hub share flow from Settings > Integrations.

- [x] **Step 4: Run the marketplace tests and confirm they pass.**

- [x] **Step 5: Commit** with `feat: catalogue private gravity mcp suite`.

### Task 6: Verify, visually review and hand off

**Files:**
- Modify: `docs/superpowers/plans/2026-09-14-lawoss-ai-governance.md` to mark completed steps.
- Create: `docs/design/mockups/2026-09-14-ai-governance/` image assets generated after the approved design.

- [x] **Step 1: Install dependencies in the isolated worktree** with `pnpm install --frozen-lockfile` if needed.

- [x] **Step 2: Run focused tests, app typecheck, app build, i18n checks, and `git diff --check`.**

- [x] **Step 3: Generate the approved four-screen raster mockup board with ChatGPT Imagine**: onboarding AI handling, AI provider/DPA settings, Integrations/MCP private catalog, and compliance detail/audit direction. Use LAWOSS’s dark desk, warm paper ink, squared rules, restrained gold stamp accent, IBM Plex typography, and human-review language. Copy the generated asset into the project mockup folder without including client data or secrets.

- [x] **Step 4: Review the AI settings, Integrations and Marketplace screens in the local app, checking accessibility state and interactive guidance changes.**

- [x] **Step 5: Run the final test suite again, inspect the diff, and check that no external publication was falsely reported.**

- [x] **Step 6: Commit** with `feat: finish lawoss ai governance onboarding`.
