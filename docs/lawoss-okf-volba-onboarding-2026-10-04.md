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
5. **Aktualizácia OKF balíka v existujúcich workspaces.** Pri dokončení onboardingu aj pri otvorení pracovného priestoru, ktorý je OKF klient alebo vec pod zaregistrovaným klientom, sa pri zapnutom OKF do priestoru klienta doplnia chýbajúce skilly `novy-spis`, `okf-pamat` a `usporiadaj-spis` a obnoví sa zdroj `okf-memory.js` a `okf.js`, ak sa líši od pribaleného (`apps/app/src/lawoss/okf/workspace-skill-sync.tsx`, doplnené 5. 10. 2026). SKILL.md sa prepíše len vtedy, keď je zhodný s niektorou predchádzajúcou pribalenou verziou. Upravený SKILL.md sa zachová a appka na rozdiel upozorní, pri otvorení raz pre ten istý zoznam skillov. Skill `vystup-dokumentu` sa inštaluje až pri rýchlej akcii vyhotovenia dokumentu vo veci.
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

### Testy (Node 24)

- `cd apps/app && bun test tests/`: 1177 pass, 0 fail (základ #105: 1153).
- `cd apps/server && bun test src/lawoss-onboarding.e2e.test.ts`: 10 pass. Starší profil bez `okf` sa načíta, zapnutie bez potvrdenia a verzie textu server odmietne, voľba „bez OKF“ s potvrdením tiež.
- `pnpm typecheck` v `apps/app` aj `apps/server`: čisté. `bun scripts/i18n-check.ts`: prešiel.

### Prehliadač, 4. 10. 2026

Izolované prostredie: `scripts/dev-headless-web.ts` s dočasnými `HOME` a `XDG_*`, syntetické priečinky, bez modelu a bez reálnych profilov.

- **Voľba OKF:** krok sa zobrazí po identite, žiadna voľba nie je predvolená, „Pokračovať“ je zablokované. Pri „Používať OKF“ je potvrdenie povinné. Server uložil `okf: { enabled: true, acknowledgedAt, noticeVersion: "2026-10-04-alfa-1" }`.
- **Cesta s OKF:** šesť krokov. Kancelária, klient a vec sa vytvorili, skilly `novy-spis`, `okf-pamat` a `usporiadaj-spis` sa nainštalovali do klienta, appka otvorila `/home?project=…`.
- **Cesta bez OKF:** tri kroky, voliteľný pracovný priečinok. Profil má `okf: { enabled: false }`. Priečinok má len bežné súbory `.opencode` bez skillov a štruktúry OKF. Lite `/home` sa otvorí s týmto priečinkom.
- **Zapnúť OKF:** tlačidlo v bočnom paneli otvorí `/welcome?continue=okf`.

Snímky: [voľba](evidence/okf-volba/1-volba-okf.jpg), [potvrdenie](evidence/okf-volba/2-okf-beriem-na-vedomie.jpg), [cesta s OKF](evidence/okf-volba/3-cesta-s-okf-kancelaria.jpg), [cesta bez OKF](evidence/okf-volba/4-cesta-bez-okf-ai.jpg), [Lite bez OKF](evidence/okf-volba/5-bez-okf-home-lite.jpg).

**Nález mimo tohto PR:** v tomto prostredí `/home` padal na „Maximum update depth exceeded“ v Select. Príčina je v `dev`: automatický výber modelu vybral zrušenú bezplatnú vrstvu `opencode`, ktorú session-route hneď zmazal. Oprava je samostatné PR nad `dev`. Snímky `/home` vznikli s touto opravou dočasne aplikovanou.

### Neoverené

- Zabalená desktopová appka, registrácia priečinka cez natívny `workspaceCreate` a reštart.
- Upozornenie na upravený SKILL.md v živej appke.
- Názov klienta s bodkami („s. r. o.“) neprejde validáciou a chyba je po anglicky. Vyriešené v PR B.

### PR B: overenie

Testy (Node 24, `bun` 1.4.2), 4. 10. 2026:

- `cd apps/app && bun test tests/`: 1198 pass, 0 fail (základ #106: 1177). Nové: `lawoss-model-readiness.test.ts`, `lawoss-onboarding-ai-step.test.tsx`, `lawoss-onboarding-folder-name.test.ts`, rozšírené `lawoss-scope-levels.test.tsx` a `lawoss-setup-language.test.tsx`.
- `cd apps/app && pnpm typecheck`: čisté. `bun scripts/i18n-check.ts`: prešiel (5671 kľúčov, en/de aj sk/cs úplné).
- `cd apps/server && pnpm typecheck`: čisté. `bun test src/lawoss-onboarding.e2e.test.ts`: 10 pass.
- `cd lawoss/okf && bun test`: 208 pass, 0 fail (základ 206). `pnpm typecheck`: čisté. `bun run build` a `git diff --exit-code bundle/`: bundle čerstvý, dva behy dávajú rovnaký výstup.
- `cd lawoss/okf-pamat && pnpm test`: 630 pass, 0 fail. `pnpm typecheck`: čisté. `bun run build` a `git diff --exit-code bundle/`: bundle čerstvý.
- `bun test scripts/alpha-hardening-contract.test.mjs`: 2 pass (akceptačný protokol obsahuje povinné frázy).

Rozhodnutia:

- **Bod 8.** Výpočet stavu modelu z `session-route` je v `apps/app/src/lawoss/shell/model-readiness.ts`; `session-route` ho volá bez zmeny správania (riadok v `PATCHES.md`). Onboarding k nemu pridáva len vylúčenie zrušenej bezplatnej vrstvy (`opencode`, `eigenwelt-free`). Zoznam poskytovateľov sa číta z aktívneho alebo prvého lokálneho workspace; bez workspace platí náhradný výpočet composera pred načítaním zoznamu.
- **Bod 9.** Voľba analytiky sa zapisuje do uloženej preferencie, ktorú používa aj prepínač v Nastaveniach. `setAnalyticsConsentOverride` sa nevolá: má prednosť pred uloženou voľbou a nedá sa zrušiť, takže neskoršie vypnutie v Nastaveniach by v tom istom behu nezabralo. Nedotknutý prepínač nechá voľbu prázdnu.
- **Názov s bodkami.** Validátor odreže koncové bodky a medzery z názvu priečinka (Windows ich ticho odstráni), vnútorné bodky ponechá. Odmieta ďalej prázdny názov, „.“, „..“, úvodnú bodku, oddeľovače, dvojbodku, NUL, znaky `< > " | ? *`, ktoré Windows v názve nepovolí, a viac ako 120 znakov; vtedy appka ukáže vysvetlenie v jazyku rozhrania.

Neoverené:

- Krok AI v živej appke so skutočným poskytovateľom, bez workspace a po návrate z nastavení AI.
- Či sú nastavenia AI použiteľné pri prvom spustení s OKF, keď ešte neexistuje žiadny workspace (kancelária workspace nevytvára).
- Názov s bodkami na Windows a obnovenie zmeneného `okf-memory.js` a SKILL.md v existujúcom workspace.

Prehliadač, 4. 10. 2026 (izolované prostredie ako pri PR A, s dočasne aplikovanou opravou #107):

- Krok AI bez modelu ukáže „Zatiaľ nemáte pripojený model“ a tlačidlo „Pokračovať bez modelu“. Zrušenú vrstvu `opencode`, ktorú headless engine hlási, nepovažuje za model. Prepínač analytiky je vypnutý.
- Nadpis „Nastavte svoju prax“. Klient „Novák s. r. o.“ prejde; náhľad ukáže priečinok „Novák s. r. o“, workspace má plný názov.
- Cesta s OKF skončí na Lite `/home`, detail veci sa otvorí.

Snímky: [krok AI](evidence/okf-volba/6-krok-ai-bez-modelu.jpg), [klient s bodkami](evidence/okf-volba/7-klient-s-bodkami.jpg), [vec v Lite](evidence/okf-volba/8-vec-lite.jpg).
