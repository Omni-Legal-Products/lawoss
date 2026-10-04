# OKF pamäť riadená agentom — plán a stav (4. 10. 2026)

- **Navrhol:** VŘ s AI asistenciou
- **Základ:** hlava #104 (`feat/okf-onboarding`, nad #103 a `dev` 39a27747)
- **Vychádza z:** zápisu 25. 9. (rozhodnutia 2 a 3), plánu ďalšej fázy k#87 (bod 2 „Dokončiť OKF“), review 22. 9., komentára VŘ v k#85 (nesporné typy)

## Prečo

Rozhodnutie 3 z 25. 9.: **štruktúru riadi agent, deterministické ostávajú len kritické údaje** — lehoty, spisové značky a ďalšie kľúčové údaje. Rozhodnutie 2: **zapojené subjekty** (protistrana, súd, finančný úrad, polícia, prokuratúra, kataster, kontakty) eviduje agent všeobecne, nie deterministickým zoznamom typov.

Dnešné `okf-pamat` je presne naopak:

| | Dnes | Cieľ |
|---|---|---|
| Typ záznamu | uzavretý zoznam 11 typov; neznámy `type` = chyba parsera, súbor sa preskočí a **zablokuje všetky zápisy v `memory/`** | agent smie založiť vlastný typ; číta sa, zapisuje, renderuje, validátor ho len označí |
| Sekcie tela | len `## Truth` a `## History`; ďalšia sekcia sa pri zápise **ticho zahodí** a pri čítaní blokuje | ľubovoľné ďalšie sekcie sa zachovajú pri round-tripe |
| Zapojené subjekty | len `subject` s uzavretou rolou a jedno textové pole `court` | voľný zoznam `participants` s rolou podľa agenta, blok v `_STATUS.md` aj v appke |
| Lehoty, `due` | ľubovoľný reťazec, porovnanie textovo (`31.12.2026` sa vyhodnotí zle) | **len ISO dátum, inak chyba** |
| Spisová značka `matter_ref` | nevaliduje sa | kontrola tvaru CZ/SK |

Brány ostávajú: L1/L3 a mazanie len so schválením, únik L2→L3, append-only história, atomicita pravdy. **Vlastný typ je vždy L2** — vlastným typom sa nedá obísť brána L1/L3.

## Úlohy

### A · Jadro `okf-pamat` (nedeterministická štruktúra)

1. **Otvorené typy.** Neznámy `type` sa načíta ako záznam agenta (`layer` vždy L2, iná vrstva = chyba), varovanie `AGENT_TYPE`, žiadne blokovanie zápisu.
2. **Vlastné sekcie tela** sa zachovajú v poradí pri čítaní aj zápise; `hasUnparsedBody` ich nehlási ako problém.
3. **`participants`** (zoznam máp `name`, `role`, voliteľne `contact`, `ref`, `note`), voľná rola. Render bloku „Zapojené subjekty“ do `_STATUS.md` spolu so subjektmi.
4. **Nesporné typy VŘ** `requirement`, `instrument`, `relation` ako známe typy (L2) s poliami a stavmi z komentára k#85; stavy validované len varovaním (`UNKNOWN_VALUE`).
5. **Deterministické kritické údaje:** `deadlines` a `due` musia byť ISO `RRRR-MM-DD` (chyba `DATE_INVALID`); `matter_ref` tvar spisovej značky (varovanie `CASE_NUMBER_FORMAT`).
6. SKILL.md: ako agent zakladá vlastný typ, sekcie a `participants`; čo ostáva deterministické. Prebudovať bundle `okf-memory.js`.

### B · Napojenia v appke

7. **Zapojené subjekty** v detaile veci (Lite `matter-page`, Pro `spis-page`) z čítacieho modelu.
8. **Pro súčty** (`read.ts`): lehoty, po termíne a záznamy deduplikovať podľa `recordKey` ako Lite Dnes.
9. **Viditeľný rozsah:** úrovne vec / klient / Office pomenované v Lite aj Pro; klientsky `VSTUPY.md` označený ako klientsky aj v detaile veci.
10. **Testy chýbajúcich napojení:** route `GET /workspace/:id/lawoss/memory/context`, `okf/connection.ts`; CLI `read` vypíše aj klientsky `VSTUPY.md`; `init` USAGE s `--cz`.

### Mimo rozsahu (vedome)

- SK AML (KÚV, archivácia SK) — samostatná oprava podľa k#87.
- D1 znova na živej nainštalovanej appke (R8) a dvojstupňový onboarding (MF).
- Registrové adaptéry ORSR/RPO/ARES, monitor schránok.

## Overenie

`okf-pamat` (`node --test`), `okf` (`bun test`), `@legalwork/app` test, server e2e pre nové route, typecheck, i18n audit, čerstvý bundle.
