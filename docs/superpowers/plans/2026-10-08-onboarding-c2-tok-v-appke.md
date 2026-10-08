# Onboarding cez priečinok, plán C2: tok v appke

> **Pre agentných pracovníkov:** POVINNÝ SUB-SKILL: použi `superpowers:subagent-driven-development` (odporúčané) alebo `superpowers:executing-plans` a implementuj plán úloha po úlohe. Kroky používajú checkbox (`- [ ]`) syntax na sledovanie.

**Cieľ:** Onboarding má tri kroky (Ty → AI → Priečinok). Krok Priečinok ponúkne „Pripojiť existujúci priečinok“ a „Začať nanovo“ a po výbere ukáže jednu obrazovku „Toto som našiel“: návrh úrovne, voľbu pri praxi, otázku „Môžem priečinok usporiadať podľa OKF?“ a hromadné spracovanie klientov. Tú istú obrazovku otvorí aj bočný panel.

**Architektúra:**
- **Nové súbory** v `apps/app/src/lawoss/domains/onboarding/`: čistá logika `found-flow.ts` (testovateľná s falošným API), texty `found-text.ts`, komponenty `folder-step.tsx` a `found-screen.tsx`.
- **`lawoss-welcome-page.tsx`** mení len zoznam krokov a vetvy vykresľovania. Komponenty `Client` a `Matter` ostávajú pre „Pridať klienta“ a „Nová vec“ (`?continue=client|matter`).
- **„Áno, usporiadaj“** znovu použije `TriagePreviewView` zo stránky roztriedenia (tabuľka presunov). Stromy pred a po a animácie patria do plánu D.

**Tech stack:** React 19, TypeScript, `bun test` s `renderToStaticMarkup` (bez JSDOM), pnpm 11.4.0, Node 24, Electron (overenie na zabalenej appke).

**Spec:** [lawOSS-like-SK-CZ#92](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/92) (po zlúčení `specs/2026-10-08-onboarding-pripojit-priecinok.md` v `main`), časti „Tok obrazoviek“, „Pripojenie praxe (P5)“ a „Chyby a obnova“. Schválil MČ 8. 10. 2026.

## Predpoklad: základ vetvy

- Stavia na **C1** (trasy `suggest`, `triage/grant`, typy `OnboardingSuggestion`, `PracticePlanRequest`, `triageGrant`, `TriageStatus.mode`, `TriageUndoResult.kept`, krok `folder`/`found` v profile) a cez neho na #135 a #136.
- Vetva `feat/onboarding-c2` z `dev` po zlúčení C1. Ak C1 ešte nie je v `dev`, vytvor vetvu z vetvy C1 a PR cieľ na `dev` s poznámkou o závislosti.
- Čísla riadkov sú orientačné (stav 8. 10. po zlúčení A a B). Kód hľadaj podľa obsahu.

## Rozhodnutia, ktoré plán prijíma (na potvrdenie MČ pri review)

| # | Rozhodnutie | Prečo |
|---|---|---|
| R1 | **Prax + „Áno“:** najprv sa hromadne pridajú OKF súbory všetkým vybraným klientom, potom sa presuny navrhujú **po jednom klientovi** (náhľad, potvrdenie, ďalší). | Každý zápis presunov musí mať potvrdený odtlačok svojho náhľadu (C1, `triage/apply`); „všetci naraz“ by presúval bez náhľadu. |
| R2 | **Celá prax ako jeden priečinok + „Áno“:** voľba „Áno“ je vypnutá s vysvetlením. Usporiadať sa dajú jednotliví klienti neskôr cez „Usporiadať podľa OKF“. | Roztriedenie potrebuje kartu klienta v koreni; koreň praxe ju nemá. |
| R3 | **Potvrdenie OKF** (`okf.enabled` s `acknowledgedAt` a `noticeVersion`) sa uloží pri prvom potvrdení na obrazovke „Toto som našiel“, nová verzia oznámenia `2026-10-08-priecinok`. Profil s `okf.enabled = false` sa pri tom prepíše na `true`. | OKF je podľa specu vždy zapnuté (P2); skilly OKF sa inštalujú len pri `enabled`. Text oznámenia vysvetľuje, čo sa do priečinka zapíše. |
| R4 | **Hromadné pridanie OKF súborov** sa potvrdzuje raz pre celý zoznam; jednotlivé náhľady servera appka potvrdí sama. | „Nie“ (convert) len pridáva súbory, nič neprepisuje ani nepresúva; advokát vidí zoznam klientov aj zoznam súborov, ktoré pribudnú každému. |
| R5 | **Predvolené hodnoty pre convert:** názov = meno priečinka, typ klienta `po` pri právnej forme v mene, inak `fo`, jurisdikcia a jazyk z kroku Ty, dátum = dnes, `confirmUnknownClient: true`. | Formulár „Prvý klient“ z onboardingu vypadol (spec P7). Typ klienta sa dá neskôr zmeniť v karte klienta. |
| R6 | Kroky OKF voľba, Kancelária a Balíky z onboardingu odchádzajú; `packs-step.tsx` ostáva (používa ho Marketplace), z onboardingu sa len odpojí. | Spec P7. |
| R7 | **„Začať nanovo“ nezaregistruje žiadny pracovný priečinok.** Po založení kancelárie ide appka na domov s interným domovským priestorom (plán B), kým advokát nepridá prvého klienta. | Výsledok kancelárie má `root` = `…/Office`; ako pracovný priečinok nedáva zmysel a celý nový priečinok LAWOSS by agentovi otvoril všetkých budúcich klientov. Spec krok 3 sa dá čítať aj inak. |
| R8 | **Celá prax ako jeden priečinok** sa po onboardingu zaregistruje s `appFiles: "inside"`, takže do koreňa praxe vedľa `Office/` pribudne `.opencode/` (súbory appky, nie klientske dáta). | Rovnako ako pri každom pracovnom priečinku; spec P5 to pri „jeden priečinok“ predpokladá. |
| R9 | **Vec:** tlačidlo „Pripojiť klienta …“ pripojí nadradený priečinok s odpoveďou „Nie“. Usporiadať ho advokát môže neskôr cez „Usporiadať podľa OKF“. | Jednoduchší tok; spec žiada len ponúknuť pripojenie klienta. |

## Global Constraints

- Nová logika v súboroch LAWOSS (`apps/app/src/lawoss/**`). Upstream súbor `apps/app/src/react-app/shell/welcome-route.tsx` mení len mapovanie `?continue=` a `root`; riadok v `PATCHES.md` (existujúci riadok pre `welcome-route.tsx` sa rozšíri).
- Natívne UI: AI v onboardingu ostáva `OnboardingAiPanel` a natívne Nastavenia → Poskytovatelia AI; žiadne paralelné nastavenia.
- Nič sa nepresúva bez potvrdeného náhľadu presunov. „Nie“ a hromadné pridanie len pridávajú súbory.
- Texty SK, CS, EN, DE v `found-text.ts`; slovenské a české pojmy sa neprekladajú medzi sebou (spis/věc, advokát/advokát, klient).
- Tlačidlá: hlavné akcie `lw-btn gold` (globálne v `lawoss/shell/lawoss.css`), vedľajšie `lw-btn`. `.lw-today-primary` nepoužívať: jeho farba `--td-metal` je definovaná len pod `.lw-today` a `.lw-triage`.
- TypeScript bez `any` a `as`; komentáre po slovensky; commity po slovensky s `Co-Authored-By`; v novom texte bez dlhej pomlčky.
- **Overenie na zabalenej appke (úloha 9) len izolovane a appku zatvárať cez Cmd+Q alebo `osascript -e 'tell application id "com.eigenweltlabs.legalwork" to quit'`, nikdy `pkill`.** 8. 10. 2026 sa po `pkill` testovací build sám znova spustil bez izolácie nad reálnym profilom. Po každom zatvorení over: `pgrep -fl "MacOS/LAWOSS"` je prázdne a `find ~/.config/legalwork ~/.config/opencode ~/.legalwork -newer <marker>` je prázdne.

## Review Focus

- **Advokát vyberie priečinok s jedným klientom (99 % prípadov):** návrh „klient“, „Nie“ pridá OKF súbory, priečinok sa otvorí v appke. Test v úlohe 2 a v smoke (úloha 9).
- **Prax s 30 klientmi, jeden zlyhá** (napr. zamknutý súbor): ostatní sa spracujú, súhrn ukáže chybu a „Skúsiť znova“ len pre neúspešných. Test v úlohe 2.
- **Advokát opraví návrh** (prax → klient): obrazovka prepne voľby bez nového výberu priečinka. Test v úlohe 5.
- **Vec namiesto klienta:** obrazovka ponúkne nadradený priečinok ako klienta. Test v úlohe 2.
- **Uložený starý krok (`okf`, `office`, `packs`) alebo staré uložené `folder` v localStorage:** onboarding pokračuje na kroku Priečinok, nie na neexistujúcom kroku. Test v úlohe 1.

---

### Úloha 1: Nový zoznam krokov a migrácia uložených krokov

**Files:**
- Modify: `apps/app/src/lawoss/domains/onboarding/onboarding-state.ts` (`isStep`, `readOnboardingProgress`, `OKF_NOTICE_VERSION`, cesty krokov, `visibleOnboardingSteps`, `visibleOnboardingStep`, `stepAfterAi`, `stepAfterOkfChoice`)
- Test: `apps/app/tests/lawoss-onboarding-okf-steps.test.ts` (prepísať)

**Interfaces:**
- Produces:
  - `MAIN_ONBOARDING_PATH: readonly OnboardingStep[] = ["identity", "ai", "folder"]`
  - `visibleOnboardingSteps(): readonly OnboardingStep[]` (bez parametra; vždy hlavná cesta)
  - `visibleOnboardingStep(step: OnboardingStep): OnboardingStep`: hlavná cesta, `found`, `client`, `matter` a `done` ostávajú; `okf`, `office`, `packs` → `folder`
  - `stepAfterAi(): "folder"`
  - `OKF_NOTICE_VERSION = "2026-10-08-priecinok"`; `okfChoice(true, now)` beze zmeny tvaru
  - `stepAfterOkfChoice` sa **odstráni**

- [ ] **Krok 1: Prepíš testy krokov**

`apps/app/tests/lawoss-onboarding-okf-steps.test.ts` nahraď:

```ts
import { describe, expect, test } from "bun:test";
import {
  MAIN_ONBOARDING_PATH, OKF_NOTICE_VERSION, okfChoice, readOnboardingProgress,
  stepAfterAi, visibleOnboardingStep, visibleOnboardingSteps,
} from "../src/lawoss/domains/onboarding/onboarding-state";

const storage = (value: unknown) => ({ getItem: () => JSON.stringify(value) });

describe("kroky onboardingu cez priečinok", () => {
  test("hlavná cesta má tri kroky", () => {
    expect(MAIN_ONBOARDING_PATH).toEqual(["identity", "ai", "folder"]);
    expect(visibleOnboardingSteps()).toEqual(["identity", "ai", "folder"]);
    expect(stepAfterAi()).toBe("folder");
  });
  test("staré kroky vedú na Priečinok, ostatné ostávajú", () => {
    for (const legacy of ["okf", "office", "packs"] as const) expect(visibleOnboardingStep(legacy)).toBe("folder");
    for (const kept of ["identity", "ai", "folder", "found", "client", "matter", "done"] as const) expect(visibleOnboardingStep(kept)).toBe(kept);
  });
  test("uložené folder v localStorage je nový krok Priečinok", () => {
    expect(readOnboardingProgress(storage({ lane: "detailed", step: "folder" }))).toEqual({ lane: "detailed", step: "folder" });
    expect(readOnboardingProgress(storage({ lane: "detailed", step: "found" }))).toEqual({ lane: "detailed", step: "found" });
  });
  test("potvrdenie OKF nesie novú verziu oznámenia", () => {
    expect(OKF_NOTICE_VERSION).toBe("2026-10-08-priecinok");
    expect(okfChoice(true, new Date("2026-10-08T10:00:00Z"))).toEqual({ enabled: true, acknowledgedAt: "2026-10-08T10:00:00.000Z", noticeVersion: "2026-10-08-priecinok" });
  });
});
```

Over názvy exportov v súbore pred zápisom (`DEFAULT_ONBOARDING_PROGRESS`, `lane`); ak sa „lane“ volá inak, uprav očakávanie podľa súboru, nie kód.

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd apps/app && bun test tests/lawoss-onboarding-okf-steps.test.ts`
Expected: FAIL, `MAIN_ONBOARDING_PATH` neexistuje.

- [ ] **Krok 3: Implementuj v `onboarding-state.ts`**

1. Typ krokov v tomto súbore (duplikát `OnboardingStep`, riadky okolo 65 až 73) zjednoť: importuj `OnboardingStep` z `./api` a lokálnu kópiu odstráň. Ak sa importu bráni cyklus importov, doplň do lokálnej kópie `"folder" | "found"`.
2. `isStep` doplň o `value === "folder" || value === "found"`.
3. V `readOnboardingProgress` odstráň riadok `if (parsed?.step === "folder") return { lane: parsed.lane, step: "office" };` a jeho komentár (staré `folder` sa teraz zhoduje s novým krokom Priečinok).
4. Blok od `export const OKF_NOTICE_VERSION` po koniec `stepAfterOkfChoice` nahraď:

```ts
/** Verzia oznámenia OKF; nová verzia si vyžiada nové vzatie na vedomie (spec 2026-10-08, OKF vždy lokálne). */
export const OKF_NOTICE_VERSION = "2026-10-08-priecinok";

/** Hlavná cesta onboardingu (spec P7): Ty → AI → Priečinok; „Toto som našiel“ je obrazovka kroku Priečinok. */
export const MAIN_ONBOARDING_PATH: readonly OnboardingStep[] = ["identity", "ai", "folder"];

export function visibleOnboardingSteps(): readonly OnboardingStep[] {
  return MAIN_ONBOARDING_PATH;
}

/** Staré kroky (voľba OKF, kancelária, balíky) uložené alfa testermi vedú na krok Priečinok. */
export function visibleOnboardingStep(step: OnboardingStep): OnboardingStep {
  return step === "okf" || step === "office" || step === "packs" ? "folder" : step;
}

export function stepAfterAi(): OnboardingStep {
  return "folder";
}
```

Typ `OkfEnabled` a funkciu `okfChoice` ponechaj.

- [ ] **Krok 4: Spusti test a typecheck**

Run: `cd apps/app && bun test tests/lawoss-onboarding-okf-steps.test.ts tests/lawoss-onboarding-state.test.ts && pnpm typecheck`
Expected: test krokov PASS. Typecheck zlyhá v `lawoss-welcome-page.tsx` (volania so starým podpisom `visibleOnboardingSteps(okfEnabled)`, `stepAfterOkfChoice`). Tie opraví úloha 6. Aby bola táto úloha samostatne zelená, uprav v `lawoss-welcome-page.tsx` len volania: `visibleOnboardingSteps()`, `visibleOnboardingStep(initialStep ?? status.profile?.step ?? saved.step)`, `stepAfterAi()`; vetvu `step === "okf"` dočasne nechaj volať `move("folder", { okf: okfChoice(enabled, new Date()) })` namiesto `stepAfterOkfChoice`. Ak `lawoss-onboarding-state.test.ts` čakal mapovanie `folder` → `office`, uprav očakávanie na `folder`.

- [ ] **Krok 5: Commit**

```bash
git add apps/app/src/lawoss/domains/onboarding/onboarding-state.ts apps/app/src/lawoss/domains/onboarding/lawoss-welcome-page.tsx apps/app/tests/lawoss-onboarding-okf-steps.test.ts apps/app/tests/lawoss-onboarding-state.test.ts
git commit -m "feat: onboarding má tri kroky, staré kroky vedú na Priečinok"
```

---

### Úloha 2: Logika obrazovky „Toto som našiel“ (`found-flow.ts`)

**Files:**
- Create: `apps/app/src/lawoss/domains/onboarding/found-flow.ts`
- Test: `apps/app/tests/lawoss-onboarding-found-flow.test.ts`

**Interfaces:**
- Consumes: `OnboardingApi` (`planOnboarding`, `applyOnboarding`, `suggestOnboarding`, `updateOnboardingProfile`), `OnboardingSuggestion`, `PracticePlanRequest`, `ExistingPlanRequest`, `OnboardingApplyResult` (C1); `TriageClient`, `triageGrant`, `triagePlan` (C1); `hasLegalForm` z `lawoss/okf/src/onboarding/suggest-patterns.ts` (plán A).
- Produces:
  - `type FoundIdentity = { lawyerName: string; jurisdiction: Jurisdiction; language: Language }`
  - `folderName(root: string): string`
  - `childPath(root: string, relative: string): string`
  - `parentPath(root: string): string`
  - `documentLanguage(language: Language): DocumentLanguage`
  - `convertRequest(root: string, identity: FoundIdentity, today: Date): ExistingPlanRequest`
  - `practiceRequest(root: string, identity: FoundIdentity, suggestion: OnboardingSuggestion, scope: "client" | "practice"): PracticePlanRequest`
  - `type BatchItem = { root: string; name: string; status: "pending" | "done" | "failed"; error?: string; result?: OnboardingApplyResult }`
  - `addOkfFiles(api, items: readonly { root: string; name: string }[], identity, today, onProgress: (items: BatchItem[]) => void): Promise<BatchItem[]>`
  - `retryFailed(api, items: readonly BatchItem[], identity, today, onProgress): Promise<BatchItem[]>`
  - `connectPractice(api, root, identity, suggestion, scope): Promise<OnboardingApplyResult>` (plán a zápis kancelárie praxe, potom `updateOnboardingProfile({ officeRoot: root })`)
  - `startReorganize(client: TriageClient, root: string): Promise<TriagePreview>` (grant, potom plán)
  - `firstWorkspaceResult(items: readonly BatchItem[]): OnboardingApplyResult | undefined`

- [ ] **Krok 1: Napíš padajúce testy**

`apps/app/tests/lawoss-onboarding-found-flow.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import type { OnboardingApi, OnboardingApplyResult, OnboardingPlanRequest, OnboardingSuggestion } from "../src/lawoss/domains/onboarding/api";
import type { TriageApiPath } from "../src/lawoss/domains/roztriedenie/api";
import {
  addOkfFiles, childPath, connectPractice, convertRequest, documentLanguage, firstWorkspaceResult,
  folderName, parentPath, practiceRequest, retryFailed, startReorganize, type BatchItem,
} from "../src/lawoss/domains/onboarding/found-flow";

const identity = { lawyerName: "Syntetický advokát", jurisdiction: "sk" as const, language: "sk" as const };
const today = new Date("2026-10-08T10:00:00Z");
const suggestion = (patch: Partial<OnboardingSuggestion> = {}): OnboardingSuggestion => ({ root: "/p", level: "practice", marked: false, score: 1, signals: [], clientPattern: "*", clients: [], complete: true, ...patch });

/** Falošné API: zaznamená požiadavky; klient s názvom „Zamknutý“ zlyhá pri pláne. */
function fakeApi() {
  const plans: OnboardingPlanRequest[] = [], applied: string[] = [], profiles: unknown[] = [];
  const api: Pick<OnboardingApi, "planOnboarding" | "applyOnboarding" | "updateOnboardingProfile"> = {
    planOnboarding: async (request) => {
      plans.push(request);
      if ("root" in request && request.root.endsWith("Zamknutý")) throw new Error("locked_file");
      return { id: `id-${plans.length}`, fingerprint: "f".repeat(64), preview: { operations: ["AGENTS.md"] } };
    },
    applyOnboarding: async (input): Promise<OnboardingApplyResult> => {
      applied.push(input.id);
      const request = plans[Number(input.id.slice(3)) - 1];
      const root = request && "root" in request ? request.root : "";
      return { result: "applied", root, clientRoot: root, workspace: { id: `ws-${applied.length}`, path: root } };
    },
    updateOnboardingProfile: async (patch) => { profiles.push(patch); return { version: 1, lawyerName: "L", jurisdiction: "sk", language: "sk" }; },
  };
  return { api, plans, applied, profiles };
}

describe("cesty a predvolené hodnoty", () => {
  test("meno, rodič a podpriečinok na macOS aj Windows", () => {
    expect(folderName("/Users/a/Klienti/Novák s.r.o/")).toBe("Novák s.r.o");
    expect(folderName("C:\\Klienti\\Alfa s. r. o.")).toBe("Alfa s. r. o.");
    expect(parentPath("/Users/a/Klienti/Novák/2024-03 Zmluva")).toBe("/Users/a/Klienti/Novák");
    expect(parentPath("C:\\Klienti\\Novák\\2024-03 Zmluva")).toBe("C:\\Klienti\\Novák");
    expect(childPath("/p", "A/Alfa s.r.o")).toBe("/p/A/Alfa s.r.o");
    expect(childPath("C:\\p", "A/Alfa s.r.o")).toBe("C:\\p\\A\\Alfa s.r.o");
  });
  test("jazyk dokumentov a typ klienta z právnej formy", () => {
    expect(documentLanguage("cs")).toBe("cs");
    expect(documentLanguage("de")).toBe("en");
    expect(convertRequest("/k/Alfa s. r. o.", identity, today)).toEqual({ action: "existing", root: "/k/Alfa s. r. o.", mode: "convert", title: "Alfa s. r. o.", clientType: "po", jurisdiction: "sk", date: "2026-10-08", language: "sk", confirmUnknownClient: true });
    expect(convertRequest("/k/Novák Ján", identity, today).clientType).toBe("fo");
  });
  test("prax nesie vzor klientov z návrhu", () => {
    expect(practiceRequest("/p/Kancelária", identity, suggestion({ clientPattern: "*/*" }), "client")).toEqual({ action: "practice", root: "/p/Kancelária", title: "Kancelária", jurisdiction: "sk", language: "sk", lawyerName: "Syntetický advokát", clientPattern: "*/*", scope: "client" });
    expect(practiceRequest("/p", identity, suggestion({ clientPattern: undefined }), "practice").clientPattern).toBe("*");
  });
});

describe("hromadné pridanie OKF súborov", () => {
  test("zlyhanie jedného klienta nezastaví ostatných; súhrn a opakovanie len neúspešných", async () => {
    const { api, applied } = fakeApi();
    const progress: BatchItem[][] = [];
    const items = await addOkfFiles(api, [{ root: "/p/Alfa", name: "Alfa" }, { root: "/p/Zamknutý", name: "Zamknutý" }, { root: "/p/Gama", name: "Gama" }], identity, today, next => progress.push(next));
    expect(items.map(item => item.status)).toEqual(["done", "failed", "done"]);
    expect(items[1]?.error).toBe("locked_file");
    expect(applied).toHaveLength(2);
    expect(progress.at(-1)).toEqual(items);
    expect(firstWorkspaceResult(items)?.workspace?.path).toBe("/p/Alfa");
    const again = await retryFailed(api, items, identity, today, () => undefined);
    expect(again.map(item => item.status)).toEqual(["done", "failed", "done"]);
    expect(applied).toHaveLength(2);
  });
});

describe("prax a usporiadanie", () => {
  test("pripojenie praxe zapíše kanceláriu a uloží ju do profilu", async () => {
    const { api, plans, profiles } = fakeApi();
    await connectPractice(api, "/p", identity, suggestion(), "client");
    expect(plans[0]).toMatchObject({ action: "practice", root: "/p", scope: "client" });
    expect(profiles).toEqual([{ officeRoot: "/p" }]);
  });
  test("usporiadanie najprv udelí súhlas, potom pripraví náhľad", async () => {
    const calls: { path: TriageApiPath; body: unknown }[] = [];
    const client = { lawossTriage: async <T,>(path: TriageApiPath, body: unknown): Promise<T> => { calls.push({ path, body }); return (path === "grant" ? { granted: true, root: "/k" } : { id: "t", fingerprint: "f", moves: [] }) as T; } };
    await startReorganize(client, "/k");
    expect(calls.map(call => call.path)).toEqual(["grant", "plan"]);
    expect(calls[0]?.body).toEqual({ root: "/k", confirm: true });
  });
});
```

`as T` v náhrade generickej metódy `lawossTriage` je rovnaký vzor ako v C1 (úloha 5); ak `lawoss-triage-ui.test.tsx` používa iný vzor bez pretypovania, prevezmi ho.

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd apps/app && bun test tests/lawoss-onboarding-found-flow.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj `found-flow.ts`**

```ts
/**
 * Logika obrazovky „Toto som našiel“ (spec 2026-10-08): predvolené hodnoty, hromadné pridanie
 * OKF súborov, pripojenie praxe a začiatok usporiadania na mieste. Bez Reactu, aby sa dala testovať.
 */
import type { Language } from "@/i18n";
import { hasLegalForm } from "../../../../../../lawoss/okf/src/onboarding/suggest-patterns";
import { triageGrant, triagePlan, type TriageClient, type TriagePreview } from "../roztriedenie/api";
import type { DocumentLanguage, ExistingPlanRequest, Jurisdiction, OnboardingApi, OnboardingApplyResult, OnboardingSuggestion, PracticePlanRequest } from "./api";

export type FoundIdentity = { lawyerName: string; jurisdiction: Jurisdiction; language: Language };
export type BatchItem = { root: string; name: string; status: "pending" | "done" | "failed"; error?: string; result?: OnboardingApplyResult };
type FlowApi = Pick<OnboardingApi, "planOnboarding" | "applyOnboarding" | "updateOnboardingProfile">;

const separatorOf = (root: string) => (root.includes("\\") && !root.includes("/") ? "\\" : "/");
const trimEnd = (root: string) => root.replace(/[\\/]+$/, "");

export function folderName(root: string): string {
  return trimEnd(root).split(/[\\/]/).pop() ?? root;
}

export function parentPath(root: string): string {
  const trimmed = trimEnd(root);
  const index = Math.max(trimmed.lastIndexOf("/"), trimmed.lastIndexOf("\\"));
  return index > 0 ? trimmed.slice(0, index) : trimmed;
}

/** Cesta klienta z relatívnej cesty návrhu (vždy s „/“) v oddeľovači koreňa. */
export function childPath(root: string, relative: string): string {
  const separator = separatorOf(root);
  return [trimEnd(root), ...relative.split("/").filter(Boolean)].join(separator);
}

/** Jazyk dokumentov OKF: slovenčina, čeština alebo angličtina (nemecké rozhranie píše anglicky). */
export function documentLanguage(language: Language): DocumentLanguage {
  return language === "cs" ? "cs" : language === "sk" ? "sk" : "en";
}

const isoDay = (date: Date) => date.toISOString().slice(0, 10);

/** „Nie, len pridaj OKF súbory“ bez formulára (R5): názov a typ z mena priečinka, zvyšok z kroku Ty. */
export function convertRequest(root: string, identity: FoundIdentity, today: Date): ExistingPlanRequest {
  const title = folderName(root);
  return {
    action: "existing", root, mode: "convert", title,
    clientType: hasLegalForm(title) ? "po" : "fo",
    jurisdiction: identity.jurisdiction, date: isoDay(today), language: documentLanguage(identity.language),
    confirmUnknownClient: true,
  };
}

export function practiceRequest(root: string, identity: FoundIdentity, suggestion: OnboardingSuggestion, scope: "client" | "practice"): PracticePlanRequest {
  return {
    action: "practice", root, title: folderName(root),
    jurisdiction: identity.jurisdiction, language: documentLanguage(identity.language), lawyerName: identity.lawyerName,
    clientPattern: suggestion.clientPattern ?? "*", scope,
  };
}

const errorText = (reason: unknown) => (reason instanceof Error ? reason.message : String(reason));

async function convertOne(api: FlowApi, item: { root: string; name: string }, identity: FoundIdentity, today: Date): Promise<BatchItem> {
  try {
    const preview = await api.planOnboarding(convertRequest(item.root, identity, today));
    const result = await api.applyOnboarding({ id: preview.id, fingerprint: preview.fingerprint, confirm: true });
    return { ...item, status: "done", result };
  } catch (reason) {
    return { ...item, status: "failed", error: errorText(reason) };
  }
}

/**
 * Pridá OKF súbory klientom po jednom (R4: zoznam potvrdil advokát raz). Chyba u jedného klienta
 * nezastaví ostatných; priebeh hlási po každom klientovi.
 */
export async function addOkfFiles(api: FlowApi, items: readonly { root: string; name: string }[], identity: FoundIdentity, today: Date, onProgress: (items: BatchItem[]) => void): Promise<BatchItem[]> {
  const state: BatchItem[] = items.map(item => ({ ...item, status: "pending" }));
  onProgress([...state]);
  for (const [index, item] of items.entries()) {
    state[index] = await convertOne(api, item, identity, today);
    onProgress([...state]);
  }
  return state;
}

/** Zopakuje len neúspešných; hotových nechá tak. */
export async function retryFailed(api: FlowApi, items: readonly BatchItem[], identity: FoundIdentity, today: Date, onProgress: (items: BatchItem[]) => void): Promise<BatchItem[]> {
  const state = [...items];
  for (const [index, item] of items.entries()) {
    if (item.status !== "failed") continue;
    state[index] = await convertOne(api, { root: item.root, name: item.name }, identity, today);
    onProgress([...state]);
  }
  return state;
}

/** Kancelária pre existujúcu prax (nič sa nepresúva) a jej zápis do profilu ako kancelárie. */
export async function connectPractice(api: FlowApi, root: string, identity: FoundIdentity, suggestion: OnboardingSuggestion, scope: "client" | "practice"): Promise<OnboardingApplyResult> {
  const preview = await api.planOnboarding(practiceRequest(root, identity, suggestion, scope));
  const result = await api.applyOnboarding({ id: preview.id, fingerprint: preview.fingerprint, confirm: true });
  await api.updateOnboardingProfile({ officeRoot: root });
  return result;
}

/** „Áno, usporiadaj“: výslovný súhlas, potom náhľad presunov; zápis až po potvrdení náhľadu. */
export async function startReorganize(client: TriageClient, root: string): Promise<TriagePreview> {
  await triageGrant(client, root);
  return triagePlan(client, root);
}

export function firstWorkspaceResult(items: readonly BatchItem[]): OnboardingApplyResult | undefined {
  return items.find(item => item.status === "done" && item.result?.workspace)?.result;
}
```

Over relatívnu cestu importu `hasLegalForm`: `lawoss-welcome-page.tsx` importuje `../../../../../../lawoss/okf/src/profile`; z rovnakého priečinka je cesta `../../../../../../lawoss/okf/src/onboarding/suggest-patterns`. Ak `suggest-patterns.ts` importuje `../triage/rules.ts` s príponou `.ts`, appka ho musí vedieť zostaviť (Vite a Bun to vedia, `tsc` s `allowImportingTsExtensions`); over `pnpm typecheck` a ak zlyhá, importuj `hasLegalForm` rovnakým spôsobom ako iné moduly `lawoss/okf/src`, ktoré appka už používa.

- [ ] **Krok 4: Spusti testy a typecheck**

Run: `cd apps/app && bun test tests/lawoss-onboarding-found-flow.test.ts && pnpm typecheck`
Expected: PASS.

- [ ] **Krok 5: Commit**

```bash
git add apps/app/src/lawoss/domains/onboarding/found-flow.ts apps/app/tests/lawoss-onboarding-found-flow.test.ts
git commit -m "feat: logika obrazovky Toto som našiel (OKF súbory, prax, usporiadanie)"
```

---

### Úloha 3: Texty (`found-text.ts`)

**Files:**
- Create: `apps/app/src/lawoss/domains/onboarding/found-text.ts`
- Modify: `apps/app/src/lawoss/domains/onboarding/lawoss-welcome-page.tsx` (slovníky `text`: kľúč `folder` pre názov kroku vo všetkých štyroch jazykoch)
- Test: `apps/app/tests/lawoss-onboarding-found-text.test.ts`

**Interfaces:**
- Produces: `foundText(locale: Language): (key: FoundTextKey, params?: Record<string, string | number>) => string` a typ `FoundTextKey`.

- [ ] **Krok 1: Napíš padajúci test**

```ts
import { expect, test } from "bun:test";
import { FOUND_TEXT, foundText } from "../src/lawoss/domains/onboarding/found-text";

test("všetky jazyky majú rovnaké kľúče a neprázdne texty", () => {
  const keys = Object.keys(FOUND_TEXT.sk).sort();
  for (const locale of ["cs", "en", "de"] as const) expect(Object.keys(FOUND_TEXT[locale]).sort()).toEqual(keys);
  for (const locale of ["sk", "cs", "en", "de"] as const) for (const value of Object.values(FOUND_TEXT[locale])) expect(value.trim().length).toBeGreaterThan(0);
});
test("parametre sa doplnia a slovenčina nepreberá české pojmy", () => {
  expect(foundText("sk")("practiceFound", { count: 37 })).toContain("37");
  expect(foundText("sk")("matterFound", { name: "2024-03 Zmluva" })).toContain("2024-03 Zmluva");
  expect(FOUND_TEXT.sk.reorganizeQuestion).toContain("usporiadať");
  expect(FOUND_TEXT.cs.reorganizeQuestion).toContain("uspořádat");
});
test("bez dlhej pomlčky", () => {
  for (const locale of ["sk", "cs", "en", "de"] as const) for (const value of Object.values(FOUND_TEXT[locale])) expect(value).not.toMatch(/[\u2013\u2014]/);
});
```

- [ ] **Krok 2: Over, že test padá**

Run: `cd apps/app && bun test tests/lawoss-onboarding-found-text.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj `found-text.ts`**

```ts
/** Texty kroku Priečinok a obrazovky „Toto som našiel“ (SK, CS, EN, DE). */
import type { Language } from "@/i18n";

const sk = {
  folderTitle: "Priečinok",
  folderLead: "LAWOSS pracuje nad vaším priečinkom, rovnako ako Claude Code alebo Codex. Vyberte existujúci, alebo začnite nanovo.",
  connectExisting: "Pripojiť existujúci priečinok",
  connectExistingHint: "Klient, celá prax alebo jedna vec. Rozpoznám to a spýtam sa.",
  startFresh: "Začať nanovo",
  startFreshHint: "Nový priečinok LAWOSS s kanceláriou. Klientov doň neskôr skopírujete.",
  choose: "Vybrať priečinok",
  freshDone: "Priečinok LAWOSS je pripravený: kancelária v Office/ a priečinok Klienti/.",
  freshHowTo: "Klientov sem skopírujte (pôvodné priečinky ostanú nedotknuté) a v bočnom paneli zvoľte Pridať priečinok. Každého klienta potom usporiadate podľa OKF hromadne alebo po jednom.",
  finish: "Dokončiť",
  looking: "Prezerám priečinok…",
  foundTitle: "Toto som našiel",
  clientFound: "Vyzerá to ako klient {name}.",
  practiceFound: "Vyzerá to ako celá prax: {count} klientov.",
  matterFound: "Vyzerá to ako jedna vec: {name}.",
  unknownFound: "Neviem s istotou, čo tento priečinok je.",
  incomplete: "Priečinok je veľký, prezrel som len časť. Návrh nemusí byť úplný.",
  correctLabel: "Toto je",
  asClient: "klient",
  asPractice: "celá prax",
  asMatter: "jedna vec",
  matterHint: "Vec patrí pod klienta. Pripojím nadradený priečinok {name} ako klienta.",
  useParent: "Pripojiť klienta {name}",
  scopeTitle: "Ako pracovať s praxou",
  scopeEach: "Každý klient zvlášť (odporúčané)",
  scopeEachHint: "Agent vidí vždy len jedného klienta.",
  scopeOne: "Jeden priečinok pre všetko",
  scopeOneHint: "Model môže v jednej konverzácii čítať spisy rôznych klientov. Zvoľte len vedome (mlčanlivosť).",
  clientsTitle: "Klienti",
  selectAll: "Označiť všetkých",
  selectNone: "Zrušiť označenie",
  reorganizeQuestion: "Môžem priečinok usporiadať podľa OKF?",
  okfNotice: "Do priečinka pribudnú súbory OKF (AGENTS.md, CLAUDE.md, karta klienta, memory/). Vďaka nim každý AI nástroj vie, čo v priečinku je. Žiadny váš súbor sa neprepíše ani nezmaže.",
  answerNo: "Nie, len pridaj OKF súbory",
  answerNoHint: "Nič existujúce sa nepohne.",
  answerYes: "Áno, usporiadaj",
  answerYesHint: "Najprv pridám OKF súbory, potom ukážem, kam navrhujem dokumenty presunúť. Presun sa dá vrátiť.",
  answerYesPractice: "Najprv pridám OKF súbory všetkým označeným klientom, potom navrhnem presuny po jednom klientovi.",
  answerYesDisabled: "Celú prax ako jeden priečinok usporiadať nejde. Klientov usporiadate neskôr jednotlivo.",
  filesTitle: "Pribudne",
  acknowledge: "Beriem na vedomie a pokračujem",
  working: "Pridávam OKF súbory: {done} z {total}",
  batchDone: "Hotovo: {done} z {total}",
  batchFailed: "Nepodarilo sa: {name} ({error})",
  retry: "Skúsiť znova neúspešných",
  reorganizeFor: "Usporiadanie: {name}",
  skipClient: "Tohto klienta preskočiť",
  nextClient: "Ďalší klient",
  reorganized: "Usporiadané. Presun sa dá vrátiť na stránke Roztriedenie.",
  open: "Otvoriť v LAWOSS",
  back: "Späť",
  changeFolder: "Vybrať iný priečinok",
};
type FoundTextKey = keyof typeof sk;
type Dictionary = Record<FoundTextKey, string>;

const cs: Dictionary = {
  folderTitle: "Složka",
  folderLead: "LAWOSS pracuje nad vaší složkou, stejně jako Claude Code nebo Codex. Vyberte existující, nebo začněte znovu.",
  connectExisting: "Připojit existující složku",
  connectExistingHint: "Klient, celá praxe nebo jedna věc. Rozpoznám to a zeptám se.",
  startFresh: "Začít znovu",
  startFreshHint: "Nová složka LAWOSS s kanceláří. Klienty do ní později zkopírujete.",
  choose: "Vybrat složku",
  freshDone: "Složka LAWOSS je připravená: kancelář v Office/ a složka Klienti/.",
  freshHowTo: "Klienty sem zkopírujte (původní složky zůstanou nedotčené) a v bočním panelu zvolte Přidat složku. Každého klienta pak uspořádáte podle OKF hromadně nebo po jednom.",
  finish: "Dokončit",
  looking: "Prohlížím složku…",
  foundTitle: "Tohle jsem našel",
  clientFound: "Vypadá to jako klient {name}.",
  practiceFound: "Vypadá to jako celá praxe: {count} klientů.",
  matterFound: "Vypadá to jako jedna věc: {name}.",
  unknownFound: "Nevím s jistotou, co tato složka je.",
  incomplete: "Složka je velká, prohlédl jsem jen část. Návrh nemusí být úplný.",
  correctLabel: "Tohle je",
  asClient: "klient",
  asPractice: "celá praxe",
  asMatter: "jedna věc",
  matterHint: "Věc patří pod klienta. Připojím nadřazenou složku {name} jako klienta.",
  useParent: "Připojit klienta {name}",
  scopeTitle: "Jak pracovat s praxí",
  scopeEach: "Každý klient zvlášť (doporučeno)",
  scopeEachHint: "Agent vidí vždy jen jednoho klienta.",
  scopeOne: "Jedna složka pro všechno",
  scopeOneHint: "Model může v jedné konverzaci číst spisy různých klientů. Zvolte jen vědomě (mlčenlivost).",
  clientsTitle: "Klienti",
  selectAll: "Označit všechny",
  selectNone: "Zrušit označení",
  reorganizeQuestion: "Můžu složku uspořádat podle OKF?",
  okfNotice: "Do složky přibudou soubory OKF (AGENTS.md, CLAUDE.md, karta klienta, memory/). Díky nim každý AI nástroj ví, co ve složce je. Žádný váš soubor se nepřepíše ani nesmaže.",
  answerNo: "Ne, jen přidej soubory OKF",
  answerNoHint: "Nic existujícího se nepohne.",
  answerYes: "Ano, uspořádej",
  answerYesHint: "Nejdřív přidám soubory OKF, potom ukážu, kam navrhuji dokumenty přesunout. Přesun jde vrátit.",
  answerYesPractice: "Nejdřív přidám soubory OKF všem označeným klientům, potom navrhnu přesuny po jednom klientovi.",
  answerYesDisabled: "Celou praxi jako jednu složku uspořádat nejde. Klienty uspořádáte později jednotlivě.",
  filesTitle: "Přibude",
  acknowledge: "Beru na vědomí a pokračuji",
  working: "Přidávám soubory OKF: {done} z {total}",
  batchDone: "Hotovo: {done} z {total}",
  batchFailed: "Nepodařilo se: {name} ({error})",
  retry: "Zkusit znovu neúspěšné",
  reorganizeFor: "Uspořádání: {name}",
  skipClient: "Tohoto klienta přeskočit",
  nextClient: "Další klient",
  reorganized: "Uspořádáno. Přesun jde vrátit na stránce Roztřídění.",
  open: "Otevřít v LAWOSS",
  back: "Zpět",
  changeFolder: "Vybrat jinou složku",
};

const en: Dictionary = {
  folderTitle: "Folder",
  folderLead: "LAWOSS works on your folder, just like Claude Code or Codex. Choose an existing one or start fresh.",
  connectExisting: "Connect an existing folder",
  connectExistingHint: "A client, a whole practice or one matter. I will recognise it and ask.",
  startFresh: "Start fresh",
  startFreshHint: "A new LAWOSS folder with an office. You copy clients into it later.",
  choose: "Choose folder",
  freshDone: "The LAWOSS folder is ready: the office in Office/ and the Klienti/ folder.",
  freshHowTo: "Copy clients here (the original folders stay untouched) and choose Add folder in the sidebar. Then organise each client by OKF, all at once or one by one.",
  finish: "Finish",
  looking: "Looking at the folder…",
  foundTitle: "Here is what I found",
  clientFound: "This looks like the client {name}.",
  practiceFound: "This looks like a whole practice: {count} clients.",
  matterFound: "This looks like one matter: {name}.",
  unknownFound: "I am not sure what this folder is.",
  incomplete: "The folder is large and I only looked at part of it. The suggestion may be incomplete.",
  correctLabel: "This is",
  asClient: "a client",
  asPractice: "a whole practice",
  asMatter: "one matter",
  matterHint: "A matter belongs to a client. I will connect the parent folder {name} as the client.",
  useParent: "Connect client {name}",
  scopeTitle: "How to work with the practice",
  scopeEach: "Each client separately (recommended)",
  scopeEachHint: "The agent only ever sees one client.",
  scopeOne: "One folder for everything",
  scopeOneHint: "The model may read different clients' files in one conversation. Choose this knowingly (confidentiality).",
  clientsTitle: "Clients",
  selectAll: "Select all",
  selectNone: "Clear selection",
  reorganizeQuestion: "May I organise the folder by OKF?",
  okfNotice: "OKF files will be added to the folder (AGENTS.md, CLAUDE.md, client card, memory/). With them, any AI tool knows what the folder contains. None of your files is overwritten or deleted.",
  answerNo: "No, just add OKF files",
  answerNoHint: "Nothing existing moves.",
  answerYes: "Yes, organise it",
  answerYesHint: "First I add the OKF files, then I show where I suggest moving documents. The move can be undone.",
  answerYesPractice: "First I add OKF files to all selected clients, then I suggest moves one client at a time.",
  answerYesDisabled: "A whole practice as one folder cannot be organised. Organise clients one by one later.",
  filesTitle: "Will be added",
  acknowledge: "I acknowledge this and continue",
  working: "Adding OKF files: {done} of {total}",
  batchDone: "Done: {done} of {total}",
  batchFailed: "Failed: {name} ({error})",
  retry: "Retry the failed ones",
  reorganizeFor: "Organising: {name}",
  skipClient: "Skip this client",
  nextClient: "Next client",
  reorganized: "Organised. The move can be undone on the Sorting page.",
  open: "Open in LAWOSS",
  back: "Back",
  changeFolder: "Choose another folder",
};

const de: Dictionary = {
  folderTitle: "Ordner",
  folderLead: "LAWOSS arbeitet mit Ihrem Ordner, wie Claude Code oder Codex. Wählen Sie einen bestehenden oder beginnen Sie neu.",
  connectExisting: "Bestehenden Ordner verbinden",
  connectExistingHint: "Ein Mandant, eine ganze Kanzlei oder eine Angelegenheit. Ich erkenne es und frage nach.",
  startFresh: "Neu beginnen",
  startFreshHint: "Ein neuer LAWOSS-Ordner mit Kanzlei. Mandanten kopieren Sie später hinein.",
  choose: "Ordner wählen",
  freshDone: "Der LAWOSS-Ordner ist bereit: die Kanzlei in Office/ und der Ordner Klienti/.",
  freshHowTo: "Kopieren Sie Mandanten hierher (die ursprünglichen Ordner bleiben unberührt) und wählen Sie in der Seitenleiste Ordner hinzufügen. Ordnen Sie dann jeden Mandanten nach OKF, alle auf einmal oder einzeln.",
  finish: "Fertig",
  looking: "Ich sehe mir den Ordner an…",
  foundTitle: "Das habe ich gefunden",
  clientFound: "Das sieht aus wie der Mandant {name}.",
  practiceFound: "Das sieht aus wie eine ganze Kanzlei: {count} Mandanten.",
  matterFound: "Das sieht aus wie eine Angelegenheit: {name}.",
  unknownFound: "Ich bin nicht sicher, was dieser Ordner ist.",
  incomplete: "Der Ordner ist groß, ich habe nur einen Teil angesehen. Der Vorschlag ist evtl. unvollständig.",
  correctLabel: "Das ist",
  asClient: "ein Mandant",
  asPractice: "eine ganze Kanzlei",
  asMatter: "eine Angelegenheit",
  matterHint: "Eine Angelegenheit gehört zu einem Mandanten. Ich verbinde den übergeordneten Ordner {name} als Mandanten.",
  useParent: "Mandant {name} verbinden",
  scopeTitle: "Wie mit der Kanzlei arbeiten",
  scopeEach: "Jeder Mandant einzeln (empfohlen)",
  scopeEachHint: "Der Agent sieht immer nur einen Mandanten.",
  scopeOne: "Ein Ordner für alles",
  scopeOneHint: "Das Modell kann in einem Gespräch Akten verschiedener Mandanten lesen. Nur bewusst wählen (Verschwiegenheit).",
  clientsTitle: "Mandanten",
  selectAll: "Alle auswählen",
  selectNone: "Auswahl aufheben",
  reorganizeQuestion: "Darf ich den Ordner nach OKF ordnen?",
  okfNotice: "Dem Ordner werden OKF-Dateien hinzugefügt (AGENTS.md, CLAUDE.md, Mandantenkarte, memory/). Damit weiß jedes KI-Werkzeug, was der Ordner enthält. Keine Ihrer Dateien wird überschrieben oder gelöscht.",
  answerNo: "Nein, nur OKF-Dateien hinzufügen",
  answerNoHint: "Nichts Bestehendes wird verschoben.",
  answerYes: "Ja, ordnen",
  answerYesHint: "Zuerst füge ich die OKF-Dateien hinzu, dann zeige ich, wohin ich Dokumente verschieben würde. Das Verschieben lässt sich rückgängig machen.",
  answerYesPractice: "Zuerst füge ich allen ausgewählten Mandanten OKF-Dateien hinzu, dann schlage ich Verschiebungen Mandant für Mandant vor.",
  answerYesDisabled: "Eine ganze Kanzlei als ein Ordner lässt sich nicht ordnen. Ordnen Sie Mandanten später einzeln.",
  filesTitle: "Wird hinzugefügt",
  acknowledge: "Ich nehme das zur Kenntnis und fahre fort",
  working: "Füge OKF-Dateien hinzu: {done} von {total}",
  batchDone: "Fertig: {done} von {total}",
  batchFailed: "Fehlgeschlagen: {name} ({error})",
  retry: "Fehlgeschlagene erneut versuchen",
  reorganizeFor: "Ordnen: {name}",
  skipClient: "Diesen Mandanten überspringen",
  nextClient: "Nächster Mandant",
  reorganized: "Geordnet. Das Verschieben lässt sich auf der Seite Sortierung rückgängig machen.",
  open: "In LAWOSS öffnen",
  back: "Zurück",
  changeFolder: "Anderen Ordner wählen",
};

export const FOUND_TEXT: Record<"sk" | "cs" | "en" | "de", Dictionary> = { sk, cs, en, de };
export type { FoundTextKey };

export function foundText(locale: Language): (key: FoundTextKey, params?: Record<string, string | number>) => string {
  const dictionary = locale === "sk" || locale === "cs" || locale === "de" ? FOUND_TEXT[locale] : FOUND_TEXT.en;
  return (key, params) => dictionary[key].replace(/\{(\w+)\}/g, (match, name: string) => (params && name in params ? String(params[name]) : match));
}
```

Ak typ `Language` zahŕňa ďalšie jazyky, `foundText` pre ne vráti angličtinu (rovnako ako ostatné slovníky onboardingu).

V `lawoss-welcome-page.tsx` doplň do slovníka `text` kľúč `folder` (názov kroku): en `"Folder"`, sk `"Priečinok"`, cs `"Složka"`, de `"Ordner"`.

- [ ] **Krok 4: Spusti test a commit**

Run: `cd apps/app && bun test tests/lawoss-onboarding-found-text.test.ts && pnpm typecheck`
Expected: PASS.

```bash
git add apps/app/src/lawoss/domains/onboarding/found-text.ts apps/app/src/lawoss/domains/onboarding/lawoss-welcome-page.tsx apps/app/tests/lawoss-onboarding-found-text.test.ts
git commit -m "feat: texty kroku Priečinok a obrazovky Toto som našiel"
```

---

### Úloha 4: Krok Priečinok (`folder-step.tsx`)

**Files:**
- Create: `apps/app/src/lawoss/domains/onboarding/folder-step.tsx`
- Modify: `apps/app/src/lawoss/domains/onboarding/onboarding.css` (karty voľby)
- Test: `apps/app/tests/lawoss-onboarding-folder-step.test.tsx`

**Interfaces:**
- Consumes: `foundText` (úloha 3); `OnboardingApi.planOnboarding`, `applyOnboarding`, `updateOnboardingProfile`; `OfficePlanRequest`.
- Produces:
  - `FolderChoiceView({ text, busy, onConnect, onFresh })`: čisté zobrazenie dvoch kariet
  - `FreshDoneView({ text, onFinish })`
  - `FolderStep({ api, identity, text, pickDirectory, onFound, onFreshDone, onError })`: `onFound(root: string)` po výbere existujúceho priečinka; `onFreshDone(result)` po založení nového (volajúci výsledok kancelárie ako priečinok neregistruje)

- [ ] **Krok 1: Napíš padajúci test**

```tsx
import { expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { FolderChoiceView, FreshDoneView } from "../src/lawoss/domains/onboarding/folder-step";
import { foundText } from "../src/lawoss/domains/onboarding/found-text";

test("dve veľké voľby so zlatým tlačidlom pre pripojenie", () => {
  const html = renderToStaticMarkup(<FolderChoiceView text={foundText("sk")} busy={false} onConnect={() => undefined} onFresh={() => undefined} />);
  expect(html).toContain("Pripojiť existujúci priečinok");
  expect(html).toContain("Začať nanovo");
  expect(html).toContain("lw-onb-choice");
  expect(html).toMatch(/class="lw-btn gold"[^>]*>Vybrať priečinok/);
});
test("po založení nového priečinka návod na migráciu", () => {
  const html = renderToStaticMarkup(<FreshDoneView text={foundText("sk")} onFinish={() => undefined} />);
  expect(html).toContain("Klientov sem skopírujte");
  expect(html).toContain("Dokončiť");
});
```

- [ ] **Krok 2: Over, že test padá**

Run: `cd apps/app && bun test tests/lawoss-onboarding-folder-step.test.tsx`
Expected: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj `folder-step.tsx`**

```tsx
/** Krok Priečinok (spec P1, P7): pripojiť existujúci priečinok alebo začať nanovo. */
import { useState } from "react";
import { FolderOpen, FolderPlus } from "lucide-react";
import type { OnboardingApi, OnboardingApplyResult } from "./api";
import { documentLanguage, type FoundIdentity } from "./found-flow";
import type { FoundTextKey } from "./found-text";

type Text = (key: FoundTextKey, params?: Record<string, string | number>) => string;

export function FolderChoiceView({ text, busy, onConnect, onFresh }: { text: Text; busy: boolean; onConnect: () => void; onFresh: () => void }) {
  return (
    <div className="grid gap-4">
      <h2 className="text-xl font-semibold">{text("folderTitle")}</h2>
      <p className="text-muted-foreground">{text("folderLead")}</p>
      <div className="lw-onb-choices">
        <section className="lw-onb-choice">
          <FolderOpen className="size-6" aria-hidden />
          <h3>{text("connectExisting")}</h3>
          <p>{text("connectExistingHint")}</p>
          <button type="button" className="lw-btn gold" disabled={busy} onClick={onConnect}>{text("choose")}</button>
        </section>
        <section className="lw-onb-choice">
          <FolderPlus className="size-6" aria-hidden />
          <h3>{text("startFresh")}</h3>
          <p>{text("startFreshHint")}</p>
          <button type="button" className="lw-btn" disabled={busy} onClick={onFresh}>{text("choose")}</button>
        </section>
      </div>
    </div>
  );
}

export function FreshDoneView({ text, onFinish }: { text: Text; onFinish: () => void }) {
  return (
    <div className="grid gap-3">
      <p>{text("freshDone")}</p>
      <p className="text-muted-foreground">{text("freshHowTo")}</p>
      <div><button type="button" className="lw-btn gold" onClick={onFinish}>{text("finish")}</button></div>
    </div>
  );
}

type Props = {
  api: Pick<OnboardingApi, "planOnboarding" | "applyOnboarding" | "updateOnboardingProfile">;
  identity: FoundIdentity;
  text: Text;
  pickDirectory: () => Promise<string | null>;
  onFound: (root: string) => void;
  onFreshDone: (result: OnboardingApplyResult) => void;
  onError: (reason: unknown) => void;
};

/**
 * „Začať nanovo“: vybraný (prázdny) priečinok dostane kanceláriu, `AGENTS.md` praxe a `Klienti/`.
 * Náhľad zmien netreba potvrdzovať zvlášť: do nového priečinka sa len pridáva (rovnaký zápis ako dnes Kancelária).
 */
export function FolderStep({ api, identity, text, pickDirectory, onFound, onFreshDone, onError }: Props) {
  const [busy, setBusy] = useState(false);
  const [fresh, setFresh] = useState<OnboardingApplyResult | null>(null);
  const connect = async () => {
    const root = await pickDirectory();
    if (root) onFound(root);
  };
  const startFresh = async () => {
    const parent = await pickDirectory();
    if (!parent) return;
    setBusy(true);
    try {
      const preview = await api.planOnboarding({ action: "office", parent, title: "LAWOSS", jurisdiction: identity.jurisdiction, language: documentLanguage(identity.language), lawyerName: identity.lawyerName });
      const result = await api.applyOnboarding({ id: preview.id, fingerprint: preview.fingerprint, confirm: true });
      await api.updateOnboardingProfile({ officeRoot: parent });
      setFresh(result);
    } catch (reason) {
      onError(reason);
    } finally {
      setBusy(false);
    }
  };
  if (fresh) return <FreshDoneView text={text} onFinish={() => onFreshDone(fresh)} />;
  return <FolderChoiceView text={text} busy={busy} onConnect={() => void connect()} onFresh={() => void startFresh()} />;
}
```

Over typ `OfficePlanRequest.language` v `api.ts`: je `Language` (rozhranie), nie `DocumentLanguage`. Ak je `Language`, pošli `identity.language` priamo a `documentLanguage` tu nepoužívaj (import potom odstráň). Riaď sa typom, nie touto poznámkou.

Do `apps/app/src/lawoss/domains/onboarding/onboarding.css` pridaj:

```css
/* Krok Priečinok: dve veľké voľby vedľa seba, na úzkom okne pod sebou. */
.lw-onb-choices { display: grid; gap: 16px; grid-template-columns: repeat(auto-fit, minmax(240px, 1fr)); }
.lw-onb-choice { display: grid; gap: 10px; align-content: start; padding: 20px; border-radius: 16px; border: 1px solid color-mix(in srgb, var(--lw-gold) 28%, transparent); background: color-mix(in srgb, var(--lw-surface, #11161c) 86%, transparent); }
.lw-onb-choice h3 { font-size: 1.05rem; font-weight: 600; }
.lw-onb-choice p { color: var(--muted-foreground, #9aa4ae); font-size: 0.92rem; }
.lw-onb-choice .lw-btn { justify-self: start; }
```

Over názvy premenných farieb v `lawoss/shell/lawoss.css` (`--lw-gold`, `--lw-surface`) a použi existujúce; ak `--lw-surface` neexistuje, nechaj záložnú hodnotu.

- [ ] **Krok 4: Spusti test, typecheck, commit**

Run: `cd apps/app && bun test tests/lawoss-onboarding-folder-step.test.tsx && pnpm typecheck`
Expected: PASS.

```bash
git add apps/app/src/lawoss/domains/onboarding/folder-step.tsx apps/app/src/lawoss/domains/onboarding/onboarding.css apps/app/tests/lawoss-onboarding-folder-step.test.tsx
git commit -m "feat: krok Priečinok s voľbou pripojiť existujúci alebo začať nanovo"
```

---

### Úloha 5: Obrazovka „Toto som našiel“ (`found-screen.tsx`)

**Files:**
- Create: `apps/app/src/lawoss/domains/onboarding/found-screen.tsx`
- Modify: `apps/app/src/lawoss/domains/roztriedenie/triage-page.tsx` (export `useText` ako `useTriageText`)
- Test: `apps/app/tests/lawoss-onboarding-found-screen.test.tsx`

**Interfaces:**
- Consumes: `found-flow.ts` (úloha 2), `found-text.ts` (úloha 3), `TriagePreviewView` a `triageApply`, `triageReplan` (roztriedenie), `OnboardingSuggestion` (C1).
- Produces:
  - `FoundLevel = "practice" | "client" | "matter"`
  - `FoundView(props)`: čisté zobrazenie fázy `question` (návrh, oprava, prax, otázka OKF, zoznam súborov)
  - `BatchView({ text, items, busy, onRetry, onContinue })`
  - `FoundScreen({ api, triage, identity, root, onAcknowledge, onDone, onChangeFolder, onError })`: `onAcknowledge()` uloží potvrdenie OKF (R3), `onDone(result?: OnboardingApplyResult)` ukončí tok

Fázy obrazovky:

| Fáza | Čo vidno | Ďalej |
|---|---|---|
| `loading` | „Prezerám priečinok…“ | `suggestOnboarding(root)` |
| `question` | návrh (klient, prax s počtom, vec, neznáme), výber „Toto je“, pri praxi rozsah a zoznam klientov so zaškrtávaním, pri veci návrh nadradeného klienta, oznámenie OKF, dve tlačidlá Nie/Áno | potvrdenie: `onAcknowledge()`, potom podľa voľby |
| `working` | priebeh „Pridávam OKF súbory: x z y“ | `addOkfFiles` alebo pri klientovi jeden `convert` |
| `batch` | súhrn, chyby, „Skúsiť znova neúspešných“ | pri „Áno“ fronta usporiadania, inak `onDone` |
| `reorganize` | `TriagePreviewView` pre aktuálneho klienta, „Tohto klienta preskočiť“ | po potvrdení `triageApply`, ďalší klient, nakoniec `onDone` |

- [ ] **Krok 1: Napíš padajúce testy**

```tsx
import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";
import { BatchView, FoundView } from "../src/lawoss/domains/onboarding/found-screen";
import { foundText } from "../src/lawoss/domains/onboarding/found-text";
import type { OnboardingSuggestion } from "../src/lawoss/domains/onboarding/api";

const base = (patch: Partial<OnboardingSuggestion>): OnboardingSuggestion => ({ root: "/p/Novák", level: "client", marked: false, score: 0.8, signals: [], clients: [], complete: true, ...patch });
const props = { text: foundText("sk"), busy: false, selected: [] as string[], scope: "client" as const, onLevel: () => undefined, onScope: () => undefined, onToggle: () => undefined, onAll: () => undefined, onAnswer: () => undefined, onChangeFolder: () => undefined };

describe("Toto som našiel", () => {
  test("klient: návrh, oznámenie OKF a obe odpovede", () => {
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({})} level="client" />);
    expect(html).toContain("Vyzerá to ako klient Novák.");
    expect(html).toContain("AGENTS.md");
    expect(html).toContain("Nie, len pridaj OKF súbory");
    expect(html).toContain("Áno, usporiadaj");
  });
  test("prax: počet, rozsah a zaškrtnutí klienti", () => {
    const clients = [{ path: "Alfa s. r. o.", name: "Alfa s. r. o." }, { path: "Beta a. s.", name: "Beta a. s." }];
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({ level: "practice", clients, clientPattern: "*" })} level="practice" selected={["Alfa s. r. o."]} />);
    expect(html).toContain("celá prax: 2 klientov");
    expect(html).toContain("Každý klient zvlášť");
    expect(html).toMatch(/type="checkbox"[^>]*checked=""[^>]*\/?>[^<]*<span>Alfa s\. r\. o\./);
  });
  test("celá prax ako jeden priečinok: Áno je vypnuté s vysvetlením", () => {
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({ level: "practice" })} level="practice" scope="practice" />);
    expect(html).toContain("Celú prax ako jeden priečinok usporiadať nejde");
    expect(html).toMatch(/<button[^>]*disabled=""[^>]*>Áno, usporiadaj/);
  });
  test("vec: ponúkne nadradeného klienta", () => {
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({ root: "/p/Novák/2024-03 Zmluva", level: "matter" })} level="matter" />);
    expect(html).toContain("Pripojiť klienta Novák");
  });
  test("oprava návrhu prepne voľby bez nového výberu priečinka", () => {
    const html = renderToStaticMarkup(<FoundView {...props} suggestion={base({ level: "practice" })} level="client" />);
    expect(html).toContain("Vyzerá to ako celá prax");
    expect(html).not.toContain("Každý klient zvlášť");
    expect(html).toContain("Nie, len pridaj OKF súbory");
  });
  test("súhrn hromadného spracovania so zlyhaním", () => {
    const html = renderToStaticMarkup(<BatchView text={foundText("sk")} busy={false} items={[{ root: "/a", name: "Alfa", status: "done" }, { root: "/z", name: "Zamknutý", status: "failed", error: "locked_file" }]} onRetry={() => undefined} onContinue={() => undefined} />);
    expect(html).toContain("Hotovo: 1 z 2");
    expect(html).toContain("Nepodarilo sa: Zamknutý (locked_file)");
    expect(html).toContain("Skúsiť znova neúspešných");
  });
});
```

Regulárne výrazy pre zaškrtnutý checkbox a pre `disabled` závisia od poradia a tvaru atribútov v Reacte (`disabled=""` alebo `disabled`). Ak test padne len na tvare atribútov, uprav regex tak, aby overoval to isté: riadok klienta „Alfa s. r. o.“ má zaškrtnuté políčko a „Beta a. s.“ nemá; tlačidlo „Áno, usporiadaj“ je pri celej praxi vypnuté.

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd apps/app && bun test tests/lawoss-onboarding-found-screen.test.tsx`
Expected: FAIL, modul neexistuje.

- [ ] **Krok 3: Export textov roztriedenia**

V `apps/app/src/lawoss/domains/roztriedenie/triage-page.tsx` zmeň `const useText = …` na `export const useTriageText = …` a v súbore nahraď volania `useText(` za `useTriageText(`.

- [ ] **Krok 4: Implementuj `found-screen.tsx`**

```tsx
/**
 * „Toto som našiel“ (spec 2026-10-08): návrh úrovne, oprava, prax, otázka OKF, hromadné pridanie
 * a usporiadanie po jednom klientovi. Spoločná pre onboarding aj bočný panel („Pridať priečinok“).
 */
import { useEffect, useState } from "react";
import { useLocale } from "@/i18n/use-locale";
import { triageApply, triageReplan, type TriageClient, type TriagePreview } from "../roztriedenie/api";
import { TriagePreviewView, useTriageText } from "../roztriedenie/triage-page";
import type { OnboardingApi, OnboardingApplyResult, OnboardingSuggestion } from "./api";
import { addOkfFiles, childPath, connectPractice, firstWorkspaceResult, folderName, parentPath, retryFailed, startReorganize, type BatchItem, type FoundIdentity } from "./found-flow";
import type { FoundTextKey } from "./found-text";

type Text = (key: FoundTextKey, params?: Record<string, string | number>) => string;
export type FoundLevel = "practice" | "client" | "matter";
type Answer = "no" | "yes";

const OKF_FILES = ["AGENTS.md", "CLAUDE.md", "client.md", "memory/", "_STATUS.md"];

function headline(text: Text, suggestion: OnboardingSuggestion): string {
  if (suggestion.level === "practice") return text("practiceFound", { count: suggestion.clients.length });
  if (suggestion.level === "client") return text("clientFound", { name: folderName(suggestion.root) });
  if (suggestion.level === "matter") return text("matterFound", { name: folderName(suggestion.root) });
  return text("unknownFound");
}

type ViewProps = {
  text: Text; busy: boolean; suggestion: OnboardingSuggestion; level: FoundLevel;
  scope: "client" | "practice"; selected: readonly string[];
  onLevel: (level: FoundLevel) => void; onScope: (scope: "client" | "practice") => void;
  onToggle: (path: string) => void; onAll: (all: boolean) => void;
  onAnswer: (answer: Answer) => void; onChangeFolder: () => void;
};

export function FoundView({ text, busy, suggestion, level, scope, selected, onLevel, onScope, onToggle, onAll, onAnswer, onChangeFolder }: ViewProps) {
  const yesDisabled = level === "practice" && scope === "practice";
  const parentName = folderName(parentPath(suggestion.root));
  return (
    <div className="grid gap-5" data-lawoss-found>
      <h2 className="text-xl font-semibold">{text("foundTitle")}</h2>
      <p>{headline(text, suggestion)}</p>
      {!suggestion.complete ? <p className="lw-status warn">{text("incomplete")}</p> : null}
      <label className="grid gap-1.5 text-sm font-medium">
        {text("correctLabel")}
        <select className="lw-onb-select" value={level} disabled={busy} onChange={(event) => { const value = event.target.value; if (value === "practice" || value === "client" || value === "matter") onLevel(value); }}>
          <option value="client">{text("asClient")}</option>
          <option value="practice">{text("asPractice")}</option>
          <option value="matter">{text("asMatter")}</option>
        </select>
      </label>
      {level === "matter" ? (
        <div className="lw-onb-inset grid gap-2">
          <p>{text("matterHint", { name: parentName })}</p>
          <div><button type="button" className="lw-btn gold" disabled={busy} onClick={() => onAnswer("no")}>{text("useParent", { name: parentName })}</button></div>
        </div>
      ) : null}
      {level === "practice" ? (
        <fieldset className="grid gap-2">
          <legend className="font-semibold">{text("scopeTitle")}</legend>
          {(["client", "practice"] as const).map((value) => (
            <label key={value} className="lw-onb-inset flex gap-3">
              <input type="radio" name="lawoss-scope" checked={scope === value} disabled={busy} onChange={() => onScope(value)} />
              <span><strong>{text(value === "client" ? "scopeEach" : "scopeOne")}</strong><br /><span className="text-muted-foreground">{text(value === "client" ? "scopeEachHint" : "scopeOneHint")}</span></span>
            </label>
          ))}
        </fieldset>
      ) : null}
      {level === "practice" && scope === "client" && suggestion.clients.length ? (
        <fieldset className="grid gap-1">
          <legend className="font-semibold">{text("clientsTitle")}</legend>
          <div className="flex gap-2">
            <button type="button" className="lw-btn" disabled={busy} onClick={() => onAll(true)}>{text("selectAll")}</button>
            <button type="button" className="lw-btn" disabled={busy} onClick={() => onAll(false)}>{text("selectNone")}</button>
          </div>
          {suggestion.clients.map((client) => (
            <label key={client.path} className="flex gap-2"><input type="checkbox" checked={selected.includes(client.path)} disabled={busy} onChange={() => onToggle(client.path)} /><span>{client.name}</span></label>
          ))}
        </fieldset>
      ) : null}
      {level !== "matter" ? (
        <section className="grid gap-3">
          <h3 className="font-semibold">{text("reorganizeQuestion")}</h3>
          <p className="text-muted-foreground">{text("okfNotice")}</p>
          <p className="text-sm"><strong>{text("filesTitle")}:</strong> {OKF_FILES.join(", ")}</p>
          <div className="lw-onb-choices">
            <section className="lw-onb-choice">
              <h3>{text("answerNo")}</h3>
              <p>{text("answerNoHint")}</p>
              <button type="button" className="lw-btn gold" disabled={busy} onClick={() => onAnswer("no")}>{text("answerNo")}</button>
            </section>
            <section className="lw-onb-choice">
              <h3>{text("answerYes")}</h3>
              <p>{yesDisabled ? text("answerYesDisabled") : text(level === "practice" ? "answerYesPractice" : "answerYesHint")}</p>
              <button type="button" className="lw-btn" disabled={busy || yesDisabled} onClick={() => onAnswer("yes")}>{text("answerYes")}</button>
            </section>
          </div>
          <p className="text-xs text-muted-foreground">{text("acknowledge")}</p>
        </section>
      ) : null}
      <div><button type="button" className="lw-btn" disabled={busy} onClick={onChangeFolder}>{text("changeFolder")}</button></div>
    </div>
  );
}

export function BatchView({ text, busy, items, onRetry, onContinue }: { text: Text; busy: boolean; items: readonly BatchItem[]; onRetry: () => void; onContinue: () => void }) {
  const done = items.filter(item => item.status === "done").length;
  const failed = items.filter(item => item.status === "failed");
  const pending = items.some(item => item.status === "pending");
  return (
    <div className="grid gap-3" data-lawoss-batch>
      <p role="status">{pending ? text("working", { done, total: items.length }) : text("batchDone", { done, total: items.length })}</p>
      {failed.map(item => <p key={item.root} className="lw-status err">{text("batchFailed", { name: item.name, error: item.error ?? "" })}</p>)}
      {!pending ? (
        <div className="flex gap-2">
          {failed.length ? <button type="button" className="lw-btn" disabled={busy} onClick={onRetry}>{text("retry")}</button> : null}
          <button type="button" className="lw-btn gold" disabled={busy} onClick={onContinue}>{text("open")}</button>
        </div>
      ) : null}
    </div>
  );
}

type Props = {
  api: Pick<OnboardingApi, "planOnboarding" | "applyOnboarding" | "updateOnboardingProfile" | "suggestOnboarding">;
  triage: TriageClient;
  identity: FoundIdentity;
  text: Text;
  root: string;
  onAcknowledge: () => Promise<void>;
  onDone: (result?: OnboardingApplyResult) => Promise<void> | void;
  onChangeFolder: () => void;
  onError: (reason: unknown) => void;
};

type Phase =
  | { name: "loading" }
  | { name: "question"; suggestion: OnboardingSuggestion }
  | { name: "batch"; items: BatchItem[]; answer: Answer }
  | { name: "reorganize"; queue: BatchItem[]; preview: TriagePreview; result?: OnboardingApplyResult };

export function FoundScreen({ api, triage, identity, text, root, onAcknowledge, onDone, onChangeFolder, onError }: Props) {
  const locale = useLocale();
  const triageText = useTriageText(locale);
  const [phase, setPhase] = useState<Phase>({ name: "loading" });
  const [level, setLevel] = useState<FoundLevel>("client");
  const [scope, setScope] = useState<"client" | "practice">("client");
  const [selected, setSelected] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const today = new Date();

  useEffect(() => {
    let cancelled = false;
    const suggest = api.suggestOnboarding;
    if (!suggest) { onError(new Error("suggest_unavailable")); return; }
    setPhase({ name: "loading" });
    void suggest({ root }).then((suggestion) => {
      if (cancelled) return;
      setLevel(suggestion.level === "practice" || suggestion.level === "matter" ? suggestion.level : "client");
      setSelected(suggestion.clients.map(client => client.path));
      setPhase({ name: "question", suggestion });
    }).catch(onError);
    return () => { cancelled = true; };
  }, [api, root]);

  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    try { await work(); } catch (reason) { onError(reason); } finally { setBusy(false); }
  };

  /** Ďalší klient vo fronte usporiadania, alebo koniec toku. */
  const nextReorganize = async (queue: BatchItem[], result?: OnboardingApplyResult) => {
    const [current, ...rest] = queue;
    if (!current) { await onDone(result); return; }
    const preview = await startReorganize(triage, current.result?.clientRoot ?? current.root);
    setPhase({ name: "reorganize", queue: [current, ...rest], preview, result });
  };

  const answer = (suggestion: OnboardingSuggestion, choice: Answer) => run(async () => {
    await onAcknowledge();
    if (level === "practice") {
      await connectPractice(api, suggestion.root, identity, suggestion, scope);
      if (scope === "practice") {
        // Celá prax ako jeden priečinok (P5): zaregistruje ju volajúci cez onDone bez výsledku klienta.
        await onDone({ result: "applied", root: suggestion.root });
        return;
      }
      const items = suggestion.clients.filter(client => selected.includes(client.path)).map(client => ({ root: childPath(suggestion.root, client.path), name: client.name }));
      const batch = await addOkfFiles(api, items, identity, today, (next) => setPhase({ name: "batch", items: next, answer: choice }));
      setPhase({ name: "batch", items: batch, answer: choice });
      return;
    }
    const target = level === "matter" ? parentPath(suggestion.root) : suggestion.root;
    const batch = await addOkfFiles(api, [{ root: target, name: folderName(target) }], identity, today, (next) => setPhase({ name: "batch", items: next, answer: choice }));
    if (batch[0]?.status === "done" && choice === "no") { await onDone(batch[0].result); return; }
    if (batch[0]?.status === "done" && choice === "yes") { await nextReorganize(batch, batch[0].result); return; }
    setPhase({ name: "batch", items: batch, answer: choice });
  });

  if (phase.name === "loading") return <p role="status">{text("looking")}</p>;
  if (phase.name === "question") {
    return (
      <FoundView
        text={text} busy={busy} suggestion={phase.suggestion} level={level} scope={scope} selected={selected}
        onLevel={setLevel} onScope={setScope}
        onToggle={(path) => setSelected((current) => current.includes(path) ? current.filter(item => item !== path) : [...current, path])}
        onAll={(all) => setSelected(all ? phase.suggestion.clients.map(client => client.path) : [])}
        onAnswer={(choice) => void answer(phase.suggestion, choice)}
        onChangeFolder={onChangeFolder}
      />
    );
  }
  if (phase.name === "batch") {
    const continueBatch = () => run(async () => {
      const done = phase.items.filter(item => item.status === "done");
      if (phase.answer === "yes") await nextReorganize(done, firstWorkspaceResult(phase.items));
      else await onDone(firstWorkspaceResult(phase.items));
    });
    return <BatchView text={text} busy={busy} items={phase.items} onRetry={() => void run(async () => setPhase({ name: "batch", items: await retryFailed(api, phase.items, identity, today, (next) => setPhase({ name: "batch", items: next, answer: phase.answer })), answer: phase.answer }))} onContinue={() => void continueBatch()} />;
  }
  const [current, ...rest] = phase.queue;
  return (
    <div className="grid gap-3" data-lawoss-reorganize>
      <h2 className="text-xl font-semibold">{text("reorganizeFor", { name: current?.name ?? "" })}</h2>
      <TriagePreviewView
        preview={phase.preview} text={triageText} busy={busy}
        onKeep={(id, keep) => void run(async () => {
          const keepInInbox = keep ? [...phase.preview.keepInInbox, id] : phase.preview.keepInInbox.filter(item => item !== id);
          setPhase({ ...phase, preview: await triageReplan(triage, phase.preview.id, keepInInbox) });
        })}
        onConfirm={() => void run(async () => { await triageApply(triage, phase.preview); await nextReorganize(rest, phase.result); })}
        onModel={() => undefined}
      />
      <div><button type="button" className="lw-btn" disabled={busy} onClick={() => void run(() => nextReorganize(rest, phase.result))}>{rest.length ? text("skipClient") : text("finish")}</button></div>
    </div>
  );
}
```

Poznámky pre implementátora:
- `onModel` je v `TriagePreviewView` povinný; model sa v onboardingu nepoužíva (prepínač sa zobrazí len pri `proposal.state === "ready"`, čo pri prvom usporiadaní nenastane).
- Fáza `question` pri `level === "matter"`: tlačidlo „Pripojiť klienta …“ volá `onAnswer("no")` a `answer` pre `level === "matter"` pripojí rodiča (`parentPath`), nie vec. Usporiadať ho advokát môže neskôr cez „Usporiadať podľa OKF“.
- Cesta klienta praxe sa skladá z koreňa praxe a relatívnej cesty z návrhu (`childPath`), nie z mena.
- Efekt s `suggestOnboarding` má zámerne závislosti `[api, root]`. `onError` z volajúceho je nová funkcia pri každom vykreslení; keby bol v závislostiach, návrh by sa volal stále dookola. Ak lint pravidlo `react-hooks/exhaustive-deps` hlási chybu, obal `onError` vo volajúcom (`lawoss-welcome-page.tsx`, úloha 6) do `useCallback` a až potom ho pridaj do závislostí.

- [ ] **Krok 5: Spusti testy, typecheck, commit**

Run: `cd apps/app && bun test tests/lawoss-onboarding-found-screen.test.tsx tests/lawoss-triage-ui.test.tsx && pnpm typecheck`
Expected: PASS.

```bash
git add apps/app/src/lawoss/domains/onboarding/found-screen.tsx apps/app/src/lawoss/domains/roztriedenie/triage-page.tsx apps/app/tests/lawoss-onboarding-found-screen.test.tsx
git commit -m "feat: obrazovka Toto som našiel s otázkou OKF, praxou a usporiadaním po klientoch"
```

---

### Úloha 6: Zapojenie do onboardingu (`lawoss-welcome-page.tsx`)

**Files:**
- Modify: `apps/app/src/lawoss/domains/onboarding/lawoss-welcome-page.tsx`
- Modify: `apps/app/tests/lawoss-onboarding-okf-choice.test.tsx` (premenovať na `lawoss-onboarding-welcome.test.tsx` a prepísať časti o krokoch)
- Test: `apps/app/tests/lawoss-onboarding-welcome.test.tsx`

**Interfaces:**
- Consumes: `FolderStep` (úloha 4), `FoundScreen` (úloha 5), `foundText`, `okfChoice`, `MAIN_ONBOARDING_PATH` (úloha 1).
- Produces:
  - `WelcomeApi` rozšírené o `Pick<LegalworkServerClient, "lawossTriage">` (čiastočne, ako ostatné)
  - nový prop `initialRoot?: string` (z `?root=`): otvorí rovno „Toto som našiel“
  - vetvy: `identity` → `move("ai")`; `ai` vždy s `onContinue` → `move("folder")`; `folder` → `FolderStep` alebo `FoundScreen`

- [ ] **Krok 1: Napíš padajúce testy**

Premenuj `apps/app/tests/lawoss-onboarding-okf-choice.test.tsx` na `apps/app/tests/lawoss-onboarding-welcome.test.tsx` (`git mv`) a:
- odstráň testy `OkfChoiceStep`, `WorkingFolderStep` a `clientsFolderOf` (komponenty odchádzajú, pozri krok 3);
- ponechaj testy posúvacej oblasti a pásu na ťahanie okna (uprav `initialStep` na `"folder"`);
- pridaj:

```tsx
test("onboarding má tri kroky a krok Priečinok ponúkne obe voľby", () => {
  const html = renderToStaticMarkup(<MemoryRouter><LawossWelcomePage api={api} initialStep="folder" pickDirectory={async () => null} onOpenAiSettings={() => {}} onComplete={() => {}} /></MemoryRouter>);
  expect(html).toContain("repeat(3, minmax(0, 1fr))");
  expect(html).toContain("Pripojiť existujúci priečinok");
  expect(html).toContain("Začať nanovo");
});
test("krok AI sa dá preskočiť", () => {
  const html = renderToStaticMarkup(<MemoryRouter><LawossWelcomePage api={api} initialStep="ai" pickDirectory={async () => null} onOpenAiSettings={() => {}} onComplete={() => {}} /></MemoryRouter>);
  expect(html).toMatch(/Pokračovať bez modelu|Teraz preskočiť/);
});
```

Falošné `api` v súbore doplň o `suggestOnboarding: async () => ({ root: "/x", level: "client", marked: false, score: 0.5, signals: [], clients: [], complete: true })`. `renderToStaticMarkup` nespúšťa efekty, takže sa vykreslí `initialStep` a `locale` predvolený pre testy (over, či je slovenčina; ak je angličtina, porovnávaj anglické texty z `found-text.ts`).

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd apps/app && bun test tests/lawoss-onboarding-welcome.test.tsx`
Expected: FAIL (`repeat(3` chýba, krok `folder` sa nevykreslí).

- [ ] **Krok 3: Implementuj v `lawoss-welcome-page.tsx`**

1. Importy: odstráň `PacksStep` (súbor `packs-step.tsx` ostáva, používa ho Marketplace), pridaj `FolderStep` z `./folder-step`, `FoundScreen` z `./found-screen`, `foundText` z `./found-text`, `okfChoice` (už importované) a typ `TriageClient` z `../roztriedenie/api`.
2. `WelcomeApi`: `Pick<LegalworkServerClient, "listWorkspaces" | "lawossMarketplace" | "lawossTriage">`.
3. `Props`: pridaj `initialRoot?: string`.
4. Stav: `const [foundRoot, setFoundRoot] = useState<string | null>(initialRoot ?? null);` a `const found = foundText(locale);`.
5. V `Identity.onSave`: `await move("okf")` zmeň na `await move("ai")`.
6. Vetvu `step === "okf"` (komponent `OkfChoiceStep`; od úlohy 1 volá dočasne `move("folder", { okf: okfChoice(enabled, new Date()) })`), vetvu `step === "office"` (komponent `Office`) a vetvu `step === "packs"` odstráň. Kľúč `folder` v slovníku `text` pridala úloha 3.
7. Vetvu `step === "ai"` nahraď:

```tsx
          {step === "ai" ? (
            <>
              <h2 className="text-xl font-semibold">{tr("ai")}</h2>
              <p className="text-muted-foreground">{tr("aiText")}</p>
              <OnboardingAiPanel
                locale={locale}
                busy={busy}
                onOpenAiSettings={onOpenAiSettings}
                onContinue={() => void move("folder")}
              />
            </>
          ) : null}
```

8. Pridaj vetvu kroku Priečinok (za vetvu `ai`):

```tsx
          {(step === "folder" || step === "found") && api.lawossTriage ? (
            foundRoot ? (
              <FoundScreen
                api={api}
                triage={{ lawossTriage: api.lawossTriage }}
                identity={{ lawyerName: base.lawyerName, jurisdiction: base.jurisdiction, language: base.language }}
                text={found}
                root={foundRoot}
                onAcknowledge={async () => {
                  // R3: OKF je vždy zapnuté; prvé potvrdenie na tejto obrazovke je vzatie oznámenia na vedomie.
                  setProfile(await api.updateOnboardingProfile({ okf: okfChoice(true, new Date()), step: "found" }));
                }}
                onDone={async (result) => { setCompletedResult(result); await onComplete(result, completion()); }}
                onChangeFolder={() => setFoundRoot(null)}
                onError={(reason) => setError(onboardingErrorMessage(reason, locale))}
              />
            ) : (
              <FolderStep
                api={api}
                identity={{ lawyerName: base.lawyerName, jurisdiction: base.jurisdiction, language: base.language }}
                text={found}
                pickDirectory={pickDirectory}
                onFound={(root) => setFoundRoot(root)}
                onFreshDone={() => void onComplete(undefined, completion())}
                onError={(reason) => setError(onboardingErrorMessage(reason, locale))}
              />
            )
          ) : null}
```

   Ak `api.lawossTriage` chýba (testovacia náhrada bez neho), krok Priečinok sa nevykreslí; v testoch preto doplň `lawossTriage` do falošného API.
9. Odstráň komponenty, ktoré po zmene nikto nepoužíva: `Office`, `WorkingFolderStep`, `OkfChoiceStep` (a slovník `okfNotice`), `clientsFolderOf`, stav `workingFolder` a funkciu `completion` zjednoduš na `() => undefined`, ak už nič nenastavuje `workingFolder`. Pred odstránením over `git grep -n "OkfChoiceStep\|WorkingFolderStep\|clientsFolderOf\|okfNotice" apps/app` a odstráň len to, čo nemá iné použitie.
10. V `apply()` (spoločný náhľad pre `?continue=client|matter`) zmeň ďalší krok po `office` z `"packs"` na `"done"` (kancelária sa v onboardingu už nezakladá, ale funkcia `apply` ju vie dokončiť pri obnove starého náhľadu).
11. Hlavička krokov: pri `step === "client"` alebo `"matter"` (formuláre z bočného panela) skry `<ol className="lw-onb-steps">`, lebo tieto kroky nie sú na hlavnej ceste.

- [ ] **Krok 4: Spusti testy a typecheck**

Run: `cd apps/app && bun test tests/lawoss-onboarding-welcome.test.tsx tests/lawoss-onboarding-matter-client.test.tsx tests/lawoss-onboarding-attach-existing.test.tsx tests/lawoss-onboarding-okf-steps.test.ts tests/lawoss-marketplace-updates.test.tsx && pnpm typecheck`
Expected: PASS. Testy, ktoré overovali odstránené komponenty (`attach-existing` pre `Client` ostáva), uprav len tam, kde testujú odstránené časti; zapíš ich do správy.

- [ ] **Krok 5: Commit**

```bash
git add -A apps/app/src/lawoss/domains/onboarding/lawoss-welcome-page.tsx apps/app/tests/lawoss-onboarding-welcome.test.tsx apps/app/tests/lawoss-onboarding-okf-choice.test.tsx
git commit -m "feat: onboarding Ty, AI, Priečinok s obrazovkou Toto som našiel"
```

---

### Úloha 7: Trasa `/welcome`, bočný panel a vstupy „Pridať priečinok“ a „Usporiadať podľa OKF“

**Files:**
- Modify: `apps/app/src/react-app/shell/welcome-route.tsx` (upstream; `continuationStep`, `root`, `initialRoot`)
- Modify: `apps/app/src/lawoss/lite/links.ts` (`ATTACH_EXISTING_CLIENT_PATH`, nové `ADD_FOLDER_PATH`, `organizeFolderLink`)
- Modify: `apps/app/src/lawoss/domains/onboarding/entry-actions.tsx` (`ENABLE_OKF_ROUTE`, odstránenie `EnableOkfAction` z panela, nové tlačidlá)
- Modify: `PATCHES.md` (riadok `welcome-route.tsx`)
- Test: `apps/app/tests/lawoss-onboarding-attach-existing.test.tsx`, `apps/app/tests/lawoss-onboarding-enable-okf.test.tsx`

**Interfaces:**
- Produces:
  - `ADD_FOLDER_PATH = "/welcome?continue=folder"`; `ATTACH_EXISTING_CLIENT_PATH = ADD_FOLDER_PATH`
  - `organizeFolderLink(root: string): string` = `/welcome?continue=folder&root=<encoded>`
  - `ENABLE_OKF_ROUTE = ADD_FOLDER_PATH`
  - `continuationStep`: `existing`, `okf`, `folder` → `"folder"`; `client`, `matter` ostávajú
  - `OnboardingEntryActions`: Pridať priečinok (FolderInput), Usporiadať podľa OKF (FolderTree, len pri aktívnom priečinku), Pridať klienta, Nová vec

- [ ] **Krok 1: Napíš padajúce testy**

V `apps/app/tests/lawoss-onboarding-attach-existing.test.tsx` uprav očakávanie trasy: `ATTACH_EXISTING_CLIENT_PATH` je `"/welcome?continue=folder"`. Pridaj:

```ts
test("odkaz na usporiadanie priečinka nesie zakódovanú cestu", () => {
  expect(organizeFolderLink("/Users/a/Klienti/Novák s.r.o")).toBe("/welcome?continue=folder&root=%2FUsers%2Fa%2FKlienti%2FNov%C3%A1k%20s.r.o");
});
```

V `apps/app/tests/lawoss-onboarding-enable-okf.test.tsx` uprav: `ENABLE_OKF_ROUTE` je `"/welcome?continue=folder"`; test, ktorý čakal tlačidlo „Zapnúť OKF“ v `OnboardingEntryActions`, prepíš na očakávanie, že v kompaktnom paneli tlačidlo „Zapnúť OKF“ nie je a je tam „Pridať priečinok“.

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd apps/app && bun test tests/lawoss-onboarding-attach-existing.test.tsx tests/lawoss-onboarding-enable-okf.test.tsx`
Expected: FAIL.

- [ ] **Krok 3: Implementuj**

`apps/app/src/lawoss/lite/links.ts`:

```ts
/** Pripojiť priečinok (klient, prax, vec) cez obrazovku „Toto som našiel“ (spec 2026-10-08). */
export const ADD_FOLDER_PATH = "/welcome?continue=folder";
/** Staré meno pre tlačidlá „Pripojiť existujúci priečinok klienta“; vedie na ten istý tok. */
export const ATTACH_EXISTING_CLIENT_PATH = ADD_FOLDER_PATH;
/** „Usporiadať podľa OKF“ pre už pripojený priečinok: rovno obrazovka „Toto som našiel“. */
export const organizeFolderLink = (root: string): string => `${ADD_FOLDER_PATH}&root=${encodeURIComponent(root)}`;
```

`apps/app/src/lawoss/domains/onboarding/entry-actions.tsx`:
1. `export const ENABLE_OKF_ROUTE = ADD_FOLDER_PATH;` (import z `../../lite/links`).
2. V `labels` pridaj `folder` a `organize` (en: "Add folder", "Organise by OKF"; sk: "Pridať priečinok", "Usporiadať podľa OKF"; cs: "Přidat složku", "Uspořádat podle OKF"; de: "Ordner hinzufügen", "Nach OKF ordnen").
3. V `OnboardingEntryActions` odstráň `<EnableOkfAction …/>`. Tlačidlo s `FolderInput` presmeruj na `ADD_FOLDER_PATH` s textom `text.folder`. Za neho pridaj tlačidlo „Usporiadať podľa OKF“ (ikona `FolderTree`), ktoré sa zobrazí len pri aktívnom priečinku:

```tsx
  const { connection } = useOkfConnection();
  const active = activeWorkspace(connection);
  …
      {active?.path ? (
        <Button variant="outline" size={compact ? "icon-xs" : "sm"} onClick={() => navigate(organizeFolderLink(active.path))} aria-label={text.organize} title={text.organize}>
          <FolderTree className="size-4" />
          {compact ? null : <span>{text.organize}</span>}
        </Button>
      ) : null}
```

   (`useOkfConnection` a `activeWorkspace` z `../../okf/read-model`; over, že `RouteWorkspace` má pole `path`.) `EnableOkfAction` a `useOkfOffered` ponechaj exportované len ak ich niečo iné používa (`git grep`); inak odstráň.

`apps/app/src/react-app/shell/welcome-route.tsx`:

```ts
// LAWOSS: pripojenie priečinka (aj staré `existing` a `okf`) otvorí krok Priečinok; `root` rovno „Toto som našiel“.
const continuationStep = (value: string | null): OnboardingStep | undefined =>
  value === "existing" || value === "okf" || value === "folder" ? "folder" : value === "client" || value === "matter" ? value : undefined;
```

a do `LawossWelcomePage` pridaj prop `initialRoot={new URLSearchParams(location.search).get("root") ?? undefined}`. Prop `attachExisting` odstráň, ak ho komponent po úlohe 6 už nemá; inak ho nechaj.

V `onComplete` vo `welcome-route.tsx`: pri celej praxi ako jednom priečinku príde `result` bez `workspace` a s `root` praxe. Doplň za výpočet `plain`:

```ts
    // LAWOSS: celá prax ako jeden priečinok (spec P5) sa zaregistruje ako priečinok s vlastnými súbormi appky.
    const practice = !result?.workspace && result?.root && !result.clientRoot ? await registerWorkingFolder(client, result.root) : undefined;
    const workspace = result?.workspace ?? plain ?? practice ?? list.items.find(item => item.path === status.profile?.clientRoot);
```

(a pôvodný riadok `const workspace = …` nahraď týmto). „Začať nanovo“ volá `onComplete(undefined)` (úloha 6), takže sa nezaregistruje nič: appka ide na domov s interným domovským priestorom (plán B), kým advokát nepridá prvého klienta. Výsledok kancelárie by mal `root` = `…/Office`, ktorý ako pracovný priečinok nedáva zmysel.

`PATCHES.md`: rozšír existujúci riadok `apps/app/src/react-app/shell/welcome-route.tsx` o „`?continue=folder|existing|okf` otvorí krok Priečinok, `root` rovno obrazovku Toto som našiel; prax ako jeden priečinok sa po onboardingu zaregistruje (spec 2026-10-08)“.

- [ ] **Krok 4: Spusti testy, typecheck, commit**

Run: `cd apps/app && bun test tests/lawoss-onboarding-attach-existing.test.tsx tests/lawoss-onboarding-enable-okf.test.tsx tests/lawoss-onboarding-welcome.test.tsx && pnpm typecheck`
Expected: PASS.

```bash
git add apps/app/src/react-app/shell/welcome-route.tsx apps/app/src/lawoss/lite/links.ts apps/app/src/lawoss/domains/onboarding/entry-actions.tsx PATCHES.md apps/app/tests/lawoss-onboarding-attach-existing.test.tsx apps/app/tests/lawoss-onboarding-enable-okf.test.tsx
git commit -m "feat: Pridať priečinok a Usporiadať podľa OKF v bočnom paneli"
```

---

### Úloha 8: Stránka roztriedenia pre priečinok na mieste

**Files:**
- Modify: `apps/app/src/lawoss/domains/roztriedenie/triage-page.tsx` (`TriageFlow`: stav, vrátenie, texty)
- Modify: `apps/app/src/lawoss/i18n/shell.ts` (kľúče `lawoss.triage.*` pre sk, cs, en, de)
- Test: `apps/app/tests/lawoss-triage-ui.test.tsx`

**Interfaces:**
- Consumes: `TriageStatus.mode`, `TriageUndoResult.kept` (C1).
- Produces: `TriageUndoSummary({ text, result })` (export pre test): po vrátení zobrazí počet vrátených a zoznam ponechaných dokumentov.

- [ ] **Krok 1: Napíš padajúci test**

```tsx
test("po vrátení na mieste sa ukážu ponechané dokumenty", () => {
  const html = renderToStaticMarkup(<TriageUndoSummary text={(key, params) => `${key}${params ? JSON.stringify(params) : ""}`} result={{ status: "undone", runId: "triage-20261008-100000-abcdef", restored: 3, removed: 2, kept: ["05_Komunikacia/odpoved.eml"] }} />);
  expect(html).toContain("undo_restored{\"count\":3}");
  expect(html).toContain("05_Komunikacia/odpoved.eml");
});
```

- [ ] **Krok 2: Over, že test padá**

Run: `cd apps/app && bun test tests/lawoss-triage-ui.test.tsx -t ponechané`
Expected: FAIL.

- [ ] **Krok 3: Implementuj**

V `triage-page.tsx`:

```tsx
/** Súhrn vrátenia: koľko sa vrátilo a ktoré dokumenty ostali, lebo ich advokát medzitým zmenil (spec). */
export function TriageUndoSummary({ text, result }: { text: Text; result: TriageUndoResult }) {
  return (
    <div className="grid gap-1" role="status">
      <p>{text("undo_restored", { count: result.restored })}</p>
      {result.kept.length ? (
        <>
          <p>{text("undo_kept")}</p>
          <ul className="list-disc pl-5">{result.kept.map(path => <li key={path}>{path}</li>)}</ul>
        </>
      ) : null}
    </div>
  );
}
```

V `TriageFlow` po úspešnom `triageUndo` ulož výsledok do stavu a vykresli `TriageUndoSummary` v paneli po vrátení. Hlášku „toto nie je skúšobný klon“ (`TriageEmpty` pre `trial: false`) nahraď textom `not_reorganizable` s odkazom na `organizeFolderLink(root)` („Usporiadať podľa OKF“). Pri `status.mode === "in_place"` zobraz nadpis `in_place_title` namiesto textu o klone.

V `apps/app/src/lawoss/i18n/shell.ts` pridaj do blokov en, sk, cs, de kľúče:

| Kľúč | sk | cs | en | de |
|---|---|---|---|---|
| `lawoss.triage.undo_restored` | `Vrátené dokumenty: {count}.` | `Vrácené dokumenty: {count}.` | `Documents returned: {count}.` | `Zurückgesetzte Dokumente: {count}.` |
| `lawoss.triage.undo_kept` | `Tieto dokumenty ostali na novom mieste, lebo ste ich medzitým zmenili:` | `Tyto dokumenty zůstaly na novém místě, protože jste je mezitím změnili:` | `These documents stayed in their new place because you changed them in the meantime:` | `Diese Dokumente blieben am neuen Ort, weil Sie sie inzwischen geändert haben:` |
| `lawoss.triage.not_reorganizable` | `Tento priečinok zatiaľ nie je pripravený na usporiadanie.` | `Tato složka zatím není připravená k uspořádání.` | `This folder is not ready to be organised yet.` | `Dieser Ordner ist noch nicht zum Ordnen bereit.` |
| `lawoss.triage.in_place_title` | `Usporiadanie priečinka klienta` | `Uspořádání složky klienta` | `Organising the client folder` | `Ordnen des Mandantenordners` |

Over formát parametrov v `t()` (`{count}` alebo `{{count}}`) podľa existujúcich kľúčov `lawoss.triage.*` a prispôsob.

- [ ] **Krok 4: Spusti testy, i18n audit, typecheck, commit**

Run: `cd apps/app && bun test tests/lawoss-triage-ui.test.tsx && pnpm typecheck`
Run: `cd ../.. && node scripts/i18n-audit.mjs` (alebo príkaz zo skriptov koreňového `package.json`, ak sa volá inak)
Expected: PASS, audit bez chýbajúcich kľúčov.

```bash
git add apps/app/src/lawoss/domains/roztriedenie/triage-page.tsx apps/app/src/lawoss/i18n/shell.ts apps/app/tests/lawoss-triage-ui.test.tsx
git commit -m "feat: roztriedenie priečinka na mieste ukáže ponechané dokumenty po vrátení"
```

---

### Úloha 9: Overenie na zabalenej appke (D1)

**Files:** bez zmien kódu; výsledky do popisu PR a do `docs/lawoss-d1-onboarding-priecinok-2026-10.md` (nový dokument).

- [ ] **Krok 1: Zabal appku**

Run: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && pnpm install --frozen-lockfile && pnpm --filter @legalwork/desktop package:electron:dir`

- [ ] **Krok 2: Syntetické dáta a izolovaný profil**

V scratchpade priečinok `P` s `home/{.config,.local/share,.local/state,.cache}`, `userdata`, `touch $P/marker` a syntetické priečinky (vymyslené mená, žiadne reálne dáta):
- `Prax/` so 6 klientmi (`Alfa s. r. o.`, `Beta a. s.`, `Gama s.r.o.`, `Delta k. s.`, `Novák Ján/2024-03 Kúpna zmluva`, `Zamknutý klient`) a v každom 3 až 5 dokumentov (`.pdf`, `.docx`, `.eml` s názvami ako `Zmluva_v2.docx`, `Rozsudok 8C_1_2024.pdf`);
- `Samostatný klient/` s 8 dokumentmi a podpriečinkom `2025-01 Spor`;
- prázdny `Nová prax/`.

Spúšťač:

```bash
HOME=$P/home XDG_CONFIG_HOME=$P/home/.config XDG_DATA_HOME=$P/home/.local/share XDG_STATE_HOME=$P/home/.local/state XDG_CACHE_HOME=$P/home/.cache LEGALWORK_ELECTRON_USERDATA=$P/userdata LEGALWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY=1 apps/desktop/dist-electron/mac-arm64/LAWOSS.app/Contents/MacOS/LAWOSS
```

- [ ] **Krok 3: Prejdi tri cesty a zaznamenaj PASS/FAIL**

1. **Klient:** Ty → AI (preskočiť) → Priečinok → Pripojiť existujúci → `Samostatný klient` → návrh „klient“ → „Áno, usporiadaj“ → náhľad presunov → potvrdiť → appka otvorí klienta; v `Samostatný klient` sú `AGENTS.md`, `CLAUDE.md`, `client.md`, `memory/`; na stránke Roztriedenie „Vrátiť“ vráti stav.
2. **Prax:** v bočnom paneli Pridať priečinok → `Prax` → návrh „celá prax: 6 klientov“ → „Každý klient zvlášť“ → odznačiť `Zamknutý klient` → „Nie“ → súhrn 5 z 5 → v bočnom paneli 5 klientov, `lawoss-domov` nikde; `Prax/AGENTS.md` bez mien klientov.
3. **Začať nanovo:** Pridať priečinok… (alebo nový profil) → Začať nanovo → `Nová prax` → `Office/`, `Klienti/`, `AGENTS.md`; návod na migráciu; skopírovať `Samostatný klient` do `Nová prax/Klienti/` → Pridať priečinok → klient → „Nie“.

- [ ] **Krok 4: Zatvorenie a kontrola profilu**

Zatvor appku **Cmd+Q** (alebo `osascript -e 'tell application id "com.eigenweltlabs.legalwork" to quit'`), **nikdy `pkill`**. Potom:

```bash
pgrep -fl "MacOS/LAWOSS" || echo "nič nebeží"
find ~/.config/legalwork ~/.config/opencode ~/.legalwork -newer $P/marker 2>/dev/null
```

Oba výstupy musia byť prázdne (prvý vypíše „nič nebeží“). Ak niečo beží, over jeho `HOME` (`ps -E -p <pid> -o command= | tr ' ' '\n' | grep ^HOME=`) a nahlás to skôr, než čokoľvek zastavíš.

- [ ] **Krok 5: Dokument a PR**

Výsledky zapíš do `docs/lawoss-d1-onboarding-priecinok-2026-10.md` (cesty, PASS/FAIL, snímky obrazoviek „Toto som našiel“ pre klienta a prax) a otvor PR do `dev` s odkazom na spec PR #92, plán C2 a tabuľku rozhodnutí R1 až R6 na potvrdenie MČ.

```bash
git add docs/lawoss-d1-onboarding-priecinok-2026-10.md
git commit -m "docs: D1 onboardingu cez priečinok na zabalenej appke"
```
