# Onboarding cez priečinok, plán C1: server a jadro

> **Pre agentných pracovníkov:** POVINNÝ SUB-SKILL: použi `superpowers:subagent-driven-development` (odporúčané) alebo `superpowers:executing-plans` a implementuj plán úloha po úlohe. Kroky používajú checkbox (`- [ ]`) syntax na sledovanie.

**Cieľ:** Server vie navrhnúť úroveň vybraného priečinka, povoliť usporiadanie priečinka klienta na mieste a už neodmieta skutočné klientske priečinky pri ukladaní profilu onboardingu (chyba `400 invalid_scope` z callu 8. 10.).

**Architektúra:**
- **Plytká kontrola úrovne v jadre.** Nová funkcia `inspectCardLevel` v `lawoss/okf` číta len karty v koreni a `Office/okf.config`. Rozhodovanie o úrovni sa presunie do jednej čistej funkcie `decideCardLevel`, ktorú používa aj plná inšpekcia, takže pravidlá sa neduplikujú.
- **Server** používa plytkú kontrolu pri `POST /lawoss/onboarding/profile`. Plná inšpekcia ostáva tam, kde sa zapisuje (plán, zápis).
- **Nové trasy:** `POST /lawoss/onboarding/suggest` a `POST /lawoss/triage/grant`. Trasa `status` roztriedenia pozná aj usporiadanie na mieste.
- **App API:** typy a metódy pre plán C2, bez zmeny UI.

**Tech stack:** TypeScript, Bun 1.4.2 (`bun test`), pnpm 11.4.0, Node 24. Testy jadra: `cd lawoss/okf && bun test test/`. Server: `cd apps/server && bun test src/<súbor>`. Appka: `cd apps/app && bun test tests/<súbor>`.

**Spec:** [lawOSS-like-SK-CZ#92](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/92) (po zlúčení `specs/2026-10-08-onboarding-pripojit-priecinok.md` v `main`), schválil MČ 8. 10. 2026. Nadväzuje na plán A (#135) a B (#136).

## Predpoklad: základ vetvy

Plán stavia na rozhraniach z #135 (`suggestOnboardingLevel`, `practice`, `grantInPlaceReorganize`, `verifyTriageTarget`, `keepChanged`) a #136 (domovský priestor).
- Ak sú #135 a #136 zlúčené: vetva `feat/onboarding-c1` z aktuálneho `dev`.
- Ak nie sú: vetva z `dev`, potom `git merge origin/feat/onboarding-jadro-okf` a `git merge origin/feat/ai-bez-priecinka` (8. 10. sa zlúčili bez konfliktov). PR potom cieli na `dev` a v popise uvedie závislosť.
- Čísla riadkov v pláne sú orientačné (stav 8. 10. po zlúčení A a B). Kód hľadaj podľa obsahu.

## Zistenia, z ktorých plán vychádza (overené v kóde 8. 10. 2026)

| Čo | Kde | Dôsledok |
|---|---|---|
| `/profile` overuje každý uložený koreň plnou inšpekciou (celý strom, hash, limity 10 000 položiek / 1 GB, symlink alebo zamknutý súbor = neúplné) | `apps/server/src/lawoss/onboarding.ts` v trase `profile` (`inspectOnboardingRoot(path)`, chyba `invalid_scope`) | skutočný klient s veľkým stromom, symlinkom alebo zamknutým súborom sa nedá uložiť; to je chyba z callu |
| Chybu spúšťa najmä `preferOpenClient` pri „+ Nová vec“ a prehltne ju `catch` | `apps/app/src/lawoss/domains/onboarding/lawoss-welcome-page.tsx` (`preferOpenClient`) | používateľ chybu nevidí, onboarding sa „zasekne“ |
| Kandidát pamäte kancelárie pri pláne kontroluje meno `Office`/`_kancelaria` pred inšpekciou | `onboarding.ts`, trasa `plan`, cyklus `officeMemoryRoot` | koreň praxe sa pri pláne celý neprechádza; netreba meniť |
| `status` roztriedenia volá len `verifyTrialClone` | `apps/server/src/lawoss/triage.ts`, trasa `status` | priečinok so súhlasom na mieste sa javí ako „nie je klon“ |
| `undo` vracia výsledok `undoTriage` priamo | `triage.ts`, trasa `undo` | pole `kept` z plánu A prejde bez zmeny servera |
| Zoznam krokov profilu je uzavretý zod enum | `onboarding.ts`, `profileSchema.step` | nové kroky `folder` a `found` treba pridať, staré ponechať (alfa testeri ich majú uložené) |
| `withCanonicalPaths` prevádza len vymenované polia s cestou | `apps/app/src/lawoss/domains/onboarding/typed-paths.ts` | nová metóda `suggestOnboarding` musí byť obalená, inak cesta z Windows Prieskumníka zlyhá |

## Global Constraints

- Zelená zóna: `lawoss/**`, `apps/server/src/lawoss/**` a `apps/app/src/lawoss/**` sú súbory LAWOSS, bez riadku v `PATCHES.md`.
- Žltá zóna: zmena `apps/app/src/app/lib/legalwork-server.ts` (upstream) dostane riadok v `PATCHES.md` v tom istom PR.
- Plná inšpekcia (`inspectOnboardingRoot`) ostáva pri pláne a zápise; plytká kontrola sa použije len na potvrdenie identity už vybraného priečinka.
- Súhlas s usporiadaním na mieste smie zapísať len trasa `grant`, len pre zaregistrovaný lokálny priečinok s `appFiles: "inside"`, a len s `confirm: true`. Presuny ďalej vyžadujú odtlačok potvrdeného náhľadu (už existuje v `apply`).
- TypeScript bez `any` a `as`; komentáre po slovensky; commity po slovensky s `Co-Authored-By`; v novom texte bez dlhej pomlčky.
- `lawoss/okf/bundle/okf.js` je v repozitári: po zmene `lawoss/okf/src` pregenerovať (`bun run build`).

## Review Focus

- **Klient so symlinkom alebo s viac ako 10 000 súbormi:** profil sa uloží, `classify` naďalej hlási problém. Test v úlohe 2.
- **Profil so starým krokom (`okf`, `office`, `packs`):** po aktualizácii sa načíta a dá sa prepísať na `folder`. Test v úlohe 2.
- **`grant` pre priečinok, ktorý nie je zaregistrovaný, je `outside` alebo je skúšobný klon:** odmietnuť bez zápisu. Test v úlohe 4.
- **Usporiadanie na mieste a vrátenie po úprave dokumentu:** `undo` vráti ostatné a zmenený nahlási v `kept`. Test v úlohe 4.
- **Cesta skopírovaná z Prieskumníka (Windows) pri `suggest`:** prejde cez `withCanonicalPaths`. Test v úlohe 5.

---

### Úloha 1: Plytká kontrola úrovne v jadre (`inspectCardLevel`)

**Files:**
- Modify: `lawoss/okf/src/onboarding/classify.ts` (konštanty `CARD_LEVELS`, `CARD_TYPES`; blok rozhodnutia na konci `inspectOnboardingRoot`)
- Modify: `lawoss/okf/onboarding.mjs`, `lawoss/okf/onboarding.d.mts`, `apps/server/src/lawoss/onboarding-runtime.ts` (export)
- Test: `lawoss/okf/test/onboarding-card-level.test.ts`

**Interfaces:**
- Produces:
  - `decideCardLevel(cards: readonly { path: string; text: string | undefined }[], office: boolean, officeConflict: boolean): { level: OnboardingLevel; issue?: "conflicting_identity" | "invalid_card_type" }`
  - `inspectCardLevel(root: string): Promise<{ root: string; level: OnboardingLevel; issues: { path: string; code: string }[] }>`
  - seam: `inspectCardLevel` z `onboarding.mjs`, deklarácia v `onboarding.d.mts`, re-export v `onboarding-runtime.ts`

- [ ] **Krok 1: Napíš padajúce testy**

`lawoss/okf/test/onboarding-card-level.test.ts`:

```ts
import { afterEach, expect, test } from "bun:test";
import { mkdtemp, mkdir, realpath, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { decideCardLevel, inspectCardLevel, inspectOnboardingRoot } from "../src/onboarding/classify.ts";

const roots: string[] = [];
afterEach(async () => { await Promise.all(roots.splice(0).map(path => rm(path, { recursive: true, force: true }))); });
async function fixture(files: Record<string, string> = {}) {
  const root = await realpath(await mkdtemp(join(tmpdir(), "okf-card-level-")));
  roots.push(root);
  for (const [path, content] of Object.entries(files)) { await mkdir(join(root, path, ".."), { recursive: true }); await writeFile(join(root, path), content); }
  return root;
}
const card = (type: string) => `---\ntype: ${type}\ntitle: Synthetic\n---\n`;

test("rozhodnutie o úrovni je spoločné pre plytkú aj plnú inšpekciu", () => {
  expect(decideCardLevel([{ path: "client.md", text: card("client") }], false, false)).toEqual({ level: "client" });
  expect(decideCardLevel([{ path: "spis.md", text: card("spis") }], false, false)).toEqual({ level: "matter" });
  expect(decideCardLevel([], true, false)).toEqual({ level: "office" });
  expect(decideCardLevel([], false, false)).toEqual({ level: "unknown" });
  expect(decideCardLevel([{ path: "client.md", text: card("client") }, { path: "klient.md", text: card("client") }], false, false)).toEqual({ level: "conflict", issue: "conflicting_identity" });
  expect(decideCardLevel([{ path: "client.md", text: card("client") }], true, false)).toEqual({ level: "conflict", issue: "conflicting_identity" });
  expect(decideCardLevel([], true, true)).toEqual({ level: "conflict", issue: "conflicting_identity" });
  expect(decideCardLevel([{ path: "client.md", text: card("matter") }], false, false)).toEqual({ level: "conflict", issue: "invalid_card_type" });
  expect(decideCardLevel([{ path: "client.md", text: undefined }], false, false)).toEqual({ level: "conflict", issue: "invalid_card_type" });
});

test("plytká kontrola rozpozná klienta, vec a kanceláriu z kariet v koreni", async () => {
  expect(await inspectCardLevel(await fixture({ "client.md": card("client"), "Zmluvy/a.pdf": "x" }))).toMatchObject({ level: "client", issues: [] });
  expect(await inspectCardLevel(await fixture({ "spis.md": card("spis") }))).toMatchObject({ level: "matter" });
  expect(await inspectCardLevel(await fixture({ "Office/okf.config": "version: 1\n", "Klienti/A/client.md": card("client") }))).toMatchObject({ level: "office" });
  const practice = await fixture({ "Office/okf.config": "version: 1\n" });
  expect(await inspectCardLevel(join(practice, "Office"))).toMatchObject({ level: "office" });
  expect(await inspectCardLevel(await fixture({ "notes.md": "x" }))).toMatchObject({ level: "unknown" });
});

test("klient so symlinkom: plná inšpekcia je neúplná, plytká kontrola ho uzná", async () => {
  const root = await fixture({ "client.md": card("client"), "Podklady/a.pdf": "x" });
  await symlink(join(root, "Podklady"), join(root, "odkaz"));
  expect((await inspectOnboardingRoot(root)).complete).toBe(false);
  expect(await inspectCardLevel(root)).toMatchObject({ level: "client", issues: [] });
});

test("konflikty a neplatná cesta", async () => {
  expect(await inspectCardLevel(await fixture({ "client.md": card("client"), "klient.md": card("client") }))).toMatchObject({ level: "conflict", issues: [{ path: "", code: "conflicting_identity" }] });
  expect(await inspectCardLevel(await fixture({ "client.md": card("client"), "Office/okf.config": "version: 1\n" }))).toMatchObject({ level: "conflict" });
  expect(await inspectCardLevel(await fixture({ "Office/okf.config": "version: 1\n", "_kancelaria/okf.config": "version: 1\n" }))).toMatchObject({ level: "conflict" });
  expect(await inspectCardLevel("relative/path")).toMatchObject({ level: "unknown", issues: [{ path: "", code: "canonical_directory_required" }] });
});

test("príliš veľká karta sa nečíta a je neplatná", async () => {
  const root = await fixture({ "client.md": `${card("client")}${"x".repeat(70 * 1024)}` });
  expect(await inspectCardLevel(root)).toMatchObject({ level: "conflict", issues: [{ path: "", code: "invalid_card_type" }] });
});
```

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd lawoss/okf && bun test test/onboarding-card-level.test.ts`
Expected: FAIL, `decideCardLevel` nie je exportované.

- [ ] **Krok 3: Implementuj v `classify.ts`**

Pod konštantu `CARD_TYPES` pridaj:

```ts
const OFFICE_DIR_NAMES = ["Office", "_kancelaria"] as const;
const CARD_HEAD_BYTES = 64 * 1024;

/**
 * Jedno rozhodnutie o úrovni z kariet a kancelárie; používa ho plná inšpekcia aj plytká
 * kontrola identity, aby pravidlá (jedna karta, platný `type:`, karta nie vedľa kancelárie) neboli dvakrát.
 */
export function decideCardLevel(cards: readonly { path: string; text: string | undefined }[], office: boolean, officeConflict: boolean): { level: OnboardingLevel; issue?: "conflicting_identity" | "invalid_card_type" } {
  if (cards.length > 1 || (cards.length > 0 && office) || officeConflict) return { level: "conflict", issue: "conflicting_identity" };
  const card = cards[0];
  if (card) {
    const metadata = card.text === undefined ? null : parseFrontmatter(card.text);
    const types = card.text?.match(/^type:/gm) ?? [];
    const level = CARD_LEVELS[card.path];
    if (!level || !metadata?.type || types.length !== 1 || !CARD_TYPES[card.path]?.includes(metadata.type)) return { level: "conflict", issue: "invalid_card_type" };
    return { level };
  }
  return { level: office ? "office" : "unknown" };
}

/** Prvých 64 KB karty bez sledovania odkazu; väčšia karta alebo iný druh súboru vráti `undefined`. */
async function readCardHead(path: string): Promise<string | undefined> {
  let handle;
  try { handle = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW); }
  catch { return undefined; }
  try {
    const state = await handle.stat();
    if (!state.isFile() || state.size > CARD_HEAD_BYTES) return undefined;
    const buffer = Buffer.alloc(state.size);
    const read = await handle.read(buffer, 0, state.size, 0);
    return buffer.subarray(0, read.bytesRead).toString("utf8");
  } finally { await handle.close(); }
}

const isFile = (path: string) => lstat(path).then(state => state.isFile(), () => false);

/**
 * Plytká kontrola identity priečinka: len karty v koreni a `Office/okf.config`, bez prechádzania stromu.
 * Pre potvrdenie už vybraného klienta, kancelárie či veci (profil onboardingu); veľký strom, symlink
 * alebo zamknutý dokument v ňom identitu nemenia. Zápis (plán, apply) naďalej robí plnú inšpekciu.
 */
export async function inspectCardLevel(root: string): Promise<{ root: string; level: OnboardingLevel; issues: { path: string; code: string }[] }> {
  const resolved = resolve(root);
  try {
    if (!isAbsolute(root) || await realpath(root) !== resolved || !(await lstat(resolved)).isDirectory()) return { root: resolved, level: "unknown", issues: [{ path: "", code: "canonical_directory_required" }] };
  } catch { return { root: resolved, level: "unknown", issues: [{ path: "", code: "canonical_directory_required" }] }; }
  const names = new Set(await readdir(resolved));
  const cardNames = Object.keys(CARD_LEVELS).filter(name => names.has(name));
  const cards = await Promise.all(cardNames.map(async path => ({ path, text: await readCardHead(join(resolved, path)) })));
  const directOffice = OFFICE_DIR_NAMES.some(name => basename(resolved) === name) && names.has("okf.config") && await isFile(join(resolved, "okf.config"));
  const nestedOffices = (await Promise.all(OFFICE_DIR_NAMES.map(name => isFile(join(resolved, name, "okf.config"))))).filter(Boolean).length;
  const decision = decideCardLevel(cards, directOffice || nestedOffices > 0, nestedOffices > 1);
  return { root: resolved, level: decision.level, issues: decision.issue ? [{ path: "", code: decision.issue }] : [] };
}
```

V `inspectOnboardingRoot` nahraď blok od `const conflict = (code: string) => …` po `} else if (office) result.level = "office";` týmto:

```ts
  const conflict = (code: string) => { result.level = "conflict"; result.issues.push({ path: "", code }); };
  const decision = decideCardLevel(
    cards.map(card => ({ path: card.path, text: cardText.get(card.path) })),
    office,
    officePaths.length > 1 || officePaths.some(entry => entry.path.split("/").length > 2),
  );
  if (decision.issue) conflict(decision.issue);
  else result.level = decision.level;
```

Over, že `open`, `constants`, `lstat`, `readdir`, `realpath`, `basename`, `isAbsolute`, `join`, `resolve` a `parseFrontmatter` sú v `classify.ts` už importované (sú, riadky 1 až 6).

- [ ] **Krok 4: Seam**

`lawoss/okf/onboarding.mjs`: riadok s `inspectOnboardingRoot` zmeň na

```js
export { inspectCardLevel, inspectOnboardingRoot } from "./src/onboarding/classify.ts";
```

`lawoss/okf/onboarding.d.mts`, pod deklaráciu `inspectOnboardingRoot`:

```ts
export function inspectCardLevel(root: string): Promise<{ root: string; level: Inspection["level"]; issues: { path: string; code: string }[] }>;
```

`apps/server/src/lawoss/onboarding-runtime.ts`: do prvého exportu pridaj `inspectCardLevel`.

- [ ] **Krok 5: Spusti testy, typecheck, bundle**

Run: `cd lawoss/okf && bun test test/onboarding-card-level.test.ts test/onboarding-classify.test.ts && bun run typecheck && bun test test/ && bun run build`
Run: `cd ../../apps/server && pnpm typecheck`
Expected: všetko PASS, `onboarding-classify.test.ts` bez zmeny očakávaní.

- [ ] **Krok 6: Commit**

```bash
git add lawoss/okf/src/onboarding/classify.ts lawoss/okf/test/onboarding-card-level.test.ts lawoss/okf/onboarding.mjs lawoss/okf/onboarding.d.mts lawoss/okf/bundle/okf.js apps/server/src/lawoss/onboarding-runtime.ts
git commit -m "feat: plytká kontrola úrovne priečinka podľa kariet v koreni"
```

---

### Úloha 2: Profil onboardingu bez plnej inšpekcie (oprava `400 invalid_scope`) a nové kroky

**Files:**
- Modify: `apps/server/src/lawoss/onboarding.ts` (import, `profileSchema.step`, cyklus kontroly koreňov v trase `profile`)
- Test: `apps/server/src/lawoss-onboarding.e2e.test.ts`

**Interfaces:**
- Consumes: `inspectCardLevel` z úlohy 1.
- Produces: `profileSchema.step` = `"identity" | "ai" | "folder" | "found" | "okf" | "office" | "packs" | "client" | "matter" | "done"` (staré hodnoty ostávajú kvôli uloženým profilom).

- [ ] **Krok 1: Napíš padajúce testy**

Do `apps/server/src/lawoss-onboarding.e2e.test.ts` pridaj import `symlink` z `node:fs/promises` a testy:

```ts
test("profil prijme skutočného klienta so symlinkom; classify problém naďalej hlási", async () => {
  const f = await fixture();
  const created = await f.apply({ action: "client", parent: f.parent, name: "Klient", title: "Klient", ...common });
  const clientRoot = created.clientRoot as string;
  await mkdir(join(clientRoot, "Podklady"));
  await symlink(join(clientRoot, "Podklady"), join(clientRoot, "odkaz"));
  await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", clientRoot });
  expect((await f.success("classify", { root: clientRoot })).complete).toBe(false);
});

test("profil prijme kanceláriu v koreni veľkej praxe bez prechádzania klientov", async () => {
  const f = await fixture(), root = join(f.base, "praxe");
  await mkdir(join(root, "Klient A"), { recursive: true });
  await symlink(join(root, "Klient A"), join(root, "odkaz-na-klienta"));
  await f.apply({ action: "practice", root, title: "Syntetická prax", jurisdiction: "sk", language: "sk", lawyerName: "Synthetic lawyer", clientPattern: "*", scope: "client" });
  await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", officeRoot: root });
});

test("nové kroky folder a found sa uložia; starý krok packs sa načíta", async () => {
  const f = await fixture();
  await f.success("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", step: "packs" });
  expect((await f.success("status")).profile.step).toBe("packs");
  await f.success("profile", { step: "folder" });
  await f.success("profile", { step: "found" });
  expect((await f.success("status")).profile.step).toBe("found");
});

test("profil naďalej odmietne priečinok, ktorý nie je klient", async () => {
  const f = await fixture(), plain = join(f.base, "obyčajný");
  await mkdir(plain);
  expect((await f.call("profile", { lawyerName: "Synthetic lawyer", jurisdiction: "sk", language: "sk", clientRoot: plain })).status).toBe(400);
});
```

Poznámka k druhému testu: `officeRoot` je koreň praxe. Plytká kontrola v koreni nájde `Office/okf.config` a vráti `office`.

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd apps/server && bun test src/lawoss-onboarding.e2e.test.ts`
Expected: FAIL: prvé dva testy dostanú 400 `invalid_scope`, tretí 400 na `step: "folder"`.

- [ ] **Krok 3: Implementuj**

V `apps/server/src/lawoss/onboarding.ts`:

1. Do importu z `./onboarding-runtime.js` pridaj `inspectCardLevel`.
2. `profileSchema.step` zmeň na:

```ts
  // Nový tok (spec 2026-10-08): identity, ai, folder, found, done. Staré hodnoty ostávajú pre uložené profily alfa testerov.
  step: z.enum(["identity", "ai", "folder", "found", "okf", "office", "packs", "client", "matter", "done"]).optional(),
```

3. V trase `profile` nahraď v cykle nad koreňmi riadky

```ts
        const inspection = await inspectOnboardingRoot(path);
        const mappedClient = key === "clientRoot" && config.workspaces.some(workspace => workspace.path === path && workspace.appFiles === "outside");
        if (!mappedClient && (!inspection.complete || inspection.level !== level)) throw new ApiError(400, "invalid_scope", `Selected ${key} does not identify a complete ${level}.`);
```

týmito:

```ts
        // LAWOSS: identita z kariet v koreni (plytko). Plná inšpekcia celého stromu tu odmietala
        // skutočných klientov (veľký strom, symlink, zamknutý dokument), chyba z callu 8. 10. 2026.
        const identity = await inspectCardLevel(path);
        const mappedClient = key === "clientRoot" && config.workspaces.some(workspace => workspace.path === path && workspace.appFiles === "outside");
        if (!mappedClient && identity.level !== level) throw new ApiError(400, "invalid_scope", `Selected ${key} does not identify a ${level}.`);
```

Over, či ešte niečo v appke porovnáva presný text chyby „does not identify a complete“ (`git grep -n "identify a complete" apps/app`). Ak áno (napr. test `lawoss-onboarding-matter-client.test.tsx`), uprav ho na nový text.

- [ ] **Krok 4: Spusti testy a typecheck**

Run: `cd apps/server && bun test src/lawoss-onboarding.e2e.test.ts src/lawoss-triage.e2e.test.ts && pnpm typecheck`
Run: `cd ../app && bun test tests/lawoss-onboarding-matter-client.test.tsx`
Expected: PASS.

Do popisu PR uveď: `/plan` a `/apply` naďalej robia plnú inšpekciu celého stromu, takže bezpečnosť zápisu sa nemení; uvoľnila sa len kontrola identity už vybraného priečinka v profile. Priečinok s dvoma kartami (konflikt) profil naďalej odmietne.

- [ ] **Krok 5: Commit**

```bash
git add apps/server/src/lawoss/onboarding.ts apps/server/src/lawoss-onboarding.e2e.test.ts
git commit -m "fix: profil onboardingu overuje identitu priečinka podľa kariet, nie celým stromom"
```

---

### Úloha 3: Trasa `suggest`

**Files:**
- Modify: `lawoss/okf/onboarding.mjs` (už exportuje `suggestOnboardingLevel` z plánu A; over)
- Modify: `apps/server/src/lawoss/onboarding-runtime.ts` (re-export `suggestOnboardingLevel`, typ `OnboardingSuggestion`)
- Modify: `apps/server/src/lawoss/onboarding.ts` (nová trasa)
- Test: `apps/server/src/lawoss-onboarding.e2e.test.ts`

**Interfaces:**
- Consumes: `suggestOnboardingLevel(root)` a `OnboardingSuggestion` z plánu A (`onboarding.d.mts`).
- Produces: `POST /lawoss/onboarding/suggest` s telom `{ root: string }` (host), odpoveď `OnboardingSuggestion` (`{ root, level: "practice"|"client"|"matter"|"unknown", marked, score, signals, clientPattern?, clients: { path, name }[], complete }`).

- [ ] **Krok 1: Napíš padajúci test**

```ts
test("suggest navrhne prax z mien priečinkov a nič nezapíše", async () => {
  const f = await fixture(), root = join(f.base, "kancelaria");
  for (const name of ["Alfa s. r. o.", "Beta a. s.", "Gama s.r.o.", "Delta k. s.", "Novák Ján/2024-03 Kúpna zmluva"]) await mkdir(join(root, name), { recursive: true });
  const suggestion = await f.success("suggest", { root });
  expect(suggestion).toMatchObject({ level: "practice", marked: false, clientPattern: "*" });
  expect(suggestion.clients).toHaveLength(5);
  expect((await readdir(root)).sort()).toEqual(["Alfa s. r. o.", "Beta a. s.", "Delta k. s.", "Gama s.r.o.", "Novák Ján"]);
  expect((await f.call("suggest", { root: "relatívna/cesta" })).status).toBe(400);
  expect((await f.call("suggest", { root }, {} as { "X-LegalWork-Host-Token": string; "Content-Type": string })).status).toBe(401);
});
```

- [ ] **Krok 2: Over, že test padá**

Run: `cd apps/server && bun test src/lawoss-onboarding.e2e.test.ts -t suggest`
Expected: FAIL, 404.

- [ ] **Krok 3: Implementuj**

`apps/server/src/lawoss/onboarding-runtime.ts`: do prvého exportu pridaj `suggestOnboardingLevel`, do typového exportu `OnboardingSuggestion`.

`apps/server/src/lawoss/onboarding.ts`: import `suggestOnboardingLevel` z `./onboarding-runtime.js` a hneď za trasu `classify` pridaj:

```ts
  // Návrh úrovne (prax, klient, vec) z mien priečinkov; nič nečíta z obsahu a nič nezapisuje (spec P4).
  route("POST", "suggest", async ctx => {
    const input = z.strictObject({ root: z.string().min(1).max(4096) }).parse(await body(ctx));
    await canonicalDirectory(input.root);
    return await suggestOnboardingLevel(input.root);
  });
```

`route()` volá `ensureWritable` pre každú ne-GET trasu. Ak je server len na čítanie, `suggest` by zlyhal, hoci nič nezapisuje. Ak `ensureWritable` v režime len na čítanie hádže, nechaj to tak (rovnako sa správa `classify`) a zapíš to do správy.

- [ ] **Krok 4: Spusti test, typecheck, commit**

Run: `cd apps/server && bun test src/lawoss-onboarding.e2e.test.ts && pnpm typecheck`
Expected: PASS.

```bash
git add apps/server/src/lawoss/onboarding.ts apps/server/src/lawoss/onboarding-runtime.ts apps/server/src/lawoss-onboarding.e2e.test.ts
git commit -m "feat: server navrhne, či je priečinok prax, klient alebo vec"
```

---

### Úloha 4: Usporiadanie na mieste cez server (`grant`, `status` s režimom, `undo` s `kept`)

**Files:**
- Modify: `apps/server/src/lawoss/onboarding-runtime.ts` (re-export `verifyTriageTarget`, `grantInPlaceReorganize`)
- Modify: `apps/server/src/lawoss/triage.ts` (trasy `status`, nová `grant`)
- Test: `apps/server/src/lawoss-triage.e2e.test.ts`

**Interfaces:**
- Consumes: `grantInPlaceReorganize(root)`, `verifyTriageTarget(root, trialJournalDirectory)` (plán A), `undoTriage` s predvoleným `keepChanged` pre `in_place`.
- Produces:
  - `POST /lawoss/triage/status` → `{ trial: true; mode: "trial" | "in_place"; root; runs }` alebo `{ trial: false; reason; runs: [] }`
  - `POST /lawoss/triage/grant` s telom `{ root, confirm: true }` → `{ granted: true, root }`; 403 `not_registered_client`, ak priečinok nie je zaregistrovaný lokálny priečinok s `appFiles: "inside"`
  - `POST /lawoss/triage/undo` vráti aj `kept: string[]` (z jadra)

Pole `trial: true` sa ponecháva aj pri `in_place`, lebo appka ním dnes rozhoduje, či roztriedenie ponúknuť; význam je „roztriedenie je tu dovolené“. Nové pole `mode` rozlišuje druh.

- [ ] **Krok 1: Napíš padajúci test**

Do `apps/server/src/lawoss-triage.e2e.test.ts` pridaj druhý fixture (skutočný klient po `convert`, zaregistrovaný ako priečinok) a test:

```ts
/** Skutočný klient po „Nie, len pridaj OKF súbory“ (convert) a jeho registrácii, ako v novom onboardingu. */
async function convertedFixture() {
  const base = await realpath(await mkdtemp(join(tmpdir(), "lawoss-triage-in-place-"))); roots.push(base);
  const client = join(base, "Vymysleny klient"), data = join(base, "data");
  for (const dir of [client, data]) await mkdir(dir);
  for (const [path, content] of Object.entries({ "odpoved.eml": "x", "Plnomocenstvo.pdf": "y", "Rozsudok 8C_1_2024.pdf": "z", "Zaloba 8C_1_2024.pdf": "w" })) await writeFile(join(client, path), content);
  process.env.LEGALWORK_DATA_DIR = data; process.env.LEGALWORK_TOKEN_STORE = join(data, "tokens.json");
  const config: ServerConfig = { host: "127.0.0.1", port: 0, configPath: join(data, "server.json"), token: "synthetic-client", hostToken: "synthetic-host", approval: { mode: "auto", timeoutMs: 1000 }, corsOrigins: [], workspaces: [], authorizedRoots: [], readOnly: false, startedAt: Date.now(), tokenSource: "cli", hostTokenSource: "cli", logFormat: "pretty", logRequests: false };
  const server = await startServer(config); stops.push(() => server.stop());
  const headers = { "X-LegalWork-Host-Token": "synthetic-host", "Content-Type": "application/json" };
  const call = (path: string, body: unknown) => fetch(`http://127.0.0.1:${server.port}/lawoss/${path}`, { method: "POST", headers, body: JSON.stringify(body) });
  const success = async (path: string, body: unknown) => { const response = await call(path, body), result = await response.json(); expect({ status: response.status, error: result.error, message: result.message }).toEqual({ status: 200, error: undefined, message: undefined }); return result; };
  const preview = await success("onboarding/plan", { action: "existing", root: client, mode: "convert", title: "Vymyslený klient", clientType: "po", language: "sk", jurisdiction: "sk", date: "2026-10-08", confirmUnknownClient: true });
  await success("onboarding/apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true });
  return { base, client, call, success };
}

test("usporiadanie na mieste: len zaregistrovaný klient, len po grant, vrátenie hlási ponechané", async () => {
  const f = await convertedFixture();
  expect(await f.success("triage/status", { root: f.client })).toMatchObject({ trial: false });
  expect((await f.call("triage/plan", { root: f.client })).status).toBe(403);
  expect((await f.call("triage/grant", { root: f.client, confirm: false })).status).toBe(400);
  const stranger = join(f.base, "cudzí"); await mkdir(stranger);
  expect((await f.call("triage/grant", { root: stranger, confirm: true })).status).toBe(403);
  expect(await f.success("triage/grant", { root: f.client, confirm: true })).toEqual({ granted: true, root: f.client });
  expect(await f.success("triage/status", { root: f.client })).toMatchObject({ trial: true, mode: "in_place", runs: [] });
  const preview = await f.success("triage/plan", { root: f.client });
  expect(preview.moves.length).toBeGreaterThan(1);
  const applied = await f.success("triage/apply", { id: preview.id, fingerprint: preview.fingerprint, confirm: true });
  const changed = preview.moves[0].to as string;
  await writeFile(join(f.client, changed), "advokát to medzitým upravil");
  const undone = await f.success("triage/undo", { root: f.client, runId: applied.runId, confirm: true });
  expect(undone.kept).toContain(changed);
  expect(undone.restored).toBe(preview.moves.length - 1);
});
```

- [ ] **Krok 2: Over, že test padá**

Run: `cd apps/server && bun test src/lawoss-triage.e2e.test.ts`
Expected: FAIL, `triage/grant` vráti 404.

- [ ] **Krok 3: Implementuj**

`apps/server/src/lawoss/onboarding-runtime.ts`: do exportu roztriedenia pridaj `grantInPlaceReorganize` a `verifyTriageTarget`.

`apps/server/src/lawoss/triage.ts`:

1. Import rozšír o `grantInPlaceReorganize` a `verifyTriageTarget`.
2. Trasu `status` nahraď:

```ts
  route("status", async ctx => {
    const { root } = z.strictObject({ root: rootSchema }).parse(await body(ctx));
    try {
      // Skúšobný klon alebo klient so súhlasom na mieste (`grant`); `trial: true` = roztriedenie je tu dovolené.
      const target = await verifyTriageTarget(root, trialJournalDirectory);
      return { trial: true, mode: target.mode, root: target.root, runs: await listTriageRuns(target.root) };
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "not_trial_clone") return { trial: false, reason: error instanceof Error ? error.message : "", runs: [] };
      throw error;
    }
  });
```

3. Za trasu `status` pridaj:

```ts
  // Výslovný súhlas advokáta s usporiadaním priečinka klienta na mieste („Áno, usporiadaj“).
  // Len pre priečinok, ktorý appka spravuje ako klienta s vlastnými súbormi appky; presuny potom
  // vyžadujú odtlačok potvrdeného náhľadu (`apply`), vrátenie ponechá zmenené dokumenty (`kept`).
  route("grant", async ctx => {
    options.ensureWritable(config);
    const input = z.strictObject({ root: rootSchema, confirm: z.literal(true) }).parse(await body(ctx));
    const root = resolve(input.root);
    const registered = config.workspaces.some(workspace => workspace.workspaceType !== "remote" && resolve(workspace.path) === root && (workspace.appFiles ?? "inside") === "inside");
    if (!registered) throw new ApiError(403, "not_registered_client", "Only a connected client folder can be reorganised in place.");
    await grantInPlaceReorganize(root);
    return { granted: true, root };
  });
```

Over typ `WorkspaceInfo` (`apps/server/src/types.ts`): má `workspaceType` a `appFiles` (voliteľné). Ak sa pole volá inak, uprav podmienku bez `as`.

Chyba z `grantInPlaceReorganize` pre priečinok bez karty klienta prejde cez spoločný handler ako 400 `triage_failed` (alebo 403, ak je to `TrialCloneError`). To je v poriadku.

- [ ] **Krok 4: Spusti testy, typecheck, commit**

Run: `cd apps/server && bun test src/lawoss-triage.e2e.test.ts src/lawoss-onboarding.e2e.test.ts && pnpm typecheck`
Expected: PASS, pôvodný test skúšobného klona bez zmeny.

```bash
git add apps/server/src/lawoss/triage.ts apps/server/src/lawoss/onboarding-runtime.ts apps/server/src/lawoss-triage.e2e.test.ts
git commit -m "feat: server povolí usporiadanie priečinka klienta na mieste po výslovnom súhlase"
```

---

### Úloha 5: App API pre nový tok (typy, metódy, cesty z Prieskumníka)

**Files:**
- Modify: `apps/app/src/lawoss/domains/onboarding/api.ts`
- Modify: `apps/app/src/lawoss/domains/onboarding/typed-paths.ts`
- Modify: `apps/app/src/lawoss/domains/roztriedenie/api.ts`
- Modify: `apps/app/src/app/lib/legalwork-server.ts` (upstream; riadok v `PATCHES.md`)
- Modify: `PATCHES.md`
- Test: `apps/app/tests/lawoss-onboarding-api.test.ts`, `apps/app/tests/lawoss-onboarding-typed-paths.test.ts`, `apps/app/tests/lawoss-triage-ui.test.tsx`

**Interfaces:**
- Produces (plán C2 ich používa):
  - `OnboardingStep` pridá `"folder" | "found"`
  - `PracticePlanRequest = { action: "practice"; root: string; title: string; jurisdiction: Jurisdiction; language: DocumentLanguage; lawyerName: string; clientPattern: string; scope: "client" | "practice" }` v únii `OnboardingPlanRequest`
  - `OnboardingSuggestion = { root: string; level: "practice" | "client" | "matter" | "unknown"; marked: boolean; score: number; signals: readonly string[]; clientPattern?: string; clients: readonly { path: string; name: string }[]; complete: boolean }`
  - `OnboardingApi.suggestOnboarding?(input: { root: string }): Promise<OnboardingSuggestion>` (voliteľná, aby staré testovacie náhrady API ostali platné)
  - `TriageApiPath` pridá `"grant"`; `TriageStatus` = `{ trial: true; mode: "trial" | "in_place"; root: string; runs: TriageRun[] } | { trial: false; reason?: string; runs: [] }`
  - `TriageUndoResult` pridá `kept: string[]`
  - `triageGrant(client, root): Promise<{ granted: true; root: string }>`

- [ ] **Krok 1: Napíš padajúce testy**

Do `apps/app/tests/lawoss-onboarding-typed-paths.test.ts` pridaj (podľa existujúcich testov `withCanonicalPaths` v súbore, ktoré používajú falošné API a `canonicalize`):

```ts
test("suggest prevedie cestu z Prieskumníka rovnako ako classify", async () => {
  const seen: string[] = [];
  const api = {
    classifyOnboarding: async () => ({ level: "unknown" as const }),
    planOnboarding: async () => ({ id: "x", fingerprint: "y", preview: {} }),
    updateOnboardingProfile: async () => ({ version: 1 as const, lawyerName: "L", jurisdiction: "sk" as const, language: "sk" as const }),
    suggestOnboarding: async (input: { root: string }) => { seen.push(input.root); return { root: input.root, level: "client" as const, marked: false, score: 0.5, signals: [], clients: [], complete: true }; },
  };
  const wrapped = withCanonicalPaths(api, async value => value.replace(/^"|"$/g, "").replace("z:", "Z:"));
  await wrapped.suggestOnboarding?.({ root: "\"z:\\Klienti\\Novák\"" });
  expect(seen).toEqual(["Z:\\Klienti\\Novák"]);
});
```

Do `apps/app/tests/lawoss-onboarding-api.test.ts` pridaj typový test:

```ts
test("plán praxe je súčasť únie požiadaviek", () => {
  const request: OnboardingPlanRequest = { action: "practice", root: "/p", title: "Prax", jurisdiction: "sk", language: "sk", lawyerName: "L", clientPattern: "*", scope: "client" };
  expect(request.action).toBe("practice");
});
```

(s importom `type OnboardingPlanRequest` z `../src/lawoss/domains/onboarding/api`, ak tam ešte nie je).

Do `apps/app/tests/lawoss-triage-ui.test.tsx` pridaj (súbor už má falošného `TriageClient`; použi rovnaký vzor):

```ts
test("grant posiela root a potvrdenie", async () => {
  const calls: { path: string; body: unknown }[] = [];
  const client = { lawossTriage: async <T,>(path: TriageApiPath, body: unknown): Promise<T> => { calls.push({ path, body }); return { granted: true, root: "/k" } as T; } };
  expect(await triageGrant(client, "/k")).toEqual({ granted: true, root: "/k" });
  expect(calls).toEqual([{ path: "grant", body: { root: "/k", confirm: true } }]);
});
```

Ak vzor súboru používa iný tvar falošného klienta bez `as T`, prevezmi ho. `as T` v testovacej náhrade generickej funkcie je jediný spôsob bez knižnice. Ak ho súbor už nepoužíva, zapíš to do správy.

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd apps/app && bun test tests/lawoss-onboarding-typed-paths.test.ts tests/lawoss-onboarding-api.test.ts tests/lawoss-triage-ui.test.tsx`
Expected: FAIL (chýbajú typy, `suggestOnboarding` nie je obalené, `triageGrant` neexistuje).

- [ ] **Krok 3: Implementuj typy a metódy**

`apps/app/src/lawoss/domains/onboarding/api.ts`:

```ts
export type OnboardingStep =
  | "identity"
  | "ai"
  | "folder"
  | "found"
  | "okf"
  | "office"
  | "packs"
  | "client"
  | "matter"
  | "done";
```

```ts
export type PracticePlanRequest = {
  action: "practice";
  root: string;
  title: string;
  jurisdiction: Jurisdiction;
  language: DocumentLanguage;
  lawyerName: string;
  clientPattern: string;
  scope: "client" | "practice";
};
```

`OnboardingPlanRequest` rozšír o `| PracticePlanRequest`.

```ts
/** Návrh úrovne vybraného priečinka (spec P4); vždy návrh, ktorý advokát potvrdí alebo opraví. */
export type OnboardingSuggestion = {
  root: string;
  level: "practice" | "client" | "matter" | "unknown";
  marked: boolean;
  score: number;
  signals: readonly string[];
  clientPattern?: string;
  clients: readonly { path: string; name: string }[];
  complete: boolean;
};
```

Do `OnboardingApi` pridaj:

```ts
  suggestOnboarding?(input: { root: string }): Promise<OnboardingSuggestion>;
```

`apps/app/src/lawoss/domains/onboarding/typed-paths.ts`:

```ts
type PathApi = Pick<OnboardingApi, "classifyOnboarding" | "planOnboarding" | "updateOnboardingProfile"> & Pick<Partial<OnboardingApi>, "suggestOnboarding">;
```

a vo `withCanonicalPaths` pridaj (len keď metóda existuje):

```ts
    ...(api.suggestOnboarding ? {
      suggestOnboarding: async (input: { root: string }) => api.suggestOnboarding!(await withPaths(input, CLASSIFY_PATHS, canonicalize)),
    } : {}),
```

Použi radšej podobu bez `!`: `const suggest = api.suggestOnboarding;` a `...(suggest ? { suggestOnboarding: async (input: { root: string }) => suggest(await withPaths(input, CLASSIFY_PATHS, canonicalize)) } : {})`. Návratový typ `withCanonicalPaths` ostáva `T`; ak typecheck podmienené rozšírenie nepriradí k `T`, zostav výsledok ako `const wrapped: T = { ...api, classifyOnboarding…, planOnboarding…, updateOnboardingProfile… }` a metódu pridaj cez `if (suggest) wrapped.suggestOnboarding = …` (pole je voliteľné, takže priradenie je typovo v poriadku).

`apps/app/src/app/lib/legalwork-server.ts`, hneď za `classifyOnboarding`:

```ts
    suggestOnboarding: (input: { root: string }): Promise<OnboardingSuggestion> => requestJson(baseUrl, "/lawoss/onboarding/suggest", { token, hostToken, method: "POST", body: input, timeoutMs: 120_000 }),
```

a import typu `OnboardingSuggestion` vedľa existujúceho importu `OnboardingApi`.

`apps/app/src/lawoss/domains/roztriedenie/api.ts`:

```ts
export type TriageApiPath = "status" | "plan" | "replan" | "apply" | "undo" | "grant";
export type TriageStatus = { trial: true; mode: "trial" | "in_place"; root: string; runs: TriageRun[] } | { trial: false; reason?: string; runs: [] };
export type TriageUndoResult = { status: "undone" | "already_undone"; runId: string; restored: number; removed: number; kept: string[] };
/** Výslovný súhlas s usporiadaním priečinka klienta na mieste („Áno, usporiadaj“). */
export const triageGrant = (client: TriageClient, root: string) => client.lawossTriage<{ granted: true; root: string }>("grant", { root, confirm: true });
```

Ak niektorý existujúci kód vytvára `TriageStatus` s `trial: true` bez `mode` (napr. testy alebo stránka roztriedenia), doplň `mode: "trial"`.

- [ ] **Krok 4: PATCHES.md**

Rozšír existujúci riadok pre `apps/app/src/app/lib/legalwork-server.ts` s metódou `lawossTriage` (riadok začína `` | `apps/app/src/app/lib/legalwork-server.ts` | +1 import typu `TriageApiPath` ``) o text: „; +1 metóda `suggestOnboarding(input)` volajúca hostové `/lawoss/onboarding/suggest` a import typu `OnboardingSuggestion` (spec 2026-10-08, onboarding cez priečinok)“. Ak je bunka PR, pridaj odkaz na tento PR.

- [ ] **Krok 5: Spusti testy a typecheck**

Run: `cd apps/app && bun test tests/lawoss-onboarding-typed-paths.test.ts tests/lawoss-onboarding-api.test.ts tests/lawoss-triage-ui.test.tsx tests/lawoss-onboarding-okf-steps.test.ts && pnpm typecheck`
Expected: PASS. Ak typecheck nájde `switch` nad `OnboardingStep` bez vetiev `folder`/`found` (napr. v `onboarding-state.ts`), pridaj tam vetvu, ktorá sa správa ako `identity` (návrat na začiatok toku). Plnú logiku nových krokov dodá plán C2.

- [ ] **Krok 6: Commit**

```bash
git add apps/app/src/lawoss/domains/onboarding/api.ts apps/app/src/lawoss/domains/onboarding/typed-paths.ts apps/app/src/lawoss/domains/roztriedenie/api.ts apps/app/src/app/lib/legalwork-server.ts PATCHES.md apps/app/tests/lawoss-onboarding-typed-paths.test.ts apps/app/tests/lawoss-onboarding-api.test.ts apps/app/tests/lawoss-triage-ui.test.tsx
git commit -m "feat: API appky pre návrh priečinka, prax a usporiadanie na mieste"
```

---

## Mimo tohto plánu (plán C2)

- Nový tok v appke (Ty, AI, Priečinok, obrazovka „Toto som našiel“), hromadné spracovanie klientov praxe, potvrdenie OKF, bočný panel, texty SK/CS/EN/DE a overenie na zabalenej appke.
- Stránka roztriedenia pre priečinok na mieste (texty, zobrazenie `kept` po vrátení).
