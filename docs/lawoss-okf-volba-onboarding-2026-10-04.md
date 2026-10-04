# Voľba OKF v onboardingu pre alfu 1: návrh a stav (4. 10. 2026)

- **Navrhol:** MČ s AI asistenciou
- **Základ:** hlava #105 (`feat/okf-pamat-agent`, nad #104, #103 a `dev` 39a27747)
- **Vychádza z:** zápisu 25. 9. (rozhodnutie 6: OKF je opt-in; rozhodnutia 7 a 8: potvrdenie „beriem na vedomie“), plánu ďalšej fázy k#87 (bod 4: alfa s jednou obrazovkou poučenia), analýzy medzier OKF a onboardingu zo 4. 10.
- **Poradie merge:** #103 → #104 → #105 → PR A → PR B

## Prečo

V hlave #105 je uvítací tok sám o sebe OKF. Krok Kancelária sa nedá preskočiť, pri dokončení sa vždy nainštalujú skilly `novy-spis`, `okf-pamat` a `usporiadaj-spis` a prepínač OKF neexistuje. To je v rozpore s rozhodnutím 6. Alfa 1 má OKF testovať, preto voľba nesmie byť predvolene vypnutá ani zapnutá: používateľ ju urobí vedome a pri zapnutí berie na vedomie, ako OKF pracuje s údajmi spisu.

Dvojstupňový model (lokálny model ako stupeň 1, cloud po troch samostatných potvrdeniach DPA, mlčanlivosť a súhlas klienta) ostáva na betu. Rozhodnutie 7 ešte nepotvrdili písomne IR a VŘ a návrh MF k#88 ho môže upraviť. Preto je text poučenia verzovaný a beta ho môže vymeniť a vyžiadať nové potvrdenie.

## Rozsah

### PR A · Voľba OKF a skilly (body 1 a 2)

1. **Nový krok `okf`** hneď po kroku „Vy a jurisdikcia“. Dve rovnocenné voľby bez predvoleného výberu: „Používať OKF“ a „Zatiaľ bez OKF“. Pri voľbe „Používať OKF“ je povinné zaškrtnúť „beriem na vedomie“.
2. **Uloženie** v serverovom profile onboardingu: `okf: { enabled, acknowledgedAt, noticeVersion }`, verzia textu `2026-10-04-alfa-1`. Pole je voliteľné, starší `profile.json` sa načíta bez zmeny. Pri voľbe „bez OKF“ sa `acknowledgedAt` neukladá.
3. **Cesta podľa voľby.** Zapnuté: identita → OKF → kancelária → AI → klient → vec. Vypnuté: identita → OKF → AI → hotovo. Zobrazené kroky, číslovanie a „Späť“ sa počítajú z voľby.
4. **Skilly iba pri zapnutom OKF.** `installMissingOnboardingSkills` sa volá len pri `okf.enabled === true`.
5. **Aktualizácia OKF balíka v existujúcich workspaces.** Pri dokončení onboardingu aj pri ďalšom otvorení workspace s OKF sa obnoví zdroj `okf-memory.js` a `okf.js`, ak sa líši od pribaleného. SKILL.md sa prepíše len vtedy, keď je zhodný s niektorou predchádzajúcou pribalenou verziou. Upravený SKILL.md sa zachová a appka na rozdiel upozorní.
6. **Bez OKF sa používateľ nesmie stratiť.** Po dokončení bez OKF musí `/home` ukázať použiteľný prázdny stav s pridaním priečinka. Ak ho Lite bez OKF väzby nevie ukázať, cesta bez OKF ponúkne výber pracovného priečinka cez pôvodné `workspaceCreate`.
7. **OKF neskôr.** V prázdnom stave aj v nastaveniach je odkaz „Zapnúť OKF“, ktorý otvorí onboarding v kroku `okf`.

### PR B · Dokončenie onboardingu pre alfu (body 4 až 7)

8. **Krok AI overí model** rovnakým výpočtom, aký používa composer pre upozornenie „žiadny model“ (`session-surface.tsx`). Bez modelu krok ukáže stav a odkaz do nastavení AI. Pokračovať sa dá aj bez modelu, ale stav je výslovne uvedený.
9. **Voľba analytiky** v kroku AI cez existujúci `setAnalyticsConsentOverride` a prepínač podľa upstream `welcome-page.tsx`. Predvolene vypnutá.
10. **Texty nielen pre advokátov:** „Nastavte svoju prax“, „Vaše meno“. Popiska `participants` je všade „Zapojené subjekty“. Nenačítané úrovne rozsahu (klient, Office) sa pri samostatne otvorenej veci výslovne uvedú.
11. **Akceptačný protokol** `docs/lawoss-alpha-acceptance.md` prepísaný na cestu voľba OKF → kancelária → klient → vec → dokument → pamäť → nový rozhovor, plus kratšia cesta bez OKF.

### Mimo alfy 1

- Zápis `.opencode/` do existujúceho klientskeho priečinka pri režime „Bezpečne doplniť“ a pri registrácii existujúceho priečinka. Zmena by zasiahla upstream `workspaces.ts` a miesto, kde žijú skilly workspace. Pre alfu 1 musí byť zápis viditeľný v náhľade zmien, zmena patrí do bety.
- Dvojstupňová brána, tri samostatné potvrdenia, definícia lokálneho modelu, vizuál dvoch ciest, typ predplatného, odkazy na DPA, štruktúra SK/CZ.

## Text poučenia, verzia `2026-10-04-alfa-1`

Návrh na schválenie MF a MČ pred merge. Nepoužíva slová „súhlas“ ani „súhlasím“.

### SK

**Organizácia spisov (OKF)**

LAWOSS môže viesť kanceláriu, klientov a veci v jednotnej štruktúre OKF. Sú to obyčajné priečinky a textové súbory na vašom počítači, ktoré si viete otvoriť aj bez LAWOSS.

- Asistent číta a zapisuje pamäť veci: lehoty, zapojené subjekty, fakty a stav. Zápisy ostávajú v priečinku klienta.
- Ak používate model v cloude, časti spisu sa posielajú poskytovateľovi modelu ako súčasť otázky. Mlčanlivosť a zmluvu o spracúvaní údajov (DPA) s poskytovateľom máte vo svojej zodpovednosti.
- V alfa verzii pracujte len s vymyslenými alebo verejnými údajmi, nie so skutočnými spismi.
- OKF môžete zapnúť aj neskôr.

Voľby: **Používať OKF** · **Zatiaľ bez OKF**
Potvrdenie: **Beriem na vedomie, ako OKF pracuje s údajmi spisu.**

### CS

**Organizace spisů (OKF)**

LAWOSS může vést kancelář, klienty a věci v jednotné struktuře OKF. Jsou to obyčejné složky a textové soubory ve vašem počítači, které otevřete i bez LAWOSS.

- Asistent čte a zapisuje paměť věci: lhůty, zapojené subjekty, fakta a stav. Zápisy zůstávají ve složce klienta.
- Pokud používáte model v cloudu, části spisu se posílají poskytovateli modelu jako součást dotazu. Mlčenlivost a smlouvu o zpracování údajů (DPA) s poskytovatelem máte ve své odpovědnosti.
- V alfa verzi pracujte jen s vymyšlenými nebo veřejnými údaji, ne se skutečnými spisy.
- OKF můžete zapnout i později.

Volby: **Používat OKF** · **Zatím bez OKF**
Potvrzení: **Beru na vědomí, jak OKF pracuje s údaji spisu.**

### EN

**Matter organisation (OKF)**

LAWOSS can keep your office, clients and matters in one OKF structure. These are ordinary folders and text files on your computer that you can open without LAWOSS.

- The assistant reads and writes matter memory: deadlines, involved parties, facts and status. Entries stay in the client folder.
- If you use a cloud model, parts of the matter are sent to the model provider as part of a question. Confidentiality and a data processing agreement (DPA) with the provider remain your responsibility.
- In the alpha, work only with invented or public data, not with real matters.
- You can turn OKF on later.

Choices: **Use OKF** · **Not now**
Acknowledgement: **I acknowledge how OKF handles matter data.**

### DE

**Aktenorganisation (OKF)**

LAWOSS kann Kanzlei, Mandanten und Angelegenheiten in einer einheitlichen OKF-Struktur führen. Das sind gewöhnliche Ordner und Textdateien auf Ihrem Computer, die Sie auch ohne LAWOSS öffnen können.

- Der Assistent liest und schreibt das Gedächtnis der Angelegenheit: Fristen, beteiligte Personen und Stellen, Fakten und Stand. Einträge bleiben im Mandantenordner.
- Wenn Sie ein Cloud-Modell verwenden, werden Teile der Akte als Teil einer Frage an den Modellanbieter gesendet. Verschwiegenheit und ein Auftragsverarbeitungsvertrag (DPA) mit dem Anbieter liegen in Ihrer Verantwortung.
- Arbeiten Sie in der Alpha nur mit erfundenen oder öffentlichen Daten, nicht mit echten Akten.
- Sie können OKF auch später einschalten.

Auswahl: **OKF verwenden** · **Vorerst ohne OKF**
Bestätigung: **Ich nehme zur Kenntnis, wie OKF mit Aktendaten umgeht.**

## Overenie

Doplní sa po implementácii: príkazy testov, výsledky a snímky obrazovky oboch ciest.
