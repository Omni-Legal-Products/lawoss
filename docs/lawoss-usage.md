# LAWOSS: krátky návod pre tím

Tento návod opisuje bezpečný spôsob práce v LAWOSS. Je určený pre prvé použitie aj pre bežnú právnu prácu; rozšírené možnosti používajte až po overení nastavení tímom.

## Prvých 10 minút

1. Na uvítacej obrazovke zvoľte **Použiť odporúčané nastavenie** a vyberte pracovný priečinok so spismi.
2. Pripojte AI model, ktorý má byť použitý pre túto prácu. Dokumenty odchádzajú iba k zvolenému modelu a podľa jeho podmienok.
3. Začnite neškodnou úlohou, napríklad: „Zhrň tento dokument do piatich bodov a uveď, čo treba overiť.“
4. Pred uložením skontrolujte návrh, zdroje, citácie a zmeny v dokumente. LAWOSS nemá nahradiť právne posúdenie advokáta.

Ak potrebujete konkrétnu cestu k priečinku alebo chcete nastavenie upraviť, zvoľte **Nastaviť podrobne**. Prerušený onboarding si zapamätá zvolený spôsob a posledný krok na tomto počítači.

## Bežná právna úloha

- Pomenujte cieľ, jurisdikciu, rozhodný dátum a požadovaný výstup.
- Pridajte iba dokumenty potrebné na danú úlohu. Pri citlivom spise skontrolujte, kam môže zvolený model odosielať obsah.
- Pri úprave dokumentu žiadajte najprv návrh alebo plán a až potom vykonanie. Vždy prejdite zmeny a komentáre pred uložením.
- Pri práci v otvorenom Worde nechajte otvorený LAWOSS panel. Nástroje `word_*` pracujú s dokumentom, ktorý používateľ vidí; pred úpravou si overia presný textový kotviaci úsek.
- Pri právnych záveroch vyžadujte označenie zdroja, dátumu a jurisdikcie. Nezamieňajte návrh modelu za overenú právnu autoritu.

## Nový spis a OKF

Pri zakladaní spisu vyplňte aspoň predmet, názov, jurisdikciu a identifikáciu protistrany, ak je známa. Pred zápisom si pozrite náhľad a overte, že cesta a názvy súborov patria správnemu spisu. Rozšírené OKF rozhodnutia používajte podľa tímového checklistu; nič z neho sa nepovažuje za schválené, kým tím nezapíše rozhodnutie.

## Rozšírené použitie

MCP konektory, skills, pamäť a agentné pracovné postupy zapínajte iba v rozsahu potrebnom pre úlohu. Pred použitím overte:

- aké dáta konektor číta alebo zapisuje;
- či sa použije lokálny alebo vzdialený model;
- aké potvrdenie je potrebné pred zmenou súboru alebo konfigurácie;
- ako sa bude výsledok spätne kontrolovať.

Pri nejasnosti sa vráťte k jednoduchému chatu, vyžiadajte si plán a pokračujte až po kontrole rozsahu. Bezpečnostné nastavenie a tímové rozhodnutia majú prednosť pred pohodlím automatizácie.

## Identita autora v DOCX

V **Settings → Personalisation → Document author** nastavte meno, ktoré sa má použiť pri nových úpravách v in-app DOCX editore. Nastavenie nemení existujúce revízie. Komentáre a natívne revízie vytvorené priamo v otvorenom Worde identifikuje Word podľa aktuálneho Office konta; túto identitu LAWOSS cez použité Office API neprepisuje.
