# AI a modely

Otvoriť v LAWOSS: [Poskytovatelia AI](legalwork://app/settings/ai).

## Pripojiť poskytovateľa

Agent odpovedá cez poskytovateľa AI, ktorého pripojíte. Otvorte nastavenia, kartu **Poskytovatelia AI**, a v časti **Poskytovatelia** zvoľte **Pridať poskytovateľa**. Prihlasovacie údaje alebo kľúč zadajte do formulára, nikdy nie do chatu. Pripojiť sa dá aj predplatným ChatGPT.

Pripojený poskytovateľ má v zozname ponuku, cez ktorú ho upravíte alebo odpojíte. Bez poskytovateľa agent neodpovedá; zvyšok aplikácie (klienti, súbory, prehľady) funguje ďalej.

Model vyberiete pri prvom spustení v kroku **AI asistent** (**Model asistenta**) alebo priamo v chate. Ak poskytovateľ ponúka len bezplatné modely, LAWOSS upozorní: s podkladmi klientov ich nepoužívame, pripojte platený alebo vlastný model.

Vzdialený poskytovateľ dostane obsah dokumentov, s ktorými agent pracuje. Pred použitím s údajmi klientov posúďte konkrétnu službu, účel a údaje; prihlásenie ani platený program také posúdenie nenahrádzajú.

## AI hranice

Na tej istej karte je prepínač **AI hranice**. Keď sú zapnuté, aplikácia neposiela obsah prípadov žiadnemu modelu okrem chráneného generovania dokumentov a bežný chat je vypnutý. Keď sú vypnuté, bežný chat posiela to, čo doň napíšete alebo priložíte, zvolenému poskytovateľovi bez ďalšieho potvrdenia. Ak je prepínač zamknutý nastavením počítača, v aplikácii ho vypnúť nemožno.

## Naskenované dokumenty (OCR)

V časti **Naskenované dokumenty** je voľba **Rozpoznávanie textu zo skenov (OCR)**. Kým je vypnutá, LAWOSS číta z dokumentov len ich vlastnú textovú vrstvu a naskenované strany neprečíta; model nesťahuje ani nespúšťa.

Po zapnutí LAWOSS jednorazovo stiahne lokálny model PaddleOCR z huggingface.co (tlačidlom **Stiahnuť model** alebo pri prvom naskenovanom dokumente). Naskenované strany sa potom čítajú na tomto počítači a dokumenty sa nikam neodosielajú. Ak sťahovanie zlyhá, skontrolujte pripojenie a voľné miesto na disku a zvoľte **Skúsiť stiahnuť znova**. Stiahnutý model zmažete tlačidlom **Odstrániť model**.

Súvisí: [Prvé spustenie](zaciatok.md), [Chaty](chaty.md), [Riešenie problémov](riesenie-problemov.md).
