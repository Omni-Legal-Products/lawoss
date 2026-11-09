# Lokalizácia a presné názvy ovládacích prvkov

## Jazyk aplikácie

Jazyk rozhrania zmeníte v nastaveniach na karte **Jazyk**. LAWOSS má slovenčinu (`sk`), češtinu (`cs`), angličtinu (`en`) a nemčinu (`de`); voľba **Podľa systému** sa riadi jazykom operačného systému. Zmena sa prejaví hneď.

Jazyk rozhrania, jazyk nových dokumentov a právo, s ktorým kancelária pracuje, sú samostatné voľby. Pozri [Prvé spustenie](zaciatok.md).

## Presné texty

Tabuľka [i18n.json](../i18n.json) obsahuje všetky texty rozhrania vo všetkých jazykoch. Tabuľky iných jazykov než `sk`, `cs`, `en` a `de` sú neúplné a v aplikácii sa nedajú zvoliť. Niektoré texty patria skrytým obrazovkám; zhoda v tabuľke preto nedokazuje, že tlačidlo v LAWOSS naozaj je. Overte to na príslušnej stránke tejto príručky. Kde tabuľka uvádza názov LegalWork, aplikácia zobrazuje LAWOSS.

Celý súbor nenačítavajte. Použite pomocný skript skillu `legalwork-help`:

```sh
node .opencode/skills/legalwork-help/scripts/lookup-label.mjs sk settings.tab_ai
node .opencode/skills/legalwork-help/scripts/lookup-label.mjs cs "Pripojené priečinky"
```

Prvý argument je jazyk, ďalší je presný kľúč alebo hľadaný text. Výsledok obsahuje text v zvolenom jazyku, anglický text a všetky preklady. Skript číta len pribalený súbor a nepotrebuje sieť.

Zástupné znaky ako `{name}` alebo `{count}` ponechajte, kým nepoznáte skutočnú hodnotu. Texty sprievodcu prvým spustením (napríklad **Toto sme našli**) v tabuľke nie sú; sú priamo na stránke [Prvé spustenie](zaciatok.md) v slovenčine a v [češtine](../cs/zaciatok.md).
