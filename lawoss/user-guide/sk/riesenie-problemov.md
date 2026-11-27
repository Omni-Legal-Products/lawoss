# Riešenie problémov

Pri hlásení chyby uveďte presný text chyby a tlačidlo alebo obrazovku, ktorú ste použili.

| Čo sa deje | Čo urobiť |
| --- | --- |
| Agent neodpovedá, rýchle akcie hlásia chýbajúci model | V nastaveniach na karte **Poskytovatelia AI** pripojte poskytovateľa a vyberte model. Pozri [AI a modely](ai-a-modely.md). |
| **Poskytovateľ je pripojený, ale model zatiaľ nie je vybraný.** alebo **Vybraný model už nie je dostupný.** | Vyberte iný model v nastaveniach AI alebo priamo v chate. |
| Bežný chat odmieta správy s obsahom klienta | Sú zapnuté **AI hranice**. Pozri [AI a modely](ai-a-modely.md). |
| Chat hlási, že nemôže použiť súbory klienta, lebo LAWOSS nepotvrdil spojenie so svojím AI jadrom | Ukončite LAWOSS úplne, znova ho otvorte a správu pošlite znova. Nič sa neprečítalo ani nezmenilo. |
| Agent nevidí súbor mimo priečinka klienta | Ak súbor patrí tomuto klientovi, pripojte jeho priečinok v **Pripojené priečinky**. Priečinky iných klientov nepripájajte. Pozri [Klienti a prípady](klienti-a-pripady.md). |
| Pri PDF vidím **V PDF sa nenašiel elektronický podpis**, hoci na strane je obrázok podpisu | Obrázok môže byť súčasťou stránky. Otvorte podpísanú kópiu a rozbaľte údaje o elektronických podpisoch. [Podpisy v PDF](klienti-a-pripady.md#elektronické-podpisy-v-pdf) |
| LAWOSS hlási **Podpisy sa nepodarilo skontrolovať** alebo zobrazí čiastočný výsledok | Overte, že ste otvorili celý správny súbor. Pri potrebe rozhodnúť o platnosti overte pôvodné PDF vo validátore podpisov. |
| V chate nevidím blesk **Fast** | Vyberte model pripojeného predplatného ChatGPT, ktorý ponúka prednostné spracovanie. [AI a modely](ai-a-modely.md) |
| Naskenované PDF sa neprečíta | Zapnite **Rozpoznávanie textu zo skenov (OCR)**. Ak sťahovanie modelu zlyhá, skontrolujte pripojenie a voľné miesto na disku a zvoľte **Skúsiť stiahnuť znova**. |
| Prehľad alebo Dnes hlási **Podklady sa nepodarilo prečítať, lehoty preto nie sú známe.** alebo **Prehľad praxe je neúplný. Môžu existovať ďalšie lehoty.** | Neúplný prehľad neznamená, že lehoty nie sú. Skontrolujte prípady a skúste obnoviť stránku. |
| **Chaty sa nepodarilo načítať** | Zvoľte **Skúsiť znova**. |
| Zmena súborov sa robí bez pýtania | Je zapnutý YOLO Mode. Vypnete ho v nastaveniach na karte **Oprávnenia nástrojov** (pokročilý režim). |
| Balík z Marketplace sa nenainštaluje | Inštalácia vyžaduje dostupný priečinok a oprávnenie na zápis. Skúste to znova na karte **Integrácie**. |
| **Aktualizácie sa nepodarilo skontrolovať** | Skontrolujte internet a zvoľte **Skontrolovať teraz** znova. |

## Nahlásiť chybu alebo nápad

Hlásenie pošlete priamo z appky: v bočnom paneli zvoľte **Nahlásiť chybu alebo nápad**, alebo **Pomocník → Nahlásiť chybu alebo nápad**. Ak appka nenaštartuje, rovnaké tlačidlo je aj na chybovej obrazovke.

1. Vyberte, či hlásite chybu, nápad alebo otázku. Pri chybe zvoľte, ako veľmi vám prekáža.
2. Opíšte, čo ste robili, čo sa stalo a čo sa malo stať, a ako často sa to deje.
3. **Snímka okna** je nepovinná. Appka ju urobí pred otvorením okna hlásenia; skontrolujte náhľad, že na nej nie sú mená klientov ani dokumenty.
4. **Priložiť diagnostiku** je zaškrtnuté. Ide o technické záznamy appky bez hesiel, kľúčov, e-mailov a názvov priečinkov klientov. Tlačidlom **Zobraziť, čo sa odošle** si pozriete presne to, čo sa pošle.
5. E-mail je nepovinný a slúži len na odpoveď. Do hlásenia nepíšte údaje klientov.

Po odoslaní appka ukáže číslo hlásenia. Ak odoslanie zlyhá, appka povie prečo a ponúkne **Uložiť hlásenie do počítača** a **Otvoriť webový formulár**, kde uložené súbory priložíte.

Karta **Ladenie** je len pre vývojárov a bežne sa nezobrazuje.

Súvisí: [Nastavenia](nastavenia.md), [Integrácie](integracie.md), [Chaty](chaty.md).
