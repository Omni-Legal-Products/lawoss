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
