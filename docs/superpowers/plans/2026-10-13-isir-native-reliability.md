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

- [ ] Test semicolons, quotes, newlines, Czech UTF-8 and missing optional facts. Exported seven-field ISIR registry has exactly one row for each distinct selected source, excludes duplicate copies by source ID/hash.
- [ ] Test real initial malformed rows from prior observations (6 instead of 7 columns), missing/mismatched case identity, missing/extra/duplicated rows and official URL mismatch are invalid with specific issues; no success flag from model text.
- [ ] Test outputs saved through ordinary agent file tools are inspectable and remain unverified until checks pass; editing an already validated output invalidates its verification. Do not intercept/prevent unrelated user CSV writes.
- [ ] Implement CSV parser/serializer with quoted multiline fields; no new dependency. Validate readable JSON reference inputs using zod. Never infer a legal case number from workspace ID or unrelated file.
- [ ] Structured export writes known identity header from persisted workspace/reference manifest, preserves unknown facts as such, stages outputs atomically and refuses overwriting user-owned files. A repair may update only the registered generated output with matching expected hash/revision.
- [ ] Agent tool result instructs repair of concrete issues and revalidation; bounded retries through existing agent workflow. Success requires files reread by server. Validate formatting/provenance, not legal truth.
- [ ] Run server suites, plugin behavior tests, typecheck/build; self-review and commit, fresh review.

### Task 4: Nativní UI se stavem zpracování a generováním přes chat

**Files:** `apps/app/src/react-app/domains/session/panel/workspace-files-panel.tsx`, small focused processing controller/components, workspace/project file intake hooks, app/lib/legalwork-server.ts client types/methods, locale CZ/SK/EN (other supported structures kept aligned), React behavior tests.

**Interfaces:** Consumes Task 2 statuses/read results and Task 3 verification. UI exposes prepare on selected files/folder, source coverage and issues, verified/invalid/edited output state. Generate action uses existing native project chat creation, selected connected provider/model, permissions and task submission path. No hard-coded model, separate AI settings or fabricated generated content.

- [ ] Test uploaded vs readable vs partial and generated vs format-verified; count real distinct sources and page coverage, label incomplete OCR clearly. A model message cannot promote status.
- [ ] Test prepare/read/validate on selected project never sends siblings; stale output/source resets status; reload/polling recovers; double submit/cancel/errors leave consistent state.
- [ ] Test generate action passes selected project + source refs to the existing chat submission, preflights provider/engine and gives localized actionable error before creating side effects when unavailable.
- [ ] Add native panel actions and state refresh using React Query conventions. Plain source text and file names are escaped; navigation/model reuse existing UI flows.
- [ ] Generate prompt names scoped preparation/read/export/validation tools and actual relative source paths. It requires Czech when UI is Czech, retains facts/unknowns/source pages and validates before completion. Technical checks do not present output as lawyer-approved.
- [ ] Run app complete tests, typecheck, locale parity and build plus desktop bridge tests; self-review and commit, fresh review.

### Task 5: Automatizovaný nativní průchod a opakovaná živá akceptace

**Files:** Incorporate existing test commit 42e11242 if not merged; new desktop native regression harness/tests, app e2e integration, pnpm scripts and both appropriate CI workflows. Public data stay outside repository.

**Interfaces:** `pnpm test:isir` offline transport suite; `pnpm test:isir:native` automated actual Electron/renderer flow with isolated profile and deterministic controlled provider transport for CI. `LAWOSS_ISIR_CORPUS` enables real local PDFs, explicit live provider run performs preflight first. Harness distinguishes provider fake from live generation and returns nonzero for pending, invalid or incomplete claims.

- [ ] Observe current missing recovery/processing/export/UI cases fail through actual routes and rendered UI. Harness must exercise buttons/file picker bridge, drag/drop, chat attachment submission, source state, real production export/validation and restart; no source-text assertions or manual file placement as upload proof.
- [ ] Implement native test using existing Electron/browser automation utilities and synthetic original PDF fixtures. Keep fake engine response at provider/transport boundary only; all app UI, workspace persistence, filesystem and validation are real.
- [ ] Run offline native flow: attach files with spaces/Unicode/duplicate names into ten cases, switch projects, recover moved folder, request agent export, inspect output, restart and repeat reads. Verify original hashes and no cross-project writes.
- [ ] Run Node/server/app/desktop checks and builds corresponding to CI. Fix all observed failures before committing/pushing. Update PATCHES, general AGENTS/CLAUDE patterns and progress.txt.
- [ ] Fresh whole-branch review. No unresolved findings from requirements 1–5 may be deferred merely to satisfy a cap.
- [ ] Fetch both remotes, integrate any dev advancement, rerun relevant checks; publish the same tested feature SHA to obtain the five required remote CI checks. After all green, attempt ordinary fast-forward HEAD:dev without force as explicitly authorized. If hosted PR/approval rules reject it, open a concrete ready PR without changing protections and keep deployment incomplete until required review permits updating dev. Verify remote SHA and CI outcomes; never claim feature-branch push as dev deployment.
- [ ] Snapshot existing profile/test data and stop old application cleanly; launch freshly built pushed SHA using preserved profile. Retest original ten local ISIR samples through native UI and real agent, choosing new output locations to preserve previous evidence. Never print credentials or use client cases/free models.
- [ ] Audit all numbered requirements against actual evidence and keep goal active for any gap. Any finding opens a new failing test → implementation → green tests → commit/push → rerun loop. Completion is clean scoped requirements/acceptance with actual UI/live evidence, not an assertion that all software can never fail.
