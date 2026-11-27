# Řešení problémů

Při hlášení chyby uveďte přesný text chyby a tlačítko nebo obrazovku, kterou jste použili.

| Co se děje | Co udělat |
| --- | --- |
| Agent neodpovídá, rychlé akce hlásí chybějící model | V nastavení na kartě **Poskytovatelé AI** připojte poskytovatele a vyberte model. Viz [AI a modely](ai-a-modely.md). |
| **Poskytovatel je připojen, ale model zatím není vybrán.** nebo **Vybraný model už není dostupný.** | Vyberte jiný model v nastavení AI nebo přímo v chatu. |
| Běžný chat odmítá zprávy s obsahem klienta | Jsou zapnuté **Hranice AI**. Viz [AI a modely](ai-a-modely.md). |
| Chat hlásí, že nemůže použít soubory klienta, protože LAWOSS nepotvrdil spojení se svým AI jádrem | Ukončete LAWOSS úplně, znovu ho otevřete a zprávu pošlete znovu. Nic se nepřečetlo ani nezměnilo. |
| Agent nevidí soubor mimo složku klienta | Pokud soubor patří tomuto klientovi, připojte jeho složku v **Připojené složky**. Složky jiných klientů nepřipojujte. Viz [Klienti a případy](klienti-a-pripady.md). |
| U PDF vidím **V PDF nebyl nalezen elektronický podpis**, přestože na stránce je obrázek podpisu | Obrázek může být součástí stránky. Otevřete podepsanou kopii a rozbalte údaje o elektronických podpisech. [Podpisy v PDF](klienti-a-pripady.md#elektronické-podpisy-v-pdf) |
| LAWOSS hlásí **Podpisy se nepodařilo zkontrolovat** nebo zobrazí částečný výsledek | Ověřte, že máte otevřený celý správný soubor. Pokud potřebujete rozhodnout o platnosti, ověřte původní PDF ve validátoru podpisů. |
| V chatu nevidím blesk **Fast** | Vyberte model připojeného předplatného ChatGPT, který nabízí přednostní zpracování. [AI a modely](ai-a-modely.md) |
| Naskenované PDF se nepřečte | Zapněte **Rozpoznávání textu ze skenů (OCR)**. Pokud stahování modelu selže, zkontrolujte připojení a volné místo na disku a zvolte **Opakovat stahování**. |
| Přehled nebo Dnes hlásí **Podklady se nepodařilo přečíst, lhůty proto nejsou známé.** nebo **Přehled praxe je neúplný. Mohou existovat další lhůty.** | Neúplný přehled neznamená, že lhůty nejsou. Zkontrolujte případy a zkuste stránku obnovit. |
| **Chaty se nepodařilo načíst** | Zvolte **Zkusit znovu**. |
| Změny souborů se dělají bez ptaní | Je zapnutý YOLO Mode. Vypnete ho v nastavení na kartě **Oprávnění nástrojů** (pokročilý režim). |
| Balíček z Marketplace se nenainstaluje | Instalace vyžaduje dostupnou složku a oprávnění k zápisu. Zkuste to znovu na kartě **Integrace**. |
| **Aktualizace se nepodařilo zkontrolovat** | Zkontrolujte internet a zvolte **Zkontrolovat nyní** znovu. |

## Nahlásit chybu nebo nápad

Hlášení pošlete přímo z aplikace: v postranním panelu zvolte **Nahlásit chybu nebo nápad**, nebo **Nápověda → Nahlásit chybu nebo nápad**. Pokud se aplikace nespustí, stejné tlačítko je i na chybové obrazovce.

1. Vyberte, zda hlásíte chybu, nápad nebo dotaz. U chyby zvolte, jak moc vám vadí.
2. Popište, co jste dělali, co se stalo a co se mělo stát, a jak často se to děje.
3. **Snímek okna** je nepovinný. Aplikace ho pořídí před otevřením okna hlášení; v náhledu zkontrolujte, že na něm nejsou jména klientů ani dokumenty.
4. **Přiložit diagnostiku** je zaškrtnuté. Jde o technické záznamy aplikace bez hesel, klíčů, e-mailů a názvů složek klientů. Tlačítkem **Zobrazit, co se odešle** si prohlédnete přesně to, co se pošle.
5. E-mail je nepovinný a slouží jen k odpovědi. Do hlášení nepište údaje klientů.

Po odeslání aplikace ukáže číslo hlášení. Pokud odeslání selže, aplikace řekne proč a nabídne **Uložit hlášení do počítače** a **Otevřít webový formulář**, kde uložené soubory přiložíte.

Karta **Ladění** je jen pro vývojáře a běžně se nezobrazuje.

Související: [Nastavení](nastavenia.md), [Integrace](integracie.md), [Chaty](chaty.md).
