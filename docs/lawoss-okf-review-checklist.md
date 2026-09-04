# OKF architektúra: decision sheet pre tím

Toto je pracovný checklist k agende PR #64. Nie je to schválenie návrhu ani náhrada zápisu z callu. Pri každom bode treba doplniť rozhodnutie, vlastníka, dôkaz a podmienku prijatia.

## Rozhodnutia D1–D9

| Bod | Rozhodnutie tímu | Vlastník | Dôkaz / odkaz | Akceptačná podmienka |
|---|---|---|---|---|
| D1 | `OPEN` |  |  | Existuje jednoznačné rozhodnutie a testovateľný MVP výsledok. |
| D2 | `OPEN` |  |  | Rozhodnutie neprotirečí bezpečnostnému modelu a hraniciam dôvery. |
| D3 | `OPEN` |  |  | Je jasné, čo patrí do prvej verzie a čo sa odkladá. |
| D4 | `OPEN` |  |  | Je určený vlastník implementácie a spôsob overenia. |
| D5 | `OPEN` |  |  | Sú popísané zlyhanie, obnova a strata dát. |
| D6 | `OPEN` |  |  | Rozhodnutie je zrozumiteľné pre používateľa aj údržbára. |
| D7 | `OPEN` |  |  | Opt-in alebo citlivé funkcie majú výslovné potvrdenie a auditnú stopu. |
| D8 | `OPEN` |  |  | Je zaznamenané, či PR #24 zostáva referenčným prototypom. |
| D9 | `OPEN` |  |  | Výsledok je zapísaný do príslušného specu po revízii. |

## Kritické otvorené otázky

### O1

- Aká je presná hranica MVP a čo sa vedome nepokúšame vyriešiť v PR #64?
- Kto môže spustiť, schváliť a zvrátiť jednotlivé zápisy?
- Ako sa bude správanie overovať na reprezentatívnom testovacom spise?

### O2

- Ktoré dáta a metadata sú lokálne, ktoré môžu opustiť zariadenie a za akých podmienok?
- Ako používateľ uvidí model, konektor, oprávnenie a dôvod zápisu?
- Aká je bezpečná predvolená hodnota pri chýbajúcej konfigurácii?

### O6

- Ako sa rieši obnova po prerušení, konflikte alebo čiastočne dokončenom kroku?
- Ako tím zistí, že stav je konzistentný a že sa zápis nespustil dvakrát?
- Aké logy a diagnostika postačujú bez úniku obsahu spisu?

## Gate pred zlúčením

- [ ] Každý bod D1–D9 má stav `ACCEPTED`, `CHANGED` alebo `DEFERRED` a uvedeného vlastníka.
- [ ] O1, O2 a O6 majú konkrétnu odpoveď, nie iba všeobecný súhlas.
- [ ] Existuje testovací scenár pre prvú úlohu, zlyhanie a obnovu.
- [ ] Je overené, že predvolené nastavenie neodosiela citlivý obsah neočakávanému konektoru.
- [ ] PR #24 má výslovne zapísanú úlohu: referenčný prototyp, zdroj preberaných častí alebo vyradený návrh.
- [ ] Zápis z callu a následná úprava specu 0014 sú priložené k rozhodnutiu.
