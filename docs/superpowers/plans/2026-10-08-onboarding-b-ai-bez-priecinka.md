# Onboarding cez priečinok, plán B: AI bez priečinka

> **Pre agentných pracovníkov:** POVINNÝ SUB-SKILL: použi `superpowers:subagent-driven-development` (odporúčané) alebo `superpowers:executing-plans` a implementuj plán úloha po úlohe. Kroky používajú checkbox (`- [ ]`) syntax na sledovanie.

**Cieľ:** Advokát pripojí a overí AI model ešte predtým, ako pripojí prvý priečinok, a nastavený model mu ostane aj po pripojení klientov.

**Architektúra:**
- **Interný domovský priestor:** desktop pri štarte bez lokálneho pracovného priečinka zaregistruje prázdny priečinok `<userData>/lawoss-domov` (bez klientskych dát, `appFiles: "outside"`, nič sa doň nezapisuje) a spustí nad ním engine. Natívne stránky (krok AI v onboardingu, Nastavenia → Poskytovatelia AI) tak dostanú klienta enginu bez zmeny ich logiky.
- **Skrytie:** appka domovský priestor nikde neukazuje (bočný panel, OKF, výber priečinka) a vždy uprednostní skutočný priečinok.
- **Globálni vlastní poskytovatelia:** vlastný poskytovateľ (Ollama, LM Studio, OpenAI-compatible) sa dnes ukladá pri každom priečinku zvlášť, takže by sa po prechode z domovského priestoru na klienta stratil. Uložia sa do globálneho riadku `__global_providers__`, rovnako ako konektory (`__global_mcp__`).

**Tech stack:** TypeScript, Electron (`node --test` v `apps/desktop`), server (`bun test` v `apps/server`), appka (`bun test` v `apps/app`), pnpm 11.4.0, Node 24.

**Spec:** [lawOSS-like-SK-CZ `specs/2026-10-08-onboarding-pripojit-priecinok.md`](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/92) (po zlúčení v `main` na rovnakej ceste), časť „AI bez priečinka (P8)“ (PR #92, schválil MČ 8. 10. 2026).

## Zistenia, z ktorých plán vychádza (overené v kóde 8. 10. 2026)

| Čo | Kde | Dôsledok |
|---|---|---|
| Bez lokálneho priečinka sa nespustí server ani engine | `apps/desktop/electron/main.mjs:1283-1284` (`skipped: "no-local-workspace"`), `apps/server/src/embedded.ts:150` | „Nepripojené k serveru“ v Poskytovateľoch AI aj `no-workspace` v kroku AI (`ai-step.tsx:155`) |
| API kľúče a OAuth (ChatGPT, Anthropic) sú globálne | `store.ts:899` (`c.auth.set`), SDK `PUT /auth/{providerID}` bez `directory`; `auth.json` v XDG data home | prihlásenie v domovskom priestore platí aj pre klientov |
| Vlastný poskytovateľ je pri priečinku | `store.ts:920-923` → `PATCH /workspace/:id/config` → `server.ts:3600-3609` do riadku `workspace.id` | po prechode na klienta by Ollama zmizla; treba globálny riadok |
| Predvolený model je v localStorage appky | `apps/app/src/app/constants.ts:13`, `react-app/kernel/model-config.ts:150-166` | platí globálne, netreba nič robiť |
| `disabled_providers` je v `.opencode/opencode.jsonc` priečinka | `store.ts:397-440` | pripojenie poskytovateľa ho z priečinka odoberá; nový priečinok začína prázdnym zoznamom, takže prihlásený poskytovateľ v ňom funguje. Mimo rozsahu. |
| Skryté priečinky už existujú pre šablóny workflowov | `session-route.tsx:647-658` (filter len v bočnom paneli) | rovnaký vzor, ale s filtrom na všetkých miestach, kde sa vyberá priečinok |

## Global Constraints

- Žltá zóna: každý zmenený upstream súbor má riadok v `PATCHES.md` v tom istom PR (AGENTS.md forku).
- Nová logika patrí do nových súborov LAWOSS (`apps/desktop/electron/lawoss-*.mjs`, `apps/app/src/lawoss/**`); do upstream súborov len volanie.
- Žiadne paralelné nastavenia LAWOSS: krok AI aj Poskytovatelia AI ostávajú natívne, plán im len dodá engine (AGENTS.md, „Native UI first“).
- Do domovského priestoru sa nikdy nezapisujú klientske dáta; registruje sa ako `appFiles: "outside"`.
- Desktop smoke len izolovane: `HOME`, `XDG_CONFIG_HOME`, `XDG_DATA_HOME`, `XDG_STATE_HOME`, `XDG_CACHE_HOME`, `LEGALWORK_ELECTRON_USERDATA`, `LEGALWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY=1`; po behu `find ~/.config/legalwork ~/.config/opencode ~/.legalwork -newer <marker>` musí byť prázdne.
- TypeScript bez `any` a `as`; commity po slovensky.

## Review Focus

- **Advokát pripojí Ollamu v domovskom priestore a potom pridá klienta:** Ollama musí byť v zozname modelov aj v klientovi. Test v úlohe 1 a v smoke (úloha 4).
- **Existujúci používateľ má Ollamu uloženú pri priečinku (starý riadok):** po aktualizácii mu nesmie zmiznúť ani sa zdvojiť. Pri odpojení sa musí odstrániť z oboch miest. Test v úlohe 1.
- **Po pridaní prvého klienta sa nastavenia a krok AI nesmú „zaseknúť“ na domovskom priestore:** výber vždy uprednostní skutočný priečinok. Test v úlohe 3.
- **Domovský priestor sa nesmie objaviť v bočnom paneli, v zozname klientov OKF ani vo výbere priečinka pre nový spis.** Test v úlohe 3.
- **Po pridaní prvého klienta:** domovský priestor ostane zaregistrovaný (aj po obnove zo `server.json`), nový nevznikne a vybraný je klient. Test v úlohe 2; skrytie v úlohe 3.

---

### Úloha 1: Vlastní poskytovatelia v globálnom riadku

**Files:**
- Modify: `apps/server/src/runtime-opencode-config-store.ts` (nová konštanta a čítanie pri `GLOBAL_MCP_ID`, riadok 232)
- Modify: `apps/server/src/legalwork-runtime-config.ts` (`providerMap` riadok 237 až 244, filter v `keepLegalworkRuntimeConfigFileFresh` riadok 356 až 368)
- Modify: `apps/server/src/server.ts` (vetva `providerUpdate`, riadok 3600 až 3609)
- Modify: `apps/server/src/runtime-provider-repair.ts` (`repairAllWorkspaceRuntimeProviders`, riadok 109)
- Modify: `PATCHES.md`
- Test: `apps/server/src/legalwork-runtime-config.test.ts`

**Interfaces:**
- Consumes: `mergeRuntimeProviderPatch`, `readRuntimeOpencodeConfig`, `writeRuntimeOpencodeConfig`, `repairRuntimeProviders`.
- Produces:
  - `GLOBAL_PROVIDERS_ID = "__global_providers__"`
  - `readGlobalProviderMap(config: ServerConfig): Promise<Record<string, unknown>>`
  - konfigurácia enginu pre akýkoľvek priečinok obsahuje globálnych poskytovateľov; riadok priečinka (staré dáta) má prednosť pri rovnakom id

- [ ] **Krok 1: Napíš padajúce testy**

Do `apps/server/src/legalwork-runtime-config.test.ts` pridaj import `GLOBAL_PROVIDERS_ID` z `./runtime-opencode-config-store.js` a na koniec `describe("legalwork runtime config file")`:

```ts
  test("globálni vlastní poskytovatelia sa dostanú do každého priečinka", async () => {
    const { config } = await setup();
    const ollama = { npm: "@ai-sdk/openai-compatible", name: "Ollama", options: { baseURL: "http://localhost:11434/v1" }, models: { "gemma4:12b-mlx": { name: "gemma4" } } };
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, (current) => ({ ...current, provider: { ollama } }));
    await writeLegalworkRuntimeConfigFile(config, "ws_1");
    const parsed = await readConfigFile(config);
    expect((parsed.provider as Record<string, unknown>).ollama).toEqual(ollama);
  });

  test("starý poskytovateľ uložený pri priečinku má prednosť pred globálnym s rovnakým id", async () => {
    const { config } = await setup();
    const global = { npm: "@ai-sdk/openai-compatible", name: "Ollama (global)", options: { baseURL: "http://localhost:11434/v1" } };
    const local = { npm: "@ai-sdk/openai-compatible", name: "Ollama (priečinok)", options: { baseURL: "http://127.0.0.1:11434/v1" } };
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, (current) => ({ ...current, provider: { ollama: global } }));
    await writeRuntimeOpencodeConfig(config, "ws_1", (current) => ({ ...current, provider: { ollama: local } }));
    await writeLegalworkRuntimeConfigFile(config, "ws_1");
    expect(((await readConfigFile(config)).provider as Record<string, Record<string, unknown>>).ollama?.name).toBe("Ollama (priečinok)");
  });

  test("zápis globálnych poskytovateľov obnoví súbor konfigurácie priečinka", async () => {
    const { config } = await setup();
    const stop = keepLegalworkRuntimeConfigFileFresh(config, "ws_1");
    cleanups.push(stop);
    await writeLegalworkRuntimeConfigFile(config, "ws_1");
    await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, (current) => ({ ...current, provider: { lmstudio: { npm: "@ai-sdk/openai-compatible", name: "LM Studio", options: { baseURL: "http://localhost:1234/v1" } } } }));
    for (let i = 0; i < 50; i++) {
      const provider = (await readConfigFile(config)).provider as Record<string, unknown> | undefined;
      if (provider?.lmstudio) return;
      await new Promise(resolve => setTimeout(resolve, 20));
    }
    throw new Error("Config file was not refreshed after a global provider write.");
  });
```

Do nového súboru `apps/server/src/lawoss-global-providers.e2e.test.ts` (nový súbor LAWOSS, bez riadku v PATCHES) daj test cesty `PATCH /workspace/:id/config`. Otvor `apps/server/src/lawoss-register-existing.e2e.test.ts` a prevezmi z neho spôsob, akým spúšťa server a posiela požiadavky (pomocná funkcia na štart a `fetch` s tokenom). Test:

```ts
test("PATCH provider zapíše do globálneho riadku; null odstráni z globálneho aj zo starého riadku priečinka", async () => {
  // štart servera s jedným lokálnym priečinkom `ws` podľa lawoss-register-existing.e2e.test.ts
  const ollama = { npm: "@ai-sdk/openai-compatible", name: "Ollama", options: { baseURL: "http://localhost:11434/v1" } };
  await patchConfig(ws.id, { opencode: { provider: { ollama } } });
  expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider).toEqual({ ollama });
  expect((await readRuntimeOpencodeConfig(config, ws.id)).provider ?? {}).toEqual({});
  await writeRuntimeOpencodeConfig(config, ws.id, (current) => ({ ...current, provider: { ollama } })); // starý stav
  await patchConfig(ws.id, { opencode: { provider: { ollama: null } } });
  expect((await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider ?? {}).toEqual({});
  expect((await readRuntimeOpencodeConfig(config, ws.id)).provider ?? {}).toEqual({});
});
```

`patchConfig(id, body)` je `fetch(`${baseUrl}/workspace/${id}/config`, { method: "PATCH", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body) })` s kontrolou `response.ok`.

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd apps/server && bun test src/legalwork-runtime-config.test.ts src/lawoss-global-providers.e2e.test.ts`
Expected: FAIL, `GLOBAL_PROVIDERS_ID` nie je exportované.

- [ ] **Krok 3: Implementuj globálny riadok**

`apps/server/src/runtime-opencode-config-store.ts`, hneď za `readGlobalMcpMap`:

```ts
/**
 * LAWOSS: vlastní poskytovatelia (Ollama, LM Studio, OpenAI-compatible) pre každý priečinok,
 * ako konektory v GLOBAL_MCP_ID. Prihlásenia (auth.json) sú v engine globálne už dnes;
 * bez tohto riadku by sa vlastný poskytovateľ stratil pri prechode na iný priečinok.
 */
export const GLOBAL_PROVIDERS_ID = "__global_providers__";

export async function readGlobalProviderMap(config: ServerConfig): Promise<Record<string, unknown>> {
  const provider = (await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID)).provider;
  return isRecord(provider) ? { ...provider } : {};
}
```

`apps/server/src/legalwork-runtime-config.ts`:

1. Import rozšír o `GLOBAL_PROVIDERS_ID` a `readGlobalProviderMap`.
2. Pred `const providerMap = {` pridaj:

```ts
  const globalProviders = config ? await readGlobalProviderMap(config) : {};
```

3. `providerMap` zmeň na:

```ts
  const providerMap = {
    // LAWOSS: globálni vlastní poskytovatelia; starý riadok priečinka má pri rovnakom id prednosť.
    ...repairRuntimeProviders({ ...globalProviders, ...(runtimeConfig.provider ?? {}) }).providers,
    ...(paidProvider ? { [EIGENWELT_PROVIDER_ID]: paidProvider } : {}),
  };
```

4. V `keepLegalworkRuntimeConfigFileFresh` doplň do podmienky `writtenWorkspaceId !== GLOBAL_PROVIDERS_ID &&`.

`apps/server/src/server.ts`, vetvu `providerUpdate` (riadky 3600 až 3609) nahraď:

```ts
      const providerUpdate = ensurePlainObject(provider);
      if (Object.keys(providerUpdate).length) {
        // LAWOSS: vlastní poskytovatelia sú globálni (GLOBAL_PROVIDERS_ID). `null` odstráni
        // poskytovateľa z globálneho riadku aj zo starého riadku priečinka.
        const globalRuntime = await readRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID);
        const nextGlobal = mergeRuntimeProviderPatch(ensurePlainObject(globalRuntime.provider), providerUpdate);
        await writeRuntimeOpencodeConfig(config, GLOBAL_PROVIDERS_ID, (current) => ({
          ...current,
          provider: Object.keys(nextGlobal).length ? nextGlobal : undefined,
        }));
        const removals = Object.fromEntries(Object.entries(providerUpdate).filter(([, value]) => value === null));
        if (Object.keys(removals).length) {
          const currentRuntime = await readRuntimeOpencodeConfig(config, workspace.id);
          const nextLocal = mergeRuntimeProviderPatch(ensurePlainObject(currentRuntime.provider), removals);
          logicalUpdates.provider = Object.keys(nextLocal).length ? nextLocal : undefined;
        }
      }
```

Doplň import `GLOBAL_PROVIDERS_ID` zo `./runtime-opencode-config-store.js` (vedľa `GLOBAL_TOOL_PERMISSIONS_ID`).

`apps/server/src/runtime-provider-repair.ts`: štartovacia oprava (`repairAllWorkspaceRuntimeProviders`, riadok 109) dnes prechádza len hosťované priečinky, takže vyradený alebo poškodený blok v globálnom riadku by sa len filtroval, nikdy neodstránil. Za cyklus `for (const workspace of config.workspaces)` pridaj:

```ts
  // LAWOSS: aj globálny riadok vlastných poskytovateľov (GLOBAL_PROVIDERS_ID).
  try {
    for (const notice of await repairWorkspaceRuntimeProviders(config, GLOBAL_PROVIDERS_ID)) {
      console.warn(`Removed provider "${notice.providerId}" from global providers (${notice.reason}).`);
    }
  } catch (error) {
    console.warn(`Provider repair failed for global providers: ${error instanceof Error ? error.message : String(error)}`);
  }
```

s importom `GLOBAL_PROVIDERS_ID` zo `./runtime-opencode-config-store.js`. Overené 8. 10.: `repairRuntimeProviders` (`runtime-provider-repair.ts:60`) nechá platný blok bez zmeny (`kept[id] = block`, schéma `z.looseObject`), takže očakávanie `toEqual(ollama)` v teste platí.

Pozor: blok `if (Object.keys(logicalUpdates).length || …)` pod tým zapíše `logicalUpdates` do riadku priečinka. Keď je `logicalUpdates.provider === undefined` a kľúč existuje, `Object.keys(...).length` je 1 a zápis prebehne s `provider: undefined`, čo pole z riadku odstráni. To je zamýšľané správanie.

- [ ] **Krok 4: Over, ako appka číta poskytovateľov späť**

Run: `rg -n "readRuntimeOpencodeConfig\(config, workspace.id\)" apps/server/src/server.ts | head`
Over každé miesto, ktoré vracia appke zoznam vlastných poskytovateľov (napríklad `GET /workspace/:id/config`). Ak niektoré vracia len `runtimeConfig.provider` priečinka, zlúč doň globálnych rovnakým spôsobom ako v kroku 3 (`{ ...globalProviders, ...runtime.provider }`) a pridaj test do `lawoss-global-providers.e2e.test.ts`, ktorý po `PATCH` prečíta `GET /workspace/:id/config` a nájde `ollama`. Ak také miesto nie je (zoznam ide len z enginu cez `client.provider.list`), zapíš to do popisu PR.

- [ ] **Krok 5: Spusti testy**

Run: `cd apps/server && bun test src/legalwork-runtime-config.test.ts src/lawoss-global-providers.e2e.test.ts src/runtime-opencode-config-store.provider-patch.test.ts && pnpm typecheck`
Expected: PASS a typecheck bez chýb.

- [ ] **Krok 6: PATCHES a commit**

Do `PATCHES.md` pridaj riadok:

```markdown
| `apps/server/src/runtime-opencode-config-store.ts`, `apps/server/src/legalwork-runtime-config.ts`, `apps/server/src/server.ts`, `apps/server/src/runtime-provider-repair.ts` | Nový riadok `GLOBAL_PROVIDERS_ID` a `readGlobalProviderMap()`; konfigurácia enginu zlúči globálnych vlastných poskytovateľov pod riadok priečinka; `PATCH /workspace/:id/config` zapisuje `provider` do globálneho riadku, `null` odstráni z oboch; obnova súboru reaguje aj na globálny riadok; štartovacia oprava čistí aj globálny riadok | Vlastný poskytovateľ (Ollama) nastavený pred prvým priečinkom alebo v jednom klientovi musí platiť pre všetkých (spec 2026-10-08, P8); vzor `GLOBAL_MCP_ID` | MČ | (číslo PR) |
```

```bash
git add apps/server/src/runtime-opencode-config-store.ts apps/server/src/legalwork-runtime-config.ts apps/server/src/server.ts apps/server/src/runtime-provider-repair.ts apps/server/src/legalwork-runtime-config.test.ts apps/server/src/lawoss-global-providers.e2e.test.ts PATCHES.md
git commit -m "feat: vlastní poskytovatelia AI platia pre všetky priečinky"
```

---

### Úloha 2: Domovský priestor pri štarte bez priečinka

**Files:**
- Create: `apps/desktop/electron/lawoss-home-workspace.mjs`
- Create: `apps/desktop/electron/lawoss-home-workspace.test.mjs`
- Modify: `apps/desktop/electron/main.mjs` (`bootRuntimeForSelectedWorkspace`, riadok 1276 až 1285)
- Modify: `apps/desktop/package.json` (zoznam testov v `"test"`)
- Modify: `PATCHES.md`

**Interfaces:**
- Consumes: `workspaceStore.readWorkspaceState()`, `workspaceStore.createWorkspace({ folderPath, registerExisting, appFiles, name })` (`workspace-store.mjs:675`).
- Produces:
  - `LAWOSS_HOME_DIR_NAME = "lawoss-domov"`
  - `lawossHomeWorkspacePath(userData: string): string`
  - `ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir }): Promise<boolean>`: vráti `true`, ak priestor práve zaregistroval; nič nerobí, keď existuje lokálny priečinok
  - appka (úloha 3) rozpozná domovský priestor podľa posledného segmentu cesty `lawoss-domov`

- [ ] **Krok 1: Napíš padajúce testy**

`apps/desktop/electron/lawoss-home-workspace.test.mjs`:

```js
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, realpath } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";

import { createWorkspaceStore } from "./workspace-store.mjs";
import { ensureLawossHomeWorkspace, lawossHomeWorkspacePath, LAWOSS_HOME_DIR_NAME } from "./lawoss-home-workspace.mjs";

async function fixture() {
  const root = await realpath(await mkdtemp(path.join(tmpdir(), "lawoss-home-")));
  const userData = path.join(root, "userData");
  await mkdir(userData);
  const workspaceStore = createWorkspaceStore({ app: { getPath: () => userData }, defaultDenBaseUrl: "https://example.test", defaultRequireSignin: false, forceRequireSignin: false });
  return { root, userData, workspaceStore };
}

test("bez priečinka zaregistruje prázdny domovský priestor mimo klientov, bez zápisu doň", async () => {
  const { userData, workspaceStore } = await fixture();
  assert.equal(await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir }), true);
  const state = await workspaceStore.readWorkspaceState();
  assert.equal(state.workspaces.length, 1);
  assert.equal(state.workspaces[0].path, lawossHomeWorkspacePath(userData));
  assert.equal(path.basename(state.workspaces[0].path), LAWOSS_HOME_DIR_NAME);
  assert.equal(state.workspaces[0].appFiles, "outside");
  assert.deepEqual(await readdir(lawossHomeWorkspacePath(userData)), []);
});

test("s existujúcim lokálnym priečinkom nerobí nič", async () => {
  const { root, userData, workspaceStore } = await fixture();
  const client = path.join(root, "Klient");
  await mkdir(client);
  await workspaceStore.createWorkspace({ folderPath: client, registerExisting: true });
  assert.equal(await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir }), false);
  assert.equal((await workspaceStore.readWorkspaceState()).workspaces.length, 1);
});

test("opakované volanie je idempotentné", async () => {
  const { userData, workspaceStore } = await fixture();
  await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir });
  assert.equal(await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir }), false);
  assert.equal((await workspaceStore.readWorkspaceState()).workspaces.length, 1);
});

test("po pridaní klienta ostane domovský priestor v zozname, ale nový nevznikne a klient je vybraný", async () => {
  const { root, userData, workspaceStore } = await fixture();
  await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir });
  const client = path.join(root, "Klient");
  await mkdir(client);
  await workspaceStore.createWorkspace({ folderPath: client, registerExisting: true });
  assert.equal(await ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir }), false);
  const state = await workspaceStore.readWorkspaceState();
  assert.equal(state.workspaces.length, 2);
  assert.equal(state.workspaces.find((entry) => entry.id === state.selectedId)?.path, client);
});
```

Do `apps/desktop/package.json` v skripte `"test"` pridaj na koniec zoznamu ` electron/lawoss-home-workspace.test.mjs`.

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd apps/desktop && node --test electron/lawoss-home-workspace.test.mjs`
Expected: FAIL, `Cannot find module './lawoss-home-workspace.mjs'`.

- [ ] **Krok 3: Implementuj modul**

`apps/desktop/electron/lawoss-home-workspace.mjs`:

```js
// LAWOSS: interný domovský priestor (spec 2026-10-08, P8). Bez lokálneho priečinka sa nespustí
// server ani engine, takže sa nedá nastaviť AI. Prázdny priečinok v userData bez klientskych dát
// dá natívnym stránkam (krok AI, Poskytovatelia AI) engine; appka ho skrýva (lawoss/home-workspace.ts).
import path from "node:path";

export const LAWOSS_HOME_DIR_NAME = "lawoss-domov";

export function lawossHomeWorkspacePath(userData) {
  return path.join(userData, LAWOSS_HOME_DIR_NAME);
}

/** Zaregistruje domovský priestor, len ak nie je žiadny lokálny priečinok. Vráti, či ho práve zaregistroval. */
export async function ensureLawossHomeWorkspace({ userData, workspaceStore, mkdir }) {
  const state = await workspaceStore.readWorkspaceState();
  const local = state.workspaces.filter((entry) => entry?.workspaceType !== "remote" && String(entry?.path ?? "").trim());
  if (local.length) return false;
  const folderPath = lawossHomeWorkspacePath(userData);
  await mkdir(folderPath, { recursive: true });
  await workspaceStore.createWorkspace({ folderPath, registerExisting: true, appFiles: "outside", name: "LAWOSS" });
  return true;
}
```

Poznámka: `createWorkspace` s `registerExisting: true` vyžaduje kanonickú cestu (`workspace-store.mjs:696`). Ak `userData` na niektorom systéme nie je kanonická (napríklad `/var` → `/private/var` na macOS), použi v `lawossHomeWorkspacePath` kanonický `userData`: v `ensureLawossHomeWorkspace` po `mkdir` urob `const canonical = await realpath(folderPath)` (import `realpath` z `node:fs/promises`) a registruj `canonical`. Test v kroku 1 používa `realpath` koreňa, takže prejde v oboch prípadoch.

- [ ] **Krok 4: Zapoj modul do štartu**

V `apps/desktop/electron/main.mjs` pridaj import:

```js
import { ensureLawossHomeWorkspace } from "./lawoss-home-workspace.mjs";
```

a na začiatok `bootRuntimeForSelectedWorkspace` (pred `const list = await workspaceStore.readWorkspaceState();`):

```js
  // 🟡 LAWOSS: bez lokálneho priečinka domovský priestor, aby sa dala nastaviť AI (spec 2026-10-08, P8).
  await ensureLawossHomeWorkspace({ userData: app.getPath("userData"), workspaceStore, mkdir }).catch((error) => {
    console.warn("[lawoss] domovský priestor sa nepodarilo pripraviť", error);
  });
```

Over, že `mkdir` z `node:fs/promises` je v `main.mjs` importované (`rg -n "^import .*mkdir" apps/desktop/electron/main.mjs`); ak nie, doplň ho do existujúceho importu z `node:fs/promises`.

- [ ] **Krok 5: Spusti testy**

Run: `cd apps/desktop && node --test electron/lawoss-home-workspace.test.mjs electron/workspace-store.test.mjs`
Expected: PASS.

- [ ] **Krok 6: PATCHES a commit**

```markdown
| `apps/desktop/electron/main.mjs`, `apps/desktop/package.json` | `bootRuntimeForSelectedWorkspace` najprv volá `ensureLawossHomeWorkspace()` (nový `lawoss-home-workspace.mjs`): bez lokálneho priečinka zaregistruje prázdny `userData/lawoss-domov` ako `appFiles: "outside"`; test pridaný do skriptu `test` | Bez priečinka sa nespustí server ani engine a nedá sa nastaviť AI (spec 2026-10-08, P8) | MČ | (číslo PR) |
```

```bash
git add apps/desktop/electron/lawoss-home-workspace.mjs apps/desktop/electron/lawoss-home-workspace.test.mjs apps/desktop/electron/main.mjs apps/desktop/package.json PATCHES.md
git commit -m "feat: domovský priestor, aby sa AI dala nastaviť bez priečinka"
```

---

### Úloha 3: Skrytie domovského priestoru a prednosť skutočného priečinka

**Files:**
- Create: `apps/app/src/lawoss/home-workspace.ts`
- Test: `apps/app/tests/lawoss-home-workspace.test.ts`
- Modify: `apps/app/src/lawoss/domains/onboarding/ai-step.tsx` (`resolveOpencodeTarget`, riadok 161 až 165)
- Modify: `apps/app/src/react-app/shell/session-route.tsx` (filter bočného panela, riadok 647 až 654)
- Modify: `apps/app/src/react-app/shell/settings-route.tsx` (`selectedWorkspace`, riadok 521 až 524)
- Modify: `apps/app/src/lawoss/okf/connection.ts` (zoznam priečinkov, riadok 28 až 50)
- Modify: `apps/app/src/lawoss/domains/novy-spis/novy-spis-page.tsx` (výber priečinka, riadok 417)
- Modify: `apps/app/src/lawoss/domains/onboarding/lawoss-welcome-page.tsx` (zoznam priečinkov, riadok 705 až 728)
- Modify: `PATCHES.md`

**Interfaces:**
- Consumes: `LAWOSS_HOME_DIR_NAME` z úlohy 2 (rovnaká hodnota, appka ju nemôže importovať z Electronu, preto konštanta v appke).
- Produces:
  - `isLawossHomeWorkspace(workspace: { path?: string | null }): boolean`
  - `withoutLawossHome<T extends { path?: string | null }>(list: readonly T[]): T[]`
  - `preferRealWorkspace<T extends { path?: string | null; workspaceType?: string }>(list: readonly T[], activeId?: string | null, idOf?: (item: T) => string): T | undefined`

- [ ] **Krok 1: Napíš padajúce testy**

`apps/app/tests/lawoss-home-workspace.test.ts`:

```ts
import { describe, expect, test } from "bun:test";
import { isLawossHomeWorkspace, preferRealWorkspace, withoutLawossHome } from "../src/lawoss/home-workspace";

const home = { id: "ws_home", path: "/Users/a/Library/Application Support/LAWOSS/lawoss-domov", workspaceType: "local" };
const homeWin = { id: "ws_home_win", path: "C:\\Users\\a\\AppData\\Roaming\\LAWOSS\\lawoss-domov", workspaceType: "local" };
const client = { id: "ws_client", path: "/Users/a/Klienti/Novák s.r.o", workspaceType: "local" };
const remote = { id: "ws_remote", path: "", workspaceType: "remote" };

describe("domovský priestor", () => {
  test("rozpozná sa podľa posledného segmentu na macOS aj Windows", () => {
    expect(isLawossHomeWorkspace(home)).toBe(true);
    expect(isLawossHomeWorkspace(homeWin)).toBe(true);
    expect(isLawossHomeWorkspace(client)).toBe(false);
    expect(isLawossHomeWorkspace({ path: "/Users/a/lawoss-domov-zaloha" })).toBe(false);
    expect(isLawossHomeWorkspace({ path: null })).toBe(false);
  });
  test("zoznam pre používateľa ho neobsahuje", () => {
    expect(withoutLawossHome([home, client, remote])).toEqual([client, remote]);
  });
  test("skutočný priečinok má prednosť aj pred aktívnym domovským", () => {
    expect(preferRealWorkspace([home, client], "ws_home", item => item.id)).toEqual(client);
    expect(preferRealWorkspace([client, home], "ws_client", item => item.id)).toEqual(client);
  });
  test("bez skutočného priečinka sa použije domovský, vzdialený nie", () => {
    expect(preferRealWorkspace([remote, home], null, item => item.id)).toEqual(home);
    expect(preferRealWorkspace([remote], null, item => item.id)).toBeUndefined();
  });
});
```

- [ ] **Krok 2: Over, že testy padajú**

Run: `cd apps/app && bun test tests/lawoss-home-workspace.test.ts`
Expected: FAIL, modul neexistuje.

- [ ] **Krok 3: Implementuj modul**

`apps/app/src/lawoss/home-workspace.ts`:

```ts
/**
 * Interný domovský priestor (spec 2026-10-08, P8): prázdny priečinok `lawoss-domov` v dátach appky,
 * ktorý desktop zaregistruje, keď nie je žiadny priečinok (apps/desktop/electron/lawoss-home-workspace.mjs).
 * Používateľ ho nikde nevidí a skutočný priečinok má vždy prednosť.
 */
export const LAWOSS_HOME_DIR_NAME = "lawoss-domov";

type WithPath = { path?: string | null };

export function isLawossHomeWorkspace(workspace: WithPath): boolean {
  const path = workspace.path?.trim();
  if (!path) return false;
  return path.split(/[\\/]+/).filter(Boolean).at(-1) === LAWOSS_HOME_DIR_NAME;
}

export function withoutLawossHome<T extends WithPath>(list: readonly T[]): T[] {
  return list.filter(item => !isLawossHomeWorkspace(item));
}

/** Aktívny skutočný priečinok, inak prvý skutočný lokálny, inak domovský; vzdialený sa tu nevyberá. */
export function preferRealWorkspace<T extends WithPath & { workspaceType?: string }>(list: readonly T[], activeId?: string | null, idOf: (item: T) => string = () => ""): T | undefined {
  const local = list.filter(item => item.workspaceType !== "remote");
  const real = withoutLawossHome(local);
  return real.find(item => activeId && idOf(item) === activeId) ?? real[0] ?? local.find(isLawossHomeWorkspace);
}
```

- [ ] **Krok 4: Zapoj filtre a prednosť**

1. `apps/app/src/lawoss/domains/onboarding/ai-step.tsx`, v `resolveOpencodeTarget` nahraď výber priečinka (riadky 161 až 165):

```ts
  const workspace = preferRealWorkspace(list.items, list.activeId, item => item.id) ?? list.items.find((item) => item.id === list.activeId);
```

   Druhá časť zachová pôvodné správanie, keď je aktívny len vzdialený priečinok (`preferRealWorkspace` vzdialené nevyberá).

   a pridaj import `import { preferRealWorkspace } from "../../home-workspace";`.

2. `apps/app/src/react-app/shell/session-route.tsx`, filter bočného panela (riadok 652):

```ts
    () => withoutLawossHome(workspaces).filter((workspace) => !hiddenTemplateWorkspaceIds.includes(workspace.id)),
```

   s importom `import { withoutLawossHome } from "@/lawoss/home-workspace";`.

3. `apps/app/src/react-app/shell/settings-route.tsx`, `selectedWorkspace` (riadky 521 až 524):

```ts
  const selectedWorkspace = useMemo(
    () => workspaces.find((workspace) => workspace.id === selectedWorkspaceId) ?? (selectedWorkspaceId ? null : preferRealWorkspace(workspaces) ?? workspaces[0] ?? null),
    [selectedWorkspaceId, workspaces],
  );
```

   s importom `import { preferRealWorkspace } from "@/lawoss/home-workspace";`. Koncové `?? workspaces[0]` zachová pôvodné správanie pre používateľa, ktorý má len vzdialený priečinok. Over, že typ položiek `workspaces` má `path` a `workspaceType` (`rg -n "workspaceType" apps/app/src/react-app/shell/settings-route.tsx | head -3`).

4. `apps/app/src/lawoss/okf/connection.ts` (riadky 28 až 50): zoznam, ktorý funkcia vracia, obaľ do `withoutLawossHome(...)`.

5. `apps/app/src/lawoss/domains/novy-spis/novy-spis-page.tsx` (riadok 417): zoznam priečinkov pre výber obaľ do `withoutLawossHome(...)`.

6. `apps/app/src/lawoss/domains/onboarding/lawoss-welcome-page.tsx` (riadky 705 až 728): zoznam existujúcich priečinkov obaľ do `withoutLawossHome(...)`.

Pre body 4 až 6 si pred úpravou pozri presný riadok (`sed -n` okolo uvedeného čísla) a obaľ práve výraz so zoznamom priečinkov; logiku okolo nemeň.

- [ ] **Krok 5: Spusti testy a typecheck**

Run: `cd apps/app && bun test tests/lawoss-home-workspace.test.ts tests/lawoss-onboarding-ai-step.test.tsx && pnpm typecheck`
Expected: PASS a typecheck bez chýb. Ak `pnpm typecheck` v `apps/app` neexistuje, použi príkaz zo skriptov v `apps/app/package.json` (`rg -n '"typecheck' apps/app/package.json`).

- [ ] **Krok 6: PATCHES a commit**

```markdown
| `apps/app/src/react-app/shell/session-route.tsx`, `apps/app/src/react-app/shell/settings-route.tsx` | Bočný panel filtruje `withoutLawossHome()`; nastavenia bez vybraného priečinka berú `preferRealWorkspace()` namiesto `workspaces[0]` | Domovský priestor (`lawoss-domov`) je len technický engine pre AI pred prvým priečinkom; používateľ ho nevidí a skutočný priečinok má prednosť (spec 2026-10-08, P8) | MČ | (číslo PR) |
```

```bash
git add apps/app/src/lawoss/home-workspace.ts apps/app/tests/lawoss-home-workspace.test.ts apps/app/src/lawoss/domains/onboarding/ai-step.tsx apps/app/src/react-app/shell/session-route.tsx apps/app/src/react-app/shell/settings-route.tsx apps/app/src/lawoss/okf/connection.ts apps/app/src/lawoss/domains/novy-spis/novy-spis-page.tsx apps/app/src/lawoss/domains/onboarding/lawoss-welcome-page.tsx PATCHES.md
git commit -m "feat: domovský priestor skrytý, skutočný priečinok má prednosť"
```

---

### Úloha 4: Overenie na zabalenej appke

**Files:** žiadne zmeny kódu; výsledok ide do popisu PR.

- [ ] **Krok 1: Zabal appku**

Run: `export PATH="$HOME/.nvm/versions/node/v24.19.0/bin:$PATH" && pnpm install --frozen-lockfile && pnpm --filter @legalwork/desktop package:electron:dir`
Expected: `apps/desktop/dist-electron/mac-arm64/LAWOSS.app`.

- [ ] **Krok 2: Spusti na izolovanom profile**

Vytvor priečinok `P` v scratchpade, `touch $P/marker` a spusti:

```bash
HOME=$P/home XDG_CONFIG_HOME=$P/home/.config XDG_DATA_HOME=$P/home/.local/share XDG_STATE_HOME=$P/home/.local/state XDG_CACHE_HOME=$P/home/.cache LEGALWORK_ELECTRON_USERDATA=$P/userdata LEGALWORK_DESKTOP_DISABLE_WORKSPACE_RECOVERY=1 apps/desktop/dist-electron/mac-arm64/LAWOSS.app/Contents/MacOS/LAWOSS
```

- [ ] **Krok 3: Prejdi scenár a zaznamenaj výsledky**

1. Bez priečinka otvor Nastavenia → Poskytovatelia AI: zoznam sa načíta, žiadne „Nepripojené k serveru“.
2. Pridaj vlastného poskytovateľa Ollama (`http://localhost:11434/v1`), ak beží lokálne. Ak nebeží, pridaj OpenAI-compatible poskytovateľa so syntetickou adresou: overuje sa uloženie, nie odpoveď.
3. V onboardingu krok AI ukáže stav modelu, nie „no-workspace“. Klikni na tlačidlo, ktoré otvára nastavenia AI: musí otvoriť Poskytovateľov AI. Neoverené v kóde: `settings-route.tsx:380-383` počas nedokončeného onboardingu presmeruje na `/session`. Ak sa to stane, zapíš to do PR ako zistenie pre plán C (tok onboardingu); cieľ plánu B (engine bez priečinka) to nespochybňuje, ale krok AI v onboardingu sa potom nedá dokončiť z tohto tlačidla.
4. Pridaj syntetický priečinok klienta (prázdny priečinok v `$P`). V bočnom paneli je len klient, `lawoss-domov` nie je nikde.
5. V Poskytovateľoch AI je poskytovateľ z bodu 2 stále.
6. `ls $P/userdata/lawoss-domov` je prázdny.
7. Po zatvorení: `find ~/.config/legalwork ~/.config/opencode ~/.legalwork -newer $P/marker` je prázdne.

- [ ] **Krok 4: PR**

PR do `dev` s odkazom na spec PR #92, výsledkami testov (presné príkazy z úloh 1 až 3) a scenárom z kroku 3 so snímkou Poskytovateľov AI bez priečinka.
