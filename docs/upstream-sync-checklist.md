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

- [ ] `apps/desktop/electron-builder.yml`: `productName: LAWOSS`, `artifactName: lawoss-${os}-${arch}-${version}.${ext}`, `publish` na `Omni-Legal-Products/lawoss`, ikony z `resources/icons`, `LICENSE` a `NOTICE` v `extraResources`, katalóg modelov v `extraResources`.
- [ ] Updater: `apps/desktop/electron/updater.mjs` a `update-feed.mjs` mieria na `https://lawoss.app/update` a releasy `Omni-Legal-Products/lawoss` (prefix `lawoss-`, záložne `legalwork-`).
- [ ] Odkazy na releasy upstreamu, ktoré ostávajú ako známy dlh (nie spojenie appky, len odkaz po kliknutí): `RELEASE_PAGE_URL` v `apps/desktop/electron/main.mjs`, `RELEASES_URL` v `apps/app/src/react-app/shell/loading-overlay.tsx`, alfa kanál v ladení (`apps/app/src/app/lib/electron-alpha.ts`, len vývojársky režim a klik).
- [ ] Názov, wordmark, prepínač jazyka, SK a CS slovníky a trasy LAWOSS podľa `PATCHES.md`.

## 5. PATCHES.md a overenie

- [ ] Každý konflikt riešiť podľa riadkov `PATCHES.md`; nové zásahy do upstream súborov zapísať do toho istého PR.
- [ ] `AGENTS.md` a `CLAUDE.md` zhodné.
- [ ] Typecheck a testy: `pnpm typecheck` v `apps/app` a `apps/server`, `bun test tests/` v `apps/app`, `bun test src` v `apps/server`, `pnpm --filter @legalwork/desktop test`, `pnpm --filter @legalwork/app test:i18n`, stráž z bodu 2.
- [ ] Desktop smoke len izolovane: `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME` na dočasný priečinok, `LEGALWORK_ELECTRON_USERDATA`, `LEGALWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY=1`, vymyslené údaje. Po behu `find ~/.config/legalwork ~/.config/opencode ~/.legalwork -newer <marker>` musí byť prázdne.
- [ ] Bez internetu na Eigenwelt: pri smoke teste nastaviť `EIGENWELT_PLATFORM_URL` a `OPENCODE_MODELS_URL` na lokálny poslucháč, ktorý zapisuje požiadavky; po štarte, výpise poskytovateľov a pripojení modelu nesmie prísť žiadna.
