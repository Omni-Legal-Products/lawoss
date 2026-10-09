# LAWOSS alfa: akceptačný protokol

Tento protokol je určený pre interné alfa testovanie LAWOSS. Je doplnkom k
[build návodu pre alfa testerov](lawoss-build-pre-testerov.md) a opisuje dve
reprodukovateľné cesty, ktoré má tester prejsť pred nahlásením výsledku: hlavnú
cestu s organizáciou spisov (OKF) a kratšiu cestu bez OKF. Obe začínajú prvým
spustením aplikácie s prázdnym profilom.

> **Hranica alfa testu:** úspešný preflight ani úspešný scenár nie je právne, bezpečnostné ani produkčné schválenie. Build nie je určený na skutočné spisy.

> **Rozsah protokolu (9. 10. 2026):** nasledujúce kroky overujú existujúce UI
> s voľbou OKF. Backend onboardingu cez priečinok z PR [#135](https://github.com/Omni-Legal-Products/lawoss/pull/135),
> [#136](https://github.com/Omni-Legal-Products/lawoss/pull/136) a [#137](https://github.com/Omni-Legal-Products/lawoss/pull/137)
> sám nedokazuje dokončenie nového trojkrokového toku C2. Ten má samostatnú
> akceptáciu podľa [schváleného smeru onboardingu](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/92)
> a [implementačného plánu C2](https://github.com/Omni-Legal-Products/lawoss/pull/134).
> Zaznamenajte presný commit testovaného buildu; PASS tohto protokolu neoznačuje C2 za hotové.

## Bezpečnostné podmienky

- Použite iba **syntetické alebo verejné dáta**. Nepoužívajte klientske,
  privilegované, osobné ani inak dôverné informácie.
- Do issue, logu, screenshotu ani chatu nevkladajte API keys, tokens, client
  identifiers, client documents alebo prompts. Pred odoslaním výstup skontrolujte
  a začiernite.
- Nevykonávajte externé odoslanie, podpis, podanie ani inú následnú právnu alebo
  finančnú operáciu. Každá významná akcia má zostať pod ľudskou kontrolou.

## 1. Príprava a preflight

1. Použite samostatný testovací priečinok mimo reálnych pracovných dát.
2. Na macOS, Windows alebo Linux zaznamenajte operačný systém a architektúru
   (`arm64` alebo `x64`).
3. Použite Node 24 a `pnpm@11.4.0` podľa build návodu. Overenie bez providerov
   spustite z koreňa repozitára:

   ```bash
   pnpm test:alpha-preflight
   node scripts/alpha-preflight.mjs --strict
   ```

4. Zapíšte commit (`git rev-parse HEAD`), vetvu a výsledok preflightu. Ak
   používate Node 26 alebo inú nepodporovanú verziu, uveďte to v hlásení;
   normálny režim iba upozorní, strict režim taký runtime odmietne.
5. Pokračujte iba vtedy, keď rozumiete rozdielu medzi technickým preflightom a
   schválením na právne, bezpečnostné alebo produkčné použitie.

## 2. Zlatá cesta s OKF

Prejdite celý scenár v poradí:

**voľba OKF → kancelária → klient → vec → dokument → pamäť → nový rozhovor**

### Vy a voľba OKF

1. Pri prvom spustení sa otvorí „Nastavte svoju prax“. V kroku „Vy a
   jurisdikcia“ vyplňte vymyslené meno do poľa „Vaše meno“, zvoľte
   jurisdikciu a jazyk rozhrania a pokračujte.
2. V kroku „Organizácia spisov“ overte, že nie je predvolená žiadna voľba a
   „Pokračovať“ je zablokované. Prečítajte poučenie.
3. Zvoľte „Používať OKF“. Overte, že pokračovať sa dá až po zaškrtnutí
   „Beriem na vedomie, ako OKF pracuje s údajmi spisu.“ Text nesmie hovoriť
   o súhlase.

### Kancelária

1. Zvoľte „Vytvoriť novú“ a ako nadradený priečinok testovací priečinok mimo
   reálnych dát.
2. Otvorte „Náhľad zmien“, skontrolujte plánované zmeny a až potom zvoľte
   „Potvrdiť a vykonať“.
3. Overte, že vznikol priečinok kancelárie s `okf.config` a že kancelária
   nevytvorila vlastný pracovný priestor.

### Dáta a AI

1. Krok výslovne uvedie stav modelu: „Model je pripojený:“ s názvom modelu,
   alebo „Zatiaľ nemáte pripojený model“, prípadne že poskytovateľ je
   pripojený bez vybraného modelu alebo že vybraný model už nie je dostupný.
2. Cez „Otvoriť nastavenia AI“ overte, že stav zodpovedá nastaveniam. Zrušená
   bezplatná vrstva sa nesmie zobraziť ako pripojený model.
3. Analytika je v LAWOSS natrvalo vypnutá. Krok AI ani Nastavenia nesmú
   ponúkať prepínač na jej zapnutie. Ak sa zobrazí, zaznamenajte odchýlku.
4. Pokračujte. Bez modelu tlačidlo znie „Pokračovať bez modelu“.

### Klient a vec

1. Vytvorte testovacieho klienta s vymysleným názvom s bodkami, napríklad
   `Testovací klient s. r. o.` V náhľade zmien overte, že priečinok sa volá
   `Testovací klient s. r. o` (bez koncovej bodky) a karta klienta nesie celý
   názov. Názov začínajúci bodkou alebo obsahujúci `/` musí skončiť
   zrozumiteľnou chybou v jazyku rozhrania.
2. Založte jednu testovaciu vec s jednoznačným názvom a krátkym syntetickým
   opisom. Po potvrdení sa otvorí klient ako pracovný priestor.
3. Overte, že v klientovi sú skills `novy-spis`, `okf-pamat` a
   `usporiadaj-spis`.
4. Overte, že po reštarte alebo otvorení nového okna viete klienta a vec znovu
   nájsť a že sa zobrazuje správny kontext.

### Dokument a zdroj

1. Pridajte do veci krátky syntetický alebo verejný dokument, pri ktorom je
   dovolené jeho ďalšie spracovanie.
2. Položte otázku, na ktorú sa dá odpovedať iba z dokumentu.
3. Skontrolujte, či odpoveď uvádza správny **zdroj**, či sa dá spätne dohľadať
   relevantné miesto a či systém nepridáva tvrdenie, ktoré dokument nepodporuje.
4. Ak má výstup právny význam, tester musí overiť jurisdikciu, dátum a citáciu;
   odpoveď modelu sama osebe nie je overeným právnym záverom.

### Pamäť a nový rozhovor

1. Uložte jednu neškodnú, jasne označenú informáciu do pamäte veci, napríklad
   vymyslenú lehotu alebo zapojený subjekt.
2. V detaile veci overte, že sa informácia zobrazí (zapojené subjekty pod
   nadpisom „Zapojené subjekty“) a že rozsah pamäte uvádza vec, klienta aj
   kanceláriu. Ak otvoríte priečinok veci samostatne, rozsah výslovne uvedie
   „Klient: nenačítaný“ a „Kancelária: nenačítaná“.
3. Otvorte nový rozhovor v tej istej veci a overte, či sa použije iba očakávaný
   kontext.
4. Skontrolujte, či sa informácia nezobrazí v inej veci alebo pri inom
   testovacom klientovi.
5. Ak systém navrhne následnú akciu s právnym, externým alebo trvalým dopadom,
   musí zostať za **ľudské potvrdenie** pred jej vykonaním.

## 2a. Kratšia cesta bez OKF

Začnite s novým prázdnym profilom a prejdite:

**voľba „Zatiaľ bez OKF“ → AI → pracovný priečinok → dokument → nový rozhovor**

1. V kroku „Vy a jurisdikcia“ vyplňte vymyslené meno a pokračujte.
2. Zvoľte „Zatiaľ bez OKF“. Potvrdenie sa nevyžaduje a onboarding má tri kroky.
3. V kroku „Dáta a AI“ overte rovnaký výslovný stav modelu a neprítomnosť
   prepínača analytiky ako v ceste s OKF. Analytika je natrvalo vypnutá.
4. Ako „Pracovný priečinok (voliteľné)“ vyberte testovací priečinok so
   syntetickým dokumentom a zvoľte „Dokončiť“.
5. Overte, že priečinok je pridaný ako pracovný priestor, nevznikla v ňom
   štruktúra OKF ani skills OKF a úvodná obrazovka je použiteľná. V bočnom
   paneli je odkaz „Zapnúť OKF“.
6. Položte otázku k dokumentu a skontrolujte **zdroj** ako v ceste s OKF.
7. Otvorte nový rozhovor v tom istom priečinku a overte, či sa použije iba
   očakávaný kontext.

## 3. Matica providerov

Pre každý provider, ktorý je testerovi dostupný, vyplňte samostatný riadok.
Neposielajte do hlásenia kľúče ani obsah otázok.

| Provider | Pripojený stav | Predvolený/ponúknutý model | Prvá otázka | Stav po reštarte | Chyba po odpojení |
|---|---|---|---|---|---|
| OpenAI |  |  |  |  |  |
| Anthropic |  |  |  |  |  |
| Lokálny alebo iný podporovaný provider |  |  |  |  |  |

Pri každom riadku overte, že:

- pripojený provider má zrozumiteľný stav a model sa dá vybrať bez hádania;
- prvá otázka skončí buď odpoveďou, alebo zrozumiteľnou chybou;
- po odpojení sa nezobrazuje starý úspešný stav a používateľ dostane ďalší
  bezpečný krok;
- reštart nemení zvolený provider alebo model bez vysvetlenia.

## 4. Výsledok

Scenár označte ako **PASS** iba vtedy, ak:

- preflight uvádza očakávané prostredie;
- prešla celá cesta voľba OKF → kancelária → klient → vec → dokument →
  pamäť → nový rozhovor aj kratšia cesta bez OKF, alebo hlásenie výslovne
  uvádza, ktorú cestu tester neprešiel;
- krok AI pravdivo uviedol stav modelu a analytika ostala natrvalo vypnutá
  bez možnosti zapnúť ju v rozhraní;
- odpoveď sa dala skontrolovať podľa zdroja a nebola prezentovaná ako
  automaticky schválené právne stanovisko;
- neunikol kontext medzi vecami;
- každá významná alebo externá akcia vyžadovala ľudské potvrdenie;
- test použil iba syntetické alebo verejné dáta.

Inak označte scenár ako **FAIL**, uveďte prvý krok odchýlky a priložte iba
redigované technické údaje cez [alpha test report](../.github/ISSUE_TEMPLATE/alpha-test-report.yml).

### Environment summary / prostredie

```text
Operating system:
Architecture:
Node:
pnpm:
Commit:
Branch:
Provider(s) tested:
Path(s): s OKF / bez OKF
Scenario result: PASS / FAIL
```

Tento dokument je akceptačný protokol pre internú alfu, nie vyhlásenie o
produkčnej pripravenosti, bezpečnostný audit ani právne posúdenie.
