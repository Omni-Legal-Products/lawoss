# Lokálne odovzdanie pamäte

Bez súborového profilu natívny OpenCode plugin používa existujúce `okf-memory read` a `sync --apply` priamo, bez podprocesu, modelového volania, databázy alebo sieťovej požiadavky. Nespúšťa Git ani nezapisuje nové pamäťové tvrdenia.

Kanonický postup sa aktivuje iba pre pracovný priečinok, ktorého koreň obsahuje `matter.md` alebo `spis.md` s typom veci a bežný adresár `memory/`. Kanceláriu neprehľadáva a nevyberá z nej vec. Dve rozdielne karty, neplatný typ alebo zmena karty počas behu vyžadujú opravu a opätovné otvorenie workspace.

- `session.idle`: po skončení práce obnoví projekcie a uloží úplný výstup čítania.
- `experimental.session.compacting`: pred zhutnením vykoná to isté a doplní aktuálny kontext; nemení pôvodný compaction prompt.
- `experimental.chat.system.transform`: pred ďalším ťahom obnoví checkpoint a pridá odkaz naň aj požiadavku načítať aktuálnu pamäť.

Odvodený súbor `.lawoss/handoff/<session-id>.md` obsahuje hash kontextu, hash karty a pôvodné Revision tokeny pamäťových záznamov. `.status.md` vedľa neho rozlišuje pending, ready a error. Zápis používa dočasný súbor a atomic rename, súbory majú režim 0600. Nečitateľné alebo zmenené zdroje neprepíšu posledný dobrý checkpoint. Nezmenený kontext nevyvolá ďalšiu synchronizáciu; upravený odvodený súbor sa obnoví zo zdrojov. Pred zhutnením sa inline vkladá najviac 64 KiB: pri väčšom kontexte zostane úplný checkpoint na disku a prompt výslovne uvedie veľkosť, cestu a potrebu čítania zdrojov po častiach. Kontext nad 2 MiB sa odmietne s chybou, neskracuje sa potichu.

Je to rekonštruovateľná projekcia uložených zdrojov, nie ďalšia autoritatívna pamäť. Fakty, ktoré agent nikdy nezapísal, sa automaticky nevymýšľajú ani nevyťahujú z rozhovoru. Stav error sa vloží do nasledujúceho kontextu; pri chybe zapisovacieho oprávnenia zostáva aj upozornenie v lokálnom logu. Pád procesu môže ponechať pending; pri ďalšom ťahu sa stav znovu vyhodnotí. Zatvorenie okna ani tvrdé ukončenie procesu nie je garantovaný hook.

Plugin sám nič neposiela vzdialene. Pri bežnom zhutnení alebo ťahu kontext spracuje už zvolený model v existujúcom natívnom toku. Nezavádza tímovú synchronizáciu ani zámok pre cudzie editory.

Testy: `bun test lawoss/okf-handoff/`. Produkčný vstup je `apps/server/src/opencode-plugins/lawoss-okf-handoff.ts`; existujúci build servera ho zbalí medzi natívne pluginy. Overené rozhranie: `@opencode-ai/plugin` 1.18.29.

Checkpoint zahŕňa aj ručné časti `_STATUS.md` a deklarovaný `manual_updated`. Automatický sync tento dátum neposúva. Odvodené bloky sa nezdvojujú; zdrojové záznamy pamäte ostávajú úplné. Pri chybných markeroch checkpoint hlási chybu a zachová posledný dobrý súbor.


## Explicitný profil existujúcich súborov

Prítomný `.lawoss/memory-profile.json` vyberie `workspace-checkpoint.mjs` aj pri
chybe profilu. Ten používa súborový reader bez typovaného `sync`, nevytvorí
`memory/`, `_STATUS.md` ani kartu. [Profil, SAVE a presné CLI príkazy](../okf-pamat/SKILL.md#existujúca-súborová-pamäť-profil-má-prednosť),
[špecifikácia](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/06aba22/specs/2026-09-21-riha-memory-parity.md).

Host môže povoliť externé korene iba striktným JSON poľom absolútnych ciest:

```sh
export LAWOSS_MEMORY_ALLOWED_ROOTS='["/absolute/vault", "/absolute/archive"]'
# Potom spusti LAWOSS z prostredia s touto premennou.
```

Premenná sa zachytí pri vytvorení handoffu; profil ani metadáta granty neudeľujú.
Neplatná premenná, nepovolený koreň a chýbajúci/nečitateľný zdroj dajú viditeľnú
chybu. Nepribúda GUI nastavenie alebo externá pamäť do existujúceho prehľadu appky.

Každý hook číta aktuálne zdroje a pred uložením ich znovu skontroluje.
`bindingHash` viaže sémantickú identitu, mapovanie a caller granty, `contextHash`
aj revízie textov. Čas `loadedAt` nerozhoduje o zmene obsahu. Počas behu sa
nezmenený checkpoint neopakuje; nová factory môže odvodený súbor obnoviť aj pri
rovnakom obsahu, bez aktualizácie právneho stavu.

`.lawoss/handoff/<session>.workspace-binding.json` pripína session ku koreňu,
veci a binding hash. Rovnaká session po obnove factory neprijme zmenené mapovanie;
nová session môže. Bežné zmeny textov a formátovanie profilu sú dovolené.
Odstránenie profilu je počas behu chyba; po reštarte zostáva viditeľné, pokiaľ
ostáva marker. Po odstránení profilu aj všetkých markerov sa predchádzajúca väzba
nedá zistiť. Kontrola ciest a schémy nie je kryptografická ochrana pred priamym
prepísaním súborov ich vlastníkom.

Adresáre majú 0700, staging aj publikované súbory 0600. Symlinky, nepravidelné
ciele a neplatné session ID sa odmietnu. Text zdroja neudeľuje oprávnenia.
Posledný dobrý checkpoint ostáva pri chybe alebo prekročení 2 MiB renderovaného
kontextu zachovaný a označený za neaktuálny; nad 64 KiB hook vyžiada čítanie
plného súboru/zdrojov po častiach. Nejde o viacsúborovú OS transakciu alebo
izoláciu proti nepriateľskému zapisovateľovi. Dátum načítania nie je overenie
právneho stavu, podpisu, podania ani doručenia.
