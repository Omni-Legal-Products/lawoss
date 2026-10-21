# Bezpečnostní prověrka LAWOSS — veřejné shrnutí, 21. 10. 2026

## Rozsah a stav

Prověrka posoudila zdrojové bezpečnostní hranice aplikace a dostupné lokální testy. Použila pstack postupy `principle-boundary-discipline`, `principle-prove-it-works` a `blast-radius`, doplněné standardním postupem Codex Security. Nezávislé zdrojové kontroly pokryly architekturu, vybrané aplikační cesty a změny PR #201.

| Předmět | Přesná prověřená revize |
|---|---|
| Základ aplikace | `88dd7eef75aeace676f97d877d25602255102321` |
| Změny PR #201 | `028d9064faaf269a697be00ac0adf0172e4394dc` |

Toto dokumentační PR vychází z novějšího `dev` na `b4f86d0977e8ea39219d1c2c9cb817044b6c1b55`. Závěry původní prověrky se na tento nový základ automaticky nepřenášejí.

**Výsledek: dva potvrzené nálezy střední závažnosti; pokrytí je částečné.** V prověřených lokalizačních změnách PR #201 nebyla doložena nová bezpečnostní regrese. Dokumentace žádný nález neopravuje a není potvrzením bezpečnosti celé aplikace ani podkladem pro obejití release kontrol.

## Dostupné ověření

Testy běžely nad oddělenými kopiemi uvedených revizí, se syntetickými daty a bez běžného uživatelského profilu. Použité runtime: Node 24.21.0, Bun 1.4.2, pnpm 11.4.0. Závislosti pro lokální testy byly připraveny z cache pomocí `pnpm install --offline --ignore-scripts --frozen-lockfile`.

| Skupina | Prošlo | Přeskočeno | Selhalo |
|---|---:|---:|---:|
| Server: role, souborové hranice, AI přenosy a engine scope | 52 | 1 | 0 |
| Protected transport a podpůrné síťové/souborové kontroly | 65 | 0 | 0 |
| PR #201: nativní helpery a hranice IPC/URL | 52 | 0 | 0 |
| PR #201: Office shell a server | 15 | 0 | 0 |
| **Existující vybrané testy celkem** | **184** | **1** | **0** |

Jeden další izolovaný bezpečnostní regresní test selhal na očekávání bezpečného chování a potvrdil nalezenou chybu. Není započten mezi úspěšné testy. Samostatný pokus omezený předem stanoveným rozpočtem podpořil druhý nález; nebyl vyvoláván pád aplikace ani vyčerpání prostředků.

Příkazy pro čtyři existující skupiny:

```sh
pnpm --filter legalwork-server exec bun test src/security-auth-boundaries.e2e.test.ts src/security-file-boundary.e2e.test.ts src/lawoss/ai-transfer-boundary.e2e.test.ts src/lawoss/ai-boundaries.e2e.test.ts src/lawoss/engine-workspace-boundary.e2e.test.ts
pnpm --filter legalwork-server exec bun test src/lawoss/protected-ai/transport.test.ts src/lawoss/protected-ai/document-tools.test.ts src/lawoss/protected-ai/dispatch.test.ts src/agent-sandbox/network.test.ts src/agent-sandbox/filesystem.test.ts
node --test apps/desktop/electron/host-approvals.test.mjs apps/desktop/electron/host-context-review.test.mjs apps/desktop/electron/native-locale.test.mjs apps/desktop/electron/sandbox-preloads.test.mjs apps/desktop/electron/window-allowlist.test.mjs apps/desktop/electron/remote-debugging.test.mjs apps/desktop/electron/safe-open.test.mjs
pnpm --filter legalwork-server exec bun test src/word-addin-shell.test.ts src/word-addin.e2e.test.ts
```

Výsledky se vztahují k tehdejším přesným revizím. Vznik tohoto dokumentačního PR je novým během aplikace neobnovoval. CI tohoto PR je samostatná informace, nikoli náhrada původního protokolu.

## Omezení závěru

- Úplně bylo zdrojově prověřeno 38 souborů základní revize a 17 souborů PR #201; původní inventář obsahoval 4225 souborů. Další významná místa byla čtena po úsecích a prohledávána. Vyhledávací shoda se nepočítá jako úplný audit souboru.
- Skutečný Windows běh, skutečný Office host, celý VM/packaged běh a exploit v prohlížečové variantě nebyly touto prověrkou ověřeny. Jeden Windows test byl přeskočen a nepředstavuje úspěšnou platformní kontrolu.
- Záznamy `pnpm audit --json` byly posouzeny odděleně od potvrzených aplikačních nálezů. Závažnost balíčkového advisory sama nedokládá dosažitelnou zranitelnost aplikace.
- Prověrka nepotvrzuje absenci všech tajných údajů ani bezpečnost všech konektorů, parserů, editorů a závislostí. Nespouštěla útoky na cizí služby a nepoužívala skutečné klientské dokumenty či nalezené přihlašovací údaje.

## Nakládání s podrobnostmi

Repozitář je veřejný. Podle [SECURITY.md](../../SECURITY.md) se podrobnosti zranitelností mají předávat neveřejně a zveřejnění koordinovat s maintainery. Proto toto PR neobsahuje reprodukční vstupy, exploit kód, citlivé logy, přesná zranitelná místa ani úplný interní protokol. Podrobné podklady zůstávají v neveřejném výstupu této prověrky; jejich uchování není dokladem odeslání maintainerům.

## Další kroky

Prioritou je neveřejné projednání obou potvrzených nálezů a příprava samostatných oprav s regresními testy. Před označením opravy za ověřenou je nutné doložit selhání před změnou, úspěch po změně a zachování souvisejících kontrol. Termín zveřejnění a přijetí oprav nejsou tímto dokumentem určeny.

## Otevřené otázky

- Rozsah dopadu v reálných konfiguracích nasazení a vhodné limity nedůvěryhodných vstupů.
- Dosažitelnost vybraných dependency advisories a ochrana prohlížečové varianty.
- Samostatné nativní platformní ověření a dopad změn po prověřených revizích.
