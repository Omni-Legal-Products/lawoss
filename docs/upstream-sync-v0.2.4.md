# Upstream sync v0.2.4

Zlúčenie upstream release `v0.2.4` do LAWOSS `dev` (`0e67695c`, po #142 a #159). Prvý z dvoch krokov k v0.2.9; druhý krok (`sync/upstream-v0.2.9`) nadviaže po zlúčení tohto PR. Dokument zaznamenáva merge a lokálne overenie pre review. Nevydáva release, nenasadzuje službu ani nemení inštalované pluginy.

## Čo prináša upstream v0.2.1 až v0.2.4

| Upstream | Obsah | V LAWOSS |
|---|---|---|
| #197, #212 | Kalendár projektu a súhrnný kalendár, výpočty lehôt so záznamom postupu (pravidlá DE, GB, US), iCal export | Prevzaté. Odber kalendára (odkaz cez platformu Eigenwelt) je skrytý. SK a CZ pravidlá lehôt nie sú súčasťou syncu |
| #205 | Pokyny projektu (`.legalwork/project.json`), obnova modelov vlastných poskytovateľov, odstránenie pluginu `opencode-agent-memory` | Pokyny a odstránenie pluginu prevzaté. Obnova modelov číta pribalený katalóg, nie sieť |
| #206, #207 | Sync onboarding, ponuka plánov priamo v chate pri limite využívania, oprava prihlásenia Sync | Plochy Eigenweltu ostávajú skryté; ponuka plánov pri limite sa neukazuje ani pri vlastnom kľúči |
| #208 | Predvolený verejný katalóg OpenCode | Nahradené pribaleným katalógom (pozri vyššie) |
| #211 | Predplatné ChatGPT len pri účte Eigenwelt s `org_management` | Neprevzaté: predplatné ChatGPT je v LAWOSS vždy dostupné |
| #202 | Ikona Eigenwelt poskytovateľa | Bez vplyvu (poskytovateľ je vypnutý) |

## Riešenie konfliktov

18 textových konfliktov (29 blokov). Bloky, kde sa zmeny oboch strán neprekrývali, sa zlúčili po tokenoch a overili typecheckom a testami. Ostatné sa riešili ručne podľa `PATCHES.md`; nové a zmenené adaptácie sú v sekcii „Upstream sync v0.2.4“ na konci `PATCHES.md`.

- Server: globálni vlastní poskytovatelia a potvrdenie prepisu (`provider_conflict`) ostávajú; upstream označenie odpojenia poskytovateľa sa zapíše pred nimi. Plugin `lawoss-okf-handoff` ostáva, plugin lokálnej pamäte upstreamu je preč.
- `office-plugin-shared.ts`: upstream opravil to isté ako LAWOSS (výber najhlbšieho priečinka aj na Windows), náš variant v `resolveWorkspaceId()` bol nahradený upstreamom.
- Appka: brána pamäte v Lite a nové schvaľovanie pokynov projektu sa spájajú; personalizácia stratila prepínače lokálnej pamäte podľa upstreamu a zachovala autora dokumentu a profil kancelárie.
- Lokalizácia: 369 nových kľúčov preložených do SK a CS (kalendár, výpočty lehôt, pokyny projektu, limity, obnova modelov). Zahraničné právne predpisy v textoch výpočtov (BGB, ZPO, CPR, FRCP) ostávajú pomenované v origináli. Zrušené upstream kľúče (`budget.retry_title`, prepínače pamäte) sú odstránené zo všetkých jazykov.

## Stráže

- `node lawoss/scripts/check-no-eigenwelt.mjs`, `node lawoss/scripts/check-branding.mjs`, ich testy: v poriadku (32/0).
- Nové sieťové miesto: `apps/server/src/provider-model-catalog.ts` (`models.opencode.ai`). Server ho na obnovu modelov nevolá; `apps/server/src/lawoss/bundled-provider-catalog.ts` číta `lawoss/models-catalog/api.json`. Test overuje, že sa nepoužije `fetch`.
- `opencodeVersion` bez zmeny (`v1.18.29`), červená zóna nedotknutá.

## Overenie

macOS arm64, Node 24.19.0, pnpm 11.4.0, Bun 1.4.3. Testy bežali s izolovaným `HOME` a `XDG_*`: neizolovaný beh načítal skilly a nastavenia z reálneho profilu vývojára a dával falošné zlyhania.

| Príkaz | Výsledok |
|---|---|
| `pnpm install --frozen-lockfile` | prešlo |
| `pnpm typecheck` v `apps/app` a `apps/server`, `pnpm --filter @legalwork/desktop typecheck:electron` | prešlo |
| `bun test src` v `apps/server` | 1 758 pass, 33 skip, 0 fail |
| `bun test tests/` v `apps/app` | 1 596 pass, 2 skip, 0 fail |
| `pnpm --filter @legalwork/desktop test` | 345 pass, 4 skip, 0 fail |
| `pnpm --filter @legalwork/app test:i18n`, `node scripts/i18n-audit.mjs --ci` | prešlo, sk/cs úplné |

Desktop smoke na zabalenej appke sa v tomto kroku nerobil; plánuje sa po v0.2.9. Kontroly `Package and launch` a `portable-windows` padajú na `dev` od #156 a v tomto PR sa očakávajú rovnako.

## Známe otvorené body

- Metadáta a pokyny projektu (`.legalwork/project.json`) sa zapisujú do `workspace.path`, nie do `workspaceAppFilesRoot`. V režime `outside` tak vznikajú v pôvodnom priečinku klienta. Stav je starší ako tento sync (týka sa aj metadát z v0.2.1), #205 pridáva ďalší zápis. Riešenie patrí do samostatného PR.
- SK a CZ pravidlá pre výpočty lehôt a ich prepojenie s `lehoty` z OKF: návrh v koordinačnom repe.
- Množné tvary `calc.period_*` majú v SK a CS len tvar pre 5 a viac, lebo angličtina nemá kľúč `_other` a test parity iné tvary nepovoľuje.
