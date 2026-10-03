# Branding pass a alfa build — implementačný plán

> **Pre agentných pracovníkov:** POVINNÝ SUB-SKILL: použi `superpowers:subagent-driven-development` (odporúčané) alebo `superpowers:executing-plans` a implementuj plán úloha po úlohe. Kroky používajú checkbox (`- [ ]`) syntax na sledovanie.

**Cieľ:** Odstrániť z aplikácie viditeľné stopy po LegalWorku a jeho komerčných plochách a pripraviť build cestu, ktorou si externý tester appku skompiluje sám.

**Architektúra:** Branding rieši jedna substitučná vrstva v `t()` namiesto prepisovania 229 reťazcov. Komerčné plochy sa skrývajú filtrovaním na jednom mieste, upstream kód sa nemaže. Alfa nepotrebuje podpísané artefakty, iba zdokumentovaný build.

**Tech stack:** TypeScript, React 19, Electron, pnpm 11.4.0, `bun test` (apps/app), `node --test` (apps/desktop).

**Spec:** `docs/superpowers/specs/2026-09-11-branding-pass-a-alfa-spec.md`

## Globálne obmedzenia

- **Zónový model z `PATCHES.md` platí pre každú úlohu:** 🟢 nové LAWOSS súbory bez záznamu · 🟡 hodnotová zmena upstream súboru **vyžaduje riadok v `PATCHES.md` v tom istom commite** · 🔴 štrukturálne zásahy sa v tomto pláne nerobia.
- **`appId` ostáva `com.eigenweltlabs.legalwork`.** Žiadna úloha ho nemení.
- **Strojové identifikátory sa nepremenúvajú:** názvy balíkov (`@legalwork/app`, `legalwork-server`), premenné `LEGALWORK_*`, cesty.
- **Nahrádza sa iba presný tvar `LegalWork` → `LAWOSS`**, nikdy `legalwork` malými písmenami.
- Commit správy po slovensky, formát `typ: čo`.
- **Preklad SK/CZ nie je v tomto pláne** — má vlastný plán, lebo je to 6 420 reťazcov mechanickej práce s iným cyklom.

---

### Úloha 1: Substitučná vrstva mena značky v `t()`

**Súbory:**
- Upraviť: `apps/app/src/i18n/index.ts` (funkcia `t`, koniec súboru)
- Vytvoriť: `apps/app/tests/lawoss-brand-substitution.test.ts`
- Upraviť: `PATCHES.md`

**Rozhrania:**
- Poskytuje: `applyBrandName(text: string): string` a `BRAND_EXEMPT_KEYS: ReadonlySet<string>` exportované z `apps/app/src/i18n/index.ts`. Úloha 3 ani 4 ich nepoužívajú.

- [ ] **Krok 1: Napíš padajúci test**

Vytvor `apps/app/tests/lawoss-brand-substitution.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { BRAND_EXEMPT_KEYS, applyBrandName, t } from "../src/i18n";

describe("LAWOSS brand substitution", () => {
  test("nahradí meno upstream produktu v preloženom texte", () => {
    expect(t("office_addins.tab_description", "en")).toBe("LAWOSS in Word, Excel, and PowerPoint");
  });

  test("nechá strojové identifikátory na pokoji", () => {
    expect(applyBrandName("legalwork-server is read-only")).toBe("legalwork-server is read-only");
  });

  test("nahradí každý výskyt, nielen prvý", () => {
    expect(applyBrandName("LegalWork and LegalWork")).toBe("LAWOSS and LAWOSS");
  });

  test("kľúče popisujúce upstream dodávateľa si meno ponechajú", () => {
    expect(BRAND_EXEMPT_KEYS.has("mcp.quick_connect_legalmemory_desc")).toBe(true);
    expect(t("mcp.quick_connect_legalmemory_desc", "en")).toContain("LegalWork");
  });
});
```

- [ ] **Krok 2: Spusti test a over, že padá**

```bash
cd apps/app && bun test tests/lawoss-brand-substitution.test.ts
```

Očakávané: FAIL — `applyBrandName` a `BRAND_EXEMPT_KEYS` nie sú exportované.

- [ ] **Krok 3: Doplň substitúciu do `apps/app/src/i18n/index.ts`**

Nad definíciu `export const t = (` vlož:

```ts
/* ------------------------------------------------------------------ */
/*  LAWOSS: substitúcia mena značky                                    */
/* ------------------------------------------------------------------ */

/**
 * LAWOSS: upstream reťazce hovoria o LegalWorku. Namiesto prepísania 229
 * hodnôt v `en.ts` — čo by pri každom syncu konfliktovalo na 229 miestach —
 * sa meno nahrádza na jednom mieste, pri výdaji textu. Nové upstream reťazce
 * sú tým pokryté automaticky.
 *
 * Nahrádza sa iba presný tvar `LegalWork`. Identifikátory ako
 * `legalwork-server` alebo `LEGALWORK_DEV_MODE` sa v UI nezobrazujú a ich
 * prepis by rozbil beh.
 */
export const applyBrandName = (text: string): string => text.replaceAll("LegalWork", "LAWOSS");

/**
 * Kľúče, kde `LegalWork` popisuje **cudzí produkt alebo jeho autora**, nie náš.
 * Prepísať ich na LAWOSS by bolo vecne nepravdivé.
 */
export const BRAND_EXEMPT_KEYS: ReadonlySet<string> = new Set<string>([
  // „…from Eigenwelt Labs, the makers of LegalWork." — veta o dodávateľovi
  // ich vlastného LegalMemory, nie o nás.
  "mcp.quick_connect_legalmemory_desc",
]);
```

Vo funkcii `t` nahraď blok od `const result = lookupEntry(...)` po `return out;` týmto:

```ts
  const result = lookupEntry(loc, lookupKey);
  if (result === null) return key;

  // LAWOSS: značka sa nahrádza raz, pred dosadením parametrov, aby hodnota
  // parametra nemohla substitúciu spustiť ani obísť.
  const branded = BRAND_EXEMPT_KEYS.has(key) ? result : applyBrandName(result);

  if (!params) return branded;

  let out = branded;
  for (const [k, v] of Object.entries(params)) {
    if (k === "lng") continue;
    out = out.replace(`{${k}}`, String(v));
  }
  return out;
```

- [ ] **Krok 4: Spusti test a over, že prechádza**

```bash
cd apps/app && bun test tests/lawoss-brand-substitution.test.ts
```

Očakávané: PASS, štyri testy.

- [ ] **Krok 5: Spusti kontrolu prekladov a typov**

```bash
cd apps/app && bun scripts/i18n-check.ts && pnpm typecheck
```

Očakávané: obe prejdú. Ak `i18n-check` porovnáva hodnoty voči `en.ts`, substitúcia ho neovplyvní — beží nad slovníkmi, nie nad `t()`.

- [ ] **Krok 6: Doplň riadok do `PATCHES.md`**

Do tabuľky pridaj:

```markdown
| `apps/app/src/i18n/index.ts` | +`applyBrandName()`, +`BRAND_EXEMPT_KEYS`, substitúcia `LegalWork` → `LAWOSS` v `t()` pred dosadením parametrov | Branding bez prepisovania 229 upstream reťazcov; nové upstream reťazce pokryté automaticky | MČ | plan/branding-pass-a-alfa |
```

- [ ] **Krok 7: Commit**

```bash
git add apps/app/src/i18n/index.ts apps/app/tests/lawoss-brand-substitution.test.ts PATCHES.md
git commit -m "feat: nahrádzať meno LegalWork za LAWOSS pri výdaji prekladu"
```

---

### Úloha 2: Názvy release artefaktov

**Súbory:**
- Upraviť: `apps/desktop/electron-builder.yml:130`
- Vytvoriť: `apps/desktop/electron/artifact-name.test.mjs`
- Upraviť: `apps/desktop/package.json` (skript `test`)
- Upraviť: `PATCHES.md`

**Rozhrania:**
- Spotrebúva: nič z úlohy 1.
- Poskytuje: nič pre ďalšie úlohy.

- [ ] **Krok 1: Napíš padajúci test**

Vytvor `apps/desktop/electron/artifact-name.test.mjs`:

```js
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const here = path.dirname(fileURLToPath(import.meta.url));
const config = readFileSync(path.join(here, "..", "electron-builder.yml"), "utf8");

test("artefakty sa volajú lawoss-, nie legalwork-", () => {
  const line = config.split("\n").find((row) => row.trim().startsWith("artifactName:"));
  assert.ok(line, "electron-builder.yml musí definovať artifactName");
  assert.match(line, /lawoss-\$\{os\}-\$\{arch\}-\$\{version\}\.\$\{ext\}/);
  assert.doesNotMatch(line, /legalwork-/);
});
```

- [ ] **Krok 2: Spusti test a over, že padá**

```bash
node --test apps/desktop/electron/artifact-name.test.mjs
```

Očakávané: FAIL — riadok je dnes `artifactName: legalwork-${os}-${arch}-${version}.${ext}`.

- [ ] **Krok 3: Uprav šablónu**

V `apps/desktop/electron-builder.yml` na riadku 130 zmeň:

```yaml
artifactName: lawoss-${os}-${arch}-${version}.${ext}
```

- [ ] **Krok 4: Zaraď test medzi desktopové testy**

V `apps/desktop/package.json` v skripte `test` pridaj `electron/artifact-name.test.mjs` na koniec zoznamu súborov.

- [ ] **Krok 5: Spusti testy a over, že prechádzajú**

```bash
node --test apps/desktop/electron/artifact-name.test.mjs
cd apps/desktop && pnpm test
```

Očakávané: nový test PASS a žiadny existujúci desktopový test nepadne.

- [ ] **Krok 6: Doplň riadok do `PATCHES.md`**

```markdown
| `apps/desktop/electron-builder.yml` | `artifactName` `legalwork-` → `lawoss-` (value-only) | Vydanie z 11. 9. vyšlo ako `legalwork-mac-arm64-0.1.14.dmg`, hoci `productName` je LAWOSS | MČ | plan/branding-pass-a-alfa |
| `apps/desktop/package.json` | +1 súbor v skripte `test` (`electron/artifact-name.test.mjs`) | Aby sa názov artefaktov nemohol ticho vrátiť | MČ | plan/branding-pass-a-alfa |
```

- [ ] **Krok 7: Commit**

```bash
git add apps/desktop/electron-builder.yml apps/desktop/electron/artifact-name.test.mjs apps/desktop/package.json PATCHES.md
git commit -m "fix: artefakty vydania pomenovať lawoss- namiesto legalwork-"
```

- [ ] **Krok 8: Preklop existujúce vydanie `v0.1.14`**

Nie je to zmena kódu, ale patrí k tejto úlohe — dnes je to najnovšie vydanie forku a volá sa „LegalWork v0.1.14":

```bash
gh release edit v0.1.14 --repo Omni-Legal-Products/lawoss --prerelease --title "LAWOSS v0.1.14 (upstream build)"
```

Over: `gh release list --repo Omni-Legal-Products/lawoss --limit 3` — `v0.1.14` už nesmie byť označené ako Latest stable.

---

### Úloha 3: Skrytie komerčných záložiek v nastaveniach

**Súbory:**
- Vytvoriť: `apps/app/src/lawoss/feature-flags.ts`
- Vytvoriť: `apps/app/tests/lawoss-feature-flags.test.ts`
- Upraviť: `apps/app/src/react-app/domains/settings/shell/settings-page.tsx:225-239`
- Upraviť: `PATCHES.md`

**Rozhrania:**
- Poskytuje: `hideCommercialTabs<T extends string>(tabs: T[]): T[]`, `HIDDEN_SETTINGS_TABS: ReadonlySet<string>`, `HIDDEN_QUICK_CONNECT_SERVERS: ReadonlySet<string>` a `isHiddenQuickConnect(serverName: string): boolean` z `apps/app/src/lawoss/feature-flags.ts`. **Úloha 4 používa `isHiddenQuickConnect`.**

- [ ] **Krok 1: Napíš padajúci test**

Vytvor `apps/app/tests/lawoss-feature-flags.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import {
  HIDDEN_QUICK_CONNECT_SERVERS,
  HIDDEN_SETTINGS_TABS,
  hideCommercialTabs,
  isHiddenQuickConnect,
} from "../src/lawoss/feature-flags";

describe("LAWOSS feature flags", () => {
  test("odstráni komerčné záložky a poradie ostatných zachová", () => {
    const tabs = ["account", "ai", "recorder", "extensions", "appearance"];
    expect(hideCommercialTabs(tabs)).toEqual(["ai", "extensions", "appearance"]);
  });

  test("nič iné neodstráni", () => {
    const tabs = ["ai", "extensions", "personalisation", "appearance", "updates"];
    expect(hideCommercialTabs(tabs)).toEqual(tabs);
  });

  test("skryté sú účet a recorder", () => {
    expect(HIDDEN_SETTINGS_TABS.has("account")).toBe(true);
    expect(HIDDEN_SETTINGS_TABS.has("recorder")).toBe(true);
    expect(HIDDEN_SETTINGS_TABS.has("ai")).toBe(false);
  });

  test("LegalMemory sa neponúka v rýchlom pripojení", () => {
    expect(HIDDEN_QUICK_CONNECT_SERVERS.has("legalmemory")).toBe(true);
    expect(isHiddenQuickConnect("legalmemory")).toBe(true);
    expect(isHiddenQuickConnect("slovlex")).toBe(false);
  });
});
```

- [ ] **Krok 2: Spusti test a over, že padá**

```bash
cd apps/app && bun test tests/lawoss-feature-flags.test.ts
```

Očakávané: FAIL — modul `src/lawoss/feature-flags` neexistuje.

- [ ] **Krok 3: Vytvor modul prepínačov**

Vytvor `apps/app/src/lawoss/feature-flags.ts`:

```ts
/**
 * LAWOSS: plochy zdedené z LegalWorku, ktoré v našom produkte nedávajú zmysel.
 *
 * Zámerne **skrývame, nemažeme**. Upstream kód ostáva na disku nedotknutý,
 * takže sync z upstreamu nemá na čom konfliktovať a prípadný návrat je zmena
 * jedného riadku tu.
 */

/** Záložky nastavení, ktoré sa nezobrazia. */
export const HIDDEN_SETTINGS_TABS: ReadonlySet<string> = new Set<string>([
  // Prihlásenie, plán a fakturácia dodávateľa upstreamu.
  "account",
  // Ich lokálny prepis reči; LAWOSS použije vlastné riešenie.
  "recorder",
]);

/** Odstráni skryté záložky a poradie zvyšku zachová. */
export const hideCommercialTabs = <T extends string>(tabs: T[]): T[] =>
  tabs.filter((tab) => !HIDDEN_SETTINGS_TABS.has(tab));

/** MCP servery, ktoré sa neponúkajú v rýchlom pripojení. */
export const HIDDEN_QUICK_CONNECT_SERVERS: ReadonlySet<string> = new Set<string>([
  // LegalMemory je pamäťová appliance dodávateľa upstreamu. Naša pamäť je OKF.
  // Keď sa neponúkne na pripojenie, celý jeho subsystém ostane nečinný a
  // nemusíme strážiť ~25 miest, kde sa inak renderuje.
  "legalmemory",
]);

export const isHiddenQuickConnect = (serverName: string): boolean =>
  HIDDEN_QUICK_CONNECT_SERVERS.has(serverName);
```

- [ ] **Krok 4: Spusti test a over, že prechádza**

```bash
cd apps/app && bun test tests/lawoss-feature-flags.test.ts
```

Očakávané: PASS, štyri testy.

- [ ] **Krok 5: Zapoj filter do zoznamu záložiek**

V `apps/app/src/react-app/domains/settings/shell/settings-page.tsx` doplň import k ostatným importom:

```ts
import { hideCommercialTabs } from "@/lawoss/feature-flags";
```

a vo funkcii `getGlobalSettingsTabs` zmeň posledný riadok `return tabs;` na:

```ts
  // LAWOSS: účet a recorder sú komerčné plochy upstreamu — skryté, nie zmazané.
  return hideCommercialTabs(tabs);
```

- [ ] **Krok 6: Over typy a beh appky**

```bash
cd apps/app && pnpm typecheck && bun test tests/
```

Očakávané: typecheck prejde a žiadny existujúci test nepadne. Ak niektorý test očakáva `"account"` v zozname záložiek, uprav ten test — je to zámerná zmena správania, nie regresia.

- [ ] **Krok 7: Doplň riadok do `PATCHES.md`**

```markdown
| `apps/app/src/react-app/domains/settings/shell/settings-page.tsx` | `getGlobalSettingsTabs()` vracia `hideCommercialTabs(tabs)` (+1 import, +1 riadok) | Skryť účet a recorder bez mazania upstream kódu | MČ | plan/branding-pass-a-alfa |
```

- [ ] **Krok 8: Commit**

```bash
git add apps/app/src/lawoss/feature-flags.ts apps/app/tests/lawoss-feature-flags.test.ts apps/app/src/react-app/domains/settings/shell/settings-page.tsx PATCHES.md
git commit -m "feat: skryť komerčné záložky nastavení prepínačom LAWOSS"
```

---

### Úloha 4: LegalMemory sa neponúka na pripojenie

**Súbory:**
- Upraviť: `apps/app/src/app/constants.ts` (okolie riadku 147, `MCP_QUICK_CONNECT`)
- Vytvoriť: `apps/app/tests/lawoss-quick-connect.test.ts`
- Upraviť: `PATCHES.md`

**Rozhrania:**
- Spotrebúva: `isHiddenQuickConnect(serverName: string): boolean` z úlohy 3.
- Poskytuje: `MCP_QUICK_CONNECT` bez skrytých položiek; `LEGALWORK_EXTENSION_CATALOG` (riadok 573) z neho derivuje a filter zdedí.

- [ ] **Krok 1: Napíš padajúci test**

Vytvor `apps/app/tests/lawoss-quick-connect.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { MCP_QUICK_CONNECT } from "../src/app/constants";

describe("LAWOSS rýchle pripojenie MCP", () => {
  test("LegalMemory sa neponúka", () => {
    const names = MCP_QUICK_CONNECT.map((entry) => entry.serverName);
    expect(names).not.toContain("legalmemory");
  });

  test("katalóg neostal prázdny", () => {
    expect(MCP_QUICK_CONNECT.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Krok 2: Spusti test a over, že padá**

```bash
cd apps/app && bun test tests/lawoss-quick-connect.test.ts
```

Očakávané: FAIL na prvom teste — `legalmemory` je v zozname.

- [ ] **Krok 3: Zaveď filter**

V `apps/app/src/app/constants.ts` premenuj existujúcu deklaráciu na riadku 147 z `export const MCP_QUICK_CONNECT: McpDirectoryInfo[] = [` na:

```ts
const MCP_QUICK_CONNECT_ALL: McpDirectoryInfo[] = [
```

a hneď za uzatvárajúcu `];` toho poľa vlož:

```ts
/**
 * LAWOSS: skryté položky sa z ponuky odfiltrujú. Pole vyššie ostáva úplné,
 * aby sa upstream zmeny doň mergovali bez konfliktu.
 */
export const MCP_QUICK_CONNECT: McpDirectoryInfo[] = MCP_QUICK_CONNECT_ALL.filter(
  (entry) => !isHiddenQuickConnect(entry.serverName ?? ""),
);
```

K importom na začiatku súboru pridaj:

```ts
import { isHiddenQuickConnect } from "@/lawoss/feature-flags";
```

- [ ] **Krok 4: Spusti test a over, že prechádza**

```bash
cd apps/app && bun test tests/lawoss-quick-connect.test.ts
```

Očakávané: PASS, dva testy.

- [ ] **Krok 5: Over, že nič iné nespadlo**

```bash
cd apps/app && pnpm typecheck && bun test tests/
```

Očakávané: typecheck prejde. Testy, ktoré predpokladali LegalMemory v katalógu — napríklad `tests/mcp-catalog-auth.test.ts` — treba prejsť a upraviť ich očakávanie; skrytie je zámer, nie regresia.

- [ ] **Krok 6: Doplň riadok do `PATCHES.md`**

```markdown
| `apps/app/src/app/constants.ts` | `MCP_QUICK_CONNECT` premenované na `MCP_QUICK_CONNECT_ALL` a znovu exportované cez filter `isHiddenQuickConnect` (+1 import) | LegalMemory sa neponúka na pripojenie; jeho subsystém tým ostáva nečinný bez guardov na ~25 miestach | MČ | plan/branding-pass-a-alfa |
```

- [ ] **Krok 7: Commit**

```bash
git add apps/app/src/app/constants.ts apps/app/tests/lawoss-quick-connect.test.ts PATCHES.md
git commit -m "feat: neponúkať LegalMemory v rýchlom pripojení MCP"
```

---

### Úloha 5: Skrytie firemného upsellu a trial oznámenia

Účet a recorder zmizli v úlohe 3, ale komerčné plochy prerastajú aj do záložiek, ktoré si necháme. Firemné zdieľanie (Eigenwelt Hub) sa renderuje v Skills, Plugins, MCP a v zdieľaných presetoch; trial oznámenie visí priamo nad session.

**Súbory:**
- Upraviť: `apps/app/src/lawoss/feature-flags.ts`
- Upraviť: `apps/app/tests/lawoss-feature-flags.test.ts`
- Upraviť: `apps/app/src/react-app/domains/settings/pages/hub-scope-context.tsx` (komponent `HubScopeToggle`, od riadku 27)
- Upraviť: `apps/app/src/react-app/domains/session/surface/session-surface.tsx` (blok s `trial.notice_*`, okolie riadkov 424 – 432)
- Upraviť: `PATCHES.md`

**Rozhrania:**
- Spotrebúva: modul `feature-flags` z úlohy 3.
- Poskytuje: `CommercialSurface`, `isCommercialSurfaceHidden(surface: CommercialSurface): boolean`.

- [ ] **Krok 1: Rozšír test o nové plochy**

Do `apps/app/tests/lawoss-feature-flags.test.ts` pridaj import `isCommercialSurfaceHidden` a nový test:

```ts
  test("firemné zdieľanie a trial oznámenie sú skryté", () => {
    expect(isCommercialSurfaceHidden("firm-hub")).toBe(true);
    expect(isCommercialSurfaceHidden("trial-notice")).toBe(true);
  });
```

- [ ] **Krok 2: Spusti test a over, že padá**

```bash
cd apps/app && bun test tests/lawoss-feature-flags.test.ts
```

Očakávané: FAIL — `isCommercialSurfaceHidden` neexistuje.

- [ ] **Krok 3: Doplň prepínače**

Do `apps/app/src/lawoss/feature-flags.ts` pridaj:

```ts
/**
 * Komerčné plochy upstreamu, ktoré prerastajú do záložiek, ktoré si necháme.
 * `firm-hub` je platené firemné zdieľanie, `trial-notice` je výzva na
 * predplatné nad session.
 */
export type CommercialSurface = "firm-hub" | "trial-notice";

export const HIDDEN_COMMERCIAL_SURFACES: ReadonlySet<CommercialSurface> = new Set<CommercialSurface>([
  "firm-hub",
  "trial-notice",
]);

export const isCommercialSurfaceHidden = (surface: CommercialSurface): boolean =>
  HIDDEN_COMMERCIAL_SURFACES.has(surface);
```

- [ ] **Krok 4: Spusti test a over, že prechádza**

```bash
cd apps/app && bun test tests/lawoss-feature-flags.test.ts
```

Očakávané: PASS, päť testov.

- [ ] **Krok 5: Skry prepínač firemného rozsahu**

V `apps/app/src/react-app/domains/settings/pages/hub-scope-context.tsx` pridaj import:

```ts
import { isCommercialSurfaceHidden } from "@/lawoss/feature-flags";
```

a ako **prvý riadok tela komponentu `HubScopeToggle`** vlož:

```ts
  // LAWOSS: firemné zdieľanie je platená plocha upstreamu. Bez prepínača
  // ostane `useHubScope()` na `null`, teda lokálny rozsah — to je stav,
  // s ktorým consumery vedia pracovať.
  if (isCommercialSurfaceHidden("firm-hub")) return null;
```

- [ ] **Krok 6: Skry trial oznámenie**

V `apps/app/src/react-app/domains/session/surface/session-surface.tsx` nájdi blok, ktorý renderuje `t("trial.notice_title")` a `t("trial.notice_body")` (okolie riadkov 424 – 432), a obal celý jeho JSX výraz podmienkou:

```tsx
{!isCommercialSurfaceHidden("trial-notice") && (
  /* pôvodný blok s trial.notice_* ostáva nezmenený */
)}
```

K importom pridaj:

```ts
import { isCommercialSurfaceHidden } from "@/lawoss/feature-flags";
```

- [ ] **Krok 7: Over typy a testy**

```bash
cd apps/app && pnpm typecheck && bun test tests/
```

Očakávané: prejde. Ak test očakával trial oznámenie alebo prepínač rozsahu, uprav ho — skrytie je zámer.

- [ ] **Krok 8: Doplň riadky do `PATCHES.md`**

```markdown
| `apps/app/src/react-app/domains/settings/pages/hub-scope-context.tsx` | `HubScopeToggle` vracia `null`, keď je `firm-hub` skrytý (+1 import, +1 riadok) | Firemné zdieľanie je platená plocha upstreamu | MČ | plan/branding-pass-a-alfa |
| `apps/app/src/react-app/domains/session/surface/session-surface.tsx` | Blok `trial.notice_*` obalený podmienkou `isCommercialSurfaceHidden` (+1 import) | Výzva na predplatné dodávateľa upstreamu nepatrí do LAWOSS | MČ | plan/branding-pass-a-alfa |
```

- [ ] **Krok 9: Commit**

```bash
git add apps/app/src/lawoss/feature-flags.ts apps/app/tests/lawoss-feature-flags.test.ts apps/app/src/react-app/domains/settings/pages/hub-scope-context.tsx apps/app/src/react-app/domains/session/surface/session-surface.tsx PATCHES.md
git commit -m "feat: skryť firemné zdieľanie a trial oznámenie upstreamu"
```

---

### Úloha 6: Návod na zostavenie pre externých testerov

**Súbory:**
- Vytvoriť: `docs/lawoss-build-pre-testerov.md`
- Upraviť: `README.md` (odkaz na návod)

**Rozhrania:**
- Spotrebúva: nič. Dokumentuje stav po úlohách 1 až 4.

- [ ] **Krok 1: Zisti presné verzie nástrojov, na ktorých build reálne beží**

```bash
node --version && pnpm --version && bun --version
grep -n "packageManager" package.json
```

Zapíš skutočné hodnoty; do návodu nepíš „najnovšia verzia".

- [ ] **Krok 2: Napíš návod**

Vytvor `docs/lawoss-build-pre-testerov.md` s týmito sekciami, vyplnenými hodnotami z kroku 1:

1. **Načo to je** — LAWOSS je alfa; build si robíš sám, lebo appka nie je notarizovaná. Bez podpisu ju macOS ani Windows nepustia bez varovania, a preto ju zatiaľ nedistribuujeme ako hotový súbor.
2. **Čo potrebuješ** — Node, pnpm a bun v overených verziách, Git, a na macOS nástroje Xcode command line tools.
3. **Postup** — klonovanie, `pnpm install`, `pnpm build`, prvé spustenie. Každý príkaz na vlastnom riadku, aj s tým, čo má vypísať.
4. **Prvé spustenie** — pripojenie modelu (Settings → AI Providers), založenie testovacieho priečinka, prepnutie jazyka.
5. **Čo hlásiť a kam** — reprodukovateľné kroky, verzia z `package.json`, operačný systém. Chyby patria do issues vo forku, nie do Telegramu.
6. **Čo alfa nerobí** — nie je notarizovaná, nemá automatické aktualizácie, a **nepatria do nej skutočné klientske dáta**.

- [ ] **Krok 3: Over návod na čistom priečinku**

```bash
cd /tmp && rm -rf lawoss-test-build && git clone --depth 1 https://github.com/Omni-Legal-Products/lawoss.git lawoss-test-build
cd lawoss-test-build && pnpm install && pnpm build
```

Očakávané: `pnpm build` prejde bez zásahu do kódu. Ak zlyhá, chýbajúci krok doplň do návodu a over znova — **to je hlavný zmysel tejto úlohy.**

- [ ] **Krok 4: Odkáž naň z `README.md`**

Do `README.md` mimo AUTO sekcií pridaj riadok:

```markdown
- [Build pre alfa testerov](docs/lawoss-build-pre-testerov.md) — ako si aplikáciu skompilovať a čo hlásiť
```

- [ ] **Krok 5: Doplň riadok do `PATCHES.md`**

```markdown
| `README.md` | +1 odkaz na návod na build pre alfa testerov | Alfa sa distribuuje vlastnou kompiláciou, nie podpísaným artefaktom | MČ | plan/branding-pass-a-alfa |
```

- [ ] **Krok 6: Commit**

```bash
git add docs/lawoss-build-pre-testerov.md README.md PATCHES.md
git commit -m "docs: návod na zostavenie aplikácie pre alfa testerov"
```

---

## Záverečné overenie po všetkých úlohách

- [ ] **Celé sady testov**

```bash
cd apps/app && pnpm typecheck && bun test tests/ && bun scripts/i18n-check.ts
cd ../desktop && pnpm test
```

- [ ] **Smoke scenár v spustenej aplikácii**

1. Nastavenia neobsahujú záložku **Account** ani **Recorder**.
2. V rýchlom pripojení MCP nie je **LegalMemory**.
3. Nad session nie je výzva na predplatné a v Skills, Plugins ani MCP nie je prepínač firemného zdieľania.
4. Nikde v rozhraní sa nezobrazí slovo **LegalWork** — prejdi onboarding, sidebar, nastavenia a Office add-ins.
5. Pripojenie modelu funguje, session sa vytvorí, spis sa založí a prežije reštart.

- [ ] **Kontrola upstream syncu**

```bash
git fetch upstream && git merge --no-commit --no-ff upstream/dev
```

Očakávané: konflikty iba v súboroch, ktoré majú riadok v `PATCHES.md`. Ak konfliktuje niečo iné, plán zaviedol zmenu mimo zónového modelu. Zruš skúšku cez `git merge --abort`.

## Čo tento plán zámerne nerieši

- **Preklad SK a CZ** — 3 210 kľúčov v každom jazyku, vlastný plán.
- **Zmena `appId`**, notarizácia a podpis Windows — evidované v backlogu koordinačného repa.
- **Prepojenie LegalMemory rozhrania na `okf-pamat`** — samostatný projekt; tu sa iba skrýva.
