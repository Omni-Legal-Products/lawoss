# Řešení problémů

Při hlášení chyby uveďte přesný text chyby a tlačítko nebo obrazovku, kterou jste použili.

| Co se děje | Co udělat |
| --- | --- |
| Agent neodpovídá, rychlé akce hlásí chybějící model | V nastavení na kartě **Poskytovatelé AI** připojte poskytovatele a vyberte model. Viz [AI a modely](ai-a-modely.md). |
| **Poskytovatel je připojen, ale model zatím není vybrán.** nebo **Vybraný model už není dostupný.** | Vyberte jiný model v nastavení AI nebo přímo v chatu. |
| Běžný chat odmítá zprávy s obsahem klienta | Jsou zapnuté **Hranice AI**. Viz [AI a modely](ai-a-modely.md). |
| Chat hlásí, že nemůže použít soubory klienta, protože LAWOSS nepotvrdil spojení se svým AI jádrem | Ukončete LAWOSS úplně, znovu ho otevřete a zprávu pošlete znovu. Nic se nepřečetlo ani nezměnilo. |
| Agent nevidí soubor mimo složku klienta | Pokud soubor patří tomuto klientovi, připojte jeho složku v **Připojené složky**. Složky jiných klientů nepřipojujte. Viz [Klienti a případy](klienti-a-pripady.md). |
| Naskenované PDF se nepřečte | Zapněte **Rozpoznávání textu ze skenů (OCR)**. Pokud stahování modelu selže, zkontrolujte připojení a volné místo na disku a zvolte **Opakovat stahování**. |
| Přehled nebo Dnes hlásí **Podklady se nepodařilo přečíst, lhůty proto nejsou známé.** nebo **Přehled praxe je neúplný. Mohou existovat další lhůty.** | Neúplný přehled neznamená, že lhůty nejsou. Zkontrolujte případy a zkuste stránku obnovit. |
| **Chaty se nepodařilo načíst** | Zvolte **Zkusit znovu**. |
| Změny souborů se dělají bez ptaní | Je zapnutý YOLO Mode. Vypnete ho v nastavení na kartě **Oprávnění nástrojů** (pokročilý režim). |
| Balíček z Marketplace se nenainstaluje | Instalace vyžaduje dostupnou složku a oprávnění k zápisu. Zkuste to znovu na kartě **Integrace**. |
| **Aktualizace se nepodařilo zkontrolovat** | Zkontrolujte internet a zvolte **Zkontrolovat nyní** znovu. |

Karta **Ladění** je jen pro vývojáře a běžně se nezobrazuje.

Související: [Nastavení](nastavenia.md), [Integrace](integracie.md), [Chaty](chaty.md).
