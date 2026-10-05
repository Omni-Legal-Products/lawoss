# Markdown Undo: overenie PR #97

Overené 3. 10. 2026 v izolovanom `LAWOSS-pr-097`, Node 24.19.0, pnpm 11.4.0, Bun 1.4.2. Základ `dev`: `39a277479c1bc7c3726715be311954fb1eb89d97`; merge do existujúcej PR vetvy zachováva publikovanú históriu. #103/#104 nie sú súčasťou tohto overenia.

## Reprodukcia a oprava

Pôvodné PR na novom `dev` prešlo úvodnými 19 browser kontrolami po aktualizácii českých selektorov. Nový scenár zlyhal na `refetch: Undo restores exact current baseline`: po načítaní nového nekanonického zdroja, skutočnej editácii a Undo zostal draft dirty. Verejný callback MDXEditora je pri `setMarkdown()` tlmený, takže pôvodný ref nezachytil novú normalizáciu.

Doménový `pristineMarkdownPlugin` sleduje importy a ich tlmenú normalizáciu. Natívny editor naďalej používa svoju históriu, source/diff režimy a prekladový callback. Návšteva Source bez editácie zachová pôvodné bajty; skutočná source editácia sa zachová aj po následnom rich-text Undo. Externá zmena nahradí staré mapovanie vrátane zmeny iba koncových prázdnych riadkov. Save/conflict logika panelu sa nemení.

## Výsledky

| Príkaz alebo skúška | Výsledok |
|---|---|
| `pnpm install --frozen-lockfile` | PASS, bez zmeny lockfile |
| `cd apps/app && pnpm exec bun test tests/lawoss-markdown-pristine.test.ts tests/markdown-draft.test.ts` | 8 PASS |
| `pnpm --filter @legalwork/app test` | 1005 PASS, 0 FAIL, 5540 assertions |
| `pnpm --filter @legalwork/app typecheck` | PASS |
| `pnpm --filter @legalwork/app test:i18n` | PASS, 5593 kľúčov |
| `pnpm --filter @legalwork/app build` | PASS, 42,78 s; upozornenia na veľké chunky a závislosti |
| `markdown-clean-open.browser.js` cez samostatnú Playwright CLI session | 33 PASS, 0 known limitations; [JSON](browser-results.json) |
| Safari MCP, syntetický panel | Refetch, skutočná klávesová editácia, Undo do čistého stavu, Redo, save, ďalšia editácia a Undo: PASS |
| Safari konzola a sieť na testovacej karte | 0 warning/error záznamov, 0 HTTP odpovedí >= 400 |
| Safari 760 × 800 CSS px | Viditeľný preložený toolbar, uložený stav po Undo; [screenshot](safari-saved-after-undo.png) |
| `git diff --check`, zhoda `AGENTS.md`/`CLAUDE.md` | PASS |

Browser sada obsahuje edit/Undo po refetchi, source save a prijatí cudzej verzie po skutočnej 409 odpovedi syntetického klienta. Kontroluje aj read-only, nezmenený refetch, ochranu dirty draftu, source syntax, whitespace, CreateLink a Redo. Samostatný [návod](../../../apps/app/tests/fixtures/markdown-clean-open.README.md) obsahuje postup spustenia; počet kontrol treba overiť z `### Result`, samotný exit code Playwright CLI nestačí.

Safari `type` na tomto contenteditable nezmenilo obsah Lexical editora. Preto sa reálna editácia overovala pomocou `keyPress`, dirty stavom a zmenou zobrazeného textu. Jedno vloženie pri diagnostike použilo `document.execCommand('insertText')`; nezapisovalo na disk. Screenshot zachytáva úmyselne uložený syntetický text `Histxory`, po ktorom ďalšia editácia a Undo vrátili čistý stav.

## Hranice

Ide o skutočný MDXEditor a panel s pamäťovým syntetickým súborovým klientom. Nejde o živé klientské súbory, modelové E2E, Electron packaging ani overenie produkčného úložiska. Celá 33-bodová sada bežala v Chromium; Safari vykonalo vyššie uvedený zameraný tok. Pred sériovým merge zostáva aktuálne CI, požadované review a druhá integračná fáza nad `dev` po #103/#104.
