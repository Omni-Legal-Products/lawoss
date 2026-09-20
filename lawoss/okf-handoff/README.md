# Lokálne odovzdanie OKF

Natívny OpenCode plugin používa existujúce `okf-memory read` a `sync --apply` priamo, bez podprocesu, modelového volania, databázy alebo sieťovej požiadavky. Nespúšťa Git ani nezapisuje nové pamäťové tvrdenia.

Aktivuje sa iba pre pracovný priečinok, ktorého koreň obsahuje `matter.md` alebo `spis.md` s typom veci a bežný adresár `memory/`. Kanceláriu neprehľadáva a nevyberá z nej vec. Dve rozdielne karty, neplatný typ alebo zmena karty počas behu vyžadujú opravu a opätovné otvorenie workspace.

- `session.idle`: po skončení práce obnoví projekcie a uloží úplný výstup čítania.
- `experimental.session.compacting`: pred zhutnením vykoná to isté a doplní aktuálny kontext; nemení pôvodný compaction prompt.
- `experimental.chat.system.transform`: pred ďalším ťahom obnoví checkpoint a pridá odkaz naň aj požiadavku načítať aktuálnu pamäť.

Odvodený súbor `.lawoss/handoff/<session-id>.md` obsahuje hash kontextu, hash karty a pôvodné Revision tokeny pamäťových záznamov. `.status.md` vedľa neho rozlišuje pending, ready a error. Zápis používa dočasný súbor a atomic rename, súbory majú režim 0600. Nečitateľné alebo zmenené zdroje neprepíšu posledný dobrý checkpoint. Nezmenený kontext nevyvolá ďalšiu synchronizáciu; upravený odvodený súbor sa obnoví zo zdrojov. Pred zhutnením sa inline vkladá najviac 64 KiB: pri väčšom kontexte zostane úplný checkpoint na disku a prompt výslovne uvedie veľkosť, cestu a potrebu čítania zdrojov po častiach. Kontext nad 2 MiB sa odmietne s chybou, neskracuje sa potichu.

Je to rekonštruovateľná projekcia uložených zdrojov, nie ďalšia autoritatívna pamäť. Fakty, ktoré agent nikdy nezapísal, sa automaticky nevymýšľajú ani nevyťahujú z rozhovoru. Stav error sa vloží do nasledujúceho kontextu; pri chybe zapisovacieho oprávnenia zostáva aj upozornenie v lokálnom logu. Pád procesu môže ponechať pending; pri ďalšom ťahu sa stav znovu vyhodnotí. Zatvorenie okna ani tvrdé ukončenie procesu nie je garantovaný hook.

Plugin sám nič neposiela vzdialene. Pri bežnom zhutnení alebo ťahu kontext spracuje už zvolený model v existujúcom natívnom toku. Nezavádza tímovú synchronizáciu ani zámok pre cudzie editory.

Testy: `bun test lawoss/okf-handoff/`. Produkčný vstup je `apps/server/src/opencode-plugins/lawoss-okf-handoff.ts`; existujúci build servera ho zbalí medzi natívne pluginy. Overené rozhranie: `@opencode-ai/plugin` 1.18.29.
