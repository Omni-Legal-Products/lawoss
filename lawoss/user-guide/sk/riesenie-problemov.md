# Riešenie problémov

Pri hlásení chyby uveďte presný text chyby a tlačidlo alebo obrazovku, ktorú ste použili.

| Čo sa deje | Čo urobiť |
| --- | --- |
| Agent neodpovedá, rýchle akcie hlásia chýbajúci model | V nastaveniach na karte **Poskytovatelia AI** pripojte poskytovateľa a vyberte model. Pozri [AI a modely](ai-a-modely.md). |
| **Poskytovateľ je pripojený, ale model zatiaľ nie je vybraný.** alebo **Vybraný model už nie je dostupný.** | Vyberte iný model v nastaveniach AI alebo priamo v chate. |
| Bežný chat odmieta správy s obsahom klienta | Sú zapnuté **AI hranice**. Pozri [AI a modely](ai-a-modely.md). |
| Chat hlási, že nemôže použiť súbory klienta, lebo LAWOSS nepotvrdil spojenie so svojím AI jadrom | Ukončite LAWOSS úplne, znova ho otvorte a správu pošlite znova. Nič sa neprečítalo ani nezmenilo. |
| Agent nevidí súbor mimo priečinka klienta | Ak súbor patrí tomuto klientovi, pripojte jeho priečinok v **Pripojené priečinky**. Priečinky iných klientov nepripájajte. Pozri [Klienti a prípady](klienti-a-pripady.md). |
| Naskenované PDF sa neprečíta | Zapnite **Rozpoznávanie textu zo skenov (OCR)**. Ak sťahovanie modelu zlyhá, skontrolujte pripojenie a voľné miesto na disku a zvoľte **Skúsiť stiahnuť znova**. |
| Prehľad alebo Dnes hlási **Podklady sa nepodarilo prečítať, lehoty preto nie sú známe.** alebo **Prehľad praxe je neúplný. Môžu existovať ďalšie lehoty.** | Neúplný prehľad neznamená, že lehoty nie sú. Skontrolujte prípady a skúste obnoviť stránku. |
| **Chaty sa nepodarilo načítať** | Zvoľte **Skúsiť znova**. |
| Zmena súborov sa robí bez pýtania | Je zapnutý YOLO Mode. Vypnete ho v nastaveniach na karte **Oprávnenia nástrojov** (pokročilý režim). |
| Balík z Marketplace sa nenainštaluje | Inštalácia vyžaduje dostupný priečinok a oprávnenie na zápis. Skúste to znova na karte **Integrácie**. |
| **Aktualizácie sa nepodarilo skontrolovať** | Skontrolujte internet a zvoľte **Skontrolovať teraz** znova. |

Karta **Ladenie** je len pre vývojárov a bežne sa nezobrazuje.

Súvisí: [Nastavenia](nastavenia.md), [Integrácie](integracie.md), [Chaty](chaty.md).
