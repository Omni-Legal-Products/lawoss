# Lokalizace a přesné názvy ovládacích prvků

## Jazyk aplikace

Jazyk rozhraní změníte v nastavení na kartě **Jazyk**. LAWOSS má slovenštinu (`sk`), češtinu (`cs`), angličtinu (`en`) a němčinu (`de`); volba **Podle systému** se řídí jazykem operačního systému. Změna se projeví hned.

Jazyk rozhraní, jazyk nových dokumentů a právo, se kterým kancelář pracuje, jsou samostatné volby. Viz [První spuštění](zaciatok.md).

## Přesné texty

Tabulka [i18n.json](../i18n.json) obsahuje všechny texty rozhraní ve všech jazycích. Tabulky jiných jazyků než `sk`, `cs`, `en` a `de` jsou neúplné a v aplikaci je nelze zvolit. Některé texty patří skrytým obrazovkám; shoda v tabulce proto nedokazuje, že tlačítko v LAWOSS opravdu je. Ověřte to na příslušné stránce této příručky. Kde tabulka uvádí název LegalWork, aplikace zobrazuje LAWOSS.

Celý soubor nenačítejte. Použijte pomocný skript skillu `legalwork-help`:

```sh
node .opencode/skills/legalwork-help/scripts/lookup-label.mjs cs settings.tab_ai
node .opencode/skills/legalwork-help/scripts/lookup-label.mjs sk "Připojené složky"
```

První argument je jazyk, další je přesný klíč nebo hledaný text. Výsledek obsahuje text ve zvoleném jazyce, anglický text a všechny překlady. Skript čte jen přibalený soubor a nepotřebuje síť.

Zástupné znaky jako `{name}` nebo `{count}` ponechte, dokud neznáte skutečnou hodnotu. Texty průvodce prvním spuštěním (například **Toto jsme našli**) v tabulce nejsou; jsou přímo na stránce [První spuštění](zaciatok.md) v češtině a ve [slovenštině](../sk/zaciatok.md).
