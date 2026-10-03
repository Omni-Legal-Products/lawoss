# LAWOSS alfa — akceptačný protokol

Tento protokol je určený pre interné alfa testovanie LAWOSS. Je doplnkom k
[build návodu pre alfa testerov](lawoss-build-pre-testerov.md) a opisuje jednu
reprodukovateľnú cestu, ktorú má tester prejsť pred nahlásením výsledku.

> **Hranica alfa testu:** úspešný preflight ani úspešný scenár nie je právne, bezpečnostné ani produkčné schválenie. Build nie je určený na skutočné spisy.

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

## 2. Zlatá cesta

Prejdite celý scenár v poradí:

**klient → vec → dokument → pamäť → nový rozhovor**

### Klient a vec

1. Vytvorte testovacieho klienta s vymysleným menom, napríklad `Testovací
   klient Alfa`.
2. Založte jednu testovaciu vec s jednoznačným názvom a krátkym syntetickým
   opisom.
3. Overte, že po reštarte alebo otvorení nového okna viete klienta a vec znovu
   nájsť a že sa zobrazuje správny kontext.

### Dokument a zdroj

1. Pridajte krátky syntetický alebo verejný dokument, pri ktorom je dovolené
   jeho ďalšie spracovanie.
2. Položte otázku, na ktorú sa dá odpovedať iba z dokumentu.
3. Skontrolujte, či odpoveď uvádza správny **zdroj**, či sa dá spätne dohľadať
   relevantné miesto a či systém nepridáva tvrdenie, ktoré dokument nepodporuje.
4. Ak má výstup právny význam, tester musí overiť jurisdikciu, dátum a citáciu;
   odpoveď modelu sama osebe nie je overeným právnym záverom.

### Pamäť a nový rozhovor

1. Uložte jednu neškodnú, jasne označenú informáciu do pamäte veci.
2. Otvorte nový rozhovor v tej istej veci a overte, či sa použije iba očakávaný
   kontext.
3. Skontrolujte, či sa informácia nezobrazí v inej veci alebo pri inom
   testovacom klientovi.
4. Ak systém navrhne následnú akciu s právnym, externým alebo trvalým dopadom,
   musí zostať za **ľudské potvrdenie** pred jej vykonaním.

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
- prešla celá cesta klient → vec → dokument → pamäť → nový rozhovor;
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
Scenario result: PASS / FAIL
```

Tento dokument je akceptačný protokol pre internú alfu, nie vyhlásenie o
produkčnej pripravenosti, bezpečnostný audit ani právne posúdenie.
