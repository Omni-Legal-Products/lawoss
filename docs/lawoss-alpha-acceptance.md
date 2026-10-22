# LAWOSS alfa: akceptačný protokol

Aktívny postup k 17. 10. 2026 pre zdrojový základ
`fdd10927d92aaf4c25217430cc316ef38e4e8057` je
**Ty → AI (možno preskočiť) → Priečinok → klient a vec → dokument → pamäť → nový rozhovor**.
Predchádzajúcu voľbu OKF a kancelárie zachováva
[historický protokol z 13. 10.](archive/lawoss-alpha-acceptance-2026-10-13.md).
[D1 zo 4. až 5. 10.](lawoss-d1-zabalena-appka-2026-10-05.md) je datovaný výsledok iného buildu.
Tieto staršie výsledky nepreukazujú akceptáciu nového inštalátora.

Rozhodnutia a ich stav patria do
[koordinačného indexu](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/main/planning/stav-produktu.md).
Odkaz je cieľ pripravovaného samostatného dokumentačného patchu, nie tvrdenie, že bol zverejnený.
Build a inštaláciu rozlišuje [návod pre testerov](lawoss-build-pre-testerov.md).

## Pripravte presný balíček a dva profily

1. Použite iba syntetické alebo verejné údaje. Bežný profil a reálne spisy ponechajte zatvorené a nedotknuté.
2. Zapíšte presný release tag, názov inštalátora, SHA-256, platformu a architektúru z jeho
   `release-evidence-<platform>-<arch>.json`. Nepoužite CLI `releases/latest` ako výber desktopu.
3. Overte finálne bytes a podpis po signing, notarization a stapling. Úspešný source build,
   `--dir` alebo packaged startup neznamená úplnú release akceptáciu.
4. Pripravte samostatný vlastnený profil. Migrovaný profil vytvorte výhradne ako kópiu
   starého syntetického profilu s doloženým podporovaným baseline. Originál zachovajte.
5. V Nastaveniach → Debug zapíšte stav identity, plný commit, verziu, kanál a platformu.
   `embedded` znamená vloženú a skontrolovanú identitu. `development` označuje checkout.
   `unavailable` znamená, že pôvod balíčka nie je doložený. Runtime env toto označenie neopraví.

Príkazy runneru a jeho platformové obmedzenia sú v [release evidence](release-evidence.md).
macOS adapter porovná nainštalovanú `.app` s readonly obsahom finálneho DMG alebo ZIP,
overí `codesign` a Gatekeeper, spustí ju s izolovaným profilom a číta živé IPC cez shipping
UI-control. Rozhranie CDP ani runtime fuses sa nemenia. Bez manuálne dokončených
nativných scenárov runner zapíše `blocked` a skončí nenulovo.

Súkromný alfa extractor kontroluje podporované Mach-O hlavičky priamo z obmedzeného
čítania toho istého fyzického súboru. Podporuje iba generic x64/ARM64 thin64 a overené
FAT32/FAT64 rozloženia; úspešná kontrola nenahrádza podpis ani skutočný natívny štart.
Ak úvodný census vlastníkov odmietne štart ešte pred profilovým zámkom a spawn,
cleanup dôkaz platí len pre žiadne nové deti tejto invokácie. Existujúca cudzia aplikácia
zostáva samostatným vlastníkom a pôvodný dôvod odmietnutia sa zachová.

Prospektívny natívny alfa runner viaže aj `XDG_STATE_HOME` na vlastný
`profile/state` a tento fyzický adresár skontroluje pred child spawn. Ambientný
state adresár sa nepreberá; existujúci súbor alebo alias sa neadoptuje. Kontrolované
Node fixture overujú prenos prostredia a odmietnutie nebezpečného state vstupu.
Staršie natívne výsledky tým nezískavajú dôkaz izolácie tohto nového prostredia;
skutočný engine state a jeho natívne temp správanie ešte potrebujú čerstvé meranie.

## AI režimy v governance kandidátovi

**AI hranice v alfe (rozhodnutie 20. 10. 2026):** alfa sa dodáva s prepínačom **AI hranice vypnutým**.
Bežný chat, fronta, plánované úlohy, revízie, benchmarky, SystemOne, hlas a vzdialené OCR potom
fungujú ako pred governance a posielajú obsah zvolenému poskytovateľovi bez ďalšieho potvrdenia.
Zapnete ich v **Nastavenia → Poskytovatelia AI → AI hranice**; zmena platí hneď, bez reštartu.
Tento počítač ich môže vynútiť premennou prostredia `LAWOSS_AI_BOUNDARIES_ENFORCED=1` (iba zapnúť,
nie vypnúť); prepínač je potom zamknutý s textom „Zapnuté nastavením tohto počítača“. Nie je to
firemná politika: skutočný kľúč firemnej politiky (so zrkadlom na platforme) je ďalší krok.
Poškodené uložené nastavenie sa berie ako zapnuté, kým ho používateľ znova neuloží.
Pri zapnutí appka odmietne nové správy; odpoveď, ktorú model už práve píše, môže dobehnúť. Odseky nižšie o poučení a unsupported prenosoch
opisujú stav so **zapnutými** AI hranicami. Chránené generovanie dokumentov a verejný text
fungujú v oboch stavoch rovnako.

Zaznamenajte presný SHA: táto zmena zatiaľ nie je release acceptance. Poučenie v onboardingu, AI a integráciách uvádza aktuálne vypnuté spracovanie chráneného/neznámeho kontextu. Prečítanie ani pripojený účet/provider spracovanie nepovoľujú. Ručné súbory a priečinky zostávajú dostupné; bez modelu sa nevyberá náhradný provider. Samotné `localhost` nie je dôkaz lokálneho modelu ani izolovaného downstreamu.

Pre syntetický pozitívny test nastavte vlastný OpenAI-compatible model na vlastnenom loopback receiveri bez reálnych credentials/billing. V existujúcom AI nastavení použite samostatný formulár verejného textu. Vytvorí nový prázdny scratch bez spisu, histórie, AGENTS/wiki/personalizácie a nástrojov. Natívny dialóg pred každým odoslaním ukáže cieľ a úplný serializovaný systémový/textový kontext. Potvrdenie je technická klasifikácia jedného verejného požiadavku, nie právny grant. Očakávajte skutočnú odpoveď `PUBLIC_SYNTHETIC_OK`; pri zamietnutí nesmie receiver dostať nový požiadavok. Tento formulár nesprístupňuje generovanie v klientskom priečinku, prílohy, shell, MCP ani subagentov. Bez spravovaného pripnutého enginu alebo nakonfigurovaného kompatibilného modelu je nedostupný.

Chránené chat/queue/Fusion, remote OCR/SystemOne/voice a ostatné nepreukázané prenosy zostávajú unsupported. Existujúci výslovne vybraný vstavaný lokálny OCR je samostatná cesta. Podpora chráneného modelu vyžaduje preukázanú engine/OS/receiver hranicu, zhodný enforced wire kontrakt a konkrétny právny profil schválený príslušným gestorom. Generický engine v lokálnom H1 teste čítal cez priamy shell mimo workspace aj pri permission deny; tento výsledok sa nesmie označiť za bezpečnú izoláciu. Nepripájajte skutočný spis.

Migráciu legacy nastavení najprv zobrazte cez host-only `/lawoss/ai-governance/migration/preview`; apply prijíma aktuálny `sourceHash`. Import zachová iba preferenciu, nevytvára approved profil. Produkčný backup/restore, retention, incident owner/contact a Windows rollback ešte vyžadujú samostatnú acceptance. Rollback už odoslané dáta nevráti; starší build bez governance vyžaduje prevádzkové odobratie vzdialených credentials/povolení, nie zmazanie policy DB.


## Prejdite aktuálny onboarding

1. V kroku **Ty** zadajte vymyslené meno, jurisdikciu a jazyk rozhrania.
2. V kroku **AI** overte pravdivý stav poskytovateľa a modelu. Bez modelu pokračujte
   cez preskočenie. Ponuka poskytovateľa ani uložený API kľúč nepotvrdzuje funkčné pripojenie.
3. V kroku **Priečinok** otvorte skutočný systémový picker. Zrušte ho a overte, že
   nevznikol pracovný priestor ani zápis OKF. Potom ho otvorte znova a vyberte testovaciu složku.
4. Pre obyčajný priečinok skontrolujte výsledok rozpoznania, náhľad plánovaných zmien a
   potvrdenie pred zápisom. Nehľadajte historický krok „voľba OKF“.
5. Samostatne pripojte existujúci syntetický OKF klient. Overte rozpoznanie existujúcich
   súborov, ponúknutý skúšobný klon a bezpečné doplnenie. Mapovanie bez zápisu je
   v tomto zdrojovom základe skryté flagom `ALPHA_HIDE_MAP_WITHOUT_WRITING`.
6. Založte klienta a vec cez náhľad a potvrdenie. Po dokončení overte viditeľný názov,
   priečinok veci, klientsky workspace a existujúce skills. Zrušenie toku z bočného panela
   sa má vrátiť do aplikácie, nie na prvý krok Ty.

## Overte dokument, pamäť a oddelenie klientov

1. Vložte syntetický dokument do veci. Overte jeho pôvod, aktuálne bytes a správny pracovný kontext.
2. Zapíšte syntetickú informáciu do pamäte veci. Otvorte nový rozhovor a overte jej použitie.
3. Reštartujte skutočnú nainštalovanú aplikáciu. Overte opäť živý commit, profil,
   served renderer, klienta, vec a pamäť.
4. Založte ďalších dvoch syntetických klientov. Overte prehľad praxe aj izoláciu agenta.
   Skúste chybu čítania jedného klienta a obnovu. Chýbajúci klient sa nesmie tváriť ako nula lehôt.
5. Pre zahrnuté zmeny lehôt prejdite samostatný CZ a SK prípad: dokument a doručenie,
   doložené pravidlo, deterministický výpočet, potvrdenie človekom, jeden zápis OKF a ICS.
   Zmena kandidáta musí zneplatniť potvrdenie. Bez schváleného právneho pravidla je scenár `blocked`.
6. Pre cloudovú politiku overte konkrétnu službu a podporované cesty, zmenu konfigurácie a
   odvolanie oprávnenia. Bez testovacieho účtu, právnej brány alebo potrebného konektora je výsledok `blocked`.

Každý scenár opakujte na čistom aj migrovanom profile každého deklarovaného targetu.
Samostatne overte CZ a SK UI a zdroj LegalWork vypnutý aj zapnutý.
Katalóg LAWOSS a flagy dokazujú ponuku. Pre každú integráciu zaznamenajte oddelene
**ponúknuté → nainštalované → pripojené → overené**, s dátumom a odkazom na dôkaz.
Aktuálny zdroj skrýva upstream kalendár, wiki, dashboards a plánované úlohy cez
`ALPHA_HIDE_UNADOPTED_UPSTREAM`; ich existencia v kóde nie je tvrdenie o dostupnosti.

## Zapíšte výsledok

Záznam obsahuje build identitu, finálny digest, target, druh a vlastníka profilu,
scenár, `pass|fail|blocked|not-run`, operátora, čas a odkaz na redigované dôkazy.
Čistý profil nenahrádza migrovaný a iná architektúra nenahrádza cieľovú.
Technický PASS nie je právne ani produkčné schválenie. Nezverejňujte klientske údaje,
API kľúče ani discovery token UI-control.

`draft`, `built`, `signed`, `tested`, `published` a `delivered` sú samostatné stavy.
Po zmene finálnych bytes, podpise alebo novom builde sa pôvodný runtime výsledok neprenesie.

## Ďalšie kroky

Pred publikáciou dokončite všetky povinné scenáre pre rovnaký digest na oboch profiloch.
Až potom overte upload read-back a príslušný distribuční ukazovateľ.

## Otvorené otázky

Konkrétni prevádzkovatelia a termíny platformovej akceptácie, testovacie účty a schválené
právne pravidlá musia byť doložené pri release kandidátovi. Tento protokol ich neschvaľuje.
