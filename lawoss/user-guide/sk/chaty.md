# Chaty

Otvoriť v LAWOSS: [Oprávnenia nástrojov](legalwork://app/settings/safety), [Poskytovatelia AI](legalwork://app/settings/ai).

## Nový chat

Chat začnete tlačidlom **Nový chat** v bočnom paneli alebo pod konkrétnym prípadom. Chat klienta pracuje s priečinkom klienta a s jeho [pripojenými priečinkami](klienti-a-pripady.md); chat prípadu navyše vie, o ktorý prípad ide. Rozpracované chaty nájdete pod klientom v **Chaty** a pod prípadom.

Do poľa **Opíšte svoju úlohu...** napíšte, čo potrebujete, napríklad: „Prečítaj zmluvu a vypíš ustanovenia o odstúpení s odkazom na články.“ Súbory pridáte cez **Priložiť súbory**. Model vyberiete priamo v chate; ak nie je pripojený žiadny, pozri [AI a modely](ai-a-modely.md).

Ak napíšete `/`, zobrazí sa zoznam skillov a príkazov. Pribalené skilly OKF sú napríklad `/novy-spis`, `/okf-pamat`, `/usporiadaj-spis`, `/roztried-spis` a `/vystup-dokumentu`. Ďalšie skilly pridáte v [Integráciách](integracie.md).

Odpoveď chatu nie je dôkaz, že sa súbor uložil. Skontrolujte odkaz na výstup a prípadné chyby nástrojov.

## Schvaľovanie zmien

Agent smie čítať dokumenty klienta a pamäť prípadu bez pýtania. Pred zmenou sa vás spýta kartou, ktorá ukazuje presne, čo sa stane:

- zmeny súborov, napríklad **Premenovať?**, **Presunúť?**, **Kopírovať?**, **Vytvoriť priečinok?** alebo **Presunúť do Koša?** (zmazané položky idú do Koša, odkiaľ ich obnovíte);
- zápis do pamäte prípadu: **Zapísať do pamäte prípadu?** so zoznamom toho, čo a kam sa zapíše;
- príkazy a iné nástroje so skontrolovaným rozsahom.

Na karte zvoľte **Povoliť raz**, **Povoliť do konca konverzácie** alebo **Zamietnuť**. Zamietnutie nič nezmení. Ak cesta patrí inému klientovi, karta to napíše (**Pozor: priečinok patrí inému klientovi**) a ponúkne aj **Povoliť pre tohto klienta**; takú žiadosť povoľte len vtedy, ak to naozaj chcete.

## YOLO Mode

**YOLO Mode** je v nastaveniach na karte **Oprávnenia nástrojov** (v pokročilom režime) a dá sa zvoliť aj pri prvom spustení. Predvolene je vypnutý. Zapnutý YOLO Mode nechá agenta bez pýtania presúvať, premenúvať, upravovať a mazať súbory a spúšťať príkazy s plnými právami vášho používateľského účtu. Pred zapnutím sa LAWOSS opýta (**Zapnúť YOLO Mode?**). Kým je zapnutý, v chate je značka **YOLO**.

Aj v YOLO Mode sa súborové nástroje LAWOSS pred otvorením priečinka iného klienta pýtajú kartou s varovaním. Príkazy, ktoré agent spustí priamo, túto ochranu nemajú a mazanie nimi je trvalé. Majte zálohy. Ak oprávnenia nástrojov spravuje vaša organizácia, YOLO Mode ostáva vypnutý.

## Čo agent nerobí

Agent pripravuje a navrhuje. Odoslanie, podanie alebo podpis sa schvaľujú samostatne pre konkrétny úkon. Výstup agenta nie je overená právna rada; posúdenie je na advokátovi.

Súvisí: [Klienti a prípady](klienti-a-pripady.md), [Nastavenia](nastavenia.md), [Riešenie problémov](riesenie-problemov.md).
