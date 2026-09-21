# LAWOSS downstream patches

This file records every LAWOSS modification to a file inherited from `eigenweltlabs/legalwork`.

New LAWOSS-owned files do not need an entry. Every pull request that changes an upstream file must add or update its row here.

| Upstream file | LAWOSS change | Reason | Owner | PR |
|---|---|---|---|---|
| `README.md` | LAWOSS project presentation, roadmap, team, safety notes, and upstream attribution; +1 link to the alpha tester build guide (`docs/lawoss-build-pre-testerov.md`); sekcia Autogram (samostatná macOS appka) s ikonkou | Product identity and contributor orientation; alpha is distributed as a self-compiled build, not a signed artifact | MČ | Initial setup PR; PR #39 adds the handoff index; plan/branding-pass-a-alfa |
| `AGENTS.md` | LAWOSS workflow, three-zone model, CZ/SK legal constraints, and upstream sync rules | Sustainable fork governance | MČ | Initial setup PR |
| `apps/app/src/app/index.css` | +1 `@import` (LAWOSS token override after upstream tokens); +3 fontsource imports (Plex Mono 400/500, Playfair); `--chart-1..5` values remapped to brand palette; `--radius` 0.625rem → 0.25rem (squared, issue #22) | Fáza A reskin via cascade, zero structural change | MČ | design/faza-a-tokeny |
| `apps/app/src/app/theme.ts` | Default theme `light` → `dark` (2 fallback returns + comment), value-only | Dark is the designed LAWOSS theme | MČ | design/faza-a-tokeny |
| `apps/app/package.json` | +2 deps: `@fontsource/ibm-plex-mono`, `@fontsource-variable/playfair-display` | Fonts for legal identifiers and the seal | MČ | design/faza-a-tokeny |
| `apps/app/src/index.react.tsx` | +1 import + 1 call `bootstrapLawoss()` (one-time dark migration) before upstream theme bootstrap | Existing profiles stored the old light default | MČ | design/faza-b0-branding |
| `apps/app/src/react-app/shell/shell-config.tsx` | Default `appName`/`sidebarBrandName` `LegalWork` → `LAWOSS` (value-only) | LAWOSS branding | MČ | design/faza-b0-branding |
| `apps/app/src/react-app/domains/session/sidebar/app-sidebar.tsx` | Brand mark import → `lawoss/brand/lawoss-mark.svg` (1 line); recorder nav položka zaguardovaná `HIDDEN_SETTINGS_TABS.has("recorder")` (+1 import, +1 podmienka) | LAWOSS branding; recorder je skrytá komerčná plocha — skrytá bola len záložka v nastaveniach, samotná funkcia ostávala jeden klik od session | MČ | design/faza-b0-branding; plan/branding-pass-a-alfa |
| `apps/app/src/react-app/domains/settings/shell/settings-page.tsx` | `getGlobalSettingsTabs()`: +`"appearance"` v zozname (1 riadok + komentár); vracia `hideCommercialTabs(tabs)` (+1 import, +1 riadok) | Appearance/Language je pre LAWOSS core (dark téma + sk/cs locale); skryť účet a recorder bez mazania upstream kódu | MČ | design/faza-b1-registre; plan/branding-pass-a-alfa |
| `apps/app/src/react-app/shell/welcome-route.tsx` | Import `WelcomePage` presmerovaný na `lawoss/domains/onboarding/lawoss-welcome-page` (1 riadok) | Uvítacia obrazovka v LAWOSS farbách a po slovensky; upstream stránka ostáva nedotknutá | MF | feat/uvitacia-obrazovka |
| `apps/desktop/electron/updater.mjs` | Stable feed → `lawoss.app/update`; pri chybe alebo zastaranom výsledku jediný bounded GitHub API výber stabilného app releasu a presný tagový generic provider; uložený check sleduje verziu aj zdroj, takže zlyhaný retained fallback download sa neopakuje; alpha ostáva rolling feed; `0.0.0` sa nekontroluje | `releases/latest` môže patriť orchestrátoru; updater musí vybrať novší publikovaný app release s manifestom a inštalátorom, zachovať provider pre explicitný download, neopakovať mŕtvy fallback a pravdivo odmietnuť chýbajúci stable release ([spec/plan PR #83](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/83)) | MČ, VŘ | fix/experimenty-layout-a-updater; feat/internal-candidate-followup |
| `apps/desktop/electron/updater.test.mjs` | Syntetické regresie pre app-release selection fallback, stale primary, konečný počet pokusov, stable prerelease zákaz, alpha/`0.0.0`; registrované IPC overuje retained aj implicitný fallback download, povolený jeden primary→fallback pokus a reset kanála | Aby sa updater nemohol vrátiť k sidecar `latest`, downgrade alebo opakovanému mŕtvemu fallbacku | MČ, VŘ | fix/experimenty-layout-a-updater; feat/internal-candidate-followup |
| `apps/app/index.html` | `<title>` `LegalWork` → `LAWOSS` | LAWOSS branding | MČ | design/faza-b0-branding |
| `apps/desktop/electron-builder.yml` | `productName` → `LAWOSS`; publisher → `Omni-Legal-Products/lawoss`; icon files in `resources/icons/**` replaced by LAWOSS badge (binary); `artifactName` `legalwork-` → `lawoss-` (value-only) | LAWOSS branding and fork-owned updater metadata; `appId` intentionally unchanged (keychain/user-data continuity — separate ADR if ever) | MČ | fix/updater-release-assets; plan/branding-pass-a-alfa |
| `scripts/release/ship.mjs` | Default GitHub repository → `Omni-Legal-Products/lawoss` in release links and workflow watch | Release helper must ship and monitor the LAWOSS fork, not upstream LegalWork | MF | fix/updater-release-assets |
| `apps/app/src/i18n/index.ts` | +`applyBrandName()`, +`BRAND_EXEMPT_KEYS`, substitúcia `LegalWork` → `LAWOSS` v `t()` pred dosadením parametrov | Branding bez prepisovania 229 upstream reťazcov; nové upstream reťazce pokryté automaticky | MČ | plan/branding-pass-a-alfa |
| `apps/desktop/package.json` | +3 súbory v skripte `test` (`electron/artifact-name.test.mjs`, `electron/window-allowlist.test.mjs`, `scripts/dev-server-identity.test.mjs`) | Aby sa názov artefaktov nemohol ticho vrátiť; aby allowlist okna bežal v CI (skript vymenúva testy explicitne) | MČ, VŘ | plan/branding-pass-a-alfa; fix/okno-len-vlastna-adresa |
| `apps/desktop/scripts/electron-dev.mjs` | +1 import, +1 konštanta `appRoot`; `looksLikeVite()` (sonda `/@vite/client`) nahradená `identifyServer()`/`looksLikeOurVite()` nad upstream endpointom `/__legalwork_dev_server_id`; úvodná sonda pri cudzom serveri na porte vypíše návod (`PORT=… pnpm dev`) a skončí `exit 1`; z `waitForVite()` odstránený fallback „port je otvorený = Vite“; logika je v LAWOSS súbore `scripts/dev-server-identity.mjs` | Skript prijal akýkoľvek Vite na dev porte a odovzdal ho Electronu ako `LEGALWORK_ELECTRON_START_URL`, takže sa v hlavnom okne vykreslila cudzia appka a vlastný dev server sa ani nespustil (#47, bod 3); za vlastný sa teraz považuje len server, ktorý hlási `apps/app` tohto checkoutu | VŘ | fix/electron-dev-vlastny-vite |
| `apps/app/src/app/constants.ts` | `MCP_QUICK_CONNECT` premenované na `MCP_QUICK_CONNECT_ALL`, priamo exportované (upstream nefiltrovaný zoznam), a znovu exportované aj pod pôvodným menom `MCP_QUICK_CONNECT` cez filter `isHiddenQuickConnect` (+1 import) | LegalMemory sa neponúka na pripojenie; jeho subsystém tým ostáva nečinný bez guardov na ~25 miestach; unfiltered export umožňuje upstream testom čítať katalóg pred filtrovaním | MČ | plan/branding-pass-a-alfa |
| `apps/app/tests/mcp-catalog-auth.test.ts` | Test „LegalMemory discovers auth requirements for its firm's deployment" vrátený doslovne (obe pôvodné asercie); zdroj dát prepnutý z filtrovaného `MCP_QUICK_CONNECT` na nefiltrované `MCP_QUICK_CONNECT_ALL`, keďže test overuje auth-dáta záznamu, nie viditeľnosť v katalógu | Test overuje dáta katalógovej položky, nie jej viditeľnosť — tú kryje samostatne `apps/app/tests/lawoss-quick-connect.test.ts`; pôvodná asercia sa nemala mazať | MČ | plan/branding-pass-a-alfa |
| `apps/app/src/react-app/domains/settings/pages/hub-scope-context.tsx` | `HubScopeToggle` (Local/Team prepínač) vracia `null`, keď je `firm-hub` skrytý (+1 import, +1 riadok) — pokrýva iba tento prepínač, nie zvyšok firm-hub plochy; upsell kartu v `hub-download-section.tsx` gatuje samostatný guard (pozri jeho riadok) | Firemné zdieľanie je platená plocha upstreamu | MČ | plan/branding-pass-a-alfa |
| `apps/app/src/react-app/domains/session/surface/session-surface.tsx` | `trialEndedNoticeVisible` zohľadňuje `isCommercialSurfaceHidden("trial-notice")` (+1 import, +1 riadok); `NoModelNotice` nerenderuje tlačidlá „Start free trial“ / „Log in“ / „Upgrade to Plus“, keď je `eigenwelt-trial` skrytý — ostáva len „Pripojiť model“ (+1 podmienka) | Výzva na predplatné dodávateľa upstreamu nepatrí do LAWOSS; lišta bez modelu má viesť k vlastnému poskytovateľovi (Anthropic, OpenRouter, …) | MČ; VŘ | plan/branding-pass-a-alfa; feat/anthropic-a-skryte-komercne-prvky |
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
| `.github/workflows/dco.yml` | Job `dco` beží len pri `github.repository == 'eigenweltlabs/legalwork'` (+1 komentár, +1 riadok `if:`) | Upstream DCO kontrola (#140, `--check-merge-commits`) by zhodila každé PR forku: žiadny LAWOSS commit nemá `Signed-off-by`. Príspevky posielané do upstreamu podpisujeme `git commit -s` podľa jeho `CONTRIBUTING.md` | MČ | sync/upstream-v0.1.21 |
| `apps/app/src/react-app/shell/session-route.tsx` | Obrazovka s plánmi (`ai-plans`): brána `aiPlansGateEnabled` a `aiPlansScreenVisible` zohľadňujú `isCommercialSurfaceHidden("ai-plans")` (+1 import, 2 podmienky); +4-riadkový efekt, ktorý krok onboardingu `"ai"` hneď dokončí | Plány Eigenwelt Plus/Pro LAWOSS neponúka (rozhodnutie MČ 17. 9.); bez efektu by onboarding ostal visieť v kroku `"ai"` a nastavenia by boli nedostupné | MČ | sync/upstream-v0.1.21 |
| `apps/server/src/tasks-api.ts` | `connectedTaskOrgId()` vráti `null`, kým nie je `LAWOSS_EIGENWELT_FIRM_SERVICES=1` (+1 import, +1 riadok) | Úlohy, poznámky a prílohy nesmú po prihlásení do Eigenwelt odísť na ich platformu; tým sa vypne sync, členovia firmy aj zmazanie pri odhlásení. Lokálne úlohy fungujú ďalej | MČ | sync/upstream-v0.1.21 |
| `apps/server/src/file-storage/team.ts` | `TeamStorage.identity()` vráti `null` bez `LAWOSS_EIGENWELT_FIRM_SERVICES=1` (+1 import, +1 riadok) | Tímové pripojenia úložísk by posielali prístupové údaje na platformu Eigenwelt; lokálny rozsah funguje ďalej | MČ | sync/upstream-v0.1.21 |
| `apps/server/src/routes/file-storage.ts` | Zoznam OAuth poskytovateľov filtruje `storageOAuthProviderAllowed()` (+1 import, 1 podmienka): Box len s vlastným `LEGALWORK_STORAGE_BOX_OAUTH_URL` | Box ide pri prihlásení aj pri každom obnovení tokenu cez broker Eigenwelt | MČ | sync/upstream-v0.1.21 |
| `pnpm-workspace.yaml` | pridané `lawoss/*` medzi `packages` (+ zodpovedajúci `pnpm-lock.yaml`) | balíčky `lawoss/okf` a `lawoss/okf-pamat` sú súčasťou pnpm workspace — akčný bod z callu 11. 9. 2026 | VŘ | feat/okf-z-aplikacie-bez-rucnych-krokov |
| `apps/app/tsconfig.json` | +1 riadok `"allowImportingTsExtensions": true` (iba typecheck; `noEmit` už platí, Vite `.ts` prípony rieši sám) | Prehľad a Lehoty čítajú pamäť spisu cez `lawoss/okf-pamat/src/record.ts`, ktorý importuje `./schema.ts` s príponou (balíček beží pod `node --test`, kde je prípona povinná); bez flagu `tsc` hlási TS5097 | VŘ | feat/prehlad-a-lehoty-c1 |
| `apps/app/src/react-app/domains/recorder/premium-upsell-modal.tsx` | `PremiumUpsellModal` vracia `null`, keď je `premium-upsell` skrytý (+1 import, +1 riadok za hookmi) | Ponuka Eigenwelt Plus (7-dňový trial, €69/seat) sa otvára z prepisu reči a z Hubu; lokálne modely prepisu ostávajú, len bez upsellu | VŘ | feat/anthropic-a-skryte-komercne-prvky |
| `apps/app/src/react-app/domains/connections/provider-auth/provider-auth-modal.tsx` | Syntetická položka „Eigenwelt Subscription“ sa do výberu poskytovateľov nepridá, keď je `eigenwelt-sign-in` skrytý (+1 import, +1 podmienka) | Prihlásenie do platenej platformy dodávateľa upstreamu; poskytovatelia z enginu (Anthropic, OpenRouter, …) ostávajú nedotknutí | VŘ | feat/anthropic-a-skryte-komercne-prvky |
| `apps/app/src/react-app/shell/free-retired-dialog.tsx` | `hasPendingFreeRetiredNotice()` vracia `false`, keď je `eigenwelt-trial` skrytý (+1 import, +1 riadok) | Migračný dialóg zrušenej bezplatnej vrstvy je výzva na Eigenwelt trial; guard v jedinom čítaní markera zároveň neblokuje What's new a úvod prepisu, ktoré naň čakajú | VŘ | feat/anthropic-a-skryte-komercne-prvky |
| `apps/app/src/react-app/shell/session-route.tsx` | Krok onboardingu „Your AI“ (`AiStep`) sa nerenderuje a uložený stav `"ai"` sa efektom dokončí ako `skipped`, keď je `eigenwelt-trial` skrytý (+1 import, +3 riadky efekt, +1 podmienka); krok „audio" (zapnutie prepisu) sa preskočí, keď je záložka recorder skrytá — vrátane uloženého stavu a tlačidla Späť | Posledný krok onboardingu má jedinú akciu — Eigenwelt trial; model si tester pripojí v Nastavenia → AI alebo cez „Pripojiť model“ nad composerom | VŘ | feat/anthropic-a-skryte-komercne-prvky |
| `apps/server/src/opencode-plugins/legalwork-skill-tools.ts` | Pomocné funkcie `fitSkillName`, `resolveSkillName`, `buildSkillMarkdown` (+ `MAX_SKILL_NAME_LENGTH`, `titleFromName`) presunuté bez zmeny do nového súboru `legalwork-skill-tools-shared.ts` (+1 import); modul exportuje už len `LegalWorkSkillTools` | opencode (v1.18.29, `plugin/index.ts` → `getLegacyPlugins`) volá KAŽDÝ export plugin modulu ako `server(input)`; `buildSkillMarkdown(PluginInput)` padal na `input.description.trim` a engine pri každom štarte logoval `failed to load plugin` | VŘ | fix/skill-tools-plugin-start |
| `apps/server/src/opencode-plugins/legalwork-skill-tools.test.ts` | Import pomocných funkcií presmerovaný na `legalwork-skill-tools-shared.js` (+1 namespace import); +1 test, ktorý každý export modulu zavolá ako plugin vstup tak, ako to robí opencode | Aby sa export pomocnej funkcie vedľa pluginu nemohol ticho vrátiť | VŘ | fix/skill-tools-plugin-start |
| `apps/app/src/react-app/infra/provider-list-query.ts` | Telo `getDefaultModelForSingleConnectedProvider()` nahradené delegáciou na `pickDefaultModel()` z LAWOSS súboru `apps/app/src/lawoss/shell/default-model-pick.ts` (+1 import, −9 riadkov) | Automatický výber predvoleného modelu bral prvý záznam katalógu bez ohľadu na schopnosti — u OpenRouteru obrázkový `google/gemini-3-pro-image-preview` bez nástrojov, každý prompt padal na HTTP 404 „No endpoints found that support tool use“; teraz sa vyberá len model s `capabilities.toolcall` a id bez `image/audio/tts/transcribe/realtime/embed` | VŘ | fix/predvoleny-model-s-nastrojmi |
| `apps/app/tests/model-connect-notice.test.ts` | Fixture modelu doplnená o `capabilities: { toolcall: true }` (1 riadok) | Fixture bez schopností by po sprísnení výberu nezodpovedala reálnemu katalógu enginu a upstream testy predvoleného modelu by padli | VŘ | fix/predvoleny-model-s-nastrojmi |
| `apps/desktop/electron/main.mjs` | +1 import (`isAllowedNavigation`, `guardNavigation`, `originAllowlistEntry`, `describeBlockedUrl`), `startUrl` vytiahnutý na úroveň modulu, +`OWN_ORIGINS`/`NAVIGATION_ALLOWLIST`, +1 funkcia `guardAppWindow()`; dva duplicitné bloky `setWindowOpenHandler`/`will-navigate`/`did-start-navigation` (hlavné okno + odpojené okno session) nahradené jej volaním; samotná logika je v LAWOSS súbore `window-allowlist.mjs` | Hlavné okno pustilo ľubovoľnú localhost adresu (`browserPanel.isMainWindowAllowedNavigation`) a vykreslil sa v ňom cudzí dev server (#47); teraz iba vlastný origin dev servera alebo `file://`, `will-redirect` a `window.open` mimo allowlistu sú blokované a logované | VŘ | fix/okno-len-vlastna-adresa |
| `apps/desktop/electron/main.mjs` | Import z `update-feed.mjs`; `resolveCorrectArchitectureDownloadUrl()` používa sledovaný feed a presný `releases/download/v<verzia>/<asset>`; odstránený nepoužitý import/alias starého `releases/latest` fallbacku; hľadanie adresy beží len pri nezhode architektúr | `releases/latest` forku môže držať orchestrátorový sidecar; architektúrny tok aj self-updater používajú iba konkrétny app tag ([spec/plan PR #83](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/83)) | VŘ | fix/updater-feed-fork; feat/internal-candidate-followup |
| `apps/desktop/package.json` | +1 súbor v skripte `test` (`electron/update-feed.test.mjs`) | Testy feedu forku bežia v `pnpm --filter @legalwork/desktop test` | VŘ | fix/updater-feed-fork |

## Review checklist for upstream sync

### v0.1.21 integration (2026-09-17)

Merged exact upstream tag `v0.1.21` (`a4edd4b`, covering v0.1.19 and v0.1.20) onto LAWOSS `790a86c`. Six textual conflicts, all resolved by keeping both sides; every active row above was re-checked in the merged tree.

| Upstream files | Preserved downstream behavior |
|---|---|
| `README.md` | LAWOSS README kept; the only upstream change was the Bun 1.4.2+ requirement, reflected in `docs/lawoss-build-pre-testerov.md`. |
| `apps/app/src/i18n/locales/en.ts`, `de.ts` | LAWOSS `autogram.*` keys kept next to the new upstream Tasks, plans, storage and notification keys. |
| `apps/app/src/react-app/domains/session/artifacts/artifact-panel.tsx` | Document author from local preferences kept; upstream `localReadOnly`, `saveActions` and the exported `ArtifactPanelView` adopted. |
| `apps/app/src/react-app/domains/settings/shell/settings-page.tsx` | `"appearance"` stays in the global tabs next to the new upstream `"notifications"`; `hideCommercialTabs()` still filters the list. |
| `apps/app/src/react-app/shell/session-route.tsx` | Pane reset keeps `setShowRecorder(false)` and the `location.key` dependency for LAWOSS routes; upstream Tasks pane keep-open window adopted. |

Guards verified after the merge: `isCommercialSurfaceHidden` in `session-surface.tsx`, `hub-download-section.tsx`, `hub-scope-context.tsx`; `HIDDEN_SETTINGS_TABS` in `general-view.tsx`, `transcription-intro.tsx`, `app-sidebar.tsx`; `applyBrandName` in `i18n/index.ts`; the `welcome-route.tsx` redirect; the connections store still reads the filtered `MCP_QUICK_CONNECT` after upstream #136. `opencodeVersion` and `apps/server/src/extensions/` are unchanged by upstream. `legalwork-legalmemory-knowledge` changed upstream only.

New upstream surfaces handled in this sync (decision MČ 2026-09-17: remove paid Eigenwelt paths, keep what works locally):

- `apps/app/src/react-app/domains/onboarding/ai-plans-overlay.tsx` (#155): hidden as `CommercialSurface "ai-plans"`; the onboarding step `"ai"` finishes immediately. The file stays because `tests/onboarding-transitions.test.tsx` renders it.
- Tasks (#154): kept local. Firm sync, members and sign-out wipe are off on the server (`apps/server/src/lawoss/commercial-services.ts`). Upstream tests enable them through `apps/server/bunfig.toml` → `test-preload-lawoss.ts`.
- File storage (#131, #142, #148): SMB, WebDAV, S3, Azure Blob, GCS, SFTP and FTP kept local; team connections off on the server; Box hidden unless the firm runs its own OAuth broker.
- **Check on every sync:** a person can add their own MCP server without any sign-in to LegalWork, Eigenwelt or LAWOSS (Settings → Integrations → Connectors → Add; remote URL with optional headers, and local command). Requirement MČ 2026-09-17, [ADR 0013 draft](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/80). Verified in v0.1.21: no Eigenwelt call on this path.
- Still visible and left to open PR #65 (VŘ): trial/log-in buttons in the composer notice, the Eigenwelt entry in the providers dialog, the premium upsell and free-tier dialogs. #65 must drop its `AiStep` hunk (file deleted upstream) and its `finishOnboarding("skipped")` call when rebased.

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
| `apps/app/scripts/i18n-check.ts` | Odstránená výnimka `partial` pre `sk`/`cs` (kontrolujú sa na plné pokrytie ako `de`); kontrola kľúčov navyše pozná české a slovenské CLDR kategórie `_few`/`_many`, keď rodina má v `en.ts` `_other` | Preklad je dokončený, takže tolerovať anglický fallback by znamenalo, že nový chýbajúci kľúč prejde bez povšimnutia | VŘ | loc/prvy-preklad-sk-cz |
| `apps/server/src/opencode-plugins/legalwork-word-tools.ts` | `isOpenWordFilePipelineCall` a `FILE_BACKEND_MARKERS` a pomocné `decodedDocumentUrl`/`documentName` presunuté bez zmeny do nového `legalwork-word-tools-shared.ts` (+1 import, −24 riadkov) | opencode volá každý export modulu pluginu ako plugin — rovnaká pasca ako v `legalwork-skill-tools` (PR #61) | VŘ | fix/word-tools-exporty-a-picker |
| `apps/server/src/opencode-plugins/legalwork-word-tools.test.ts` | helper sa importuje zo shared modulu; +1 test „every export loads as a plugin entry point" | Regresia sa inak prejaví až pádom pri štarte enginu | VŘ | fix/word-tools-exporty-a-picker |
| `apps/server/src/skills.ts` | `parseSkillEntry()` číta a parsuje SKILL.md v `try`/`catch`: chybný súbor sa preskočí s `console.warn` namiesto toho, aby výnimka zhodila celý výpis | Jeden cudzí skill s neplatným frontmatterom inak zneviditeľní všetky skilly vo workspace aj v `~/.claude/skills` — a tým aj `legalwork_skill_create` | VŘ | fix/vypis-skillov-prezije-chybny-skill |
| `apps/server/src/skills.test.ts` | +1 test: chybný SKILL.md v priečinku sa preskočí a ostatné skilly sa vrátia | Regresia, ktorá sa inak prejaví až u používateľa s cudzím skillom | VŘ | fix/vypis-skillov-prezije-chybny-skill |
| `scripts/dev.mjs` | `LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT` sa už nedosadzuje na `9823`; port sa odovzdá len keď ho niekto nastaví (`remoteDebugEnv()` z `apps/desktop/scripts/dev-remote-debug.mjs`) | Launcher už nevnucuje port 9823; bez hodnoty ostáva automatický port upstreamu, explicitné `off` ho vypne | VŘ | fix/cdp-port-len-na-vyziadanie |
| `apps/desktop/package.json` | +1 súbor v skripte `test` (`scripts/dev-remote-debug.test.mjs`) | Aby sa default nemohol ticho vrátiť | VŘ | fix/cdp-port-len-na-vyziadanie |
| `apps/desktop/electron/main.mjs` | `LEGALWORK_ELECTRON_REMOTE_DEBUG_PORT=off` zavrie ladiaci port úplne; bez tejto hodnoty ostáva správanie upstreamu (port sa hľadá v rozsahu 9223–9227 pre vstavaný prehliadač) | Kto sa na port pripojí, riadi okno appky aj jej session; advokát, ktorý vstavaný prehliadač nepoužíva, ho má vedieť vypnúť | VŘ | fix/cdp-port-len-na-vyziadanie |

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


## Lokálny integračný kandidát OKF alfy (2026-09-20)

Rozsah a prijaté rozhodnutia: [zápis 11. 9.](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/main/meetings/2026-09-11-zapis-sync-call.md), [reprodukcie auditu](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/79). Kandidát nie je vydanie.

| Súbory upstreamu | Úprava a dôvod |
|---|---|
| `apps/server/src/claude-plugin-bundle.ts`, `cloud-plugins.ts` a ich testy | Prenos textových resources Node pluginu, nemenný adresár podľa obsahu, absolútna cesta MCP spúšťača, zachovanie štartovacieho timeoutu; pôvodný import uložil nefunkčný príkaz bez runtime. Podporuje lokálne balíky LAWOSS marketplace, bez zásahu do extensions. |
| `apps/app/src/app/lib/legalwork-server.ts` | Inštalácia GitHub pluginu má čas na stiahnutie a prvý štart; krátky konfiguračný timeout nestačil. |
| `apps/app/src/app/lib/opencode.ts` | `POST /session` má ohraničený 60-sekundový timeout pre studený štart enginu; automatické opakovanie POST sa nepridáva. Čistý profil v smoke teste dokončil vytvorenie session až po 20,8 sekundy, pôvodný 10-sekundový limit už zobrazil chybu. Ostatné bežné požiadavky si ponechávajú pôvodný limit. |
| `apps/app/tsconfig.json` | Výslovné zahrnutie `src/lawoss/**/*` do typechecku. |
| `.github/workflows/ci-okf-pamat.yml` | Zjednotenie workspace inštalácie z #60 s kontrolou CLI bundle z #57 a Bun 1.4.2 zo syncu. |

Kombinované riešenie `session-route.tsx` zachováva novú upstream obrazovku AI plánov za LAWOSS guardom, preskočenie komerčného onboardingu a skrytého recordera. Pôvodné vetvy a autorstvo sú zachované lokálnymi merge commitmi.

Prvý nový priečinok z hlavnej obrazovky teraz pred vytvorením rozhovoru spustí desktop engine a použije jeho čerstvé pripojenie (`session-route.tsx`). Reprodukcia v čistom profile: HTTP server bežal, ale vytvorenie rozhovoru vrátilo `opencode_unconfigured`.

### Desktopové opravy #47 a #51 (2026-09-20)

PR #62, #68, #72 a #63 sú začlenené so zachovaným pôvodom. Navigácia hlavného a odpojeného okna používa presný origin; dev launcher overuje identitu checkoutu Vite. `scripts/dev.mjs` už nevnucuje port 9823 a `apps/desktop/scripts/electron-dev.mjs` nevypisuje falošnú adresu CDP pri `off`; bez premennej sa zachová upstream automatický port. Príručka testera zodpovedá tomuto správaniu.

PR #63 rieši len vyhľadanie inštalátora pri nezhode architektúry. Prevádzka update feedu, publikovanie inštalátorov, podpisovanie a zladenie alpha tagov s verziami ostávajú samostatne nevyriešené; tento merge nepredstavuje funkčné vydanie ani automatické aktualizácie.

### OKF v natívnom Pridať priečinok (2026-09-20)

| Súbory upstreamu | Úprava a dôvod |
|---|---|
| `apps/app/src/react-app/domains/workspace/create-workspace-modal.tsx`, `types.ts` | Voliteľný `ReactNode` slot pre doplnkový obsah; bez slotu ostáva pôvodný tok otvorenia lokálneho priečinka. |
| `apps/app/src/react-app/shell/session-route.tsx` | Rozbaliteľný spoločný panel OKF pre dostupný vybraný lokálny workspace; dostáva existujúci endpoint, klienta a oprávnenia, pri zatvorení sa odpojí. Bez workspace zostáva obyčajné Pridať priečinok. Panel overí právo zápisu skillov a pripraví neodoslaný návrh rozhovoru; nepotvrdzuje vznik cieľových súborov ani neregistruje neoverený priečinok. Staršia experimentálna adresa používa rovnaký panel bez duplikácie formulára. |

### LAWOSS katalóg v natívnych Integrations (2026-09-20)

| Súbory upstreamu | Úprava a dôvod |
|---|---|
| `apps/app/src/react-app/shell/settings-route.tsx` | Pripája zelený `NativeCatalog` a čítanie existujúceho registra `listCloudPlugins` k vybranému natívnemu endpointu/workspace. Natívne MCP zoznamy dostávajú reálne `extensionsStore.skills()` a importované balíky namiesto prázdnych polí. Inštalácia používa pôvodné callbacks/API a oprávnenia; refresh obnoví balíky, skills aj MCP vrátane čiastočných chýb. Zmena workspace odpojí rozpracované preview. |
| `apps/app/src/react-app/domains/settings/pages/extensions-view.tsx` | Voliteľný `catalogView` slot v lokálnej záložke Plugins; pôvodné Team, scope prepínače, import a OpenCode Plugins ostávajú natívne. |
| `apps/app/src/react-app/domains/settings/pages/mcp-view.tsx` | Detail importovaného balíka používa typ plugin a označenie „Nainštalované“; samotný import sa už nevydáva za pripojenie MCP. |

Staré `/marketplace` a `/konektory` sú v zelenom LAWOSS routeri iba presmerovania do natívnych záložiek Plugins/MCP pre zapamätaný vybraný workspace. Experimentálny zoznam ich už neponúka a pôvodné stránky nenačítavajú paralelné pripojenie. Verejné registre zatiaľ používa existujúci import do workspace; globálna inštalácia týmto API nie je implementovaná a katalóg to uvádza. Kontrola upstream syncu: zachovať slot, mapovanie endpoint/workspace, rozlíšenie installed/connected a obnovu všetkých troch natívnych zoznamov po zmene.

### Lokálny checkpoint OKF cez natívne lifecycle hooky (2026-09-20)

| Súbory upstreamu | Úprava a dôvod |
|---|---|
| `apps/server/src/legalwork-runtime-config.ts` | Dva riadky pripájajú zelený OKF handoff cez existujúci `legalworkPluginPath`. Zachováva natívny zoznam pluginov aj compaction prompt; nič nemení v legalmemory plugine. |
| `apps/server/package.json` | Existujúci build natívnych pluginov zahŕňa malý exportný wrapper `src/opencode-plugins/lawoss-okf-handoff.ts`; vlastná implementácia a testy sú v `lawoss/okf-handoff/`. Wrapper exportuje iba vstup pluginu. |
| `apps/server/src/legalwork-runtime-config.test.ts` | Overuje prítomnosť nového pluginu ako natívneho file:// vstupu; nesmie sa vytratiť pri upstream synce. |

Checkpoint sa aktivuje iba pri otvorení koreňa konkrétnej veci s kartou a pamäťou. Udalosť idle, hook pred zhutnením a hook pred ďalším ťahom vykonajú existujúce CLI read/sync bez podprocesu alebo modelového volania. Uložený Markdown je odvodený kontext s hashmi; nečitateľné alebo zmenené zdroje neprepíšu posledný dobrý checkpoint. Globálne workspace-y bez priamej karty veci ostávajú bez zápisu. Pri upstream synce overiť rozhrania `event`, `experimental.session.compacting` a `experimental.chat.system.transform` (teraz 1.18.29), zabalenie pluginu a zachovanie pôvodného compaction promptu. Nevytvára Git repo, automaticky necommituje a nesynchronizuje tímové dáta.

- `apps/server/src/routes/files.ts`: existujúce natívne textové file API prijíma aj presný názov `okf.config`, aby náhľad pracovného profilu vedel načítať `Office/okf.config`. Ostatné `.config` súbory sa tým nepovoľujú; autentifikácia, rozsah workspace a režim iba na čítanie ostávajú zachované. HTTP regresia je v `okf-config-read.e2e.test.ts`.

Prepublikačné review OKF (20. 9. 2026): `ci-okf-pamat.yml` spúšťa aj regresie zeleného `lawoss/okf-handoff/` pri zmenách pamäte alebo hooku. Pred automatickou synchronizáciou sa preveria všetky projekčné ciele veci aj klienta; symlinky a nepravidelné súbory sa odmietnu pred prvým zápisom. Natívny hook má priamy regresný test s externým cieľom. Zápis projekcie používa dočasný súbor a rename; nejde o garanciu transakcie proti súbežnej útočnej výmene celých adresárov.

### Native office profile and shared author (2026-09-21, PR #81)

- `apps/app/src/react-app/domains/settings/pages/personalisation-view.tsx`: one optional `officeProfileView` slot and clearer existing author copy. The persisted document-author preference remains the identity source; naming a lawyer does not alter authorization.
- `apps/app/src/react-app/shell/settings-route.tsx`: mount the green office editor in Personalisation, bound to the selected workspace endpoint and remounted on workspace/server changes.
- `apps/app/src/react-app/shell/session-route.tsx`: pass the existing document-author preference to the native OKF creation panel. Preview and CLI handoff receive the same explicit lawyer name.
- `apps/app/src/app/lib/legalwork-server.ts`: optional `expectedContent` precondition on the existing text write API; null means the file must still be absent.
- `apps/server/src/routes/files.ts`: retain native authorization, read-only, approval, audit and file events; delegate text replacement to a small LAWOSS helper that serializes text saves and checks the optional exact-content precondition after approval and immediately before replacement. Guarded writes reject symlink components. This is a conflict guard against stale editor saves, not an OS transaction with uncooperative external writers.

### Živé hostiteľské oprávnenia pamäte (2026-09-21, Task 2)

Rozhodnutie: [spec/plan PR #83](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/83).

| Súbory upstreamu | Úprava a dôvod |
|---|---|
| `apps/server/src/server.ts` | Dva autentifikované read-only hooky `/workspace/:id/lawoss/memory` a `/lawoss/memory/grants`; explicitné `bootstrap: false` v spoločnom resolveri zachová lookup/alias/authorized-root kontrolu bez inicializácie alebo opravy `.opencode`; ostatné route-y si ponechávajú pôvodný bootstrap; zelený resolver používa iba existujúci runtime store, nikdy workspace-authored config. Natívny Authorized Folders PUT ostáva správcom oprávnení. |
| `apps/server/package.json` | Výslovný Bun Node bundle pre `src/lawoss/workspace-memory-runtime.ts` → `dist/lawoss/workspace-memory-runtime.js`, portable reader za deklarovaným `.mjs` seamom; runtime store zostáva pôvodným modulom servera. Tým endpoint funguje aj mimo Bun/checkoutu a TypeScript rootDir ostáva `src`. |
| `apps/app/src/app/lib/legalwork-server.ts` | Typovaný `getWorkspaceMemoryStatus(workspaceId)` používa read-only endpoint; shared strict status kontrakt nemá telá zdrojov ani anchors. |

Natívny LAWOSS plugin wrapper výslovne vyberá native režim a exportuje iba plugin. Pri synce zachovať obidva runtime-only endpointy, explicitný build seam a zákaz environment fallbacku pri nedostupnom hoste. Skryté/custom/deny runtime pravidlá konzervatívne odoberú všetky externé grants; samotný profil alebo file config prístup neposkytuje.

### Pamäť v Integrations a nový rozhovor v existujúcom spise (2026-09-21, Task 3)

Rozhodnutie: [spec/plan PR #83](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/83).

| Súbory upstreamu | Úprava a dôvod |
|---|---|
| `apps/app/src/react-app/shell/settings-route.tsx` | Pripája zelenú kartu súborovej pamäte k vybranému endpointu, workspace ID, koreňu a remote príznaku. Žiadna nová settings route ani grant store. |
| `apps/app/src/react-app/domains/settings/pages/extensions-view.tsx` | Voliteľný `fileMemoryView` slot iba v lokálnej záložke Connectors, popri pôvodných Autogram/MCP kartách. |
| `apps/app/src/app/lib/legalwork-server.ts` | Voliteľný boolean `registerExisting` na pôvodnom host-authenticated `createLocalWorkspace`; ostatné volania ostávajú bez zmeny. |
| `apps/server/src/routes/workspaces.ts` | `registerExisting: true` vyžaduje existujúci absolútny kanonický adresár bez symlink aliasov; preskočí mkdir a starter inicializáciu. Pôvodný registry, deterministické ID, persistencia, autorizované korene a audit zostávajú. Bežné vytváranie workspace inicializuje pôvodným spôsobom. |

Profil používa zdieľaný browser-safe parser, native file API a exact-content CAS (null pri vytvorení). Stav pripravenosti pochádza iba zo serverovej kontroly zhodného uloženého obsahu, nikdy z JSON parsera alebo rozpracovaného návrhu. Oprávnenia sa zobrazujú z runtime-only statusu; spravuje ich existujúca Permissions obrazovka. Pri synce zachovať oddelenie mapovania od oprávnení a oddelenie uloženého profilu od návrhu. Existujúci file API/activation bootstrap ostáva pôvodný; nulová zmena stromu súborov je garantovaná testom pre samotnú registráciu, nie pre následnú bežnú inicializáciu session.

Zelená akcia v cockpite vychádza z konkrétneho discovered record (nie len query stringu alebo názvu), použije desktop path helper a native registry, aktivuje/vyberie presný child workspace a vytvorí jeden nový rozhovor s canonical transport directory a neodoslaným draftom. Existujúci kancelársky rozhovor nemení. HTTP regresie: `apps/server/src/lawoss-register-existing.e2e.test.ts`, `apps/app/tests/lawoss-file-memory.test.tsx`, `apps/app/tests/lawoss-matter-session.test.ts`; posledný test používa skutočný server a klienta, iba desktop IPC a modelový engine sú syntetické.

## Internal candidate: document naming (Task 4)

Portable naming and the third native OKF skill `/usporiadaj-spis` are implemented only in LAWOSS-owned `lawoss/okf/**`, `lawoss/skills/usporiadaj-spis/**`, `apps/app/src/lawoss/okf/skill-bundle.ts`, `apps/app/src/lawoss/domains/marketplace/{use-native-integrations.ts,native-catalog.tsx}` and their LAWOSS tests. No upstream file hook, server file manager or new dependency is introduced. Native install/badge now cover all three skills; the new-matter draft flow keeps its two required skills. [Authorizing spec/plan, Task 4](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/83).

## Internal candidate: explicit local MCP export (Task 5)

[Authorizing spec/plan](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/83).

| Súbory upstreamu | Úprava a dôvod |
|---|---|
| `apps/app/src/app/types.ts` | Natívny MCP záznam zachováva lokálne `cwd` z pripnutej OpenCode v2 schémy a explicitný efektívny príznak `disabledByTools`. |
| `apps/app/src/react-app/domains/connections/store.ts` | Existujúci serverový zoznam prenesie vyhodnotený tools stav ako boolean; file fallback ho na všetkých záznamoch zruší, aby lokálny export nemohol vydávať neoverený stav za efektívny. Nevzniká druhý config store ani credential reader. |
| `apps/app/src/react-app/domains/settings/pages/mcp-view.tsx` | Jeden zelený dialóg exportu je pripojený k existujúcemu natívnemu zoznamu MCP a identity workspace; zmena zoznamu alebo workspace ruší staré potvrdenie. |
| `apps/server/src/runtime-config-migrate.e2e.test.ts` | Syntetická regresia preukazuje precedence global/project/runtime, zachovanie v2 polí konektorov pred a po migrácii a absenciu obnovy OAuth tokenov. Produkčný serverový kód sa nemení. |

Samotný builder, dialóg a testy sú v zelených `apps/app/src/lawoss/**` a `apps/app/tests/lawoss-mcp-config-export.test.tsx`. Export vyžaduje výslovný výber a potvrdenie, vytvorí iba lokálny Blob download a nikdy nečíta OAuth credential store. Runtime zdroj sa v UI neprezentuje ako dôkaz globálneho alebo klientského rozsahu.

## Internal candidate: persistent native matter registration (Task 6)

[Authorizing spec/plan](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/83).

| Súbory upstreamu | Úprava a dôvod |
|---|---|
| `packages/types/src/desktop-ipc.ts` | Pôvodný `workspaceCreate` prijíma voliteľný boolean `registerExisting`; nevzniká nový IPC príkaz ani druhá registračná cesta. |
| `apps/desktop/electron/workspace-store.mjs`, `workspace-store.test.mjs` | Režim `registerExisting: true` prijme iba existujúci absolútny kanonický adresár, nevytvorí ani nezmení jeho súbory a atómovo ho uloží do natívneho zoznamu spolu s selected/active/watched ID. Bežná tvorba bez príznaku alebo s `false` ostáva pôvodná. Regresia overuje bajtovo nezmenený syntetický spis, idempotentný retry, nový store nad rovnakým userData a odmietnutie neplatných vstupov. |

Zelený orchestrátor `apps/app/src/lawoss/okf/matter-session.ts` po serverom potvrdenej registrácii vyžaduje zhodnú natívnu registráciu ešte pred štartom enginu a vytvorením jedinej session. Zlyhanie alebo rozpor sa zastaví bez session; už platný serverový záznam a kancelársky draft ostávajú zachované.

## Internal candidate: prenosné záverečné kontroly (Task 7)

[Authorizing spec/plan](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/83).

| Súbory upstreamu | Úprava a dôvod |
|---|---|
| `apps/app/tests/opencode-session-timeout.test.ts` | Deterministický fetch-start deferred a ručne spúšťané transportné deadline callbacks overujú pôvodný 10-sekundový health limit, 60-sekundový session limit, chybu po timeout-e a jediný create POST. Produkčné timeouty sa nemenia. |
| `apps/desktop/electron/workspace-store.test.mjs` | Symlink/junction capability probe má vlastný pomenovaný subtest s explicitným dôvodom skipu; zvyšok perzistencie a neplatných vstupov vždy beží. |
| `.github/workflows/ci-tests.yml`, `ci-okf.yml`, `ci-okf-pamat.yml`, nový `ci-windows-portable.yml` | Testy zahŕňajú nadväzujúce PR. Bun 1.4.2, samostatný strict OKF typecheck a Linux/macOS bundle freshness; Windows spúšťa source naming/memory/handoff/updater/native registry regresie bez balenia alebo podpisovania. Filtre zahŕňajú spoločný testovací helper a workspace-store. |
| `pnpm-lock.yaml` | Nový importer pre existujúce dev nástroje OKF TypeScript 5.9.3 a bun-types 1.3.6; pamäťové dev typy sú zjednotené na už zamknuté @types/node 25.6.0, ktoré používa bun-types. Čisté CI inak načítalo súčasne deklarácie Node 24 aj 25. Runtime zostáva Node 24, žiadna runtime závislosť ani oslabenie strict kontrol. |

Windows symlink prípady sa vynechajú iba po neúspešnom capability probe s dôvodom; obsah, CAS, hardlinky a ostatné ochrany zostávajú aktívne. POSIX mode assertions nepredstierajú kontrolu Windows ACL. Pri pôvodnom odovzdaní po `3789e8f` bola jedinou produkčnou zdrojovou úpravou explicitná anotácia `Jurisdiction | undefined` v zelenom pamäťovom store; oba CLI bundles boli vtedy bajtovo nezmenené. Následné opravy potvrdené skutočným Windows CI a ich regenerované bundles sú opísané nižšie.

### Oprava potvrdená Windows CI (Task 7)

Prenosný validator v zelenom `lawoss/okf/src/fs.ts` klasifikuje rodičovský priečinok pamäte cez natívne `basename(parent) === "memory"`; pôvodné `endsWith("/memory")` odmietalo platný `memory/index.md` na Windows. Bežné vnorené indexy naďalej nesmú mať frontmatter a pamäťový index smie niesť iba `okf_version`. Regresie v `lawoss/okf/test/okf.test.ts` pokrývajú oba prípady a explicitné LF aj CRLF šablóny so zachovaním pôvodného používateľského textu a presného zrkadla AGENTS/CLAUDE. Produkčné konce riadkov sa nemenia. Pre túto overenú opravu sa regeneruje iba OKF bundle; pamäťový bundle zostáva bajtovo nezmenený.

### Natívne Windows cesty pamäte (Task 7, fix round 2)

Skutočný Windows beh po `82712b8` odhalil odmietanie natívneho absolútneho koreňa profilu a vynechanie klientskej pamäte z rozsahu L3. Zelený `lawoss/okf-pamat/src/workspace-memory-profile.ts` povoľuje spätné lomky iba v drive-absolute koreňoch; traversal odmieta pri oboch oddeľovačoch. Relatívne zdroje, caller grants, kontrola symlinkov a containment zostávajú prísne. `src/config.ts` normalizuje iba natívny oddeľovač kandidátskej cesty; na POSIX zostáva doslovná spätná lomka súčasťou mena. `src/store.ts` rozpoznáva samotnú kanceláriu cez natívne basename. Regresie profilu a klientskeho scope zachovávajú negatívne prípady aj všetky kontroly úniku; test dvoch procesov používa natívne dirname/basename pre svoj rendezvous. Pre tieto opravy sa regenerujú oba CLI bundles: OKF tiež zahŕňa zdieľané pamäťové moduly config/store/profile. Kontrola čerstvosti zostavuje oba balíčky pred porovnaním s Gitom. Žiadny ďalší funkčný test sa nevynecháva.
