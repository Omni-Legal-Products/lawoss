# Technické odovzdanie — logo B a jednotný sidebar, 10. 9. 2026

Koordinačný zápis, rozhodnutie a agenda sync callu 11. 9. sú [v koordinačnom repozitári](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/blob/design/unified-shell-and-six-logos/planning/2026-09-10-zapis-logo-sidebar-a-sync.md). Tento súbor eviduje implementáciu a reprodukciu, nekopíruje špecifikáciu.

## Zdroj a distribúcia

- [PR #39](https://github.com/Omni-Legal-Products/lawoss/pull/39), vetva `fix/unified-experiments-shell`; k 10. 9. OPEN, požadované review chýba.
- [Stiahnuteľný preview](https://github.com/Omni-Legal-Products/lawoss/releases/tag/preview/logo-b-sidebar-20260910), presný build commit `1b544a7fd2d730d9832b88793c1731b101798678`.
- Verzia `0.1.18-lawoss.local.20260910`, macOS arm64, ad-hoc podpis bez notarizácie. Windows/Intel binárky nie sú súčasťou tohto preview. Stabilný updater sa nemení.
- SHA-256 ZIP: `73f93ccb4d72349d72bb530d09b925c499d8ab1d36666acc812ecb99e00cfbaa`.
- Následný dokumentačný commit nemení publikovaný build. `Contents/Resources/lawoss-build.json` v appke obsahuje jeho pôvod.

## Implementácia

Experimentálne routy používajú `SessionRoute` a jeho existujúci `mainView`. `LawossLayout` má iba obsah a vnútornú navigáciu. Zachovanie URL pri obnove workspace a vyčistenie pomocných panelov pri návrate riešia prepínanie bez druhého sidebaru. Odsadenie `LawossNav` zodpovedá natívnym položkám; pri meraní boli iconX 20 a textX 50 zhodné s New Task/Workflows/Recorder.

Znak: [`lawoss/brand/lawoss-mark.svg`](../lawoss/brand/lawoss-mark.svg). Generátor: [`lawoss/brand/scripts/build-icons.cjs`](../lawoss/brand/scripts/build-icons.cjs), vyžaduje dostupný balík `sharp` a pre ICNS macOS `iconutil`. Výstupy: `apps/desktop/resources/icons` a `apps/app/public`. Používa sa finálny variant B; staré návrhy sú v koordinácii. Vlastný firemný branding zostáva podporovaný. Bundle ID sa nemení.

Downstream zásahy sú evidované v [`PATCHES.md`](../PATCHES.md). Táto zmena nevytvára backend nových experimentov ani neopravuje OKF kontrakt.

## Vykonané kontroly na build commite

| Príkaz / scenár | Výsledok |
|---|---|
| `pnpm --dir apps/app typecheck` | úspech |
| `pnpm --dir apps/app exec bun test tests/lawoss-experiments.test.ts` | 12 úspešných |
| `pnpm --dir apps/desktop test` | 104 úspešných, 1 preskočený |
| `pnpm --dir apps/desktop build:electron` | úspech vrátane sidecarov, rendereru a Word add-in |
| `codesign --verify --deep --strict LAWOSS.app` | úspech aj po rozbalení distribučného ZIP |
| Browser: Experimenty → Lehoty → Workflows → tie isté Lehoty | zachovaná navigácia a správny obsah |
| Nainštalovaný Electron: existujúci priečinok/relácia → Experimenty | načítanie a zachovanie sidebaru |

CI na build commite: Linux/macOS testy a i18n audit úspešné. Podpis je ad-hoc, nie potvrdenie notarizácie. Smoke test neoveruje funkčnosť právnych operácií nad spisom. Windows runtime nebol testovaný.

## Odovzdanie a ďalšie kroky

Preview bolo oznámené botom do produktového Telegram topicu 293: [úspešný run](https://github.com/Omni-Legal-Products/lawoss/actions/runs/34466275079). Lokálna appka bola aktualizovaná po zálohe pôvodnej appky a profilu; zálohy ani klientske dáta nie sú súčasťou releasu.

Pred merge treba požadované review a zelené kontroly aktuálneho HEAD. Pred stabilným vydaním zostávajú notarizácia, dohodnutá platformová matica a overenie updatera. Na sync calle treba určiť vlastníkov a akceptačnú cestu ďalšej integrácie; vizuálny preview neuzatvára pripravenosť OKF ani ostatných experimentov.
