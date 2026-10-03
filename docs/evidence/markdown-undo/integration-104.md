# PR #97: integrácia s #104

Overené 3. 10. 2026 v izolovanom `LAWOSS-pr-097`.

## Presná kombinácia

- Pôvodný head #97: `b85803074554766cf535d40948073d6eb2aac2bc`.
- Začlenený presný head #104: `f42099964e93ffdd835d0922338d8d65b6c8f945`, vrátane predchádzajúcej integrácie #103.
- Merge bez konfliktov: `bafcf85d8fcacb0631f699848b7a10ac70de6e1a`.
- Spoločná oprava životného cyklu testovacej fixture `f055592a39444559ae23408888154f3f81ba6f81` je začlenená cherry-pickom `476b4277`. Čaká na synchronizáciu oboch workspaceov pred zastavením náhradného enginu, nemení produkčný kód.
- Dodatočný focused commit `3e6f0630e8a4a692e082ff9334e45f6d293b788b` je začlenený ako `ea9050c8`. Iba druhý embedded test má odôvodnený limit 15 sekúnd pre dva štarty, ohraničené synchronizácie a ukončenia. Globálny CLI timeout sa nemení.
- `dev` sa nemenilo; publikovaná história #97 zostáva zachovaná.

## Nové lokálne výsledky

Node 24.19.0, pnpm 11.4.0, Bun 1.4.2, inštalácia cez frozen lockfile bez zmeny závislostí.

| Príkaz | Výsledok |
|---|---|
| `pnpm --filter @legalwork/app test` | 1145 PASS, 0 FAIL, 6649 assertions, 169 súborov |
| `cd apps/app && pnpm exec bun test tests/lawoss-markdown-pristine.test.ts tests/markdown-draft.test.ts` | 8 PASS, 0 FAIL |
| `pnpm --filter @legalwork/app typecheck` | PASS |
| `pnpm --filter @legalwork/app test:i18n` | PASS, 5665 kľúčov |
| `bun test apps/server/src/embedded-app-files.e2e.test.ts apps/server/src/ocr/models.test.ts` | 4 PASS, 0 FAIL, 21 assertions, bez CLI timeout override a bez požiadaviek po ukončení enginu |
| `git diff --check` a zhoda `AGENTS.md`/`CLAUDE.md` | PASS |

App testy a typecheck bežali po merge #104; následný cherry-pick mení len serverovú fixture a `PATCHES.md`. Po následnej oprave limitu druhého testu bola zmenená fixture overená spoločne s OCR testmi priamym `bun test` bez CLI timeout override (2,58 s). Celé CI sa musí vzťahovať na nový publikovaný head, nie na predchádzajúce zelené CI `b8580307`.

## Browser a Safari evidencia zostáva historicky presná

V tejto fáze sa browser ani Safari nespúšťali nanovo. Editor, panel, browser skript, browser fixture a pôvodné dôkazy sú bajtovo nezmenené oproti `b8580307`. Nasledujúce výsledky dokazujú pôvodnú základňu `dev` `39a27747`, nie nové integrované UI:

- [Pôvodný detailný report](https://github.com/Omni-Legal-Products/lawoss/blob/b85803074554766cf535d40948073d6eb2aac2bc/docs/evidence/markdown-undo/verification.md).
- [33 úspešných Chromium kontrol, 0 known limitations](https://github.com/Omni-Legal-Products/lawoss/blob/b85803074554766cf535d40948073d6eb2aac2bc/docs/evidence/markdown-undo/browser-results.json).
- [Safari screenshot po uloženom texte a Undo](https://github.com/Omni-Legal-Products/lawoss/blob/b85803074554766cf535d40948073d6eb2aac2bc/docs/evidence/markdown-undo/safari-saved-after-undo.png).

Safari v pôvodnej fáze overilo refetch, skutočné klávesové editácie, Undo/Redo, save a následné Undo; konzola bez warning/error a žiadna HTTP odpoveď >=400, viewport 760 × 800. Celá 33-bodová sada bola Chromium kontrola. Syntetický klient drží dáta v pamäti; nejde o živé klientske súbory ani modelové E2E.

## Závislosti a merge

PR #97 teraz obsahuje #104. Do `dev` sa má začleniť až po koordinovanom začlenení #103/#104, aby zostal samostatný prínos #97 prehľadný. Žiadny merge do `dev` nebol vykonaný. Požadované review zostáva samostatnou podmienkou aj po úspešnom CI.
