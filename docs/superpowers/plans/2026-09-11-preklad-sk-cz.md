# Preklad rozhrania do slovenčiny a češtiny — implementačný plán

> **Pre agentných pracovníkov:** POVINNÝ SUB-SKILL: použi `superpowers:subagent-driven-development` (odporúčané) alebo `superpowers:executing-plans` a implementuj plán úloha po úlohe. Kroky používajú checkbox (`- [ ]`) syntax na sledovanie.

**Cieľ:** Doplniť `sk.ts` a `cs.ts` na plné pokrytie voči `en.ts` a zrušiť dočasnú výnimku, vďaka ktorej dnes kontrola prekladov prechádza aj pri neúplných locale.

**Architektúra:** Prekladá sa po dávkach zoskupených podľa menného priestoru kľúča, aby terminológia v rámci obrazovky sedela. Slovník pojmov vzniká pred prvou dávkou a je záväzný pre všetky. Kontrola po každej dávke je existujúci `scripts/i18n-check.ts`. **Oba súbory sú LAWOSS-owned, takže celá úloha je v 🟢 zóne a nedotýka sa upstream syncu** — jedinou výnimkou je posledná úprava kontrolného skriptu.

**Tech stack:** TypeScript, `bun` na spustenie skriptov, `bun test` na testy.

**Spec:** `docs/superpowers/specs/2026-09-11-branding-pass-a-alfa-spec.md`, časť C

## Globálne obmedzenia

- **Rozsah: 3 210 chýbajúcich kľúčov v `sk.ts` a 3 210 v `cs.ts`**, spolu 6 420 reťazcov. `en.ts` má 3 468 kľúčov v 114 menných priestoroch.
- **Zástupné znaky musia prežiť doslova.** `{name}`, `{count}` a spol. — `i18n-check` to kontroluje tvrdo a padá na tom v každom locale.
- **Množné čísla:** slovenčina aj čeština majú CLDR kategórie `one`, `few`, `many`, `other`. Kde `en.ts` nesie `_one` a `_other`, cieľový jazyk potrebuje **všetky štyri** varianty, inak `resolvePluralKey` spadne na holý kľúč.
- **Produktové termíny sa neprekladajú:** Skills, Plugins, Commands, Sessions, OpenCode, MCP, Markdown, workspace.
- **`LegalWork` sa v našich prekladoch nepoužíva** — píše sa LAWOSS. *(Substitučná vrstva z plánu brandingu to síce dorovná aj tak, ale naše vlastné súbory majú byť správne samy o sebe.)*
- **Slovenčina a čeština sa neodvodzujú jedna z druhej.** Právna ani technická terminológia sa nepreklápa; `AGENTS.md` to zakazuje výslovne. Preklad CZ vychádza z `en.ts`, nie zo `sk.ts`.
- **Tykanie/vykanie:** rozhranie vyká, rovnako ako to robí nemecká lokalizácia, ktorú `i18n-check` kontroluje na formálne „Sie".
- **Nepreložený kľúč je lepší než zlý preklad.** Keď si dávka nie je istá právnym pojmom, kľúč sa **vynechá** a zapíše do zoznamu na dořešenie — anglický fallback stále funguje.

### Známa cena, ktorú tento plán vedome platí

Približne **500 kľúčov patrí plochám, ktoré branding pass skrýva** — `recorder` (217), `firm_hub` (69), `account` (32), `premium_upsell` (28) a časť `mcp`. Prekladajú sa napriek tomu, lebo cieľom je **mechanicky overiteľné plné pokrytie**: len vtedy sa dá zrušiť výnimka v kontrole a mať istotu, že nikde nevyskočí anglický reťazec. Je to vedomý kompromis, nie prehliadnutie.

---

### Úloha 1: Slovník pojmov a nástroj na výpis chýbajúcich kľúčov

**Súbory:**
- Vytvoriť: `apps/app/scripts/lawoss-i18n-missing.ts`
- Vytvoriť: `apps/app/tests/lawoss-i18n-missing.test.ts`
- Vytvoriť: `docs/lawoss-slovnik-prekladu.md`

**Rozhrania:**
- Poskytuje: `missingKeys(locale: "sk" | "cs", prefixes?: string[]): Array<{ key: string; en: string }>` exportované z `apps/app/scripts/lawoss-i18n-missing.ts`. Používajú ho úlohy 2 a 3.

- [ ] **Krok 1: Napíš padajúci test**

Vytvor `apps/app/tests/lawoss-i18n-missing.test.ts`:

```ts
import { describe, expect, test } from "bun:test";

import { missingKeys } from "../scripts/lawoss-i18n-missing";

describe("výpis chýbajúcich prekladových kľúčov", () => {
  test("vráti kľúč aj s anglickým zdrojom", () => {
    const rows = missingKeys("sk", ["office_addins"]);
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row.key.startsWith("office_addins.")).toBe(true);
      expect(typeof row.en).toBe("string");
      expect(row.en.length).toBeGreaterThan(0);
    }
  });

  test("bez filtra vráti všetky chýbajúce kľúče", () => {
    expect(missingKeys("sk").length).toBeGreaterThan(1000);
    expect(missingKeys("cs").length).toBeGreaterThan(1000);
  });

  test("už preložený kľúč sa nevráti", () => {
    const keys = missingKeys("sk").map((row) => row.key);
    expect(keys).not.toContain("app.reload_later");
  });
});
```

- [ ] **Krok 2: Spusti test a over, že padá**

```bash
cd apps/app && bun test tests/lawoss-i18n-missing.test.ts
```

Očakávané: FAIL — modul neexistuje.

- [ ] **Krok 3: Napíš nástroj**

Vytvor `apps/app/scripts/lawoss-i18n-missing.ts`:

```ts
/**
 * LAWOSS: vypíše kľúče, ktoré v cieľovom jazyku ešte nie sú preložené,
 * aj s anglickým zdrojom. Bez argumentu vypíše všetko, s argumentmi
 * filtruje podľa menného priestoru:
 *
 *   bun scripts/lawoss-i18n-missing.ts sk settings mcp
 */
import en from "../src/i18n/locales/en";
import sk from "../src/i18n/locales/sk";
import cs from "../src/i18n/locales/cs";

type Dict = Record<string, string>;

const TARGETS: Record<"sk" | "cs", Dict> = { sk: sk as Dict, cs: cs as Dict };

export function missingKeys(
  locale: "sk" | "cs",
  prefixes?: string[],
): Array<{ key: string; en: string }> {
  const target = TARGETS[locale];
  const source = en as Dict;
  return Object.keys(source)
    .filter((key) => !(key in target))
    .filter((key) => !prefixes?.length || prefixes.some((p) => key.startsWith(`${p}.`)))
    .map((key) => ({ key, en: source[key]! }));
}

if (import.meta.main) {
  const [locale, ...prefixes] = process.argv.slice(2);
  if (locale !== "sk" && locale !== "cs") {
    console.error("použitie: bun scripts/lawoss-i18n-missing.ts <sk|cs> [menný-priestor…]");
    process.exit(2);
  }
  const rows = missingKeys(locale, prefixes);
  console.error(`${rows.length} chýbajúcich kľúčov`);
  for (const row of rows) console.log(`${JSON.stringify(row.key)}: ${JSON.stringify(row.en)},`);
}
```

- [ ] **Krok 4: Spusti test a over, že prechádza**

```bash
cd apps/app && bun test tests/lawoss-i18n-missing.test.ts
```

Očakávané: PASS, tri testy.

- [ ] **Krok 5: Napíš slovník pojmov**

Vytvor `docs/lawoss-slovnik-prekladu.md` — záväzné preklady pre **všetky** dávky, v dvoch stĺpcoch SK a CZ, aby sa v dávke 12 nepoužilo iné slovo než v dávke 3. Povinne pokry aspoň tieto pojmy:

`workspace` · `folder` · `session` · `matter` · `provider` · `model` · `prompt` · `skill` · `plugin` · `connector` · `settings` · `appearance` · `permission` · `approve` · `retry` · `draft` · `deadline` · `filing` · `hearing` · `evidence` · `client` · `firm` · `sign in` · `usage` · `share`

Pri každom pojme uveď aj **čo sa neprekladá a prečo**. Pravidlo, ktoré patrí do hlavičky dokumentu: *slovenský a český stĺpec sú dva nezávislé preklady z angličtiny, nie preklad jeden druhého.*

- [ ] **Krok 6: Commit**

```bash
git add apps/app/scripts/lawoss-i18n-missing.ts apps/app/tests/lawoss-i18n-missing.test.ts docs/lawoss-slovnik-prekladu.md
git commit -m "feat: nástroj na výpis chýbajúcich prekladov a slovník pojmov"
```

---

### Protokol jednej prekladovej dávky

Úlohy 2 a 3 opakujú **presne tento postup**. Dávka je najmenšia jednotka, ktorá má vlastnú kontrolu aj vlastný commit.

1. **Vypíš kľúče dávky:**
   ```bash
   cd apps/app && bun scripts/lawoss-i18n-missing.ts <sk|cs> <menné-priestory…>
   ```
2. **Prelož ich** podľa globálnych obmedzení a slovníka z úlohy 1. Pri kľúči s `_one` doplň `_few`, `_many` aj `_other`.
3. **Vlož ich do cieľového súboru** (`apps/app/src/i18n/locales/sk.ts` alebo `cs.ts`), zoradené abecedne podľa kľúča, do existujúceho exportovaného objektu.
4. **Spusti kontrolu:**
   ```bash
   cd apps/app && bun scripts/i18n-check.ts
   ```
   Očakávané: prejde. Ak hlási rozdiel zástupných znakov alebo prázdnu hodnotu, oprav dávku — **nepokračuj na ďalšiu.**
5. **Over, že počet klesol o veľkosť dávky:**
   ```bash
   cd apps/app && bun scripts/lawoss-i18n-missing.ts <sk|cs> | tail -1
   ```
6. **Commit:**
   ```bash
   git add apps/app/src/i18n/locales/<sk|cs>.ts
   git commit -m "i18n(<sk|cs>): preklad dávky <názov dávky>"
   ```
7. **Kľúče, ktoré si vynechal**, zapíš na koniec `docs/lawoss-slovnik-prekladu.md` do sekcie „Na dořešenie" aj s dôvodom.

---

### Úloha 2: Slovenčina — 3 210 kľúčov v osemnástich dávkach

**Súbory:**
- Upraviť: `apps/app/src/i18n/locales/sk.ts`
- Upraviť: `docs/lawoss-slovnik-prekladu.md` (sekcia „Na dořešenie")

**Rozhrania:**
- Spotrebúva: `missingKeys` z úlohy 1.

Každá dávka podľa protokolu vyššie. Počty sú overené voči `en.ts` k 11. 9. 2026.

- [ ] Dávka 1 — `settings` (443)
- [ ] Dávka 2 — `mcp` (240)
- [ ] Dávka 3 — `recorder` (217)
- [ ] Dávka 4 — `session` `composer` (185)
- [ ] Dávka 5 — `benchmark` (166)
- [ ] Dávka 6 — `skills` (163)
- [ ] Dávka 7 — `providers` `config` (147)
- [ ] Dávka 8 — `control` `extensions` `ext` (144)
- [ ] Dávka 9 — `identities` (137)
- [ ] Dávka 10 — `firm_hub` `account` `premium_upsell` (110)
- [ ] Dávka 11 — `fusion` `artifact` `advanced` (108)
- [ ] Dávka 12 — `tool` `tool_permissions` (106)
- [ ] Dávka 13 — `workspace_list` `debug` `personalisation` `common` `blueprint` (91)
- [ ] Dávka 14 — `office_addins` `google_workspace` (90)
- [ ] Dávka 15 — `dashboard` `welcome` (75)
- [ ] Dávka 16 — zvyšné menné priestory, prvá tretina abecedne (~263)
- [ ] Dávka 17 — zvyšné menné priestory, druhá tretina abecedne (~263)
- [ ] Dávka 18 — zvyšné menné priestory, posledná tretina abecedne (~262)

Zoznam zvyšných menných priestorov pre dávky 16 až 18 vypíš takto:

```bash
cd apps/app && bun scripts/lawoss-i18n-missing.ts sk | sed 's/^"//;s/\..*//' | sort -u
```

- [ ] **Záverečná kontrola slovenčiny**

```bash
cd apps/app && bun scripts/lawoss-i18n-missing.ts sk | tail -1
```

Očakávané: `0 chýbajúcich kľúčov` — okrem tých, ktoré sú zapísané v sekcii „Na dořešenie".

---

### Úloha 3: Čeština — 3 210 kľúčov v osemnástich dávkach

**Súbory:**
- Upraviť: `apps/app/src/i18n/locales/cs.ts`
- Upraviť: `docs/lawoss-slovnik-prekladu.md` (sekcia „Na dořešenie")

**Rozhrania:**
- Spotrebúva: `missingKeys` z úlohy 1.

**Rovnaké rozdelenie dávok ako v úlohe 2, ale preklad vychádza z `en.ts`, nie zo `sk.ts`.** Poslovenčená čeština je chyba, nie úspora času; právne pojmy sa medzi jurisdikciami nekryjú.

- [ ] Dávka 1 — `settings` (443)
- [ ] Dávka 2 — `mcp` (240)
- [ ] Dávka 3 — `recorder` (217)
- [ ] Dávka 4 — `session` `composer` (185)
- [ ] Dávka 5 — `benchmark` (166)
- [ ] Dávka 6 — `skills` (163)
- [ ] Dávka 7 — `providers` `config` (147)
- [ ] Dávka 8 — `control` `extensions` `ext` (144)
- [ ] Dávka 9 — `identities` (137)
- [ ] Dávka 10 — `firm_hub` `account` `premium_upsell` (110)
- [ ] Dávka 11 — `fusion` `artifact` `advanced` (108)
- [ ] Dávka 12 — `tool` `tool_permissions` (106)
- [ ] Dávka 13 — `workspace_list` `debug` `personalisation` `common` `blueprint` (91)
- [ ] Dávka 14 — `office_addins` `google_workspace` (90)
- [ ] Dávka 15 — `dashboard` `welcome` (75)
- [ ] Dávka 16 — zvyšné menné priestory, prvá tretina abecedne (~263)
- [ ] Dávka 17 — zvyšné menné priestory, druhá tretina abecedne (~263)
- [ ] Dávka 18 — zvyšné menné priestory, posledná tretina abecedne (~262)

- [ ] **Záverečná kontrola češtiny**

```bash
cd apps/app && bun scripts/lawoss-i18n-missing.ts cs | tail -1
```

Očakávané: `0 chýbajúcich kľúčov`.

---

### Úloha 4: Zrušenie výnimky v kontrole prekladov

Toto je definícia hotového: kontrola prestane sk a cs tolerovať ako neúplné.

**Súbory:**
- Upraviť: `apps/app/scripts/i18n-check.ts` (premenná `partial`, okolie riadku 199)
- Upraviť: `PATCHES.md`

**Rozhrania:**
- Spotrebúva: dokončené `sk.ts` a `cs.ts` z úloh 2 a 3.

- [ ] **Krok 1: Over, že obe locale sú naozaj úplné**

```bash
cd apps/app && bun scripts/lawoss-i18n-missing.ts sk | tail -1 && bun scripts/lawoss-i18n-missing.ts cs | tail -1
```

Očakávané: dvakrát `0 chýbajúcich kľúčov`. **Ak nie, úloha 4 sa nezačína.**

- [ ] **Krok 2: Odstráň výnimku**

V `apps/app/scripts/i18n-check.ts` zmaž riadok

```ts
  const partial = language === "sk" || language === "cs";
```

a odstráň `!partial &&` zo všetkých podmienok v tom cykle, takže kontrola chýbajúcich kľúčov, prebytočných kľúčov aj úplnosti množných rodín platí rovnako pre `sk`, `cs` aj `de`.

- [ ] **Krok 3: Spusti kontrolu**

```bash
cd apps/app && bun scripts/i18n-check.ts
```

Očakávané: prejde a v závere už nehlási `sk/cs use English fallback`. Ak spadne na množných rodinách, doplň chýbajúce `_few` a `_many` varianty a spusti znova.

- [ ] **Krok 4: Uprav komentár v `i18n/index.ts`**

Komentár nad `export type Language` hovorí, že sa posielajú len plne preložené jazyky. Po tejto úlohe to platí aj pre sk a cs — zmaž z neho zmienku o priebežnom dopĺňaní, ak tam je.

- [ ] **Krok 5: Spusti celú sadu**

```bash
cd apps/app && pnpm typecheck && bun test tests/ && bun scripts/i18n-check.ts
```

- [ ] **Krok 6: Doplň riadok do `PATCHES.md`**

```markdown
| `apps/app/scripts/i18n-check.ts` | Odstránená výnimka `partial` pre `sk`/`cs`; obe locale sa kontrolujú na plné pokrytie ako `de` | Preklad je dokončený, tolerancia neúplnosti by od teraz skrývala regresie | MČ | plan/preklad-sk-cz |
```

- [ ] **Krok 7: Commit**

```bash
git add apps/app/scripts/i18n-check.ts apps/app/src/i18n/index.ts PATCHES.md
git commit -m "i18n: vyžadovať plné pokrytie sk a cs v kontrole prekladov"
```

---

## Záverečné overenie

- [ ] `bun scripts/i18n-check.ts` prejde bez zmienky o fallbacku
- [ ] `pnpm typecheck` a `bun test tests/` prejdú
- [ ] **V spustenej aplikácii** prepni jazyk na slovenčinu a prejdi onboarding, sidebar, nastavenia a jednu session; potom to isté po česky. Hľadáš anglické reťazce, ktoré prežili — kontrola vie overiť existenciu kľúča, nie to, či je preklad zmysluplný.
- [ ] Sekcia „Na dořešenie" v slovníku je buď prázdna, alebo každý riadok má dôvod a vlastníka
