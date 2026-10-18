# @lawoss/okf-reader

Prenositeľné čítanie OKF. [Specifikácia](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/dcd7661/specs/0018-obsidian-okf-plugin.md).

`OkfReadSource.list(path)` vracia bezprostredné súbory/priečinky a príznak neúplného výpisu. `readText(path)` vracia skutočný obsah. Obe cesty sú relatívne ku koreňu zdroja. Hostiteľ zabezpečuje fyzický rozsah a dekódovanie; API nemá zápis.

`readOkfSnapshot(source, roots, todayIso)` načíta výber v tom istom zdroji. Nadradené klientské/kancelárske vrstvy sa čítajú z predkov výberu v zdroji; výber nie je oprávnenie agenta ani OS sandbox. Prázdny zoznam koreňov nečíta nič, `['']` zvolí celý zdroj. Snapshot obsahuje pôvodné zdrojové cesty, klientov aj bez vecí, samostatnú kancelársku pamäť, diagnostiku a `truncated`. Pri prekročení limitov je prehľad čiastočný.

`readOkfRoot` slúži existujúcemu serverovému adaptéru aplikácie. Zdieľané `view-rules` a `time` zachovávajú dnešnú naliehavosť, okno a miestny kalendárny deň. Verzia záznamu `okf: 1` je podporovaná; neznáma verzia má diagnostiku a dá sa otvoriť ako pôvodný text. To je verzia poľa v zázname, nie verzia npm balíčka ani konštanta verzie CLI.

Žiadna databáza, sieť, React, Obsidian ani Node runtime. Čítacie mapy existujú len počas čítania; výsledný snapshot len počas života spotrebiteľa.
