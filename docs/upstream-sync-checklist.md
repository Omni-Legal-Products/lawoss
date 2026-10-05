# Kontrolný zoznam pre upstream sync

Postup pri každom zlúčení release tagu `eigenweltlabs/legalwork` do LAWOSS (vetva `sync/upstream-vX.Y.Z`). Dopĺňa `AGENTS.md` (sekcia Upstream sync) a `PATCHES.md`, ktorý ostáva zoznamom všetkých zmenených upstream súborov. Záznam konkrétneho syncu patrí do `docs/upstream-sync-vX.Y.Z.md`.

Záväzné rozhodnutie MČ z 5. 10. 2026: **Eigenwelt nesmie byť akýmkoľvek spôsobom aktívne pripojený na aplikáciu LAWOSS a analytika je vypnutá natrvalo.** Sync, ktorý to poruší, sa nezlučuje.

## 1. Pred zlúčením

- [ ] `git fetch origin --no-tags` a `git fetch upstream --tags`. Existujúce tagy neprepisovať (kolízia `v0.1.14`).
- [ ] Prečítať release notes upstreamu. Hľadať nové sieťové služby, telemetriu, prihlásenie, platené plochy, zmeny updatera a balenia.
- [ ] Vetvu `sync/upstream-vX.Y.Z` založiť z `dev` a zlúčiť presný tag.

## 2. Stráž Eigenweltu a analytiky

Najprv spustiť stráž; musí prejsť bez úprav povoleného zoznamu, alebo s úpravou, ktorú PR vysvetlí:

```sh
node lawoss/scripts/check-no-eigenwelt.mjs
node --test lawoss/scripts/check-no-eigenwelt.test.mjs
```

V CI beží v jobe `legalwork-tests` (`.github/workflows/ci-tests.yml`). Nový výskyt `eigenweltlabs.com`, `posthog`, kľúča `phc_…` alebo inej telemetrie mimo `ALLOWED` v skripte znamená posúdiť, či ide o aktívne spojenie. Do `ALLOWED` patrí len mŕtvy kód, vypnutá plocha alebo odkaz, vždy s dôvodom.

Potom ručne:

- [ ] **Katalóg modelov.** Engine nič nesťahuje: `apps/server/src/managed-opencode.ts` spreaduje `lawossEngineEnv()` ako posledné, `apps/server/src/embedded.ts` neposiela `OPENCODE_MODELS_URL`. Ak upstream pridal nové miesto, ktoré spúšťa engine (`opencode serve`), musí ísť cez `createManagedOpencodeServer` alebo dostať rovnaké prostredie. Mŕtve a vývojové cesty, ktoré to dnes nemajú: `startDirectRuntime` a `startOrchestratorRuntime` v `apps/desktop/electron/runtime.mjs` (nikto ich nevolá) a `apps/orchestrator` (headless vývoj; bez `OPENCODE_MODELS_URL` ide na verejný katalóg OpenCode, nie na Eigenwelt).
- [ ] **Analytika.** `apps/app/src/app/lib/analytics.ts` z upstreamu neprevziať; ponechať verziu LAWOSS bez kľúča, adresy a `fetch`, doplniť len nové exporty ako prázdne funkcie. Nový prepínač alebo krok súhlasu v UI skryť cez `isAnalyticsChoiceHidden()` (`apps/app/src/lawoss/feature-flags.ts`). Pozor na nové volania `fetch`/`sendBeacon` mimo `analytics.ts` a na server (`launch-analytics-id.ts` posiela identifikátor len v hlavičke plateného poskytovateľa Eigenwelt, ktorý je vypnutý).
- [ ] **Účet Eigenwelt.** Server bez `LAWOSS_EIGENWELT_ACCOUNT=1` nečíta uložené pripojenie ani cache plateného manifestu, manifest nesťahuje a poskytovateľa `eigenwelt` vypne v engine (`apps/server/src/lawoss/commercial-services.ts`). Nové serverové volanie platformy musí ísť cez `readEigenweltConnection()` alebo dostať rovnakú poistku. Upstream testy ho zapínajú v `apps/server/test-preload-lawoss.ts`.
- [ ] **Autodetekcia predplatného.** Appka sa na stav predplatného Eigenwelt pýta cez `/workspace/:id/eigenwelt/entitlements`; dopyt je vypnutý, keď je skrytý `eigenwelt-account`, a server vráti prázdne pripojenie. Nové výzvy na trial, prihlásenie, plány alebo upsell skryť cez `CommercialSurface` v `feature-flags.ts`. Detekcia predplatného ChatGPT (`lawoss/providers/chatgpt-subscription.mjs`) je lokálna a závisí od pribaleného katalógu (bod 3).
- [ ] **Firemné služby a úložiská.** Sync úloh a tímové úložiská ostávajú vypnuté bez `LAWOSS_EIGENWELT_FIRM_SERVICES=1`, Box len s vlastným `LEGALWORK_STORAGE_BOX_OAUTH_URL`.
- [ ] **Vlastné MCP bez prihlásenia.** Nastavenia → Integrácie → Connectors → Add funguje bez prihlásenia do LegalWorku, Eigenweltu aj LAWOSS (požiadavka MČ 17. 9. 2026).
- [ ] **Štatistiky stiahnutí.** `.github/workflows/download-stats.yml` beží len pri `github.repository == 'eigenweltlabs/legalwork'`. Nový plánovaný workflow upstreamu, ktorý niečo posiela von, dostane rovnakú podmienku.

## 3. Katalóg modelov a pin OpenCode

- [ ] `constants.json` `opencodeVersion` je červená zóna: mení sa len s ADR. Ak sa zmenil, overiť v novej binárke, že `OPENCODE_DISABLE_MODELS_FETCH`, `OPENCODE_MODELS_PATH`, `OPENCODE_DISABLE_SHARE` a `OPENCODE_DISABLE_AUTOUPDATE` stále existujú a robia to isté (zdroj modulu `ModelsDev` v binárke).
- [ ] Pribalený katalóg `lawoss/models-catalog/api.json` ide do zabalenej appky ako `Resources/lawoss-models/api.json` (`apps/desktop/electron-builder.yml`, `extraResources`). Engine ho číta cez `OPENCODE_MODELS_PATH`; bez súboru použije svoj zabudovaný snapshot, stále bez siete.
- [ ] Obnova katalógu (pred alfou, betou, pri zvýšení OpenCode alebo keď chýba nový model):

  ```sh
  node lawoss/scripts/update-models-catalog.mjs              # verejný katalóg OpenCode (models.opencode.ai)
  node lawoss/scripts/update-models-catalog.mjs --from <súbor alebo URL vo formáte api.json>
  node lawoss/scripts/update-models-catalog.mjs --check      # len overenie
  ```

  Skript spúšťa správca, nie appka. Zrkadlo Eigenweltu odmietne. Overí, že katalóg obsahuje `openai/gpt-6-luna` (odporúčaný model predplatného ChatGPT) a neobsahuje odkaz na Eigenwelt, a vypíše pridané a odobraté modely do popisu PR. Prvý katalóg je verejný katalóg OpenCode z 3. 10. 2026 (226 poskytovateľov). Upstream predtým používal zrkadlo Eigenweltu, ktoré mohlo niesť aj ich vlastného poskytovateľa; LAWOSS sa drží verejného katalógu.
- [ ] Po obnove spustiť `bun test src/lawoss` v `apps/server` a `bun test tests/` v `apps/app` (filter predplatného ChatGPT a odporúčaná Luna).

## 4. Značka a artefakty

Rozhodnutie MČ 5. 10. 2026 (M3): appka sa volá LAWOSS (`APP_NAME` aj `DISPLAY_NAME`) a upstream sync ostáva praktický. Jediný zdroj značky a adries releasov forku je `lawoss/branding.mjs`; upstream súbory ho importujú jedným riadkom. Najprv stráž značky (beží aj v kroku z bodu 2):

```sh
node lawoss/scripts/check-branding.mjs
node --test lawoss/scripts/check-branding.test.mjs
node lawoss/scripts/check-branding.mjs --write   # len ak sa zmenil lawoss/branding.mjs: obnoví desktopovú kópiu
```

- [ ] **Identita na disku sa nemení.** `APP_BUNDLE_IDENTIFIER` `com.eigenweltlabs.legalwork`, `DEV_APP_IDENTIFIER` `com.eigenweltlabs.legalwork.dev`, schéma `legalwork://`, `appId` v `electron-builder.yml` a userData `path.join(appData, APP_IDENTIFIER)` ostávajú. Ak upstream mení odvodenie priečinka s dátami, kľúčenky alebo logov, posúdiť dopad na existujúce inštalácie LAWOSS skôr, než sa stráž upraví.
- [ ] **Konflikt v riadkoch so značkou** (`main.mjs`, `updater.mjs`, `electron-alpha.ts`, `release-channels.ts`, `loading-overlay.tsx`, `web-unavailable-surface.tsx`, `i18n/index.ts`): prevziať upstream a vrátiť jeden import a hodnotu z `lawoss/branding.mjs` (v desktope `./lawoss-branding.mjs`, v appke `@/lawoss/branding`). Nový literál „LegalWork“ alebo adresu upstreamu v týchto súboroch nenechávať.
- [ ] **Nové upstream texty.** V slovníkoch sa „LegalWork“ neprepisuje; `t()` ho nahradí za LAWOSS (`applyBrandName`). Stráž zlyhá na inom tvare (napríklad „Legalwork“), na kľúči v `BRAND_EXEMPT_KEYS` bez dôvodu v `ALLOWED_TEXT` a na „LegalWork“ v slovníkoch a UI LAWOSS (`apps/app/src/lawoss/**`). Texty mimo `t()` v upstream súboroch stráž nepokrýva: nové pevné reťazce s menom upstreamu, ktoré advokát uvidí, zapísať do PR.
- [ ] `apps/desktop/electron-builder.yml`: `productName: LAWOSS`, `protocols[0].name: LAWOSS`, popisy povolení macOS (`NS*UsageDescription`) s LAWOSS, `artifactName: lawoss-${os}-${arch}-${version}.${ext}`, `publish` na `Omni-Legal-Products/lawoss`, ikony z `resources/icons`, `LICENSE` a `NOTICE` v `extraResources`, katalóg modelov v `extraResources`. Meno upstreamu smie ostať len v licenčnej doložke a v názvoch pribalených binárok (`BUILDER_ALLOWED_LINES` v stráži).
- [ ] Updater: `apps/desktop/electron/updater.mjs` (stable `https://lawoss.app/update`, alfa `alpha-macos-latest` a `alpha-windows-latest` forku) a `update-feed.mjs` (releasy `Omni-Legal-Products/lawoss`, prefix `lawoss-`, záložne `legalwork-`). Alfa náhľad v ladení (`electron-alpha.ts`) číta ten istý `latest-mac.yml` ako updater.
- [ ] Odkazy na releasy v appke a desktope (`RELEASE_PAGE_URL`, `RELEASES_URL`, alfa kanál, webová verzia) vedú na `FORK_RELEASES_URL`; stráž zlyhá na `github.com/eigenweltlabs/legalwork` a `legalwork.app` v `apps/app/src` a `apps/desktop/electron`.
- [ ] Názov, wordmark, prepínač jazyka, SK a CS slovníky a trasy LAWOSS podľa `PATCHES.md`.

## 5. PATCHES.md a overenie

- [ ] Každý konflikt riešiť podľa riadkov `PATCHES.md`; nové zásahy do upstream súborov zapísať do toho istého PR.
- [ ] `AGENTS.md` a `CLAUDE.md` zhodné.
- [ ] Typecheck a testy: `pnpm typecheck` v `apps/app` a `apps/server`, `pnpm --filter @legalwork/desktop typecheck:electron`, `bun test tests/` v `apps/app`, `bun test src` v `apps/server`, `pnpm --filter @legalwork/desktop test`, `pnpm --filter @legalwork/app test:i18n`, stráže z bodov 2 a 4.
- [ ] Desktop smoke len izolovane: `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` na dočasný priečinok, `LEGALWORK_ELECTRON_USERDATA`, `LEGALWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY=1`, vymyslené údaje. Po behu `find ~/.config/legalwork ~/.config/opencode ~/.legalwork -newer <marker>` musí byť prázdne.
- [ ] Bez internetu na Eigenwelt: pri smoke teste nastaviť `EIGENWELT_PLATFORM_URL` a `OPENCODE_MODELS_URL` na lokálny poslucháč, ktorý zapisuje požiadavky; po štarte, výpise poskytovateľov a pripojení modelu nesmie prísť žiadna.
