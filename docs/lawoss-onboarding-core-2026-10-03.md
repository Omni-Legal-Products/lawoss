# Onboarding: jadro a ochrana priečinka klienta

Implementačný záznam k [návrhu MČ, koordinačné PR #85](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/85), nad [integráciou #103](https://github.com/Omni-Legal-Products/lawoss/pull/103). Rozhodnutia zostávajú v koordinačnom repozitári. Tento záznam opisuje rozsah kódu a jeho overenie.

## Implementované

- `okf onboard classify` rozpozná kanceláriu, klienta, subjekt a vec vrátane pôvodných aliasov kariet. Číta lokálny strom bez zápisu, s limitmi počtu položiek, objemu a hĺbky. Neúplný alebo konfliktný výsledok neposkytne použiteľný hash pre zápis. Symlinky a nepodporované typy zastavia použiteľnosť výsledku.
- `okf onboard plan` pripraví doplnenie jedného existujúceho klienta v režime `convert`. Nerozpoznaný priečinok vyžaduje výslovné označenie ako klient. Kanceláriu ani vec nemožno týmto príkazom pretypovať na klienta.
- Náhľad používa existujúce lokalizované OKF šablóny. Dopĺňa iba chýbajúce súbory a priečinky, existujúce karty a archívy pamäte zachováva. Jediný existujúci `AGENTS.md` alebo `CLAUDE.md` slúži ako zdroj chýbajúceho zrkadla. Rozdielne existujúce zrkadlá sú konflikt.
- `apply` číta presný uložený plán, vyžaduje `--confirm`, znovu overuje strom a vytvára súbory výhradne cez exkluzívne vytvorenie. Žurnál sa ukladá do samostatného lokálneho priečinka mimo klienta. Opakovanie overuje vlastníctvo a obsah vytvorených položiek.
- `recover` rozlišuje dokončenie a vrátenie prerušeného zápisu. Nejasný stav medzi vytvorením súboru a záznamom jeho vlastníctva sa automaticky nepreberá ani nemaže.
- Server aj desktop zachovajú zobrazované meno a `appFiles` pri opätovnej registrácii. Režim `outside` vynechá inicializáciu projektového `.opencode` pri štarte a aktivácii. Nepodporované projektové zápisy nastavení, skillov a príkazov skončia chybou. Globálne nastavenia a runtime konfigurácia zostávajú dostupné.
- Desktop odovzdá uloženú voľbu vstavanému serveru ešte pred inicializáciou prvého priečinka. Zmena voľby zneplatní cache inicializácie; opätovné použitie bežiaceho enginu rešpektuje rovnakú voľbu.

## Použitie nad syntetickým klientom

Všetky cesty nižšie musia byť kanonické lokálne cesty. Klient aj samostatný priečinok žurnálov už musia existovať. Jeden stabilný priečinok žurnálov sa používa pre všetky operácie tejto inštalácie. Náhľad obsahuje celý text nových súborov a možno ho skontrolovať pred potvrdením.

```sh
node lawoss/okf/bundle/okf.js onboard classify "$CLIENT" --json
node lawoss/okf/bundle/okf.js onboard plan "$CLIENT" \
  --title "Testovací klient" --client-type po \
  --language sk --jurisdiction sk --date 2026-10-03 \
  --confirm-client --out "$PREVIEW"

# Až po schválení obsahu náhľadu:
node lawoss/okf/bundle/okf.js onboard apply \
  --plan "$PREVIEW" --journal "$JOURNALS" --confirm

# Obnova prerušeného zápisu, opäť po rozhodnutí používateľa:
node lawoss/okf/bundle/okf.js onboard recover \
  --plan "$PREVIEW" --journal "$JOURNALS" --action finish --confirm
```

`--action rollback` je alternatívou k dokončeniu. Originály ani zmenené vytvorené súbory sa nemažú. Stav, pri ktorom nemožno vlastníctvo preukázať, vyžaduje manuálne vyriešenie.

## Hranica tejto implementácie

| Požiadavka #85 | Stav |
|---|---|
| Klasifikácia a aditívny retrofit existujúceho klienta | CLI a deterministické jadro |
| Zachovanie mena a voľby appFiles | Server a desktop, vrátane persistencie |
| `map`, externé projektové skilly a profil pamäte | Nesprístupnené. `outside` je ochranný predpoklad, nepredstavuje hotový režim mapovania |
| `trial_clone` | Neimplementované |
| Nová kancelária, nový klient, subjekt a jednotná vec `kind` | Neimplementované v novom jadre; existujúce správanie #103 zostáva zachované |
| Päť krokov v natívnom welcome a bočnom paneli | Zatiaľ nenapojené |
| Serverové endpointy classify/plan/apply | Zatiaľ nenapojené |
| Dáta a AI, návrh #88 | Samostatný nadväzujúci rozsah |
| Akceptácia nainštalovanej alfy nad syntetickou kanceláriou | Nevykonaná |

Čítanie cloudových placeholderov závisí od lokálneho poskytovateľa súborov. Chyba alebo čiastočný sken nikdy neznamenajú prázdny priečinok. Neoverili sme správanie všetkých cloudových poskytovateľov ani pád operačného systému či výpadok napájania. Kontroly ciest a identity zužujú súbežné zmeny, neposkytujú atómový snapshot cudzieho súborového systému.

## Overenie

Lokálne overené na Node 24.19.0, pnpm 11.4.0 a Bun 1.4.2:

| Príkaz alebo skúška | Výsledok |
|---|---|
| `pnpm --dir apps/server test` | 1 343 pass, 26 skip, 0 fail, 173 súborov |
| `pnpm --dir lawoss/okf test` | 194 pass, 0 fail, 10 súborov |
| `node --test apps/desktop/electron/runtime.test.mjs apps/desktop/electron/workspace-store.test.mjs` | 33 pass, 0 fail |
| `pnpm --dir apps/server typecheck` | PASS |
| `pnpm --dir apps/app typecheck` | PASS |
| `pnpm --dir apps/desktop typecheck:electron` | PASS |
| `pnpm --dir lawoss/okf typecheck` | PASS |
| `pnpm --dir lawoss/okf build` | PASS, distribučný bundle obnovený |
| Zostavený CLI cez Node 24: PO/SK, FO/CZ, podnikateľ/EN | Klasifikácia, nezapisujúci náhľad, apply, rovnaké bajty originálu a opakované apply PASS |
| `git diff --check`, zhoda root AGENTS/CLAUDE | PASS |

Obnova sa testuje nad žurnálmi simulujúcimi konkrétne body prerušenia, vrátane odstránenia súboru pred dokončením záznamu rollbacku. Nejde o test výpadku napájania. Samostatný zámok pre koreň klienta zabraňuje súbežným zápisom toho istého OS používateľa aj pri rozdielnych priečinkoch žurnálov. Windows podporuje obnovu po páde procesu; synchronizácia metadát adresárov pri výpadku napájania závisí od súborového systému.

Nezávislá kontrola jadra bola zopakovaná po opravách súbehu žurnálov a čítania inštrukčných súborov. Browserové UI sa v tomto kroku nemení; Safari kontrola sa na čisto backendové a CLI zmeny nevzťahuje. Test vstavaného servera používa syntetický klientsky priečinok a vypnutý engine, nenahrádza akceptáciu nainštalovanej alfy.
