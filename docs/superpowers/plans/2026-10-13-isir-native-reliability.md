# Spolehlivá práce se spisem a dokumenty — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Opravit všech pět zjištění uživatele: dostupnost složky, čtení PDF/OCR/portfolií, kontrolu generovaných souborů, pravdivý stav zpracování a nativní regresní testy; následně po zelených kontrolách push na dev a opakovaný živý průchod.

**Architecture:** Zachovat native-first rozhraní projektů, panel souborů a chat. Server je autorita pro cesty, zdroje, stav extrakce a ověření výstupů. Existující DocumentPreparation/OCR a scoped agent plugins poskytují čtení a generování; přidávané služby nemají paralelní nastavení modelů, vlastní OCR engine ani externí fallback.

**Tech Stack:** Node 24, Bun, pnpm; TypeScript, React, Electron; existující PDF.js, DocumentPreparation, OCR, zod a agent plugin API.

**Spec:** `lawoss/testing/isir/native-reliability-acceptance.md` — schválený uživatelský cíl a měřitelná kritéria.

## Global Constraints

- Výchozí remote dev: 4b5870a9; před nasazením znovu fetch origin i upstream a zahrnout nové změny bez force-push.
- Uživatel výslovně autorizoval plán, implementaci, commit i přímý push na dev po zelených testech. Nevyžadovat opakované schválení plánu/pushe.
- Práce ve worktree goal-isir-reliability-20261013. Nedotýkat se necommitnutých změn jiných checkoutů.
- Node >=24 <25; pnpm; TypeScript strict, žádné nové závislosti bez doložené potřeby. Slovenské conventional commits.
- Reálné ISIR dokumenty, klientská data a přístupové údaje nesmí do Gitu ani do výstupů nástrojů. Testovací fixtures v Gitu jsou syntetické.
- Změny upstream souborů zapsat do PATCHES.md. AGENTS.md a CLAUDE.md zachovat shodné, přidávat pouze obecné vzory. progress.txt obsahuje Codebase Patterns a append-only průběh.
- Neměnit chráněné legalwork-legalmemory-knowledge ani apps/server/src/extensions. Žádné změny verzí OpenCode, globálních oprávnění, nevyžádané cloudové OCR, instalace do uživatelského prostředí nebo automatické odesílání dokumentů. Pro skutečný OCR integrační test lze stáhnout pouze aplikací připnuté a hashem ověřené modelové váhy do odděleného testovacího úložiště mimo Git; uživatelský profil/nastavení zůstávají nedotčené.
- Nativní UI, CZ/SK/EN lokalizace a kompatibilita Windows/macOS. UI nesmí zobrazit zpracováno/ověřeno pouze na základě odpovědi modelu.
- Každá implementace začíná červeným behaviorálním testem. Relevantní úplná modulová sada a typecheck musí projít před commitem; před pushem celé sady server/app/desktop, builds a CI-equivalent kontroly.
- Ověření formátu, čtení a zdrojů není právní schválení ani záruka správnosti každého tvrzení AI.

## Review Focus

1. Přesunutá složka: stejný workspace ID, odkazy a výběr po restartu; stará cesta se nezaloží znovu.
2. Cizí/již připojená složka, symlink, neplatné oprávnění: žádná tichá záměna spisu nebo rozšíření přístupů.
3. Skener/poškozené fonty/portfolio/vložené ne-PDF nebo příliš velké soubory: původní bajty nezměněné, důsledně částečný stav a zdrojová provenience.
4. Model obejde strukturovaný export nebo zapisuje špatnou identitu/CSV: výstup nebude označen jako ověřený; validátor vrátí konkrétní opravitelnou odchylku.
5. Reload, přepnutí spisu, dvojklik a chybějící provider: izolovaný a obnovitelný stav; žádná duplicitní úloha, ztracené soubory nebo předstíraný úspěch.

### Task 1: Obnovení připojení existujícího spisu

**Files:**
- Server `apps/server/src/routes/workspaces.ts`, nový helper v `apps/server/src/lawoss/workspace-reconnect.ts` podle potřeby, konfigurace pouze tam, kde loader nepodporuje stabilní ID.
- Desktop `apps/desktop/electron/workspace-store.mjs`, jeho test; runtime/IPC/preload bridge podle existujících workspace metod.
- Client `apps/app/src/app/lib/legalwork-server.ts`, `apps/app/src/app/lib/desktop.ts` a typy bridge.
- Native UI `apps/app/src/react-app/domains/workspace/project-home.tsx`, sdílená recovery komponenta pro panel souborů, locale files a behaviorální testy.
- Test `apps/server/src/workspace-reconnect.e2e.test.ts`, `apps/app/tests/project-folder-recovery.test.ts`.

**Interfaces:** Produces authenticated POST `/workspace/:id/reconnect`, body `{ folderPath: string, expectedPath: string }`, success `{ workspace, persisted: true }`; caller uses host approval/token. Existing IDs, appFiles policy, display name and other workspace attributes remain stable. Renderer API `reconnectWorkspace(workspaceId, {folderPath, expectedPath})`. Desktop bridge updates same-ID workspace and server registry consistently; no creating a new workspace through workspaceCreate.

- [x] Write filesystem e2e: register A, move its whole folder to B, old path returns project_folder_unavailable, reconnect same ID to B, read original PDF unchanged, restart config and read through the same ID again.
- [x] Add negative cases: invalid host/client scope, remote workspace, existing registered canonical destination, missing/non-directory destination, stale expectedPath, intact original project replacement without explicit recovery, failed persistence and simultaneous reconnect attempts. Verify registries and source bytes remain unchanged on failure. Reusing the freed path for a new workspace must allocate a distinct ID, not overwrite the moved one. Historical chat membership is an immutable captured ID set; future foreign chats at reused old path are rejected.
- [x] Run failing tests: `bun test src/workspace-reconnect.e2e.test.ts` in apps/server; `node --test electron/workspace-store.test.mjs` in apps/desktop. Record exact failing behavior.
- [x] Implement route/helper and desktop bridge with existing canonical-path and persistence APIs. Preserve metadata and bindings, do not copy/recreate originals or reset sessions. Serialize mutations, validate before applying, roll back in-memory state when persistence fails. Outside appFiles storage retains its original key across moves. Historical session reads use supported metadata APIs with strict captured-ID and directory filtering; tool cwd stays current; no old filesystem grants or internal OpenCode DB writes.
- [x] Implement native error action: show current missing path with localized error, pick existing folder via native picker, cancel is a no-op; reconnect, refresh project/file queries and activate same ID. Browser fallback accepts an existing path through controlled form and server host authorization.
- [x] Behavior test recovery invocation/cancel/error/refresh and typecheck both clients. Example externally observable gate:

```ts
const originalId = registered.activeId;
await rename(originalFolder, replacementFolder);
const repaired = await reconnect(originalId, { folderPath: replacementFolder, expectedPath: originalFolder });
expect(repaired.workspace.id).toBe(originalId);
expect(repaired.workspace.path).toBe(replacementFolder);
expect(await readThroughApp(originalId, "Dokumenty/source.pdf")).toEqual(originalBytes);
```

- [x] Run complete server, app and desktop tests affected by the change, typechecks; self-review and commit. Controller performs fresh task review before Task 2.

### Task 2: Jednotné čtení dokumentů a PDF portfolií

**Files:**
- New bounded service/types/storage in `apps/server/src/lawoss/documents/`.
- Reuse `apps/server/src/corpus/extract.ts`, `apps/server/src/document-preparation/` and `apps/server/src/ocr/`; smallest necessary PDF inspection hooks, never generated pdf-assets or core-skills bundles.
- Routes registration `apps/server/src/server.ts` plus `apps/server/src/routes/lawoss-documents.ts`.
- Existing scoped plugin `apps/server/src/opencode-plugins/legalwork-project-tools.ts` or independent plugin with full runtime/build registration; no edits in protected knowledge/extension modules.
- Tests filesystem/API `apps/server/src/lawoss-documents.e2e.test.ts`, portfolio fixtures made using existing pdf-lib/PDF.js.

**Interfaces:** Server endpoints GET `/workspace/:id/lawoss/documents` and POST `/workspace/:id/lawoss/documents/prepare` with `{paths: string[]}`. Stable document records contain workspace ID, relative path, SHA-256, uploaded/preparing/readable/partial/failed status, page coverage, extraction method, source/attachment provenance and issue. GET/read agent result is paginated `{text, pages, complete, nextOffset, ...}`; source content never acts as instructions. Agent tools `lawoss_documents_prepare`, `lawoss_documents_read` use these scoped endpoints. Jobs persist and interrupted preparation becomes retryable, not falsely complete.

- [x] Test real text PDF yields readable pages and source hash; malformed text enters existing OCR pipeline, configured OCR failure remains partial with original readable text; scan with usable configured OCR becomes readable. Fake only external OCR model, not PDF discovery/extraction/state storage.
- [x] Test portfolio `getAttachments()` with two embedded PDFs is processed as two attributed child sources, preserving parent hash, child names and real page numbers. Detect unsupported/oversize/encrypted/nested cyclic/deep attachments as incomplete; originals never changed.
- [x] Test UTF-8 extracts with PDF page separators are readable text; genuine NUL/binary and invalid UTF-8 remain rejected. Avoid changing OpenCode's binary detector; agent consumes normalized bounded extracts through our tool.
- [x] Test paths outside workspace, symlink escapes, source changed during extraction, duplicate preparations, cancellation, restart during processing and stale source hash.
- [x] Implement bounded persisted service by composing extractCorpusText/DocumentPreparation. PDF attachments stay in app-owned scratch with generated safe names, count/depth/total-byte/text limits. No execution of embedded content or silently remote OCR.
- [x] Add bounded background preparation + progress/state/read route and agent tool registration. Use existing authorizations and workspace appFiles placement. Agent system guidance must prefer these tools to shell pdftotext and retain incomplete coverage.
- [x] Run complete server/plugin suites and typecheck/build; self-review and commit, fresh review.

### Task 3: Strukturovaný export a automatická kontrola výstupů

**Files:** `apps/server/src/lawoss/documents/export.ts`, `validation.ts`, tests; extend lawoss document routes and scoped plugin from Task 2. Source manifest support is generic; accept known ISIR manifest only as untrusted metadata within selected workspace.

**Interfaces:** POST `/workspace/:id/lawoss/documents/export` accepts document references and structured summary/registry entries; server supplies project/case identity and serializes CSV using proper quoting. POST `/workspace/:id/lawoss/documents/validate` validates actual saved output paths, current source hashes, manifest IDs/URLs/identity and CSV field widths, returning `{valid:boolean, issues:..., outputs:...}`. Tools `lawoss_documents_export`, `lawoss_documents_validate`. Verification record is tied to output SHA-256 and source hash, never permanent after edits.

- [x] Test semicolons, quotes, newlines, Czech UTF-8 and missing optional facts. Exported seven-field ISIR registry has exactly one row for each distinct selected source, excludes duplicate copies by source ID/hash.
- [x] Test real initial malformed rows from prior observations (6 instead of 7 columns), missing/mismatched case identity, missing/extra/duplicated rows and official URL mismatch are invalid with specific issues; no success flag from model text.
- [x] Test outputs saved through ordinary agent file tools are inspectable and remain unverified until checks pass; editing an already validated output invalidates its verification. Do not intercept/prevent unrelated user CSV writes.
- [x] Implement CSV parser/serializer with quoted multiline fields; no new dependency. Validate readable JSON reference inputs using zod. Never infer a legal case number from workspace ID or unrelated file.
- [x] Structured export writes known identity header from persisted workspace/reference manifest, preserves unknown facts as such, stages outputs atomically and refuses overwriting user-owned files. A repair may update only the registered generated output with matching expected hash/revision.
- [x] Agent tool result instructs repair of concrete issues and revalidation; bounded retries through existing agent workflow. Success requires files reread by server. Validate formatting/provenance, not legal truth.
- [x] Run server suites, plugin behavior tests, typecheck/build; self-review and commit, fresh review.

### Task 4: Nativní UI se stavem zpracování a generováním přes chat

**Files:** `apps/app/src/react-app/domains/session/panel/workspace-files-panel.tsx`, small focused processing controller/components, workspace/project file intake hooks, app/lib/legalwork-server.ts client types/methods, locale CZ/SK/EN (other supported structures kept aligned), React behavior tests.

**Interfaces:** Consumes Task 2 statuses/read results and Task 3 verification. UI exposes prepare on selected files/folder, source coverage and issues, verified/invalid/edited output state. Generate action uses existing native project chat creation, selected connected provider/model, permissions and task submission path. No hard-coded model, separate AI settings or fabricated generated content.

- [x] Test uploaded vs readable vs partial and generated vs format-verified; count real distinct sources and page coverage, label incomplete OCR clearly. A model message cannot promote status.
- [x] Test prepare/read/validate on selected project never sends siblings; stale output/source resets status; reload/polling recovers; double submit/cancel/errors leave consistent state.
- [x] Test generate action passes selected project + source refs to the existing chat submission, preflights provider/engine and gives localized actionable error before creating side effects when unavailable.
- [x] Add native panel actions and state refresh using React Query conventions. Plain source text and file names are escaped; navigation/model reuse existing UI flows.
- [x] Generate prompt names scoped preparation/read/export/validation tools and actual relative source paths. It requires Czech when UI is Czech, retains facts/unknowns/source pages and validates before completion. Technical checks do not present output as lawyer-approved.
- [x] Run app complete tests, typecheck, locale parity and build plus desktop bridge tests; self-review and commit, fresh review.

### Task 5: Automatizovaný nativní průchod a opakovaná živá akceptace

**Files:** Incorporate existing test commit 42e11242 if not merged; new desktop native regression harness/tests, app e2e integration, pnpm scripts and both appropriate CI workflows. Public data stay outside repository.

**Interfaces:** `pnpm test:isir` offline transport suite; `pnpm test:isir:native` automated actual Electron/renderer flow with isolated profile and deterministic controlled provider transport for CI. `LAWOSS_ISIR_CORPUS` enables real local PDFs, explicit live provider run performs preflight first. Harness distinguishes provider fake from live generation and returns nonzero for pending, invalid or incomplete claims.

- [x] Observe current missing recovery/processing/export/UI cases fail through actual routes and rendered UI. Harness must exercise buttons/file picker bridge, drag/drop, chat attachment submission, source state, real production export/validation and restart; no source-text assertions or manual file placement as upload proof.
- [x] Implement native test using existing Electron/browser automation utilities and synthetic original PDF fixtures. Keep fake engine response at provider/transport boundary only; all app UI, workspace persistence, filesystem and validation are real.
- [x] Run offline native flow: attach files with spaces/Unicode/duplicate names into ten cases, switch projects, recover moved folder, request agent export, inspect output, restart and repeat reads. Verify original hashes and no cross-project writes.
- [x] Cold restart with a moved registered root must leave the old path absent, keep the host usable and allow same-ID recovery. Native RED found runtime provisioning recreated `.opencode` under the missing path; cover both app-files modes and existing-root startup before final native rerun.
- [x] Run Node/server/app/desktop checks and builds corresponding to CI. Fix all observed failures before committing/pushing. Update PATCHES, general AGENTS/CLAUDE patterns and progress.txt.
- [x] Fresh whole-branch review. No unresolved findings from requirements 1–5 may be deferred merely to satisfy a cap.
- [ ] Fetch both remotes, integrate current dev advancement, rerun relevant checks; publish the same tested feature SHA to obtain the five required remote CI checks. Hosted dev rules require an ordinary PR with approval and green checks; integrate through that flow without changing protections. PR #156 merged only the original bdaba06e series; prepare a new PR for subsequent reviewed fixes. Verify remote SHA and CI outcomes; never claim feature-branch push or an older merged PR as deployment of the new fixes.
- [ ] Snapshot existing profile/test data and stop old application cleanly; launch freshly built pushed SHA using preserved profile. Retest original ten local ISIR samples through native UI and real agent, choosing new output locations to preserve previous evidence. Never print credentials or use client cases/free models.
- [ ] Audit all numbered requirements against actual evidence and keep goal active for any gap. Any finding opens a new failing test → implementation → green tests → commit/push → rerun loop. Completion is clean scoped requirements/acceptance with actual UI/live evidence, not an assertion that all software can never fail.

### Závěrečná revize: oprava dvou doložených regresí

Revize celé větve k `45a325e1` odhalila dvě Important chyby v propojení již implementovaných částí. Opravy jsou podmínkou čisté revize Task 5, nikoli změnou původního cíle.

- [x] Reprodukovat skutečnou přípravu portfolia A → B → A a výběr přes nativního konzumenta včetně uloženého stavu, nového procesu služby a shodných časů. Test před opravou vybírá starou B i její přílohu.
- [x] Reprodukovat CSV s platnou identitou, které pro nečitelný zdroj tvrdí úplné čtení a získává ověření, včetně historického uloženého stavu.
- [x] Oddělit trvalé přijetí aktuálního originálu od času extrakce; zachovat původní ID, provenienci a výběr správných příloh i po reloadu.
- [x] Vyžadovat prokazatelné aktuální pokrytí pro ověření CSV/summary i při zobrazení starších záznamů. Legacy text zůstává čitelný, ale neuděluje neprokazatelné ověření; pravdivý partial/failed export je přípustný.
- [x] Dokončit modulové testy, strict/build, signed commit a jednu nezávislou scoped re-review obou oprav. Poté pokračovat všemi otevřenými sestavovacími, CI, nasazovacími a živými kroky Task 5.

Finální sestavení odhalilo ještě nesprávnou kontrolu názvu enginu v testu. Harness-only `ec197e1d` ověřuje skutečnou platformní binárku, manifest/hash i executable/health verzi při startu a restartu; samostatná scoped revize je čistá. Nový celý nativní průchod deseti syntetických spisů i macOS package/startup prošly. Toto uzavírá lokální kódové/testové kroky, nikoli otevřené remote CI, protected `dev` a skutečné public/provider/CUA kroky výše.


### Nová kola podle skutečného remote CI (PR #156)

První publikovaný HEAD dad974fd prošel source testy Linux/macOS a i18n. Windows portable a všechny tři natívní package průchody selhaly; lokální zelený průchod je nenahrazuje.

- [x] Reprodukovat zastaralý zápis při shodném mtime přes skutečné HTTP; odmítnout konfliktní baseContent i bez změny času, zachovat merge/force. Oprava 251b523a, cílený RED/GREEN.
- [x] Zachovat testy hlaviček s Windows-valid názvy a úplnými file URL pro child import; přidat bezpečně omezené synthetic-only native/cleanup diagnostiky, které zachovají původní chybu. Commit 2fd12637, covering49server/23helpers GREEN.
- [x] Nezávislá immutable scoped review prvního CI kola, aktuální úplné lokální testy/build a feature publikace bdaba06e. Nové remote výsledky znovu otevřely zbývající kroky níže.
- [ ] Z nových remote výsledků/artifacts určit skutečnou příčinu native timeoutů a Windows EBUSY; opravit jen doložené příčiny, bez skipů či potlačení chyb. Sdílené DB shutdown vlastnictví musí prokázat souběžně živý druhý server i poslední release/restart.
- [ ] Zelené požadované OS CI, běžné schválení PR a začlenění do dev; potom zachovaný uživatelský profil, skutečné public/provider/CUA testy a závěrečný audit Task5 výše.

Historický stav před následnými opravami 14. 10. 2026: publikované bdaba06e prošlo source Linux/macOS a i18n; Windows portable má 18 selhání úklidu EBUSY a všechny tři native package průchody selhaly. Lokální podepsaná databázová implementace 45799fd5 prošla server1560/21skip/0fail, Node2/0fail a zbývajícími lokálními integračními kontrolami. Nezávislá revize však otevřela tři Important chyby; oprava není publikovaná ani schválená k nasazení.

- [x] Při neúspěšném zavření zachovat skutečný prostředek a generaci, zkusit ostatní prostředky a umožnit explicitní bezpečný úklid bez dvojího snížení vlastníků či předčasného otevření nástupce.
- [x] Předat přijatou krátce odloženou task/project synchronizaci zbývajícímu živému serveru; ověřit opačné pořadí zastavení i skutečný Node AsyncLocalStorage kontext.
- [x] Zachovat původní chybu inicializace i chybu zavření a vlastnictví částečně otevřené databáze ve všech osmi adaptérech a nezávislých přímých store instancích.
- [x] Po skutečných RED/GREEN dokončit zmrazené úplné kontroly a čerstvou immutable revizi těchto tří oprav před další publikací. Fix 1a6f89ff: server1575/21existujících skip/0fail, strict/build0, Node2/0skip/0fail; I1–I3 nezávisle potvrzeny jako odstraněné.
- [x] Opravit dva nové testové typy `any` bezpečným zúžením `unknown`, zachovat všechny behaviorální kontroly a uzavřít malou scoped revizi. Test-only 71bce45c: focused34/0fail/153assertions, strict0; čerstvá scoped revize Minor ADDRESSED bez dalších zjištění. Produkční kód a jeho úplné testy se tím nemění.
- [x] Prokázat a opravit zrušení streamu přes celý autentizovaný produkční proxy; c4ba6455/1e0d7d2e a fresh reviews potvrzují signal/reader cleanup i druhý živý stream. To samo neprokazuje příčinu browser timeoutů.
- [ ] Doložit příčinu Linux/macOS nativního zaseknutí a Windows resetu na skutečných platformách; zpřesnit bezpečné diagnostiky, zachovat normální obnovení enginu a všechny dosavadní akceptační podmínky.

### Nové skutečně prokázané streamové hranice (2026-10-14)

- [x] Prokázat únik přes skutečný autentizovaný produkční proxy/HTTP, včetně zrušení před hlavičkami a ohraničeným metadata fetch. Oprava c4ba6455: fullserver1585/21existujících skip/0fail, Node13/0skip/0fail, strict/build/import233/2350; druhý stream zůstává funkční, normální odpovědi a prompt/file kontrola zachované.
- [x] Dokončit nezávislou immutable revizi proxy/reader/signal a nového macOS/Windows CI výběru před dalším production writerem. Production design schválen; Minor logger fixture opraven1e0d7d2e s Bun17/0fail, Node15/0skip/0fail, strict/build0 a čerstvou M1 ADDRESSED revizí bez dalších zjištění.
- [x] Prokázat nový idle-owner/cache-GC problém: skutečný SDK stream a React runtime dekódují dokončení/idle, ale po přirozeném16.5s vypršení15s status query zůstane po posledním release workspace SSE otevřený. Okamžité release a druhý vlastník fungují. Toto samo neprokazuje native CI zahlcení.
- [x] Zachovat autoritativní idle evidence v bounded session-sync lifetime nezávisle na krátké UI query cache; skutečný decoder/cache regression a přirozený browser GC průchod musí projít, včetně busy/unknown/error/accepted/wait/second-owner ochran. Oprava74131578: disabled observer jen během trackedrefs, default15s GC zachován, žádný extra fetch/transcript pin, fresh review bez actionable findings; focused46/0fail/fullapp1533/2existující skip/0fail/strict/build0 a původní+rozšířený browser socket0/observer0/postreleaseGC důkaz.
- [ ] Po nových clean reviews zopakovat poslední sestavení/nativní a skutečné remote OS kontroly; původní Windows reset/config publication, protected dev a skutečné public/provider/CUA kroky zůstávají otevřené.

### Aktuální bootstrap, výběr přílohy a integrace (2026-10-14)

PR #156 je skutečně sloučený do dev1c1dc431; jeho strom odpovídá publikovanému bdaba06e. Nové lokální SQL/proxy/app opravy ani rozpracovaný bootstrap v tomto merge nejsou. Oba remotes obnoveny; upstream/dev8086c06b je pouze informační, neautorizuje wholesale merge upstream development. Fetch tags odmítl přepsat existující v0.1.14; tag zachován, následný no-tags dev fetch úspěšný.

- [x] Dokončit bootstrap/diagnostics: skutečné A unscoped reset TimeoutError30003ms; B autentizovaný workspace reload200 a skutečné tool/file/hash výstupy případů1–2. Zachovat přesný scope/readiness, mixed-clock/loader epoch diagnostiky, bounded current/history a probe skutečného selhávajícího spisu; nezávislá immutable revize před publikací.
- [ ] Prověřit další skutečnou hranici: B případ3 má před OS provisioning odpojený file input. Rozlišit zastaralý CDP odkaz od produkčního unmount, začít doloženým RED a opravit nejmenší skutečnou příčinu bez retry/sleep/skip nebo oslabení native acceptance.
- [ ] Po clean reviews začlenit aktuální dev a nové opravy do nové běžné PR, dokončit všechny požadované lokální/native/remote OS kontroly a schválení; poté zachovaný profil, deset public ISIR spisů přes skutečné UI a vybraný placený provider, restart/hash audit a otevření ověřené aplikace.

Bootstrap9dc1f5e má čerstvou nezávislou spec/quality revizi bez Critical/Important. Jediný Minor očekávaného fixture logu odstraněn test-only284d60b5; focused2/allhelpers34pass0fail0skip/syntax0 a fresh scoped Minor ADDRESSED bez nových zjištění. Skutečný celkový native/OS průchod tím není zelený; další krok je evidence-driven chooser scope výše.

### Opětovně otevřená spolehlivost nativního resetu (2026-10-14)

Následující skutečný observer baseline1767 skončil ještě před chooserem: configPATCH200/auth200, supported workspace reload TimeoutError30002ms. Předchozí supported B28.853s +2 případy tedy nedokazuje spolehlivý bootstrap. Scoped helper/diagnostic revize9dc/284 zůstává dokladem svého omezeného kódu, nikoli uzavřením této nové runtime hranice. Tento stav je historický: po doložené initial-only readiness změně byly observer/startup soubory commitnuty5807 a I1 opravena4414; současná hranice je příprava osmého spisu níže. Chooser stále nemá prokázanou příčinu dřívějšího odpojení ani lifetime opravu.

- [ ] Ve skutečném připnutém hostu rozlišit scoped dispose, readiness GET/mcp, restoration a odpověď; jedno nové izolované stage měření, bez opakování nezměněného plného průchodu, skipu/reset workaroundu nebo navýšení timeoutu.
- [ ] Z doložené příčiny odvodit konkrétní behaviorální RED, nejmenší produkční opravu a GREEN/čerstvou revizi. Config persistence není důkaz derived-file publication; streamové pending počty nejsou socket census.
- [ ] Potom obnovit stejného chooser implementera, prokázat jeho actual lifetime/owner hranici a dokončit původní celý native/remote/dev/preserved-profile/public-provider/CUA řetězec.

### Aktuální příprava osmého spisu a revize startu (2026-10-14)

- [x] Zmrazit nový commit `5807e787` a získat nezávislou revizi přesného diffu. Kontrola počáteční instance prošla v původním 90s rozpočtu; běžný reset má stále 30s. Osm skutečných dialogů mělo správného vlastníka a připojený stejný vstup; nejde o prokázanou opravu dřívějšího odpojení vstupu.
- [x] Opravit a nezávisle znovu zrevidovat I1: neplatné JSON tělo nesmí proniknout do zprávy, stacku ani cause; transportní chyby a deadline zachovávají původní identitu. Skutečný HTTP RED před opravou, úplné pokrývající helper testy po opravě.
- [x] Ověřit uchovaný úplný CDP záznam bez zveřejnění surových dat. Pro spisy1–7 bylo15 POST prepare a všechny200; pro spis8 nebyl POST prepare odeslán. CDP events jsou append-only; hypotéza chybného indexu kvůli ořezu pole není podložena. Kopie25souborů odpovídají originálům,14výstupů je uložených;31originálů beze změn.
- [x] Oddělit historické streamy od aktuálního dokumentu: před osmým dialogem aktuální epoch1 obsahovala5sledovaných streamů, při selhání6; samostatný starý app-sync patří do historie. Stejný origin/HTTP1.1 a odlišné pozorované connectionId jsou vodítka, nikoli census živých socketů nebo důkaz příčiny.
- [ ] Po čisté revizi I1 mapovat skutečnou posloupnost klik → discovery/files → prepare a vlastníky transportů. Nové měření musí odlišit neprovedenou akci, čekající discovery/OPTIONS, chybu UI a serverovou chybu; příčina musí být doložená před produkční opravou. Žádné delší timeouty, neověřený retry, vynechání spisu nebo plošné rušení aktivních relací.
- [ ] Skutečný nový úplný průchod10spisů/31zdrojů/20výstupů včetně restartu/history/přesunu/cwd/hashes po doložené opravě, poté původní úplné remoteOS/PR/dev/profil/public-provider/CUA/finalaudit gates. Sedm průchozích spisů nezavírá celý cíl.

### Znovu doložené odpojení přílohy při změně klienta (2026-10-14)

- [x] Jeden nový instrumentovaný průchod13312 došel po3úplných spisech k chooseru4: stejný spis/root/složka/panel/document, klient14→15, odpovídající query pending/fetching, odstraněný řádek a odpojený přesný event input před OS provisioning. Všech31originálů beze změn,10importů a6výstupů; cleanupcleantrue. Nedošlo k testu spisu8 ani k uzavření celé matice.
- [x] Zmapovat actual řetězec: nový workspace objekt při refresh může přepočítat selectedWorkspaceEndpoint a vytvořit nového klienta; client identity je součást query key, uncached loading nahradí řádky skeletony a odstraní skrytý file input. Konkrétní původce refreshe/token equality v běhu nebyly zachyceny, tento závěr zůstává omezený na doloženou pozdější posloupnost.
- [x] Uchovat4dočasné diagnostické source soubory sSHA a bezpečné receipts; obnovit2tracked soubory přesně zBASE16fe, odstranit2vlastní helpers. Repo opět čisté, diagnostika není vydávána za produkční opravu. Skutečný busy/runActive vlastník prvního spisu nesmí být označen jako unused ani násilně zrušen.
- [x] V novém samostatném produkčním úkolu prokázat deterministický mountedReact/native RED: skutečný podporovaný refresh v době otevřeného chooseru, nezávislé potvrzení jeho dokončení a přesný stejný backendNode/input. Opravit stabilitu klienta pouze při nezměněných skutečných routing/auth operandech; zachovat nulové/prázdné token fallbacky, remote ID, skutečnou rotaci spojení a nezávislé root/execution/query zabezpečení.
- [x] Pokrývající behaviorální testy změny auth/server/workspace/local-remote, úplný app/strict/build a native helpers; stejný skutečný RED scénář musí projít se stejným inputem/preloadIPC/hash. Čerstvá immutable revize před pokračováním/nasazením.
- [ ] Nový aktuální úplný native10/31/20/history/restart/move/cwd/hash průchod; dřívější čekání discovery spisu8 zůstává otevřené do důkazu. Potom původní úplné source/platformCI/protectedPR/dev/preservedprofile/publicpaidprovider/CUA/finalaudit gates bez zúžení cíle.

### Aktuální čekající discovery a neúplný úklid (2026-10-14)

- [x] Endpoint oprava05089 a testové zpřísnění70862 mají čisté scoped revize. Skutečný stejný metadata-refresh RED→GREEN zachoval přesný chooser/node/IPC/hash a stabilitu klienta;26mounted-hook kontrol, app1537/2existujícíWinSkip/0fail, helpers42/offline14/type/build zelené. Není to celý native GREEN.
- [x] Jediný pokrývající nový průchod70995 skončil po6úplných spisech/12výstupech při čekání discovery spisu7 (správná složka/within, OPTIONS bez odpovědi, GET failed, žádný POSTprepare).31originálů nepozměněno,22importů odpovídá. Příčina vlastníků/transportu stále není potvrzená.
- [x] Zachovat původní false cleanup receipt: Electron skončil0, Vite14349 zůstal živý. Oddělené ověření vlastních2procesů/UID/group/start/argv/cwd a kontrola před každým jednotlivým signálem oba ukončily; nic nesignalizovalo starý numerický PGID. Supplement neznamená, že původní cleanup prošel.
- [ ] V čerstvém diagnostickém úkolu na schváleném endpointu zjistit konkrétní pre-dispatch/SSE vlastník a současně konkrétní cleanup guard/stage. Skutečný busy/accepted/waiting stav nesmí být vynuceně označen idle nebo zrušen. Pending CDP není počet živých socketů; typ Error dosud neurčuje cleanup příčinu.
- [ ] Teprve pro doloženou příčinu skutečný behaviorální RED, nejmenší matching production fix, pokrývající GREEN a nezávislá revize. Žádné slepé opakování, prodlužování limitů, potlačení chyb či zúžení10spisů/31zdrojů/20výstupů/restart/history/move/cwd/remoteOS/publicprovider/CUA/finalaudit.

### Task 6: Dodatečná oprava návratu dokončené relace do busy (součást původního Task 5)

Tento dodatečný implementační úkol nezavádí šesté uživatelské zjištění a nezmenšuje původní rozsah1–5. Dokončení stále vyžaduje celý původní native10/31/20/history/restart/move/cwd, všechny source/platform gates, protected dev integraci a zachovaný profil/public-paid-provider/CUA/final audit.

**BASE:** 2c6b4f0dfd4988083963d4580a9190aa8fbbc720; worktree /Users/vojte/Projects/lawoss/_worktrees/goal-isir-reliability-20261013. Diagnostika je obnovena přesně doBASE, gitstatusclean, všechny její procesy skončily. Sole fresh production writer, not alone: preserve root-owned documentation/ignored archives and every other change. No subagents. Root owns AGENTS/CLAUDE/PATCHES/progress.txt/tracked plan/ledger/review/remote/dev/userprofile/publicprovider/CUA/finalaudit. Do not poll old handles or restart due to observation expiry.

**Read first:** this task's extracted brief; then only the Actual writer-order result, Matched minimal production repair proposal and Writer-order cleanup/restoration sections of .superpowers/sdd/2026-10-13-isir-native-reliability/native-discovery-cleanup-cause-report.md; binding lawoss/testing/isir/native-reliability-acceptance.md. Safe297row proof and excerpt are indexed in writer-order-run95638/sha256.json; original diagnostic source archive writer-order-diagnostic-source-2c6b4f0 is evidence only, NOT source to reintroduce.

**Actual cause:** first-case real mountedReact/native run95638 passed originalcase1, then intended typed partial stop (not whole-gate). Sequence270–279 actualnativeidle makes corefalse/cacheidle and bindingcompletedrev20. Metadata session.updated280–281 preserves oldcachedsnapshotbusy; actualReacteffect282→seedSessionState/coreseed284–285 flips activityfalse→true andcachebusy286; second effect repeats. Current lifecycle295/297 sameacceptedmessage/nativeRevision idle/terminal, no neweraccepted/nativebusy/HTTPread/wait/error. Snapshot updater-returnordinal21 vs published22 differs under structuralsharing: do not rely on object pointer identity. Missing initial idle A refuted for thiscase. Prior full21426 reached9cases/31hash-equal originals+imports/18outputs, then case10 preflight/GET/noheaders/noprepare. This writer proof does not independently prove browsercapacity causality or historicalcleanupfailure70995 (latestcleanupGREEN, oldguardunknown).

**Root ruling:** synchronize execution status on an EXISTING cached session snapshot with authoritative native status publications already applied to core/statusQuery; preserve metadata/revert updates and hydration. This directly prevents the proven metadata replay without deriving idle from completed binding or force-releasing owners. Cost if wrong: snapshot notifications may retrigger hydration/transcript reconciliation or fail to protect a competing late HTTP writer; test existing transcript/accepted/error/wait/revert controls and retain full native gates. Do not invent status snapshot when absent, pin queries or add fetches/observers/timers/revision maps/global caches. No changes to querykeys/defaultGC/native owner safety/model/permissions/timeouts/engine/provider config/dependencies/version. An alternative production architecture needs a concrete escalation and root ruling before edit, not a silent expanded fix.

**Exact initial production ownership:** apps/app/src/react-app/domains/session/sync/session-sync.ts. Tests: apps/app/tests/session-sync-retention.test.ts, or declare one adjacent focused regression path before creation. Audit the existing real session.status, terminal assistant, session.idle status publications and existing session.error guard path in this same module; preserve legitimate error behavior and ask root before changing error semantics or another module. Reuse a small local helper if it removes repeated status publication logic, avoid unrelated restructuring. No production edits to SessionSurface/activity-store/lifecycle or debug APIs. No harness edit or new native partial flow without declaring exact needed assertion/ruling.

**RED before production edit:** use existing actual HTTP/SSE/SDK fixture and real QueryClient/snapshot observer/applyEvent/seedSessionState/activity store. Obtain the busy snapshot at a controlled real HTTP caller seam; deliver actual native idle followed by session.updated metadata, drive BOTH existing seedSessionState caller invocations from actual publishedsnapshot. Expected correct idle/activityfalse and final unused owned ServerResponse close must fail onBASE. Do not copy decision logic or label this caller-order test mountedReact. Actual native297row trace already proves mountedReact RED. Assert exact selected session/workspace/source scope and restored metadata/revert cursor, not merely boolean helper output.

**GREEN/guards:** matched sequence staysidle and releases only its last unused stream; native busy/retry afteridle remainslive and snapshotbusy; newly accepted newer turn/revisionzero remainsactive despite older idle hydration; unknown/error/wait/compaction and otherworkspace/session/directory/secondowner remain retained, as appropriate in existing contracts. Test missing snapshot is not synthesized, metadata/revert/transcript survive native cache publication, duplicate caller/remount/structural-sharing behavior does not resurrectbusy. Retain existing naturalGC/queryobserver contracts and error protections. Native event fields authoritative, no mixing clocks/client-server timestamps or terminal-tools-only guess.

**Verification:** Node24.21 PATH /Users/vojte/.nvm/versions/node/v24.21.0/bin:$PATH. Focused covering tests during iteration. Once actualRED→GREEN/guards pass, full @legalwork/app test/typecheck/build and native helper suite (after existing built server availability), syntax/diffcheck once; tests must be selected by applicable CI filters, declare a minimal filter gap before modifying workflows. No fullserver/desktop rerun for unchanged code solely to pad evidence; root runs final sourcefreeze suites before publish. If a new test causes environmental/auth/shared-fixture error, retain evidence and fix actual cause, do not delete/skip expected assertions. Own/poll all handles and safe cleanup; do not use root/user processes. No source hooks/temporarydiagnostics committed.

**Commit/report:** normal Slovak conventional Signed-off commit of ONLY owned source/tests after actual covering gates; no push/merge. Write .superpowers/sdd/2026-10-13-isir-native-reliability/native-snapshot-status-replay-report.md: BASE, exact source paths, concrete RED/GREEN commands/exits/output, preserved guard contracts, frozen sourceSHA, fullmodule checks/skips, self-review, possible competing writer/cleanup uncertainties and process handles terminal/live. Return under15lines DONE/DONE_WITH_CONCERNS/NEEDS_CONTEXT/BLOCKED, commit, one-line tests, concerns and report path; release sourceownership. Root dispatches fresh immutable spec+quality review, then full original native/currentplatform/protecteddev/profile/publicprovider/CUA sequence. No whole-goal/whole-native claim from this component.

#### Binding Global Constraints (verbatim)

- Výchozí remote dev: 4b5870a9; před nasazením znovu fetch origin i upstream a zahrnout nové změny bez force-push.
- Uživatel výslovně autorizoval plán, implementaci, commit i přímý push na dev po zelených testech. Nevyžadovat opakované schválení plánu/pushe.
- Práce ve worktree goal-isir-reliability-20261013. Nedotýkat se necommitnutých změn jiných checkoutů.
- Node >=24 <25; pnpm; TypeScript strict, žádné nové závislosti bez doložené potřeby. Slovenské conventional commits.
- Reálné ISIR dokumenty, klientská data a přístupové údaje nesmí do Gitu ani do výstupů nástrojů. Testovací fixtures v Gitu jsou syntetické.
- Změny upstream souborů zapsat do PATCHES.md. AGENTS.md a CLAUDE.md zachovat shodné, přidávat pouze obecné vzory. progress.txt obsahuje Codebase Patterns a append-only průběh.
- Neměnit chráněné legalwork-legalmemory-knowledge ani apps/server/src/extensions. Žádné změny verzí OpenCode, globálních oprávnění, nevyžádané cloudové OCR, instalace do uživatelského prostředí nebo automatické odesílání dokumentů. Pro skutečný OCR integrační test lze stáhnout pouze aplikací připnuté a hashem ověřené modelové váhy do odděleného testovacího úložiště mimo Git; uživatelský profil/nastavení zůstávají nedotčené.
- Nativní UI, CZ/SK/EN lokalizace a kompatibilita Windows/macOS. UI nesmí zobrazit zpracováno/ověřeno pouze na základě odpovědi modelu.
- Každá implementace začíná červeným behaviorálním testem. Relevantní úplná modulová sada a typecheck musí projít před commitem; před pushem celé sady server/app/desktop, builds a CI-equivalent kontroly.
- Ověření formátu, čtení a zdrojů není právní schválení ani záruka správnosti každého tvrzení AI.

#### Task6 additional matching error-hydration ruling

Two real same-module REDs now supplement the nativeidle replay: busy→actual session.error→metadata/both seed callers clears errorActive and reactivates; nativeidle→error→metadata/seed preserves error but refreshes stale statusQuery.dataUpdatedAt, potentially making knownIdle appear newer than the error. Exact fixtures/outputs remain in snapshot-replay-error-red.log and snapshot-replay-error-idle-timestamp-red.log; timestamps are compared only to the same captured query timestamp, not mixed server/client clocks.

Ruling: in existing seedSessionState, while CURRENT activity.errorActive is true, skip both seedSessionRun and statusQuery hydration but continue transcript/revert/todos. Preserve actual session.error branch unchanged; no invented idle/new provenance map/new module. Authoritative genuine accepted prompt/native busy still clears error via existing setRunStatus and enables normal hydration. Check currentactivity at relevant hydration sites; do not let a previously captured error override newer authoritative work. Cost if wrong: a genuinely fresh busy HTTP snapshot alone remains conservative until native/accepted evidence clears error; report this policy/uncertainty for independent review and do not suppress actual authoritative native/accepted recovery. This is explicit error ownership preservation, not a claim that every arbitrary snapshot must revive failed work.

Required focused RED→GREEN covers both error reactivation and staleidle timestamp refresh, real subsequent nativebusy/acceptedrevision0 recovery, transcript/revert preservation and final realidle/owned stream close. The initial full1542green predates this additionalproductionchange and stays historical; rerun appropriate finalfullapp/strict/build/helper gates after changedsourcefreeze. Root fixes only own trackedplan whitespace; no newproduction/test path/native launch/workflow/push. Whole original1–5/fullnative/public/provider/restart/dev acceptance unchanged.

#### Task6 accepted-HTTP evidence ruling after capacity interruption

Prior continuation is progress: real297row mounted cause and matched native/error RED→GREEN changed authoritative source, then exact HTTP-newaccepted recovery RED exposed an overbroad error guard. Root capacity interruption ended work, not a completed goal/blocking external condition; current source/reports/activegoal revalidated before resume. Production BASE still2c6b4f0; owned two-file patch retained, no commit, no live handles. Root docs preserved.

Ruling: implement the latest same-module conditional accepted-work exemption based on the latest existing transcript USER ID at hydration entry. For a live incoming snapshot, apply its revert cursor before deciding; require the exact known current user anchor followed in incoming message order by a distinct newer user, with no incoming error for/after the newest turn. No lexical-ID ordering, object-pointer identity, message/server-clock comparison or historical synthetic-error-row position. Missing/same/older/reverted/current-already-failed evidence stays conservative. Current authoritative activity must be re-read at final status publication; native/locallyaccepted recovery unchanged. Error-only same-turn cached metadata still cannot reactivate or refresh staleidle timestamps. No new maps/modules/API/state ownership or changes to error branch under this initial exemption.

Cost if wrong: if a genuinely new user already reached the live transcript before HTTP hydration, latest-user anchoring may lose the old failed-turn boundary; it must not be hidden as a completed recovery. Before commit add a focused actual SDK/SSE control: error on known userA, then actual message.updated userB received before fresh HTTP snapshot containing orderedA/B, no intervening nativebusy/localbusy; require newaccepted recovery and preserve a separate error AFTER B case. If this exposes missing provenance, report exact currentbehavior/minimum matching provenance proposal before further production paths/semantics; do not commit the smaller passing subset or invent error placement. This required control distinguishes genuine newly accepted work from a current-turn error rather than assuming either from latest-user position.

Run accepted HTTP/error/metadata/native/owner guards after implementation, then final changed-source fullapp/type/build/helper freeze and Signed-off commit ONLY when all required tests are green. Current intentionally failing HTTP test cannot be omitted/skipped. Relevant previous successful fullchecks remain pre-final-source receipts. Same full original1–5/native10/31/20/restart/history/move/cwd/currentplatform/dev/preservedprofile/publicpaidprovider/CUA/finalaudit mandatory; no native launch/push/goalcomplete in this task.

#### Task6 lost failed-turn provenance: matched bounded-record ruling

Actual exact focused result snapshot-replay-http-exemption-check.log: fresh HTTP-only accepted recovery/negative evidence/errorAFTER liveB GREEN, but errorA→actual SDK message.updated userB→HTTP orderedA/B remainsRED. A newer live user changes current transcript anchor toB while error stillbelongsA; therefore latest-user-at-hydration cannot discriminate. No subsetcommit/fullrerun authorized on that failure.

Ruling: extend ONLY existing bounded SessionActivityRecord in apps/app/src/react-app/domains/session/status/session-activity-store.ts with nullable errorUserMessageId, defaultnull. setError optional fourth argument errorUserMessageId?:string|null preserves existing callers. Capture latest known cached transcript USER ID immediately BEFORE existing setError in actual native session.error AND same-module injectSessionErrorMessage; missing/legacy contextnull replaces prioranchor, never infer from synthetic-row position. Use captured errorrecord anchor for ordered/nonreverted neweraccepted snapshot exemption, not current latestuser/lexical IDs/clocks/pointer. Unknown anchor conservative. Reset at all existing five error-clearing sites (workspacebusyseed, sessionbusyseed, nativebusy/retry, clearError, compactiontrue), existing removeSession owns recordlifetime; no globalmaps/provenance routes/persistence changes. Audit updateRecord equality: identical-text repeated error on different currentuser MUST replace anchor evenwhenvisiblefieldsunchanged. State/run/error/owner policy otherwiseunchanged, no inventedidle.

Additional source ownership ONLY existing activity-store.ts; sourcewriter owns it plus session-sync.ts and existing retention test. No otherproductionmodule/testfile/API/observer/querykey/timeouts/engine/provider/version changes without separate ruling. Required matchingGREEN: actualerrorA→SSE B→HTTP A/B recovery, currenterrorAFTERB retained inclidenticaltext/reusedolder syntheticrow; old/missing/reverted/currentfailed evidence conservative; actualnative/localaccepted recovery and localinjectederror captured; legacyunknown contextnull and allclear/removal/isolation lifetimes. Relevant discovered existingstoretest + focusedHTTP/SSE/owner contracts, then one final changed-source fullapp/strict/build/helpers and selected Signed-off commit/report if allrequiredGREEN. Priorfreezechecks historical. Independent immutable spec/quality reviewthen full original1–5/native10/31/20/restart/history/move/cwd/currentplatform/dev/profile/publicprovider/CUA/finalaudit.

Reason: actual lost knownfailedturn boundary cannot safelybe recoveredfrommessagearrayposition afternewuserarrival. Cost if wrong: current cachedtranscript maylack reliableanchor, so unknownread staysconservativeuntilnative/accepted authority; extra field mustnot escape safe diagnostics and isboundedbyexistingrecordlifetime. Report unknown provenance explicitly, do not claim it as newerwork or suppress known genuinelyaccepted B.

### Task6 fix round1: preserve raw and converted revert boundaries

Fresh immutable review of d9983007 is Spec❌/qualityNeedsfixes,0Critical/1Important/0Minor. Important1 has actualproductionprobe: emptyerroredassistantX isconvertedtosession-error:X, so rawcursorX no longerexistsinUI; acceptedexemptionerroneouslyseesreverted newerB afterA/X. ActualHTTP/SSE newregression reproduces on d998 (rawemptyX and unavailablecursorfail, no-revertcontrolpass), then raw-before-conversion evidence repairGREEN3/0. Currentownedscope unchanged activity-store/session-sync/retentiontest; no sourceownerotherthanoriginalimplementer.

Additional concrete observation: afterexactrawX/SDK/bothseed sequence, transcriptcache remains[A,session-error:X,session-error:session-one,B] despite snapshotrevertX, includingB already viaSSE. This transcript-boundary behavior exists in original2c6 source, while exemption'serror-clearingconsequencewasintroducedbyd998. Do not label cacheobservation actualmountedUI. Preserving declaredrevert contract still requires matching correction, not silently leavingB inknownreverted cache.

Ruling: within existing seedSessionState/session-sync.ts, derive accepted-work evidence from rawordered snapshot withrawrevert boundary BEFOREconversion; unknown/absentrawcursor cannotauthorize newacceptederror recovery. For existing transcriptreconciliation resolve rawcursor toits knownconvertedUIidentity (rawID ifretained; known SYNTHETIC_SESSION_ERROR_MESSAGE_PREFIX alias onlywhenconversion demonstrablyreplaced that SAME rawerroredassistant), thenuse existing applyRevertCursor. Keep rawmetadata/revertcursor unchanged. No arbitraryunknown cursorcut, newmodule/globalmap/pointer/clock/statusguess, changedowner semantics or debugsource. ExactSDK/SSE rawX regressionmustpreserveerror/anchor/inactive andremoveB fromcacheafterbothseeds evenwhenBprearrivedviaSSE; no-revert/nonempty/usercursor/newergenuineB recoveryguardsremain. Declareexactneedbeforebroadertranscriptpath/module. Costifwrong aliasresolutioncouldprunewrong UIturn; anchoridentity/rawboundary andknownconversion mustbeproven andcontrolsmandatory.

OnlyaftermatchingfullguardGREEN run finalchangedapp/type/build/helper sourcefreeze, normal selectedSignedoffcommit/reportfixround1, freshscopedrereview d998..newHEAD. Rootverifiedno running native beforefixdispatch; fullnativehelduntilcorrectionreview. Fulloriginal1–5/native10/31/20/history/restart/move/cwd/source/platform/remote/dev/profile/publicprovider/CUA/finalaudit unchanged.
#### Clarification: raw acceptance versus exact live transcript identity

Absence of rawcursor in incoming snapshot makes NEW ACCEPTED-WORK evidence unknown/conservative. It does NOT erase an authoritative rawmetadata cursor that exists as an exact RAW messageID in the current/merged live transcript. Preserve original exact-ID clipping there; it is known identity, not arbitrary inferredcut. Alias substitution still requires demonstrable rawX→sameconvertedalias proof. If trulyabsent from raw and knownUI, neverguesscut. ActualSSE rawcursor-row→newB→limitedsnapshot control mustclipafterknownrawID while retainingcurrenterror becauseincomingrawacceptedboundaryunknown. Correct overbroad no-cut assertion in sameID-onlylive test; keep separate trulyabsent no-cut. No extra modules/metadata mutation.

Four checks98474/51701/43513/86672 had justlaunched beforeclarification. Owner mustpoll allto terminal BEFOREediting freeze; retainaspreclarification receipts, no restartonobservationtimeout/no mixed-source claim. Then actualcorrectedfocusedREDGREEN and one finalchangedsourcefullsetbeforecommit.
#### Repeated unknown-boundary replay and normal caller completion

ActualSDK/SSE second-seedRED: first exactcachedrawcursor cuts B and cursoritself; repeated limitedsnapshot lacksrawcursor/currentcursor, soB isreintroduced. Accepted evidence staysconservative/coreerrorpreserved, buttranscriptcontractfails. Ruling: declared unresolvedcursor withneither incomingprovenraw/alias norcurrentexactrawboundary mustpreserveexistingtranscript including[] onfirsthydration; neverreconcile unprovabletail. Knownexact/provenboundaries retainnormalreconcile+clip. No newstate/maps/modelcalls/metadatachanges.

This merelysafe fallback is NOT sufficient final appflow. Source check currentSessionSurface queryFn useslimit140; appclientgetSessionSnapshot acceptsomittedlimit (alreadyexistingfullhistorysearchcaller); sessions.ts128–148 forwardsinput.limit toSDKmessages. Implementer mustdeclare precise smallest callercompletion beforeadditionalpaths: limitedreadwithdeclaredcursorabsent obtains existingfullhistoryread ONCE sameauth/workspace/session beforepublication; iffullstillcannotresolve, visible/contentfree/localizederror, no silentpermanentblank/falsecompleteness. Existingabsoluteoperationbudget/erroridentity mustbe retained, no timeoutinflation/retryloop/permission/providerchanges. Metadataonly session.updated unknowncursor canleaveviewstalewithoutanotherread: proposal mustcover narrowlyscopedactive snapshotqueryinvalidation on CHANGEDnonemptycursor absentrawcache, notsamecursor/progress/title/unobservedowners/newobservers. Additionalpath/error/i18n/test/protocol proposal pendingrootapproval; sourceownershipnotblanketexpanded. No fullchecks/commit ofpassingsafesubset.

Costifwrong fallbackdeferslegitimatepartialhistory; normalfullreadcompletion/visibleerror required toavoidchangingrequestedendstate. Originalfix1/1–5/native/source/platform/dev/profile/publicprovider/CUA/finalaudit remainbinding.
#### Approved ordinary-flow completion: limited history, deadline and visible failure

Exact additionalproductionownership approved: apps/app/src/app/lib/legalwork-server.ts plus apps/app/src/react-app/domains/session/surface/session-surface.tsx; existing sync/store/retentiontest ownershippreserved, no others. Reuse existing localizedsession.load_failed inCZ/SK/EN, no locale/componentcreation. getSessionSnapshot retainspublicargs/Promise/sameauth/workspace/session/base/hostToken. Limitedresponsewithdeclaredrawcursorabsent makesONCEexistingomittedlimitfullread, no recursion/retryloop. Anyfullreadstillmissingcursor raisescontentfreeLegalworkServerError409 code session_revert_boundary_unresolved, no details/cause/IDs/URLs.

OriginalsessionRead12s is ONEabsoluteoperationbudget throughfetch AND body for bothreads. Postbodycheckalonecannotboundneverendingbody; ownone deadline/controller/race, finallyclean, no latepublication/no secondrequestafterexpiry. PreserveexistingresolveFetch desktop/localidentity: requestJson currentlychanges toglobalfetchwhensignalprovided, so smallprivateopt-infetch override/preservedresolution permitted ONLYsnapshotpath; othercallersunchanged. Abortowned signal/body whereexistingtransport supports; remoteIPC limitationsmustbeaudited/reported, no falsecancellationclaim/newIPCpath. Non-timeouttransportfailureidentity preserved; JSONSyntaxError sanitized locally tocontentfree loadfailed/no body/cause aspriorstartupI1. No timeoutinflation/engine/provider/permission changes.

Metadataonlysession.updated changedNONEMPTYcursorabsentinrawcachedmessages invalidatesONLYexactACTIVEquerywithcancelRefetch:false; nocursorchange/progress/title/samecursor/unobservedownersdontfetch. No newobserver/globalmap/polling. Surface'sexistingemptyhistoryerrorcardalreadyvisible; addexistinglocalizedboundaryerroralertalongsidecachedhistory sofailedreadcannotmasqueradeascomplete/quietblank. RealHTTP/SSE/QueryObservertests: limited→onefullsameauth/scope/counts/budget, initialfullnoredundantread, fullmissingtypederror/oldcacheheld, samecursor/title/inactivenorefresh, heldbodyexpiryreject/socketclosewherecancellable/no latefallback, normalerroridentity, firstunknown[]/repeatedsnapshotnoB. Declareanyextratestpathbeforecreation.

Reason: exactsecondseed partialhistoryresurrectsrevertedtail; merelypreservingunknownUIisnotthe requestedcompleteapp. Costifwrong: fullhistoryreadcanbemoreexpensiveandextraqueryinvalidationcanloadunnecessarily; triggeronlymissingdeclaredboundary/changedcursor, boundedbudget/onefullfetch/actualcounttestsmandatory. RemoteIPCcancellationnotimprovedbymislabeling. Finalsourcefreeze/fullguards/app/strict/build/helpers/Signedofffix1commit/freshscopedrereviewthenalloriginal1–5/native10/31/20/restart/history/move/cwd/currentplatform/dev/profile/publicprovider/CUA/finalaudit unchanged.

#### Approved coupled read cancellation and retry completion

Ruling: optional backward-compatible caller signal on getSessionSnapshot, forwarded from existing Surface QueryFn; targeted invalidation cancelRefetch:true supersedes prior false. One original12s deadline races caller abort across headers/body/limited+full reads; preserve caller reason identity, remove listener/timer and abort owned controller finally, no late fallback/publication. Preserve original local/desktop transport; remote IPC cannot actually cancel its network and must remain explicitly qualified. Only readonly owned HTTP snapshot request cancellation, never native session/accepted work.

Actual coupled cached-read RED showed old body overwrites metadata cursor; caller cancellation made cached case GREEN. Mandatory initial/no-data, cursor clear, and changed-known-cursor controls then all RED0/3: cancelRefetch:true alone does not cancel an initial fetch and missing-only predicate misses clear/known changes. Ruling: for exact ACTIVE snapshot query, actual cursor change while fetching (including initial nonempty) explicitly cancelQueries exact with silent:true,revert:false BEFORE metadata publication, then synchronous exact active invalidate/refetch once. Keep settled changed-missing-boundary refresh; settled known/clear/samecursor/title/inactive remain no extra reads. No global state/map/observer. Observe current error and metadata at every relevant QueryObserver publication/seed, not merely final cache. Reason: stale in-flight body must not replace current native cursor or transiently clear error. Cost if wrong: cancellation could delay loading or publish stale state; real initial/cached/clear/known-change controls and request counts mandatory.

Ruling: Surface permanent session_revert_boundary_unresolved failure disables query retry for that typed code only; other failures preserve current browser default3 and SSR default0 behavior (no global retry settings exist). Use existing context/isServer helper if needed, no new policy/module/dependency. Actual request-count permanent-failure and ordinary transient retry controls required. Reason: one limited/full operation must not become four repeated permanent reads. Cost if wrong: transient failure recovery could change; negative controls preserve it. Worker sole writer of exact previously approved files, no other source/test expansion. Final changed-source full app/strict/build/helpers, same report, selected Signedoff commit and fresh scoped re-review d998..newHEAD required; fulloriginal1–5/native10/31/20/platform/protecteddev/userprofile/paidprovider/CUA/restart/history/move/cwd gates unchanged.

#### Initial cache-missing cursor deduplication provenance

Actual initial-read C→repeatedC/title metadata RED created three reads instead of two because no snapshot exists to remember prior cursor. Ruling: one bounded pending initial-read cursor map in existing SyncEntry only, keyed by already tracked/retained session, value exact existing Query identity plus nullable native cursor. Write only active/fetching/cache-missing metadata branch; compare remembered cursor only for same actual Query. Whenever cached snapshot exists, use its cursor rather than old remembered value and delete pending record. Clear alongside clearTrackedSession/session.deleted/entry disposal/test cleanup, preserve retained owner lifetime unchanged. Query identity is HTTP read dedup provenance only, never accepted/native/terminal evidence. No synthetic snapshot/globalcache/observer/timer/persistence.

Reason no-cache native metadata has no other stable cursor comparison; query-bound provenance prevents repeated samecursor from canceling replacement or old removed query from suppressing new work. Cost if wrong: unnecessary repeated reads or stale dedup could suppress required refresh, so actual initial C→repeatC/title, C→D/clear, cachedD-vs-rememberedC, inactive, remove/recreate-query and lifecycle cleanup controls required. Existing raw boundary/error/status/deadline/refetch constraints retained. Final one changed-source module freeze/commit/report/scopedreview after focused guards; original full goal unchanged.

#### Task6 fixround2: initial boundary failure with live-only history

Fresh scoped d998..a32 review original Important1 ADDRESSED, new Important N1 confirmed actualHTTP/QueryObserver/SurfaceSSR: first snapshot limited+full fails typed boundary, independent nonempty live transcript/no successful snapshot makes both error displays false. Ruling: sameoriginalwriter narrowlycorrectSurface alertcondition +existingretentiontest only, matching RED→GREEN, cached/empty/success/retry controls; no newread/state/component/locale. Reason permanent incompletehistory mustbevisible evenbeforefirstsnapshot; costifwrong duplicateorhiddenalert sofourquadrantvisibility controlsrequired. Finalchangedappfull/strict/build; unchangedhelper/server/desktop/import/locale/offline/preview/API receiptsretained, no arbitraryreruns. Round2 freshmechanicalscopedreview required; fullnativehelduntilclean, fullgoalunchanged.

#### Fixround2 SSR optimistic error representation refinement

Displayguard-only attemptedGREEN remainsRED under actual no-data retryOnMount defaults: QueryObserver optimistic fetch state clears hook error before any mounted read, while same exact Query cache retains the settled boundary failure. Ruling: sameSurface typed-alert logic uses current hook error first, otherwise existing queryClient.getQueryState(snapshotQueryKey)?.error; show alongside snapshot OR nonempty rendered transcript. Last settled incomplete-history failure remains visible until normal exact query state/success clears it. No new state/observer/query/retry policy/O1 ownership. Reason actualdefault SSR representation can otherwise hide the same known permanent failure even with corrected visibility guard. Cost if wrong: transient stale alert on remount or cross-session disclosure; exact key isolation, successful/noerror clear, no-added-read, cached/live/empty single-disclosure controls required. Preserve failed attemptedGREEN evidence asRED and SSR/mounted boundary honestly. Finalapp/strict/build/selectedcommit/report/freshscopedreview unchanged.

#### Task6 current component completion (2026-10-15)

- [x] d998 native status replay/errorprovenance implementation; a32 rawcursor/readcompletion/cancellation/provenance fix; e49 live-only errorvisibility fix. Signed-off normalcommits, no force/historyrewrite.
- [x] Independent immutable fixround1originalImportant1ADDRESSED; fixround2N1ADDRESSED/new0CriticalImportantMinor/SpecPASS/qualityPASS. Finalapp1585pass2existingWinSkip0fail10601asserts/strict0/build0; rootserver1587pass21skip/desktop333pass4skip/Node15/import233/strict/locale/offline14/preview/isolatedengineAPI0.
- [ ] Rootnewactualfullnative10/31/20/restart/history/move/cwd/hash and freshwholebranchreview includingdeferredO1; remoteplatform/protecteddev/preservedprofile/publicpaidprovider/CUA/finalaudit unchanged. ComponentGREEN doesnotcloseoriginal1–5.

### Task 7: Jedna integrovaná opravná vlna po závěrečné revizi (součást původního Task 5)

BASE624a12f79a30c4be367ea9f0afae17159fc82639. Úplný výchozí izolovaný native67222 prošel10spisů/31zdrojovýchhashů/20výstupů, skutečný restart, recovery stejnéidentity/historie/currentcwd a cleanuptrue. Nejde o živou paid-provider/profil/CUA ani remoteCI akceptaci. Závěrečná nezávislá revize přesto reprodukovala dvě Important chyby; žádná Critical/Minor.

1. I1: skutečný HTTP snapshotbusy s pozdrženým tělem doběhne po nativeidle a přes oba hydrate callery znovu aktivuje dokončený běh. Opravit explicitní lokální pořadí čtení/nativní evidence v reálném publikačním řetězci; nepoužívat mezisystémové časy, lexikální ID, plošné odmítáníbusy nebo nucené rušení agenta. Zachovat nový accepted/revisionzero běh a čerstvá pozdější čtení, error/initial/metadata/scope kontroly; prověřit i status-query writer.
2. I2: canonicalcache správně vyřízne rawX→session-error:X hranici, ale deriveRenderedSessionMessages znovu přidá revertovanýocas ze snapshotu. Sdílet úzké ověřené raw/UI pravidlo v reálném renderconsumeru; zachovat snapshot historyfloor, live-only zprávy, známé/nejistéhranice a novýaccepted/clear. Rawmetadata se nepřepisují.

Jeden nový implementer, jeden writer; root vlastní5sdílenýchdocs a celé původní acceptance/remote/profile/provider/CUA gates. Počáteční produkční scope: session-surface.tsx, session-render-state.ts, session-sync.ts a pouze úzké sdílené boundarypravidlo v transcript-reconcile.ts. Testy: existující session-sync-retention.test.ts a jeden deklarovaný session-render-boundary.test.tsx pro consumer a skutečně mounted Surface; minimální default nativecall pro skutečné assertiony a přesná Windows testselection, pokud stávající filtr nový test vynechá. Žádné nové dependencies/produkčnímoduly/globalmapy/persistencestatusu/timeouty/provider/engine/oprávnění. Další skutečná potřeba vyžaduje kauzální proposal/ruling.

- [x] Závěrečná broadreview1c1..624: oba protipříklady skutečně reprodukované, sourcebezzměn, celý seznam0Critical2Important0Minor; žádné zúžení cíle.
- [x] Oba behaviorální RED před produkční opravou, včetně consumer a skutečně mounted Surface viditelné historie; setupchyby se nepočítají jako productRED.
- [x] Nejmenší společná implementace, matchingGREEN/guardy error/novýaccepted/revert/historyfloor/unknown/scope; test musí sledovat opravený produkční reader, nikoli obcházející testovou kopii.
- [x] Finální sourcefreeze, pokrývající i úplnáapp/strict/build a relevantní nativehelper/defaultnative controly; běžný Slovak Signed-off selectedcommit, čerstvá scoped revize oboufindings/newbreakage.
- [x] Nový skutečný úplný native10/31/20/restart/history/move/cwd/hash na opravenémkódu; předchozí67222 zůstává pozitivním výchozímreceipt, nikoli testem budoucí verze.
- [ ] Původní kompletní remoteplatform/protectedPR/dev/preservedprofile/publicpaidprovider/CUA/finalaudit gates; žádný force/admin/bypass nebo vydávání formátovéverifikace za právníschválení.

### Approved explicit existing-record execution provenance and error supersession

Matching SDK/Surface held-body+nativeSSE unitRED0/2 and full-default mountedSurface nativeRED63054 terminal1 prove bothfindings before production edits; cleanupcompleted. Eightfocusedconsumer/mounted scenarios stayin declarednewtestfile, no extrafiles.

Ruling: add apps/app/src/react-app/domains/session/status/session-activity-store.ts ownership and ONE bounded nonpersistent executionEvidence field/token on existing record. Advance only at audited explicit setRunStatus/setError action sites, tagged full native syncKey versus local action. Existing audited real setRunStatus callers (send/voice/abort/queue/document-generationaccepted) may default to local action; sameSurface status HTTPpoll opts out. seedSessionRun/seedWorkspaceSessions/role/metadata hydration never advance token. Token identity/version is explicit read-order evidence, not a guess from ordinary record pointers or accepted-message ordering. Filter localactions exactworkspace/session and nativeevidence exactfullscope, remove read-local subscription finally and evidence with record. No newglobalmap/transportowner/timer/persistence. Initialabsententry and busy→busy/revisionzero are now observable through explicitaction evidence without clocks.

Error-only superseded readonlyread cancellation is authorized, preserving native error without manufacturedidle/erroranchor or agent cancellation. Proposed TanStack CancelledError({revert:true}) is conditional on actual metadata+error/everypublication proof: it mustnot roll back newer metadata/cursor or transientlyclearerror. Earlier cursorcancellation needed silent/revertfalse, so test this concrete risk. If candidatefails, worker may refine existingquerycancellation withinownedSurface/sync and reportchoice before any newerror/retrypolicy. Preserve fresh posterror/accepted recovery and later successful statuspoll; older readcannotrollbacklater validpoll. No global busyblock/nativeownerrelease.

Reason baseline lacks explicitsource distinction: hydration creates same records/transitions as true native/accepted actions, and SyncEntry maynotexistatreadstart. Costifwrong local/defaultaction misclassification can resurrectstale work or suppressgenuineacceptedwork; exactnative/auth/dir/session scope, metadata-equivalent transition, initial/noentry, samebusyaccepted/revisionzero, errorwithneweruserbody/currentmetadata/everypublication and freshpoll/newread controls mandatory. One final combinedwave/fullapp/strict/build/helpers/defaultnative/freshscopedreview/wholeoriginalacceptance unchanged.

### Existing query cancellation and later-poll refinement

TanStack source inspection confirms throwing CancelledError alone may leave fetching/retry; revert:true can roll back currentdata. Ruling: error-superseded read may synchronously cancel only its exact captured/currentQuery with silent:true,revert:false, then set only fetchStatus:idle and throw CancelledError, preserving currentdata/error/cursor. Originalsignal/readidentity muststillbelive/current; no asyncgap may cancel ormarkreplacementreadidle. Actual initial/no-data/interveningmetadata+error/everypublication/replaced-disposedquery controls required. No newretryerrorpolicy/agentcancel/restart.

Read-local QueryCache subscription to successful NONmanual exactstatus-query publications is allowed to preserve a later validpoll; manual hydration writes excluded. It must verify exactownedquery/scope provenance, subscribeonlyforread/finallycleanup, no QueryObserver/pin/timer. Both Surface readers consume caller signal for lifetime cleanup withsupported existingSDKtransport. Reason native/action-onlyevidence otherwise misses validlaterpoll and CancelledError policy hasrealrollback hazard; costifwrong stale-cache rollback or replacementread corruption, explicitmatchingcontrolsrequired. Audit newrecordevidence sinks: fullsyncKey containsauth token; no exposure/persistence/logging ofscopecredentials, minimal internalrepresentation andtoken-free saferesults. Extra neededpath/field stillrequiresconcreteproposal.

### Preserve snapshot seed contract while aligning validated poll

Guarddevelopment 24/26 exposed a valid laterpoll→metadata replay of busycachedsnapshot; aligning that existing snapshot with the validatedpoll is approved via existing cachepublication helper, without fabricatingnative actionevidence. Bounded successful NONmanual completion observation may cover both exact snapshot andstatusQueries withfullscope/finallycleanup.

Ruling: do NOT unconditionally setactivityfromsnapshotstatus just because noerror. Original seedconservativelypreserves explicitaccepted/revisionzero/waiting/compacting; setRunStatus(idle) clearswaits/compacting. Keep originalseedcontract and correct an overstrong newlyadded metadata-only assertion that demanded newfresh-idle deactivation semantics to its mandatedunchanged-status replaycase. Retain thefailed assertion/clarification as such. Genuine laterpoll alignment regression remains. Add fresh snapshot afterlocalacceptedbeforeSSE/nativebusy returningidle, waiting/compacting controls. An older reader mustpreserve currentexplicitaccepted/native safety and later validatedbusy; rawidle alone isnot terminalproof. Reason avoid solvingone racebydroppinglivework; costifwrong pendingnewwork orwaitscleared, explicitactualguardsrequired. No extrasource/state approved.


### Task7 final-source verification 2026-10-15T01:16:05.269766+00:00

Normální Signed-off9203f37a opravuje I1/I2 v9schválenýchpaths. Finální app1616pass/2existujícíWindowsSkip/0fail, strict/build0, helpers42. Matching nové9mountedSurface scenarios/54visible assertions a26endpointhookchecks; jediný nový defaultnative74573 terminal0 se všemi10spisy/31zdroji/20výstupy/restartem/reconnect/history/move/currentcwd/hash/cleanuptrue. Root nezávisle ověřil všech9source SHA proti commitu,6receipt SHA,31skutečnýchoriginálů/importů/20persistovanýchvýstupů,2enginebinary/manifest/health identity a nepřítomnost všech3vlastníchPID. Předchozí8/48 běh46802 je historický. Jediná scopedrevize624..9203 právěprobíhá; žádný redundantní fullnative na neměnnémkódu. RemoteCI/protecteddev/zachovanýprofil/publicpaidprovider/CUA/finalaudit otevřené.


### Controller ruling — full producing-read scope and native activity provenance

Approve the proposed reuse of the ONE existing bounded nonpersistent executionEvidence token with explicit action/read/activity discriminant, within existing Surface/session-sync/activity-store/retentiontest only. No new recordfield/globalmap/module/dependency/querykey/persistence/timer/retrypolicy/deadline/transportowner. Remove the unscoped QueryCache-success inference rather than guessing producer scope from Query identity or current options/meta. Actual producing Surface readers may publish explicit validated-read evidence through an existing-store method changing ONLY that token, preserving updatedAt/status/run/wait/error fields. Capture full auth/base/directory/workspace/session scope at read start in nonserializable predicate; publish synchronously only after SDK body, original signal/current-read/cancellation and ordering validation, with no async gap. A response discarded by the guard cannot publish read evidence. Raw idle rejected by original conservative snapshot accepted/wait/compaction safety cannot become authority for another read. A completed validated read is explicitly a read, never a native status or accepted-action token. Prove exact completion/caller-abort/query-removal/replacement behavior and listener cleanup, including no replacement read marked idle/cancelled.

Native permission/question waits and compaction start/end may update this same token as activity ONLY at audited actual native event callsites with captured exact scope. Do not mint evidence from metadata/list/snapshot hydration, roles, arbitrary current activity, or unscoped replaceWaitingRequests. Other existing callers retain their prior behavior unless an explicitly audited local user action genuinely needs activity provenance; declare any such need. An intervening matching native activity is a guard, not status/accepted authority. If the older readonly response would erase the still-current nonidle wait/compaction/activity guard, the existing exact-owned-query silent/revert:false cancellation path may discard it; no manufactured idle, rollback, run cancellation or owner release. Later genuine native idle/terminal supersedes activity normally; replied/ended guards and appropriate fresh HTTP reads must recover, so no permanent blanket busy/idle refusal.

Reason N1 actual A/B readers prove sameQuery identity omits producer auth/base/directory; N2 actual nativebusy-before-read then wait/compaction causes currentflags lost. Cost if wrong is false crossconnection authority, missing user interaction or wedged loading. Mandatory exact actual Surface/SDK held-body RED→GREEN bothread-directions and same/differentauth/base/directory, permissionv1/v2/question/compaction, genuineidle/terminal/end/replied/freshpoll/metadata/manual/noentry/acceptedrevisionzero/errors and cancellation/currentquery/serialization/cleanup controls. Existing source shape/read token may be refined only within this ruling; any additional production path/state needs new concrete proposal. Original I2/native9mounted54/full10/31/20/remoteplatform/protecteddev/preservedprofile/publicpaidprovider/CUA/finalaudit unchanged. No user permission question for this authorized correction.


### Controller clarification — pre-read snapshot safeguard versus fresh status poll

Keep the original distinction, not a new blanket busy lock. Snapshot hydration conservatively preserves accepted/revision-zero/wait/compaction already present before a snapshot read. The original independent status poll guarded activity arriving AFTER that poll started; a fresh status read may recover via its actual HTTP state even if SSE was missed. N1/N2 correction must preserve actual localaccepted/revisionzero DURING a held status read and all existing pre-read snapshot guards. Add explicit pre-read-accepted/fresh-status control documenting the retained baseline difference. Do not claim every status reader now has the conservative snapshot-seed contract. Do not preserve a localbusy token forever across validated HTTP reads: that would block legitimate busy→idle HTTP recovery without SSE, broadening the behavior beyond the causal findings. If actual generation lifecycle (not only an activity flag) loses the accepted task in a concrete reproduction, report its RED/proposal separately before any new state/semantics. Genuine later native idle/terminal, wait reply/compaction end and appropriate freshpoll recovery remain mandatory.


### Task7 scoped correction round1 — N1/N2

- [x] Fresh scoped review624..9203: I2ADDRESSED; I1PARTIAL with2Important: HTTPcompletion scope and newerwait/compaction lost bystatusreader. No new broadreview.
- [x] Reviewer exactactualSurface/SDK/SSE REDs on unchanged9203:4matchingpositive/16fail across20cases; ordered metadata barrier provesnativebusy consumed beforeheldstatusread.
- [x] Approvedoneexistingtoken action/read/activity refinement, explicit producingread capturedscope and exactownedread cancellation; no map/module/newrecordfield/timeouts/dependency/querykey redesign. Matching42focusedcases pass; actualgenerationbindingaccepted/nativeRevision0 retained under documentedfreshpollbaseline.
- [x] Finalround1sourcefreeze/fullapp/strict/build/defaultnative andnormalSignedoffselectedcommit.
- [ ] Independent immutable scopedN1/N2 rereview/newbreakageonly, then normalpublication/currentrequiredremoteOS/protecteddev/livepreservedprofile/publicprovider/CUA/alloriginalacceptance.


# Same I1 load-bearing residual — N3 read-local authority fold

FIX_BASE68bdab381b36a43d8e2b3180bc2a291ca76370eb. Original implementer, sole writer, not alone/no subagents. Existing onefinalbroadreview remains solebroadaudit. N1ADDRESSED/N2PARTIAL/I2ADDRESSED; N3 is actual newbreakage inpreviousfixdiff, verbatimbelow. Root has ruled it real and load-bearing for dev/public application acceptance; exact cause is proved and smallest correction is known, so user-authorized repair-until-no-findings continues within same I1/read-local scope, not a new broad wave or speculative audit. Original GlobalConstraints, round1rulings and pre-read snapshot/freshpoll distinction retained. Root owns5dirtydocs/ledgers/artifacts/remote/profile/provider/CUA, preserve them and all historical native receipts.

Initial ownership ONLY existing session-sync.ts/read-local observeSessionReadExecution fold +existing session-sync-retention.test.ts. No Surface/store/harness change needed by identifiedcause; declare concrete extra path/state need before edits. No new recordfield/globalmap/module/persistence/dependency/querykey/timer/timeout/retrypolicy/owner/nativecancel/credentialserialization/blanketbusylock. No remote/userprofile/provider/otherprocess changes. Append SAME final-integrated-fix-wave-report.md and keep exact source/RED/GREEN provenance; rootselecteddocs remainunstaged.

### Controller ruling

Approve implementer minimal bounded read-local fold: keep latest matching genuine action/validated-read status+error authority separate from one intervening activity-only guard. Activity sets/updates guard and cannot erase or replace known authority. A subsequent genuine matching action/read supersedes prior authority and clears the older activity guard. Resolve candidate from known authority or raw response FIRST; discard only through existing exact-owned-read cancellation for current authority/error or newer matching activity whose current nonidle state would be erased by an idle candidate. Thus terminalidle→activityreply/end staysidle; idle→newask/start remainsguarded; activity→genuineidle recovers; busy/newaccepted→activity preservesbusy; error→activity cannotfallthroughrawbusy. Scope filtering/serialization/read lifetime unchanged. This is no new source authority or persistentstate.

Reason bothactualSurface readers/SDKwireSSE proved nativeidle→cleanupforget→rawbusy resurrection. Costifwrong is renewedfalsebusy or lostcurrentwait; finite targetedmulti-event controls withinexisting actualfixture required (bothreaders×3cleanup events/noactivity, oppositeeventorder, laterbusy/accepted/error/fullscope/manual/appropriatefreshHTTP recovery). ActualREDbeforeedit; preserve earlierN1/N2/acceptedrevisionzero/metadata/querycancel/removal/replacement/error/rawalias safeguards. Do not broaden intoanotherwholeappsearch.

After all matchingguards/selfreview freeze: ONE fullapp/strict/build/defaultnative10/31/20/9mounted54/relaunch/history/move/cwd/hash/cleanup on finalbytes. Build desktoprenderer with LEGALWORK_ELECTRON_BUILD=1 normal appbuild ifnotalreadylaunched; no separateduplicatewebbuild required for thisdesktopgoal. No unchangedserver/desktop/helper suites merelybecauseappfoldchanged. NormalselectedSlovakSignedoffcommit ofONLYowned2files andsourcefreeze/report/release afterallterminalgreen. Root independentlyauditsreceipts and freshimmutableN3/newfixbreakage scopedreview; no redundantnative solelyforownerchange. Alloriginal20acceptance/currentremoteOS/protecteddev/1approval/preservedprofile/publicpaidprovider/CUA remainopen. Prior68883 and84900artifact are authenticpre-N3 evidence, notfinalfutureproof.


### N3 finite fixture clarification

Approved retaining semantic field/caches/cursor/IDs assertions while excluding only existing hydration updatedAt churn from full-record equality. For error→compaction.start, unchanged setCompacting and metadata hydration may already clear/reseed error/busy BEFORE held body; record actual pre-body state and prove the old body causes no additional semantic loss. This is baseline/fixture clarification, not a new product fix or an error-persistence claim. Likewise manualbusy hydration already has the conservative seed contract; assert returned reader authority separately and preserve that current manual state rather than demanding globalidle. Retain failed overstrong intermediate assertions and causal explanation in the same report. No production expansion or weakening of N3's exact nativeidle→cleanup→oldbody assertions.

### Code closure 2026-10-15T01:53:58.074648+00:00

23321ce5 Signed-off two-path N3 fold; exactnativeidle→cleanup RED2positive6fail→GREEN and78actualreader finitecontrols. Fullapp1694pass2existingWindowsSkip0fail/strict0/desktoprelativebuild0; full-default78497terminal0 10cases31sources20outputs/9mounted54+endpoint26/relaunch/history/move/cwd/hash/cleanup. Root underlying source9/receipt6/actual31imports20outputs/2binary3PIDs auditPASS. Fresh immutable scoped68bdab..23321 N3ADDRESSED/new0CriticalImportantMinor/specPASS/qualityready; N1 andoriginalN2 corrected/I2ADDRESSED carried. No open scopedcodefinding. Existing unchangedserver1587/21skip/desktop333/4skip/Node15/helper42/import233of235/locale/brand/offline/preview/isolatedengineAPI receipts retained. SupportedfinalWordaddinbuild67134terminal0 becauseWordAddinRoot importsSessionRoute. Allchangedsourcechecked, no userdata/providerkeys inGit.

Remaining originalacceptance: ordinaryfeaturepush/PR/currentremoteallOSchecks/oneapproval/resolvedthreads/protecteddev; candidateactualuserprofile/publicpaidprovider/CUA/10cases/sourceoutputhistory/restart/move/currentcwd andfinaldevbuild. LiveGitHubauto_mergefalse, maintain/nonadmin; no bypass. Profile30942filebackup/20historicaloutputs ready, actualnewuserappnotyetstarted.


### Aktuální CI kolo b9038aec — 15. 10. 2026

Původní Windows server suite, build i Node SQLite/proxy kontroly skutečně prošly. Celý portable job však selhal v novém helper testu, který porovnával host-native cesty s unixovým prefixem. Linux/macOS source, Linux package a i18n prošly. Windows package stále selhává před headers vybraného `/path`; oddělený nezměněný engine `--version` potvrdil Bun1.3.14, což neprokazuje readiness. macOS package nově selhal až ve fázi obnovy spisu. Historický e3cb macOS úspěch zůstává historický.

- [x] Opravit pouze test cest: host-native absolutní syntetický root/preload a přesná uzavřená env mapa, zachovat izolaci TOKEN/HOME a SystemRoot. a8392298 → f5b1b059, Node24 focused7/7, nezávislá spec/quality revize bez nálezů. Skutečný nový Windows výsledek zůstává otevřený.
- [x] Doplnit chybějící pozorování primární operace obnovy macOS: pevný recoveryStage/schema5 a přesná klasifikace vlastní expirace čekání, zmrazené před sekundární sondou. Žádné raw chyby/URL/cesty, nové požadavky ani změny pořadí/deadline/assertions. ded15040 → 69b0825e, Node24 focused32/32, nezávislá spec/quality revize bez nálezů; normalizovaný celý harness je bajtově shodný s původním tokem.
- [ ] Skutečným novým CI zjistit primární recoveryStage a teprve z doložené příčiny připravit případnou opravu. Lokální diagnostické testy nejsou úspěchem obnovy ani její opravou.
- [ ] Pro Windows určit skutečnou čekající část selected bootstrapu. Výchozí/DEBUG log ani soubory instalačního zámku neprokazují dokončení či příčinu čekání. Samostatný párový diagnostický build z přesného upstream commitu je zatím pouze posuzovaný plán; není implementovaný ani náhradou původní binárky a jejího RED. Engine verze, závislosti, oprávnění a původní90s limit se nemění.
- [ ] Publikovat revidované změny běžným feature pushem, ověřit nové přesné CI a pokračovat původními protected-dev a skutečnými GUI/provider akceptačními kroky. Nová testovací metadata nejsou produkční opravou neprokázané příčiny.


### Přesný f665 výsledek a další pozorování odeslání

Na f665 prošly celé sourceLinux/macOS, Windows portable včetně opravených helperů a desetisložkového korpusu, packageLinux a i18n. Windows native startup stále selhal. macOS nyní selhal přesně při prompt-observe s vlastním kódem expirace: snapshot body/check a otevření/editace/kliknutí vrátily, ale odpovídající POST nebyl přijat predikátem do30s. Samotná příčina se neví.

- [x] V původním click evaluate pozorovat pouze pevné booleany konkrétního composeru/editoru/tlačítka přes existující read-only slice; nevracet raw state/IDs/text. Použít původní attachment send jako pozitivní kontrolu, bez dalšího odeslání.
- [x] Ve stejném původním CDP event slice klasifikovat omezené endpoint/scope/body/marker/restorePATCH/response údaje; při chybějícím těle ponechat unknown. Žádné URL, těla, hlavičky ani error text do artefaktu. Zachovat původní predikát, akce, await/request pořadí i limity. Schema6 obsahuje dvě pevné role; primary freeze a runtime schema1 zůstávají.
- [x] RED/GREEN Node24 diagnostics38/38 a nezávislá scoped spec/quality revize bez nálezů; d70d85c3 → 113fe308. Původní celý tok a oba predikáty zachované.
- [ ] Normální publikace a nové skutečné CI musí určit další větev. Pozorování není opravou neprokázané příčiny.

Podklady pro případný Windows párový rebuild: čistý přesný veřejný upstream16747470 a hashované build vstupy jsou lokálně připravené; celá oddělená kopie f665 má zdrojově ověřenou striktní výběrovou cestu bez nového override. Žádný rebuild, alternativní engine ani instalace závislostí zatím neproběhly. Původní release a jeho RED zůstávají autoritativní.


### Oddělená Windows baseline kontrola — pouze nezměněný rebuild

- [x] Implementovat samostatný Windows job závislý na původní packaging matici; původní job/limity/výsledky zůstanou stejné. Lehký guard čte pouze dvě původní projektované Windows JSON stejného runu; chybějící či jiná hranice přeskočí těžké kroky s unknown/not-needed.
- [x] Implementovat pipeline pro vlastní fyzický checkout a běžné matching LAWOSS sestavení; oddělený upstream16747470/Bun1.3.14/frozen vstupy a jeden hashově zmrazený models snapshot. Zvolit zdrojově potvrzený Windows x64-baseline target, semantic1.18.29/latest, OPENCODE_RELEASE nepředávat. Žádný lokální heavy build či instalace.
- [x] Implementovat ověření před změnou pouze vlastních prostředků: porovnat původní asset proti runtime artefaktu, všechny přítomné manifesty a zavřené vlastní děti. Uchovat originály; striktní úplná staging validace a bezpečný rollback. Timeout/neověřený zánik potomků znamená unknown, zachování souborů a žádný další běh.
- [x] Implementovat volání nezměněného celého nativního harnessu v této samostatné kopii se stejným transportem a limity. Výstup pouze bounded provenance a znovu projektovaná existující diagnostika. Reprodukovaná hranice není důkaz stejné příčiny; úspěch rebuildu neuzavírá původní RED. Žádná instrumentovaná varianta ani změna produkčního enginu.
- [x] Node24 RED/GREEN jednotkové ověření guardů, hashů, staging/rollback, procesů/unknown a projekcí; YAML a nezměněné bajty původního jobu; nezávislá scoped revize před publikací. Skutečná sestavitelnost a reprodukce zůstávají neověřené do CI.


Integrace 2026-10-15T05:57:04.954464+00:00: Windows838d+4be3367e →45cc3946+c18dc31c. Nezávislá revize nalezla dva P2 (pozdní child zápis do upload cesty; chybná klasifikace cleanupErrors); oba opraveny a scoped re-review ADDRESSED, SPEC/QUALITY PASS, nové0. Soukromý raw výstup už nesdílí publikační cestu, finalize sám vytváří schválenou projekci a cleanup chyba zůstává unknown. Matching Node24.21 společně Mac38+baseline19 =57/57, YAML a původní workflow prefix i tři SHA ověřeny.

- [ ] Publikovat tuto revidovanou sadu do stejného PR a vyčkat na celý původní CI včetně oddělené baseline. Skutečný Windows build/target/staging/nativní výsledek se dosud netvrdí; marker varianta není implementovaná. Původní dev approval a skutečná GUI/provider akceptace zůstávají otevřené.


### Skutečné386e CI a testovací CLI cesta na Windows

Source Linux/macOS, i18n a celé packageLinux/macOS prošly. Mac schema6 má complete/errornull/cleanup0; obě attachment/recovery pozorování prokazují správný scope/text a skutečný odpovídající POST bez ztracených korelací. Starší f665 selhání se v tomto běhu neopakovalo, příčina tím není zpětně určena. Původní Windows native startup zůstává RED. Závislý baseline job přijal guard a běží v odděleném checkoutu; jeho rebuild/výsledek se dosud netvrdí.

Windows portable38689643038 je nový RED ve helper kroku19: dvě NEW baseline CLI kontroly skončily child-error místo ok, původní server/build/SQLite/proxy prošly, desetisložkový korpus byl přeskočen. Bounded unit-step metadata odkazují na dvě new URL(...).pathname v testu; jde o doloženou neportabilní tvorbu argumentu, ne o získaný raw module-loader error. Není to stará opravená POSIX env-prefix kontrola.

- [x] V jediném testu převést oba CLI argumenty pomocí fileURLToPath, beze změny produkčního helperu, assertions, timeoutů, skip či workflow.
- [x] Exact Node24.21 focused helper19 + syntax/diff, nezávislá scoped spec/quality revize; skutečný Windows výsledek musí ověřit další CI.
- [x] Dokončit původní baseline běh před dalším feature pushem; neukončit jej novou publikací. Celkový dev merge, GUI/provider/10spisová akceptace zůstávají otevřené.


2026-10-15T06:15:13.215753+00:00: Jednosouborová oprava7b2310bf→464ea5d0 integrována po nezávislé SPEC/QUALITY PASS/nové0. Node24.21 focused19/19, syntax/diff0; root kontrola jediné cesty a SHA souhlasí. Původní CLI argv/env/5000ms/striktní assertions zůstaly; nový actualWindows gate stále nutný. Publikace držena do dokončení aktuální baseline.


### Windows baseline instalace — skutečné selhání přípravy

386e experiment ukončen jako UNKNOWN/upstream-install/child-error; žádný rebuilt engine/manifest/native výsledek. Běžná LAWOSS instalace/build prošly. Přesné source/Bun/Node a Windows hoisted postup odpovídají upstreamu; žádná deterministická příčina instalace není prokázaná. Izolace ovšem ztrácí workflow Git core.longpaths=true, protože používá prázdný globální config. To je doložená ztráta nastavení, nikoli důkaz příčiny selhání. Frozen lockfile a všechny hashe se zachovají.

- [x] Přenést pouze pevné Git longpaths nastavení do vlastního env bez globálních credentials/config.
- [x] Rozšířit pouze opt-in install collector o uzavřené spawn/close/exit/signal/error-code/pipe metadáta a bounded úplné source-verified Bun frozen/lifecycle summary pozorování. Allowlist package identit odvodit přechodně z ověřeného root manifestu, nic z tokenů/řádků/URL/cest ani rawstderr nepublikovat. Pozorování nejsou autentizovanou příčinou.
- [x] Baseline-only schema2 s jediným nullable installObservation, striktní pure projekcí a finalize jako jediným publisherem. Původní main6/runtime1, collector opt-out, příkazy a budžety nezměněné; timeout/unknown potomci stále zakazují další fáze.
- [x] Exact Node24.21 RED/GREEN cílených syntetických chunk/close/error/limit/late-event/forged-receipt/CLI kontrol a nezávislá scoped SPEC/QUALITY revize před integrací. Žádný lokální install/build/native.
- [ ] Publikovat spolu s již revidovanou jednosouborovou CLI opravou, ověřit skutečné nové Windows CI a další přípravu. Rebuild, reprodukce a původní startup příčina jsou nadále otevřené; žádná instrumentovaná ani produkční binárka se nepřipravuje.


2026-10-15T06:39:03.732330+00:00: Implementace458c951d→5080eaef integrována po nezávislé SPEC/QUALITY PASS/nové0, dva soubory. Node24.21 focused27/27; root společně diagnostics38+baseline27=65/65, syntax/diff0, pět sourceSHA a nezměněný workflow/main/runtime ověřeny. Skutečný386e guard přijímá i nová projekce bez změny původního boundary; to je tvarový preflight, ne nová Windows metadata. Pevné Git longpaths je oprava ztráty konfigurace, nikoli prokázané příčiny instalace. Nový actualWindows test/rebuild/instalace/startup/provider/GUI/dev merge zůstávají otevřené.


### Task 8: Bezpečně rozlišit fáze nezměněného upstream buildu

Actual22d: Windows helper i desetisložkový korpus PASS; původní native startup RED. Samostatná baseline instalace prokazatelně closed/exit0, poté upstream-build/child-error, rebuiltSHA/native chybí. Nejde o frozen refusal ani doloženou příčinu startupu.

- [x] Pouze ve dvou baseline helper/test souborech přidat opt-in pasivní buildObservation: skutečný spawn/close/signal/exit a source-proved pevné stdout milestones + stderr Bun/Vite summaries; schema3, uzavřená bounded projekce. Žádné raw chyby/cesty/URL/stacky/source, změny příkazu/vstupů/budgetu/wrapperu ani závěry z absence značek. Instalační pozorování a původní výsledky zachovat.
- [x] Matching Node24.21 syntetické RED/GREEN, celý baseline helper test/syntax/diff a nezávislá scoped SPEC/QUALITY revize před integrací.
- [ ] Publikovat do stejného PR a vyhodnotit skutečné nové CI. Původní Windows startup, GUI/provider akceptace i chráněný dev merge zůstávají otevřené.

Integrace Task8: 79fbeeee → 44643e65, nezávislé SPEC PASS / QUALITY APPROVED / nové0. Exact Node24.21 focused12/12 a celý helper39/39, syntax/diff0; dva sourceSHA a pět nezměněných source/workflow souborů ověřeny. Skutečný22d original guard stále run; schema3 shape preflight nepředstavuje nová buildová metadata. Nové CI a původní startup/GUI/provider/dev merge zůstávají otevřené.


### Task 9: Rozlišit primární project-sync timeout

Skutečný29f Windows serverový krok má čtyři5000ms timeouty v project-sync; pozdní těla/cleanup mohou kaskádovat, ale příčina ani blokující await nejsou prokázané. Diagnostika nejprve změří první selhávající case revoke; další tři zůstávají otevřené.

- [x] Test-only pevné statement indexy v původním těle prvního testu, snapshot zmrazený při vstupu do původního cleanup, oddělené bounded dokončení/odmítnutí cleanup. Původní assertions, await pořadí, callbacky, LIFO/failfast a5000ms limit beze změny; žádná produktová oprava se z toho netvrdí.
- [x] Nový čistý helper/RED-GREEN a exact Bun1.4.2/preloads; explicitní test-only flag pouze v původním Windows server kroku14. Další task/native protokoly beze změny, žádné raw chyby/cesty/data.
- [x] Nezávislá scoped SPEC/QUALITY revize, integrace a publikace6ccc po dokončení29f CI. Živé AI/GUI, ostatní Windows selhání a chráněný dev merge zůstávají otevřené.

Task9 lokálně integrován71cd0c5a→6966df66 po scoped SPEC PASS / QUALITY APPROVED, nové0. ExactBun1.4.2 helper9/selected1/full21, strict0; root4sourceSHA/5nezměněných zdrojů a DCO ověřeny. Skutečné Windows statement důkazy dosud nejsou, další tři selhání otevřená. Diagnostika testů se publikuje samostatně po své revizi, aby Windows měření běželo souběžně s přípravou compile monitoru. Jeho další push počká na dokončení nynější baseline.


### Task 10: Oddělené pozorování výjimky při veřejném upstream buildu

Skutečný29f baseline má installclosed0/buildclosed1 a značku normal-target-enter; bez binárky/nativního výsledku. Zdroj Bun1.3.14 potvrzuje non-suppressing uncaughtExceptionMonitor i rejected top-level await. Nový oddělený experiment zachová původní baseline3 i produkci.

- [x] Samostatný Windows diagnostic job pouze s Node/builtins, veřejným pinned source/Bun1.3.14, strict same-run baseline3 guard a nejprve skutečným malým nativeResolveMessage capability testem. Žádný LAWOSS desktop build/staging/nativní aplikace ani retry původní baseline.
- [x] Jeden preload s přesným entry/argv guardem a uzavřenými omezenými error typy/kódy/číselnými source indexy, žádné raw chyby/cesty/zdroj/text/args. Nový namespace/sole finalizer/single-file artifact; cause/readiness neprokazuje. Fresh models hash porovnán, rozdíl není kauzální ekvivalence.
- [x] Exact Node24 RED/GREEN a nezměněný baseline helper, skutečný lokální oficiálně hashově ověřený Bun1.3.14 capability test, nezávislá scoped SPEC/QUALITY revize a integrace. Aktuální6ccc baseline je dokončená; skutečná nová Windows diagnostika, původní startup a dev merge zůstávají otevřené.


Aktuální6ccc Task9: původní Windows server krok14 RED; uzavřené měření zmrazené v5921ms ukazuje statement5 `saveProjectSyncSettings`, enter978ms/lastCompleted4. Oddělený cleanup odmítnutý; vnitřní krok ani příčina nejsou známé. Celé Linux/macOS package, zdrojové testy a i18n PASS; Windows startup stále RED. Navazující baseline je živá, další push čeká.

### Task 11: Změřit vnitřní kroky prvního ukládání nastavení

Cílená source analýza neprokázala konkrétní chybu. Nejmenší navazující měření ponechá původní await/return/SQL/scheduler pořadí i5s test limit. Implementace až po dokončení Task10 writeru; oddělená revize, žádní současní implementátoři.

- [x] Pouze volitelný čtvrtý callback na saveProjectSyncSettings,16pevných synchronních checkpointů; bez callbacku žádný observer/clock/wrapper. Produkce nečte diagnostické env ani test support. Přímý return projectSyncStatus zůstává doslova; status-call není dokončení.
- [x] Callback pouze první outer statement5 a jen při stávajících třech explicitních test flazích; samostatný uzavřený settings protokol ≤4096B,16events max, freeze při stávajícím cleanupEntry. Původní body/cleanup schema1 beze změny. Žádné raw hodnoty, chyby, cesty, dotazy, další timery nebo modelové volání.
- [x] Smysluplné pure RED/GREEN, rozpoznatelná AST/source parity původní funkce a jediného calleru, původní selected fixture jednou/exactBun1.4.2/preloads/defaultbudget a finální strict server tsc. Těžké mockování všech závislostí se nepřidává; jeho chybějící coverage bude výslovně označená.
- [x] Nezávislá scoped SPEC/QUALITY revize a integrace; aktuální baseline dokončená. Následuje publikace do stejného PR. Konkrétní opravu vybrat teprve podle skutečného vnitřního checkpointu; žádný timeout-only/DBlock/globalpath/scheduler závěr z hypotézy.


2026-10-15T10:55:12.643823+00:00: Integrace Task10:0899f152→f3b663e3, oprava Windows testových identit7a8ca4d9→40babd12; původní Important nález ADDRESSED po scoped SPEC PASS / QUALITY APPROVED, nové blokující0. Původní Minor formátování owneru je neblokující a odložené; neopravuje se nesouvisejícím reformatem. Finální Node25/25, nezměněný baseline39/39 jednou, přesný oficiální MacBun1.3.14 native capability + descendant silence PASS; Windows se z toho netvrdí. Task11:891cc57b→b3db4487 po nezávislé SPEC PASS / QUALITY APPROVED, nálezy0; Bun22/4132expects, původní selected fixture1/12expects/no frames, strict0. Root ověřil všech8sourceSHA, původní10608B workflow prefix, šest nezměněných zdrojů/DCO a skutečný6ccc baseline pure admission. Žádný lokální upstream/native/app build, profil ani nové modelové volání. Nové Windows CI, konkrétní příčina a plná GUI/provider/dev akceptace zůstávají otevřené.


2026-10-15T11:20:56.430016+00:00: Task10 navazující test-only oprava R2: skutečný83a helper19 má1selhání inert/mismatched preload testu, zatímco server14 PASS neprokazuje opravu dřívějších timeoutů. Node --import používá ESM specifier; test nově převádí pouze jeho preload argument přes pathToFileURL, Bun env zůstává nativní. Rezervované mezery/#/% prokázaly RED/GREEN; finální25testů PASS.616d4973→d9ea19df po scoped SPEC PASS / QUALITY APPROVED / nové blokující0, root8SHA/1file scope/DCO ověřeny. Windows vnitřní child chyba zůstává nepozorovaná a původní startup se z toho nevysvětluje. Publikace počká na dokončení83a baseline i compile jobu; žádný lokální build či modelové volání.


### Task 12: Rozlišit nové původní OKF a project-sync selhání

- [x] Zachovat původní149 pokus1 RED a jednou zopakovat pouze portable job stejného SHA. OKF se neopakovalo; pokus2 má serverový runner-timeout5000 u původního conflict testu453,474testů/467pass/1fail/6skip. Původní server/helper/corpus výsledky se mezi pokusy nepřenášejí.
- [x] Původní dva CLI testy jednou lokálně2PASS a conflict jednou1PASS; místní rychlost není oprava Windows. Čerstvá vlastní syntetická kontrola ověřila přesný Bun1.4.2 timeout marker; uzavřená CI projekce následně potvrdila5000ms, vnitřní příčina neznámá.
- [x] Úzká source analýza a řízený skutečný500ms scheduler RED/GREEN bez sítě prokázaly mezeru fixtures: automatický default-platform round převezme ruční fake volání. Po řádném zastavení obou timerů před scénářem při zachovaném runtime lifetime ruční fake round projde. To je samostatně opravitelná chyba izolace testu, nikoli důkaz původní Windows příčiny.

### Task 13: Oddělený původní-binary empty-auth experiment

**Důvod:** aktuálníacab Windows portable celý PASS, původní package zůstává RED: vybrané engine.path preheaders88012ms, health200/691ms, cleanup0. Stejný originální engine1.18.29/SHA32675f a runtimeBun1.3.14/preload1374ms nejsou důkaz selected readiness.149 baseline skončila UNKNOWN/upstream-install bez rebuildu, proto se neopakuje instrumentovaný rebuild ani nemění produkční engine. Čtyřsouborový source návrh je již ověřený; po dokončení Task14 je tento malý oddělený experiment schválen k implementaci, zatímcoacab CI dál měří původní výsledky.

**Owned files:** nový `lawoss/testing/isir/native/engine-empty-auth-probe.mjs`, jeho `.test.mjs`, úzký producer/ack hook `scripts/test-isir-native.mjs`, připojený job v `.github/workflows/ci-desktop-packaging.yml`. Root vlastní společné docs. Žádné produkční auth/runtime/server změny, nové dependencies, externí engine, staging/alias/target změny nebo upstream rebuild.

- [x] Owner má oddělené `guard private main runtime`, `run private`, `finalize private public` CLI. Import je inertní. Připustit pouze první workflow pokus, aktuální ověřený checkout/GITHUB_SHA, samostatný PR-head, runID aNode24; novýWindows job podle původní Windows boundary pouze načte stejné původní native/runtime artefakty ze stejného runu. Reuse pouze pure parseBoundedJson/assessOriginal se schema6, bez přejmenování experimentu na baseline. Chybějící, neplatná nebo stale data znamenají unknown a žádný install/build/native; původní úspěch je not-needed. Původní vstupy nemají head/run/attempt pole, proto raw SHA a workflow provenance mají být výslovně oddělené od jejich obsahu. Pokus>1 nikdy nejde do heavy work.
- [x] Připojit samostatný `windows-engine-empty-auth-probe` Windows2022 job závislý jen na package-smoke, s dosavadním !cancelled/failure condition. Původní celý workflow prefix včetně všech tří existujících jobů musí zůstat bajtově stejný. Nejdřív Node24.21.0 nové unit testy, pak artifact download a guard; teprve při run původnímatching pnpm11.4/Bun1.4.2/frozen install a build:electron v samostatném checkoutu. Žádný electron-builder ani nový upstream bun install. Token pouze v běžném build kroku, ne v native owner/child env. Stávající action piny zůstávají.
- [x] Harness má jedinou novou možnost `--empty-auth-probe <absolute-private-ack-file>`. Při její přítomnosti validovat před external-version/provider/app work přesný jeden argument/value, CI=true/GITHUB_ACTIONS=true, Windows, full synthetic corpus, diagnostics1, žádný debug ani externí corpus/engine/Electron override. Ack parent musí být canonical stejný private raw-diagnostics parent, fixní basename/absence, žádný symlink/overwrite. Po stávajícím env assembly vložit výhradně literal OPENCODE_AUTH_CONTENT='{}', bez caller value či passthrough; před prvním launch napsat exkluzivní ack. Bez možnosti se defaultní původní env/await/launch/assertions/budgets ani I/O nemění. Zachovat všechny existující OPENCODE reserved-env-store filtry. Jde o změněné chování všech Auth consumers, nikoli pasivní callback nebo produkční opravu přihlášení.
- [x] Ack schema1 má přesně7 polí: schemaVersion1, experiment='original-windows-empty-auth-behavioral', producerApplied=true, synthetic=true, fullMatrix=true, ownedRoot=true, engineSha256=<původní pinned SHA>. Je to potvrzení producer invocation po původním version probe, nikoli nezávislé čtení živého engine env. Owner i harness mají vlastní nové skutečné soukromé tmp roots; celý původní harness včetně deseti spisů, stejných requestů,90s startup deadline, relaunch a cleanup běží jednou. Child zná jen private ack/raw cestu, nikdy public filename. Vlastní baseline-helper collectChild má původní12min outer limit a omezený output/drain; žádné rerun ani další executable work po timeout/unclosed/error.
- [x] Ověřit přesný původní target opencode-x86_64-pc-windows-msvc.exe/verzi1.18.29/SHA25632675fbf8fcb804c6ee4e048ff0926cd64bf54d1b6185bf2c09e93a2662dd69d a původní manifesty pomocí existujících identity helperů. Nepřidávat nový executable version probe; reuse původní harness version/runtime checks. Ack po původním initial probe potvrzuje beforeVersionVerified; afterVersionVerified vyžaduje původní complete/relaunch identity check a čistýclosed0/cleanup0. Po direct close pouze read-only file/manifest identity; po unclosed nic dalšího nespouštět. Selhání/loss/změna identity zachová unknown, žádný rollback/staging/delete. Windows stop policy nezávisle nepočítá všechny descendants: descendant verification zůstává unknown i při complete.
- [x] Publikovat jediný nový `engine-empty-auth-probe.json` v artefaktu `isir-engine-empty-auth-probe-windows-2022`, jen po vždy spuštěném sole finalizeru s aktuální identity kontrolou a atomic/exclusive publication. Root schema1 má přesně18keys: schemaVersion,experiment,checkoutCommit,prHeadCommit,runId,runAttempt,nodeVersion,eligibility,stage,outcome,exit,delta,inputs,producer,engine,originalBoundary,alteredBoundary,lifecycle. Všechny vnořené objekty uzavřené, bounded a bez raw paths/errors/source/env/profile. Dřívější main6/runtime8-key1/baseline3/compile1 se nemění.
- [x] Nested contract: delta={key:'OPENCODE_AUTH_CONTENT',value:'{}',behavioral:true,causeEquivalence:'unknown'}; inputs={mainSha256,runtimeSha256}; producer={status:'not-run|applied|unknown',ackSha256}; engine={version,target,beforeSha256,afterSha256,beforeManifestsSha256,afterManifestsSha256,beforeVersionVerified,afterVersionVerified}; lifecycle={closed,code,descendants:'unknown'}. Hash nullable/lowercase64hex, flags boolean, IDs/počty konečné omezené integers. Boundary null nebo exactly{phase,startupStage,pathState,pathStatus,health200,cleanupErrorCount} z bounded projectBoundary; žádný optimistický výběr konfliktních rows. Eligibility unknown|not-needed|run; stage guard|awaiting-lawoss-build|identity-before|native|identity-after|complete; outcome unknown|not-needed|altered-progress|altered-complete|altered-failure; exit not-run|validation-failed|ok|child-error|child-unclosed|output-limit|invalid-output|timeout. Každý altered výsledek vyžaduje validní producer a koroborovanou file identity; altered-complete navíc closed0/complete/cleanup0 a final version proof. Altered-progress vyžaduje explicitní pozitivní selected-startup verification, nikoli absenci staré značky. Nic neříká repaired, causal nebo ready. Při chybě musí být primary exit zachovaný.
- [x] Raw input main max256KiB/runtime4096B, ack2048B, owner/public64KiB. Reject malformedUTF8/duplicatekeys/nonfinite/extra keys/unsafe files. Private owner/current provenance nevzniká z child payloadu. Invalid nebo chybějící private receipt znamená pouze clean unknown. Raw console/ack/executable/user data se neuploadují; private roots se ponechají runner teardown. Retention7days, přesně jeden soubor upload.
- [x] TDD: pure fixed env a absent-mode parity/invalid early guards, skutečný malý Node child pro výsledný env bez sítě, bounded producer ack/read/closed protocol a stage/hash invariants; CLI admission actualidentity/attempt2/stale/invalid/complete cases; real tiny Node collector children pro close/error/timeout/output/late freeze a sole publisher; skutečné filesystem identity helpery na syntetických bundle fixtures, pinned mismatch rejection. Nevyrábět test-only expected-hash override pro fake pinned success; pozitivní skutečná pinnedWindows identity patří až CI. Úzké source adoption/AST kontroly mohou prokázat skutečné umístění env hooku a původních native operations, nejsou nezávislým live engine-env měřením.
- [x] ExactNode24 nové unit/syntax/diff, nezměněné identity/diagnostic relevantní kontrakty jednou, YAML parser a původní celý workflow-prefix SHA; bez dalších unchangedbaseline39/compile25/native/app builds. Žádný lokální experiment se skutečným enginem/providerem. Fresh task SPEC/QUALITY review před integrací a normální publikací. Další push teprve po dokončení všech právě běžícíchacab jobů včetně baseline+compile; původní RED a skutečná GUI/provider/dev merge akceptace zůstávají samostatně otevřené.

**Lokální uzavření:** původní63937cb5 a I1oprava99765959 integrovány jako dda51822/904be87a. Nové testy32/32, relevantní identity/diagnostics51/51 jednou; syntax/YAML/prefix13304B a přesná3line legacy parity PASS. První nezávislá revize našla1Important case-alias; cílená oprava a následná scoped SPEC PASS / QUALITY APPROVED, nové0. Skutečný Windows experiment zatím neproběhl.

- [ ] Normální publikace do PR157 a všechny nové skutečné CI joby včetně samostatného empty-auth experimentu; výsledky neznámé, žádný historický PASS se nepřenáší. Původní startup RED, skutečná GUI/provider akceptace a protected dev merge zůstávají otevřené.

### Task 14: Izolovat ručně řízené project-sync fixtures od automatických roundů

**Own one file:** `apps/server/src/project-sync.test.ts`. Root vlastní společné docs. Žádné změny produkčních schedulerů, platform API, resource ownerů, helper protokolů, workflow, timeoutů nebo assertions původních konfliktů.

- [x] Nejprve přidat úzký behaviorální RED: skutečná defaultní machine fixture, pozorované skutečné timer admission bez náhrady časovačů, skutečné scheduleProjectSync a scheduleTaskSync s500ms; ručně řízená fixture nesmí přijmout automatický round. Ověřit, že explicitní fake run stále skutečně proběhne. RED před opravou musí zachytit mezeru, ne vzniknout z chybějícího importu.
- [x] Defaultní machine musí zachovat vlastní directory/lifetime i oba idempotentní cleanup callbacks; spustit dosavadní timer vlastníky, po zápisu původního synthetic spojení oba řádně zastavit/awaitnout před vrácením fixture. Samotné vynechání startu nestačí: schedule stráží stoppedConfigs/runtime scope, nikoli timerOwners. Explicitní manual run při drženém lifetime zůstane dovolený.
- [x] Přidat explicitní background režim pouze pro dva existující timer/lifetime testy: současný test918 musí nadále mít původního i dodatečného vlastníka, současný934 musí mít původního vlastníka pro stopProjectTimer a druhého config vlastníka. Zachovat jejich assertions a skutečnou automatickou práci. Zbývající machine volání zůstávají ručně řízené podle svého scénáře; nerozšiřovat DI ani globální mutable fake platform.
- [x] GREEN cíleného regression, finálně celý project-sync soubor jednou a nezměněný first-failure timing helper včetně AST/default wire kontraktů; strict server tsc/syntax/diff. Stejný Bun1.4.2/preloads/Node24.21 a původní limity: default5s i existující10s watcher test; žádný full app/server/native build jen kvůli fixtures. Doložit přirozený cleanup, obnovení spy/fetch a žádné skutečné síťové požadavky v novém kontrolním testu.
- [x] Čerstvá scoped SPEC/QUALITY revize, podepsaný commit a integrace.
- [x] Normální publikace do stejného PR a nové skutečné Windows CI: headacab, celý portable Windows job38734246130/116419375702 PASS včetně server14/build16/SQLite17/proxy18/helper19/desetispisového korpusu20; fresh15 SKIP. Původní package/native startup je samostatně RED, jeho další měření řeší Task13. Původní timeout5000/inner příčina zůstávají historicky otevřené, dokud je nové evidence nerozliší. Původní native startup, skutečná GUI/provider akceptace a protected dev merge zůstávají samostatné povinnosti.
