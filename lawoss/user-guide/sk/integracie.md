# Integrácie: Marketplace, konektory, skilly a pluginy

Otvoriť v LAWOSS: [Integrácie](legalwork://app/settings/extensions/plugins), [Skills](legalwork://app/settings/extensions/skills), [Úložisko súborov](legalwork://app/settings/extensions/storage).

Všetko, čo agentovi pridáva nástroje, je v nastaveniach na karte **Integrácie**. Nastavenia sa týkajú klienta vybraného v hlavičke nastavení. Karta má záložky **Plugins**, **Skills** a **Úložisko súborov**, nad nimi tlačidlá **Importovať**, **Pridať** a **Ďalšie akcie**.

Bez doplnkov agent odpovedá z toho, čo sa naučil. S nimi overí aktuálny zdroj: firmu v Obchodnom registri, platné znenie zákona, súdne rozhodnutie.

## Zdroje integrácií

Karta **Zdroje integrácií** ukazuje, odkiaľ integrácie pochádzajú:

- **LAWOSS** (**Predvolený**): katalóg LAWOSS Marketplace a pribalené nástroje DOCX Redline, PDF Tools a skilly OKF. Vždy zapnuté.
- **Vlastné**: MCP konektory, pluginy a skilly, ktoré pridáte sami.

## LAWOSS Marketplace

Na záložke **Plugins** je katalóg LAWOSS Marketplace od Omni Legal Products.

- **Odporúčané balíky LAWOSS**: balík jurisdikcie vašej kancelárie (**Vaša jurisdikcia**) je predvyplnený. Položky môžete odškrtnúť alebo pridať balík inej jurisdikcie. Tlačidlo **Inštalovať pre všetkých klientov** nainštaluje zaškrtnuté balíky raz pre všetkých klientov. Stiahnu sa až po kliknutí, z verejného repozitára Omni-Legal-Products/lawoss-marketplace na GitHube.
- **Všetky balíky**: celý katalóg bez ohľadu na jurisdikciu, s vyhľadávaním **Hľadať doplnky a skilly…**. Pri balíku zvolíte **Inštalovať pre**: **Všetkých klientov (odporúčané)** alebo len aktuálny priečinok.
- **Pribalené v LAWOSS**: DOCX Redline, PDF Tools a skilly OKF sú súčasťou aplikácie a sú zapnuté vždy.
- **Aktualizácie**: **Skontrolovať aktualizácie**, potom **Aktualizovať** alebo **Aktualizovať všetko**. Voľba **Kontrolovať aktualizácie automaticky raz za týždeň** je jediné automatické spojenie aplikácie: ide len na repozitár LAWOSS Marketplace na GitHube, nikdy hneď pri štarte, a samo nič neinštaluje.

Ak ste v plugine upravili súbor, aktualizácia ani odinštalovanie ho bez opýtania neprepíšu. Pri každom súbore vyberiete, či **Ponechať moju úpravu**, **Prevziať novú verziu a moju úpravu uložiť bokom** alebo **Prevziať novú verziu (moja úprava sa zahodí)**. Plugin odstránite zo všetkých klientov cez **Odinštalovať pre všetkých klientov**.

Balíky nainštalované v starších verziách len pre jeden priečinok sú v časti **Nainštalované len v priečinku**; tlačidlom **Presunúť pre všetkých klientov** ich sprístupníte všetkým klientom.

Doplnky nemenia dokumenty klientov; každá zmena aj naďalej potrebuje vaše schválenie.

## MCP konektory

Konektory (MCP) sú na záložke **Plugins** v časti **Konektory**. Každý konektor ukazuje stav (napríklad **Pripojené**) a po otvorení **Nastavenia pripojenia**, **Prístup k účtu** a prepínač **Používať v konverzáciách**. Konektor, ktorý potrebuje prihlásenie, má tlačidlo **Prihlásiť sa**; údaje, ktoré potrebuje, zadáte cez **Nastaviť**. Konektor vypnete tlačidlom **Zakázať**, znova zapnete **Povoliť** a odstránite **Odstrániť**.

Konektory z balíkov LAWOSS Marketplace sú označené ako **Plugin: LAWOSS Marketplace**. **Prehliadať katalóg** otvorí **Katalóg konektorov**; skryté položky ukáže **Zobraziť skryté**.

## Skilly

Záložka **Skills** ukazuje pribalené, nainštalované a importované skilly. Skill je návod pre agenta na opakovanú prácu; v chate ho spustíte napísaním `/` a výberom zo zoznamu. Nový skill pridáte cez **Pridať** a **Skills**, alebo ho importujete cez **Importovať**. Priečinok so skillmi otvoríte cez **Ďalšie akcie** a **Otvoriť priečinok skills**.

## Pluginy

Plugin je balík skillov a konektorov.

- **Importovať** pridá plugin z priečinka (**Vybrať priečinok**), zo ZIP súboru (**Vybrať ZIP**) alebo z **URL repozitára pluginu**. Pred importom ukáže, čo plugin obsahuje a čo potrebuje (**Skontrolovať pred importom**).
- **Vlastný** v katalógu konektorov otvorí **Nový plugin**: spojíte skilly a konektory zo svojej knižnice do jedného balíka a zvolíte **Vytvoriť plugin**. Vytvoria sa nezávislé kópie; prihlásenia ku konektorom sa nekopírujú.

Nainštalované pluginy sú v zozname pod konektormi; filtrom **Zdroj knižnice** ich zúžite. Hľadať môžete cez **Hľadať pluginy…**.

## Úložisko súborov

Záložka **Úložisko súborov** spravuje pripojené úložiská. V tejto verzii LAWOSS pripájate lokálne priečinky, aj tie, ktoré synchronizuje OneDrive, Dropbox alebo Google Drive. Cloudové a sieťové úložiská sú v ponuke vidieť, ale zatiaľ sa nedajú zvoliť.

Súvisí: [Chaty](chaty.md), [Nastavenia](nastavenia.md), [Riešenie problémov](riesenie-problemov.md).
