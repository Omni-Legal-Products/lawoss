# OKF scaffold

`okf plan/apply klient|spis|projekt` vytvára karty `client.md`, `matter.md`, `project.md`. Názvy príkazov a pôvodné polia kariet ostávajú kompatibilné; toto nie je hromadná migrácia dátového modelu.

Rozhodnutie o anglických názvoch: [zápis 11. 9. 2026](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/main/meetings/2026-09-11-zapis-sync-call.md).

Pri existujúcej `klient.md`, `spis.md` alebo `projekt.md` plán zachová tento názov aj obsah a nevytvorí kanonického dvojníka. `detect`, `validate`, `render` a natívny náhľad poznajú oba názvy. Dve karty rovnakého typu zastavia plán; najprv treba obsahovo vyriešiť konflikt. Zmena alebo odstránenie názvu karty medzi plánom a zápisom vyžaduje nový plán.

Odkazy v novej karte veci smerujú na skutočne nájdenú nadradenú kartu klienta. Ak ju CLI nenájde, uvedie pokyn otvoriť kartu v klientskom priečinku a nevymyslí cestu. UI používa skutočnú cestu načítanej karty, vrátane starého názvu.

Automatické premenovanie existujúcich klientskych súborov nie je súčasťou `apply`. Existujúce AGENTS/CLAUDE sa zachovávajú; nové dvojice sú obsahovo zhodné. Reálny migračný pilot potrebuje výslovne určenú kópiu spisu.

Ručný stav používa `manual_updated` a je opísaný v [pamäťovom jadre](../okf-pamat/README.md#ručný-stav-a-aktuálnosť).
