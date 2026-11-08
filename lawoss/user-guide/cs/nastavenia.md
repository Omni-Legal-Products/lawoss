# Nastavení

Nastavení otevřete tlačítkem **Nastavení** (ozubené kolečko) v postranním panelu. V záhlaví nastavení je výběr klienta, jehož nastavení upravujete, a přepínač **Pokročilé** (viz [První spuštění](zaciatok.md)).

## Karty, které jsou vždy

| Karta | K čemu slouží |
| --- | --- |
| [Nastavení](legalwork://app/settings/general) | Přehled nastavení. |
| [Poskytovatelé AI](legalwork://app/settings/ai) | Poskytovatelé a modely, hranice AI, OCR skenů. Viz [AI a modely](ai-a-modely.md). |
| [Integrace](legalwork://app/settings/extensions/plugins) | LAWOSS Marketplace, konektory, skilly, pluginy, úložiště souborů. Viz [Integrace](integracie.md). |
| [Oprávnění](legalwork://app/settings/permissions) | Autorizované složky a přístup k souborům pro vybraného klienta. |
| [Personalizace](legalwork://app/settings/personalisation) | Doplňky systémového promptu, místní paměť a osobnost odpovědí. |
| **Jazyk** | Jazyk rozhraní: slovenština, čeština, angličtina, němčina nebo **Podle systému**. |
| [Aktualizace](legalwork://app/settings/updates) | Verze aplikace a aktualizace. |

## Karty v pokročilém režimu

| Karta | K čemu slouží |
| --- | --- |
| [Oprávnění nástrojů](legalwork://app/settings/safety) | Co smí agent dělat sám, bez ptaní, napříč všemi klienty; nahoře je **YOLO Mode** (viz [Chaty](chaty.md)). |
| [Oznámení](legalwork://app/settings/notifications) | Oznámení o úlohách. |
| [Přizpůsobení](legalwork://app/settings/shell) | Branding a návrhy úkolů. |
| [Tajné údaje](legalwork://app/settings/environment) | Klíče API a hesla ke službám, ke kterým se agent připojuje. Klíč zadejte sem, ne do chatu. |
| [Soukromí](legalwork://app/settings/preferences) | Analytika používání je v LAWOSS natrvalo vypnutá a nelze ji zapnout. |
| [Doplňky Office](legalwork://app/settings/office-addins) | Viz [Pokročilý režim](pokrocily-rezim.md). |
| [Tabelární přehled](legalwork://app/settings/tabular-review) | Výchozí nastavení nových tabulkových kontrol. Viz [Pokročilý režim](pokrocily-rezim.md). |

## Oprávnění a složky

Agent pracuje ve složce klienta a v jeho [připojených složkách](klienti-a-pripady.md). Složky jiného klienta, složku s více klienty ani složku nad složkou klienta neautorizujte; agent by pak viděl i soubory jiných klientů. Pokud složky mimo klienta spravuje vaše organizace, změnu zde neuložíte.

## Aktualizace

Na kartě **Aktualizace** zvolte **Zkontrolovat nyní**. Připravenou verzi nainstalujete tlačítkem **Nainstalovat a restartovat**; aktivní úlohy se tím přeruší. **Kontrolovat automaticky** hledá nové verze na pozadí. V části **Kanál vydání** je **Stabilní** (plně otestovaná vydání) a **Alfa** (nejnovější změny, mohou být méně vyladěné), pokud ho vaše sestava nabízí.

Související: [AI a modely](ai-a-modely.md), [Integrace](integracie.md), [Řešení problémů](riesenie-problemov.md).
