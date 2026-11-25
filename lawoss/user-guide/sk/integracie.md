# Integrácie: Marketplace, konektory, skilly a pluginy

Otvoriť v LAWOSS: [Integrácie](legalwork://app/settings/extensions), [Skills](legalwork://app/settings/workflows/skills), [Úložisko súborov](legalwork://app/settings/extensions/storage).

V **Integráciách** nájdete dostupné pripojenia, nainštalované položky, LAWOSS Marketplace, Google Workspace cez gog a nástroje kancelárie. Tlačidlo **Pridať vlastné MCP** otvorí formulár pripojenia. Skilly majú samostatnú položku v nastaveniach.

Bez doplnkov agent odpovedá z toho, čo sa naučil. S nimi overí aktuálny zdroj: firmu v Obchodnom registri, platné znenie zákona, súdne rozhodnutie.

## Zdroje integrácií

Karta **Zdroje integrácií** ukazuje, odkiaľ integrácie pochádzajú:

- **LAWOSS** (**Predvolený**): katalóg LAWOSS Marketplace a pribalené nástroje DOCX Redline, PDF Tools a skilly OKF. Vždy zapnuté.
- **Vlastné**: MCP konektory, pluginy a skilly, ktoré pridáte sami.

## LAWOSS Marketplace

Na karte **LAWOSS Marketplace** je katalóg LAWOSS Marketplace od Omni Legal Products.

- **Odporúčané balíky LAWOSS**: balík jurisdikcie vašej kancelárie (**Vaša jurisdikcia**) je predvyplnený. Položky môžete odškrtnúť alebo pridať balík inej jurisdikcie. Tlačidlo **Inštalovať pre všetkých klientov** nainštaluje zaškrtnuté balíky raz pre všetkých klientov. Stiahnu sa až po kliknutí, z verejného repozitára Omni-Legal-Products/lawoss-marketplace na GitHube.
- **Všetky balíky**: celý katalóg bez ohľadu na jurisdikciu, s vyhľadávaním **Hľadať doplnky a skilly…**. Pri balíku zvolíte **Inštalovať pre**: **Všetkých klientov (odporúčané)** alebo len aktuálny priečinok.
- **Pribalené v LAWOSS**: Pri OKF vidíte, koľko z piatich pribalených skillov je dostupných vo vybranom pracovnom priestore. Zápis balíka uloží všetkých päť aj s ich súbormi do vybraného priečinka a nahradí rovnomenné miestne kópie.
- **Aktualizácie**: **Skontrolovať aktualizácie**, potom **Aktualizovať** alebo **Aktualizovať všetko**. Voľba **Kontrolovať aktualizácie automaticky raz za týždeň** je jediné automatické spojenie aplikácie: ide len na repozitár LAWOSS Marketplace na GitHube, nikdy hneď pri štarte, a samo nič neinštaluje.

Ak ste v plugine upravili súbor, aktualizácia ani odinštalovanie ho bez opýtania neprepíšu. Pri každom súbore vyberiete, či **Ponechať moju úpravu**, **Prevziať novú verziu a moju úpravu uložiť bokom** alebo **Prevziať novú verziu (moja úprava sa zahodí)**. Plugin odstránite zo všetkých klientov cez **Odinštalovať pre všetkých klientov**.

Balíky nainštalované v starších verziách len pre jeden priečinok sú v časti **Nainštalované len v priečinku**; tlačidlom **Presunúť pre všetkých klientov** ich sprístupníte všetkým klientom.

Doplnky nemenia dokumenty klientov; každá zmena aj naďalej potrebuje vaše schválenie.

## MCP konektory

Pridané konektory (MCP) sú na karte **Nainštalované**. Každý konektor ukazuje stav (napríklad **Pripojené**) a po otvorení **Nastavenia pripojenia**, **Prístup k účtu** a prepínač **Používať v konverzáciách**. Konektor, ktorý potrebuje prihlásenie, má tlačidlo **Prihlásiť sa**; údaje, ktoré potrebuje, zadáte cez **Nastaviť**. Konektor vypnete tlačidlom **Zakázať**, znova zapnete **Povoliť** a odstránite **Odstrániť**.

Konektory z balíkov LAWOSS Marketplace sú označené ako **Plugin: LAWOSS Marketplace**. **Prehliadať katalóg** otvorí **Katalóg konektorov**; skryté položky ukáže **Zobraziť skryté**.

## Skilly

V Nastaveniach otvorte **Skills**. Skill je návod pre agenta na opakovanú prácu. V chate ho vyberiete napísaním `/`. Osobný skill otvoríte kliknutím na jeho názov a zmeníte cez **Upraviť**. Tlačidlo **Pridať** vytvorí nový skill.

Cez **Importovať skills** vyberiete kompatibilný balík z miestnej inštalácie ChatGPT alebo Claude, priečinok, ZIP alebo repozitár na GitHube. Pred uložením skontrolujte jeho obsah. Import neprihlasuje cloudový účet a neprenáša históriu chatov.

## Pluginy

Plugin môže obsahovať skilly aj konektory. Na karte **LAWOSS Marketplace** môžete zobraziť všetky balíky alebo filtrovať nainštalované balíky a balíky dostupné na inštaláciu.

Na karte **Google Workspace** rozbaľte **Inštalovať skill**, zvoľte rozsah a potvrďte inštaláciu. Ak už je nainštalovaný, zvoľte **Spravovať inštaláciu**. Pripojený účet a stav prihlásenia overíte v termináli príkazom `gog auth list --check`.

## Podpisovanie PDF na Macu

Karta **Chevron7** v nástrojoch kancelárie ukáže stav inštalácie. Podpis spustíte pri konkrétnom PDF. Postup podpisovania aj čítania podpisov je v časti [Elektronické podpisy v PDF](klienti-a-pripady.md#elektronické-podpisy-v-pdf).

## Úložisko súborov

Záložka **Úložisko súborov** spravuje pripojené úložiská. V tejto verzii LAWOSS pripájate lokálne priečinky, aj tie, ktoré synchronizuje OneDrive, Dropbox alebo Google Drive. Cloudové a sieťové úložiská sú v ponuke vidieť, ale zatiaľ sa nedajú zvoliť.

Súvisí: [Chaty](chaty.md), [Nastavenia](nastavenia.md), [Riešenie problémov](riesenie-problemov.md).
