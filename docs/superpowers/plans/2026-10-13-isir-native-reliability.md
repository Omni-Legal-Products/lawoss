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
