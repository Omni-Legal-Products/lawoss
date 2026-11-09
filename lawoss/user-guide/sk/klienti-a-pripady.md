# Klienti a prípady

Otvoriť v LAWOSS: [Klienti](legalwork://app/projects), [Oprávnenia](legalwork://app/settings/permissions).

## Bočný panel

Hore v bočnom paneli sú **Dnes**, **Nový chat** a **Pridať klienta**. Pod nimi je sekcia **Klienti**; v jej hlavičke tlačidlo **Klienti a prípady** otvorí prehľad všetkých klientov a **Pridať klienta** začne pridanie ďalšieho. Sekcie **Pripnuté chaty** a **Nedávne chaty** sú v pokročilom režime; bez neho sú predvolene vypnuté a zapnete ich v prispôsobení bočného panela.

Pod rozbaleným klientom sú položky **Prehľad**, **Prípady**, **Chaty**, **Súbory** a **Pripojené priečinky**. Ostatné zapnuté položky sú pod **Viac**. V [pokročilom režime](pokrocily-rezim.md) sú všetky v jednom zozname, vrátane **Lehoty**, **Tabuľková kontrola**, **Úlohy** a **Pracovný priestor**.

Pod **Prípady** je každý prípad klienta, pod prípadom jeho chaty a **Nový chat**. Ak klient zatiaľ nemá prípad, zobrazí sa **Zatiaľ bez prípadov.**

## Pridať klienta alebo prípad

- **Pridať klienta** otvorí ten istý postup ako pri prvom spustení: vyberiete priečinok a LAWOSS ukáže **Toto sme našli**. Pozri [Prvé spustenie](zaciatok.md).
- Na stránke **Klienti a prípady** je aj **Pripojiť existujúci priečinok klienta** a **Nový prípad**.
- Klient nemôže byť vnútri iného klienta. Ak priečinok nesie kód iného klienta, LAWOSS ho ako klienta ani prípad nepripojí a ponúkne klienta, ktorému priečinok patrí.

## Prehľad klienta

**Prehľad** pod klientom ukazuje **Prehľad klienta**: jeho **Prípady** s fázou a ďalším krokom, **Najbližšie lehoty**, **Najbližší termín**, **Otvorené úlohy z prípadov**, **Vstupy klienta** a **Chaty klienta**. Odkaz **Všetky lehoty klienta** otvorí register lehôt len pre tohto klienta. Údaje sa čítajú z pomocných súborov OKF v priečinku klienta; ak sa niečo nedalo prečítať, prehľad to napíše (napríklad **Podklady sa nepodarilo prečítať, lehoty preto nie sú známe.**).

## Prípad

Kliknutím na prípad otvoríte jeho stránku. Karta **Prehľad** zhŕňa prípad v blokoch (napríklad **Základ**, **Konanie**, **Korporátna agenda**, **Duševné vlastníctvo**) podľa toho, čo LAWOSS rozpozná zo súborov. Bloky zmeníte cez **Upraviť** a **Uložiť do karty prípadu**. Karta **Čo vieme** ukazuje záznamy z pamäte prípadu.

Na stránke prípadu sú aj **Rozpracované chaty** s tlačidlom **Pokračovať**, **Časová os**, **Lehoty v najbližších 14 dňoch** a **Otvorené úlohy**.

Rýchle akcie otvoria chat k prípadu s pripravenou úlohou: **Zhrň prípad**, **Skontroluj lehoty**, **Priprav odpoveď**, **Pridať dokument** a **Over klienta**. Pod **Ďalšia práca na prípade** sú **Príprava na pojednávanie**, **Rešerš**, **Stratégia**, **Revízia dokumentu**, **List klientovi** a **Vyhotoviť dokument (Word/PDF)**. Rýchle akcie potrebujú pripojený model; ak chýba, stránka ponúkne **Otvoriť nastavenia AI**.

Dokumenty môžete na stránku prípadu pretiahnuť. Uložia sa do prípadu a čakajú na zaradenie (pozri [Dnes a lehoty](dnes-a-lehoty.md)).

## Pripojené priečinky

Ak má klient dokumenty aj mimo svojho hlavného priečinka, pripojte ich v **Pripojené priečinky** tlačidlom **Pripojiť priečinok**. V chatoch tohto klienta (aj v jeho prípadoch) ich agent číta bez pýtania; ak to dovolia oprávnenia v nastaveniach, môže v nich aj upravovať súbory. V chatoch iných klientov sa najprv opýta. Súbory v nich LAWOSS neusporadúva. Priečinok odpojíte tlačidlom **Odpojiť**; zmena platí hneď, aj pre otvorené chaty.

Pripájajte len priečinok, ktorý naozaj patrí tomuto klientovi. Ak priečinok nesie kód iného klienta alebo obsahuje priečinky viacerých klientov, LAWOSS upozorní a ponúkne **Nepripojiť** alebo **Pripojiť aj tak**. Nikdy nepripájajte priečinok nad priečinkom klienta ani priečinok s inými klientmi.

## Súbory

**Súbory** pod klientom ukazujú súbory v priečinku klienta. Dokumenty z odpovedí agenta otvoríte z odkazu v chate.

Súvisí: [Chaty](chaty.md), [Dnes a lehoty](dnes-a-lehoty.md), [Nastavenia](nastavenia.md).
