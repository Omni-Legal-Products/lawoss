# LAWOSS downstream patches

This file records every LAWOSS modification to a file inherited from `eigenweltlabs/legalwork`.

New LAWOSS-owned files do not need an entry. Every pull request that changes an upstream file must add or update its row here.

| Upstream file | LAWOSS change | Reason | Owner | PR |
|---|---|---|---|---|
| `README.md` | LAWOSS project presentation, roadmap, team, safety notes, and upstream attribution; +1 link to the alpha tester build guide (`docs/lawoss-build-pre-testerov.md`) | Product identity and contributor orientation; alpha is distributed as a self-compiled build, not a signed artifact | MČ | Initial setup PR; PR #39 adds the handoff index; plan/branding-pass-a-alfa |
| `AGENTS.md` | LAWOSS workflow, three-zone model, CZ/SK legal constraints, and upstream sync rules | Sustainable fork governance | MČ | Initial setup PR |
| `apps/app/src/app/index.css` | +1 `@import` (LAWOSS token override after upstream tokens); +3 fontsource imports (Plex Mono 400/500, Playfair); `--chart-1..5` values remapped to brand palette; `--radius` 0.625rem → 0.25rem (squared, issue #22) | Fáza A reskin via cascade, zero structural change | MČ | design/faza-a-tokeny |
| `apps/app/src/app/theme.ts` | Default theme `light` → `dark` (2 fallback returns + comment), value-only | Dark is the designed LAWOSS theme | MČ | design/faza-a-tokeny |
| `apps/app/package.json` | +2 deps: `@fontsource/ibm-plex-mono`, `@fontsource-variable/playfair-display` | Fonts for legal identifiers and the seal | MČ | design/faza-a-tokeny |
| `apps/app/src/index.react.tsx` | +1 import + 1 call `bootstrapLawoss()` (one-time dark migration) before upstream theme bootstrap | Existing profiles stored the old light default | MČ | design/faza-b0-branding |
| `apps/app/src/react-app/shell/shell-config.tsx` | Default `appName`/`sidebarBrandName` `LegalWork` → `LAWOSS` (value-only) | LAWOSS branding | MČ | design/faza-b0-branding |
| `apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx` | Brand mark import → `lawoss/brand/lawoss-mark.svg` (1 line); recorder nav položka zaguardovaná `HIDDEN_SETTINGS_TABS.has("recorder")` (+1 import, +1 podmienka) | LAWOSS branding; recorder je skrytá komerčná plocha — skrytá bola len záložka v nastaveniach, samotná funkcia ostávala jeden klik od session | MČ | design/faza-b0-branding; plan/branding-pass-a-alfa |
| `apps/app/src/react-app/domains/settings/shell/settings-page.tsx` | `getGlobalSettingsTabs()`: +`"appearance"` v zozname (1 riadok + komentár); vracia `hideCommercialTabs(tabs)` (+1 import, +1 riadok) | Appearance/Language je pre LAWOSS core (dark téma + sk/cs locale); skryť účet a recorder bez mazania upstream kódu | MČ | design/faza-b1-registre; plan/branding-pass-a-alfa |
| `apps/app/src/react-app/shell/welcome-route.tsx` | Import `WelcomePage` presmerovaný na `lawoss/domains/onboarding/lawoss-welcome-page` (1 riadok) | Uvítacia obrazovka v LAWOSS farbách a po slovensky; upstream stránka ostáva nedotknutá | MF | feat/uvitacia-obrazovka |
| `apps/desktop/electron/updater.mjs` | Feedy: stable → `lawoss.app/update`, alpha + fallback → `Omni-Legal-Products/lawoss` releases; `isUnstampedLocalBuild()` preskočí kontrolu pri verzii `0.0.0` | Upstream feed by fork prepísal LegalWorkom (rovnaké appId); lokálny build videl každý release ako novší | MČ | fix/experimenty-layout-a-updater |
| `apps/desktop/electron/updater.test.mjs` | Tracked feed sa číta z `ELECTRON_UPDATER_FEEDS.stable` namiesto literálu (+1 test na `0.0.0`) | Aby presmerovanie feedu nerozbilo upstream testy | MČ | fix/experimenty-layout-a-updater |
| `apps/app/index.html` | `<title>` `LegalWork` → `LAWOSS` | LAWOSS branding | MČ | design/faza-b0-branding |
| `apps/desktop/electron-builder.yml` | `productName` → `LAWOSS`; publisher → `Omni-Legal-Products/lawoss`; icon files in `resources/icons/**` replaced by LAWOSS badge (binary); `artifactName` `legalwork-` → `lawoss-` (value-only) | LAWOSS branding and fork-owned updater metadata; `appId` intentionally unchanged (keychain/user-data continuity — separate ADR if ever) | MČ | fix/updater-release-assets; plan/branding-pass-a-alfa |
| `scripts/release/ship.mjs` | Default GitHub repository → `Omni-Legal-Products/lawoss` in release links and workflow watch | Release helper must ship and monitor the LAWOSS fork, not upstream LegalWork | MF | fix/updater-release-assets |
| `apps/app/src/i18n/index.ts` | +`applyBrandName()`, +`BRAND_EXEMPT_KEYS`, substitúcia `LegalWork` → `LAWOSS` v `t()` pred dosadením parametrov | Branding bez prepisovania 229 upstream reťazcov; nové upstream reťazce pokryté automaticky | MČ | plan/branding-pass-a-alfa |
| `apps/desktop/package.json` | +1 súbor v skripte `test` (`electron/artifact-name.test.mjs`) | Aby sa názov artefaktov nemohol ticho vrátiť | MČ | plan/branding-pass-a-alfa |
| `apps/app/src/app/constants.ts` | `MCP_QUICK_CONNECT` premenované na `MCP_QUICK_CONNECT_ALL`, priamo exportované (upstream nefiltrovaný zoznam), a znovu exportované aj pod pôvodným menom `MCP_QUICK_CONNECT` cez filter `isHiddenQuickConnect` (+1 import) | LegalMemory sa neponúka na pripojenie; jeho subsystém tým ostáva nečinný bez guardov na ~25 miestach; unfiltered export umožňuje upstream testom čítať katalóg pred filtrovaním | MČ | plan/branding-pass-a-alfa |
| `apps/app/tests/mcp-catalog-auth.test.ts` | Test „LegalMemory discovers auth requirements for its firm's deployment" vrátený doslovne (obe pôvodné asercie); zdroj dát prepnutý z filtrovaného `MCP_QUICK_CONNECT` na nefiltrované `MCP_QUICK_CONNECT_ALL`, keďže test overuje auth-dáta záznamu, nie viditeľnosť v katalógu | Test overuje dáta katalógovej položky, nie jej viditeľnosť — tú kryje samostatne `apps/app/tests/lawoss-quick-connect.test.ts`; pôvodná asercia sa nemala mazať | MČ | plan/branding-pass-a-alfa |
| `apps/app/src/react-app/domains/settings/pages/hub-scope-context.tsx` | `HubScopeToggle` (Local/Team prepínač) vracia `null`, keď je `firm-hub` skrytý (+1 import, +1 riadok) — pokrýva iba tento prepínač, nie zvyšok firm-hub plochy; upsell kartu v `hub-download-section.tsx` gatuje samostatný guard (pozri jeho riadok) | Firemné zdieľanie je platená plocha upstreamu | MČ | plan/branding-pass-a-alfa |
| `apps/app/src/react-app/domains/session/surface/session-surface.tsx` | `trialEndedNoticeVisible` zohľadňuje `isCommercialSurfaceHidden("trial-notice")` (+1 import, +1 riadok) | Výzva na predplatné dodávateľa upstreamu nepatrí do LAWOSS | MČ | plan/branding-pass-a-alfa |
| `apps/app/src/react-app/shell/transcription-intro.tsx` | `TranscriptionIntroDialog` sa nikdy nezobrazí, keď je `HIDDEN_SETTINGS_TABS.has("recorder")` (+1 import, +1 riadok v efekte) | Prvorunové vysvetlenie propaguje presne tú funkciu (recorder), ktorú LAWOSS skrýva | MČ | plan/branding-pass-a-alfa |
| `apps/app/src/react-app/domains/settings/pages/general-view.tsx` | `resolveGlobalItems()` prefiltrovaný cez `HIDDEN_SETTINGS_TABS` (+1 import, +1 filter) | `Nastavenia → General` mal vlastný, neprefiltrovaný zoznam položiek vedúcich cez `onNavigateTab` priamo do skrytých panelov (account, recorder); `hideCommercialTabs()` filtrovala iba `getGlobalSettingsTabs()`, nie tento zoznam | MČ | plan/branding-pass-a-alfa |
| `apps/app/src/react-app/domains/settings/pages/hub-download-section.tsx` | Upsell karta na Eigenwelt Plus sa nezobrazí, keď je `isCommercialSurfaceHidden("firm-hub")` (+1 import, +1 podmienka) | `connected` je viazané na lokálneho sidecar klienta, nie na Eigenwelt účet — v bežnom behu je pravdivé pre každého testera, takže sa bez guardu vyrenderovala výzva na predplatné, ktoré nemá zmysel ponúkať; mountuje sa na piatich miestach v nastaveniach, guard v zdieľanej komponente rieši všetky naraz | MČ | plan/branding-pass-a-alfa |
| `package.json` | +`engines.node`: `">=24.0.0 <25.0.0"`, zodpovedá `.nvmrc` (`24`) a `node-version: 24` vo všetkých `.github/workflows/*.yml`; `packageManager` (pnpm pin) ostáva nezmenené | Bez toho klonovanie na novšom Node (napr. v26.7.0) padá na kryptickej `node-gyp` chybe pri `better-sqlite3` namiesto zrozumiteľného varovania od pnpm | MČ | plan/branding-pass-a-alfa |
| `packages/types/src/desktop-ipc.ts` | +typy `AutogramStatus`/`AutogramOpenResult` a +2 záznamy v `DesktopCommandMap` (`autogramStatus`, `autogramOpen`) | Zdieľaný kontrakt pre desktop bridge potrebný na detekciu/otvorenie Autogramu z Integrations karty | MČ | feat/autogram-teaser |
| `apps/desktop/electron/main.mjs` | +2 handlery v `desktopCommandHandlers` (`autogramStatus`, `autogramOpen`): skenujú `/Applications` a `~/Applications` pre `Autogram.app` (iba `process.platform === "darwin"`) a vedia appku otvoriť cez `shell.openPath` | Detekcia a otvorenie samostatnej appky Autogram cez `shell.openPath` bez riadenia jej procesu alebo výmeny dát | MČ | feat/autogram-teaser |
| `apps/app/src/react-app/domains/settings/pages/extensions-view.tsx` | Connectors tab renderuje `<AutogramIntegrationCard />` (LAWOSS, `apps/app/src/lawoss/domains/integrations/`) nad `props.mcpView` (+1 import, +4 riadky JSX) | Predstaviť existujúcu appku Autogram v Integrations bez tvrdenia, že prepojenie s LAWOSS už funguje | MČ | feat/autogram-teaser |
| `apps/app/src/i18n/locales/en.ts` | +15 kľúčov `autogram.*` (Autogram teaser karta v Integrations, vrátane loading a chybového stavu) | Anglický zdroj pre i18n fallback; sk/cs preklady sú vlastné LAWOSS súbory bez záznamu | MČ | feat/autogram-teaser |
| `apps/app/src/i18n/locales/de.ts` | +15 kľúčov `autogram.*` (formálne „Sie“, bez pomlčiek) | `scripts/i18n-check.ts` vyžaduje pre `de` plné pokrytie kľúčov z `en.ts` | MČ | feat/autogram-teaser |
| `apps/app/scripts/i18n-check.ts` | `"autogram.title"` pridaný do `GERMAN_KEEPS_ENGLISH` (produktový názov) | „Autogram“ je názov produktu tretej strany, nemá nemecký preklad | MČ | feat/autogram-teaser |

## Review checklist for upstream sync

### v0.1.18 integration (2026-09-10)

Merged exact upstream tag `v0.1.18` (`336270d`) onto LAWOSS `ec0f4c1`. LAWOSS-owned domain and theme files remain intact. The new upstream design-system import precedes LAWOSS token overrides. Existing patch rows above remain active; additional inherited hooks below complete the sync checklist.

| Upstream files | Preserved downstream behavior |
|---|---|
| `apps/app/src/i18n/index.ts`, `apps/app/scripts/i18n-check.ts` | Keep SK/CZ registered alongside EN/DE and system detection; validate supplied translations while retaining explicit English fallback for partial SK/CZ locales. |
| `apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx`, `apps/app/src/react-app/shell/app-root.tsx` | Keep LAWOSS navigation, routes and brand mark with upstream Evals and reactive locale support. |
| `apps/app/src/react-app/domains/session/artifacts/artifact-docx-editor.tsx`, `artifact-panel.tsx` in the same directory | Preserve configured document author with upstream recovery, dirty-document handling and live editor tools. |
| `apps/app/src/react-app/domains/settings/pages/personalisation-view.tsx`, `apps/app/src/react-app/kernel/local-provider.tsx` | Preserve document-author preference and normalization with upstream thinking-default migration. |
| `apps/app/src/react-app/domains/settings/shell/settings-page.tsx`, `apps/app/src/react-app/shell/welcome-route.tsx` | Keep Appearance and LAWOSS onboarding while adopting Extensions settings and upstream analytics lifecycle. |
| `apps/desktop/resources/icons/**`, `apps/desktop/electron-builder.yml` | Keep LAWOSS icons and use LAWOSS artwork for the newly packaged dark dock icon. |

The existing Word add-in changes, OKF modules, updater feeds, release customization and application tests are retained from the fork. No new LAWOSS behavior is introduced into the upstream extension implementation.

- Confirm that every active row still applies after the merge.
- Reapply only the smallest required downstream change.
- Remove rows for patches accepted upstream or no longer needed.
- Add a row before merging any new modification to an upstream file.

### Unified experiments shell (2026-09-10)

- `apps/app/src/react-app/shell/app-root.tsx`: render LAWOSS routes through the same SessionRoute/DevProfiler tree as sessions.
- `apps/app/src/react-app/shell/session-route.tsx`: use the existing mainView slot for experiment content and reset auxiliary panes on route changes. The original sidebar, workspace actions, resizing, titlebar and status bar remain shared.
- `apps/app/src/react-app/shell/use-workspace-route-state.ts`: optional preserveRoute keeps non-session experiment URLs from being replaced by session restoration or first-run redirects; existing session onboarding behavior is unchanged.
- `apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx`: pass active pane state to LAWOSS navigation to prevent simultaneous active indicators.

### Selected identity B (2026-09-10)

MČ selected variant B from the supplied original references; decision recorded in the coordination repository under `assets/brand/loga-2026-09-10/README.md`.
- `apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx`: use the existing white vector wordmark for the default LAWOSS brand, keeping custom brand names and logos supported.
- `apps/app/public/legalwork-mark.svg`, `favicon-16x16.png`, `favicon-32x32.png`, `apple-touch-icon.png`: generated from the selected portico source.
- `apps/desktop/resources/icons/**`: regenerate production and development macOS/Windows/runtime icons from the selected LAWOSS B mark. Icon source now matches generated files.
