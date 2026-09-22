# OKF scaffold

`okf plan/apply klient|spis|projekt` vytvára karty `client.md`, `matter.md`, `project.md`. Názvy príkazov a pôvodné polia kariet ostávajú kompatibilné; toto nie je hromadná migrácia dátového modelu.

Rozhodnutie o anglických názvoch: [zápis 11. 9. 2026](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/main/meetings/2026-09-11-zapis-sync-call.md).

Pri existujúcej `klient.md`, `spis.md` alebo `projekt.md` plán zachová tento názov aj obsah a nevytvorí kanonického dvojníka. `detect`, `validate`, `render` a natívny náhľad poznajú oba názvy. Dve karty rovnakého typu zastavia plán; najprv treba obsahovo vyriešiť konflikt. Zmena alebo odstránenie názvu karty medzi plánom a zápisom vyžaduje nový plán.

Odkazy v novej karte veci smerujú na skutočne nájdenú nadradenú kartu klienta. Ak ju CLI nenájde, uvedie pokyn otvoriť kartu v klientskom priečinku a nevymyslí cestu. UI používa skutočnú cestu načítanej karty, vrátane starého názvu.

Automatické premenovanie existujúcich klientskych súborov nie je súčasťou `apply`. Existujúce AGENTS/CLAUDE sa zachovávajú; nové dvojice sú obsahovo zhodné. Reálny migračný pilot potrebuje výslovne určenú kópiu spisu.

Ručný stav používa `manual_updated` a je opísaný v [pamäťovom jadre](../okf-pamat/README.md#ručný-stav-a-aktuálnosť).

### Kancelársky profil v aplikácii

V natívnych **Nastavenia → Prispôsobenie** je kancelársky profil vybraného lokálneho workspace. Upravuje pracovné priečinky, priradenie rolí, vzor názvu dokumentov a voliteľný `client_path` v `Office/okf.config` (alebo existujúcom `_kancelaria/okf.config`). Ostatné položky vrátane trvalého oprávnenia zostanú zachované. Pri súbežnej zmene sa uloženie odmietne; načítajte profil znova a zopakujte úpravu. Otvorený klient či vec nie je koreň kancelárie — editor vtedy vyzve otvoriť kancelársky workspace.

Meno z existujúceho nastavenia **Meno advokáta a autor dokumentov** sa odovzdá do náhľadu aj CLI cez `--advokat`. Používa sa pre nové karty a nové zmeny v DOCX editore, neprepisuje existujúce dokumenty a samo neudeľuje oprávnenie na zápis. Predvolené označenie editora `LegalWork` sa nevydáva za meno advokáta. Natívne komentáre a revízie vo Worde naďalej identifikuje Word podľa Office konta.

Zmena kancelárskeho profilu sa prejaví pri nových veciach. Existujúci `PRACOVNY-PROFIL.md` sa nemení a žiadne súbory sa automaticky nepresúvajú.
