# D1 na zabalenej appke, 4. až 5. 10. 2026

Akceptačný beh alfy 1 s vetvou `feat/dnes-prehlad` ([lawoss#109](https://github.com/Omni-Legal-Products/lawoss/pull/109)). Pravidlá pohľadov z OKF zapisuje [ADR 0014](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/89).

## Prostredie

- macOS arm64, `LAWOSS.app` zo `electron-builder --dir`, ad-hoc podpis (`-c.mac.identity=-`), `codesign --verify --deep --strict` OK.
- Každý beh na čistom profile: vlastné `HOME`, `XDG_*` a `LEGALWORK_ELECTRON_USERDATA`. Skutočné `~/.config/legalwork`, `~/.config/opencode` a `~/.legalwork` ostali po každom behu bez zmeny.
- Iba vymyslené údaje (klienti „Testovací klient s. r. o.“, „Vzorový klient D2 s. r. o.“, syntetická faktúra 2026-071).
- Modely: Ollama na 127.0.0.1 (`qwen2.5:7b`, `gemma4:12b-mlx`) a OpenAI cez ChatGPT účet (`gpt-5.6-luna`).

## Prejdené cesty

| Cesta | Výsledok |
|---|---|
| Prvé spustenie otvorí onboarding | OK |
| Onboarding s OKF: identita, voľba OKF so vzatím na vedomie, kancelária, klient, vec | OK; klient dostane skilly `novy-spis`, `okf-pamat`, `usporiadaj-spis` |
| Onboarding bez OKF s pracovným priečinkom | OK; Dnes a Klienti vysvetlia, že organizácia vecí je vypnutá, a ponúknu zapnutie |
| Zapnutie OKF neskôr z bočného panela | OK; náhľad zmien sa posunie do okna, priečinok `Klienti` sa predvyplní |
| Nová vec k už otvorenému klientovi | OK; vec v `Spisy/`, `klient:` a odkaz na kartu klienta |
| Lehota zapísaná do `memory/` | ukáže sa bez obnovenia v Dnes, súhrne, páse 14 dní, detaile veci, u klienta a v bočnom paneli |
| Klient bez vecí | má vlastnú kartu v Klientoch a veciach |
| AI Providers | bez účtu a modelov Eigenwelt; Ollama aj OpenAI sa dajú pripojiť |
| Otázka nad dokumentom | `gemma4:12b-mlx` a `gpt-5.6-luna` odpovedali správne a po slovensky; brána povolení zastavila prístup mimo priečinka |
| Menu macOS | „About / Hide / Quit LAWOSS“ |
| „What's new“ po čistom onboardingu | neukáže sa |

## Nájdené a opravené v lawoss#109

| Priorita | Nález | Commit |
|---|---|---|
| P0 | Prvé spustenie v Lite neotvorilo onboarding | `d1762345` |
| P1 | Onboarding sa nedal posúvať, potvrdenie bolo pod okrajom okna | `7a5e73f8` |
| P1 | AI Providers ukazovali účet Eigenwelt a modely SystemOne | `c6572b6c` |
| P1 | Krok AI pred prvým priečinkom posielal do nastavení, ktoré hlásili chybu | `bad572b6` |
| P1 | Bez OKF ukazovali Dnes a Klienti „žiadne veci“ a „Skúsiť znova“ | `407d7a05` |
| P1 | Stav OKF sa pri štarte čítal bez adresy servera, po reštarte „OKF vypnuté“ | `99f24fc8` |
| P1 | K otvorenému klientovi sa nedala pridať vec (symlinky v `.opencode/node_modules/.bin`) | `5eea22c7` |
| P1 | Opakované dokončenie onboardingu spadlo na obnove skillov (415 na `okf.js`) | `1ee95bc7` |
| P1 | Nainštalované skilly OKF sa po prvej inštalácii už nikdy neaktualizovali a ukazovali falošné „obsahuje vaše úpravy“ (riadený blok zdrojov v `SKILL.md`) | `2f225f0f` |
| P2 | Jazyky ako kódy, jurisdikcia vždy po anglicky | `fe27af33` |
| P2 | Klient bez vecí v Klientoch chýbal | `36f9b4c4` |
| P2 | Vec z onboardingu v `<klient>/<oblasť>/` s prázdnym `klient:` | `02453d32` |
| P2 | Nový spis nevidel meno advokáta z onboardingu | `fa72b4e6` |
| P2 | Nový používateľ videl dialóg „What's new“ | `a883a2f2` |
| P2 | Lokálny model: OpenCode zrušil prvú požiadavku po 5 minútach | `6e048670` |
| P3 | Predvyplnenie priečinka Klienti, žargón v texte kancelárie | `132295ea` |
| P3 | Rozporné texty kroku AI, posunutý ďalší krok | `d7140364` |
| P3 | Menu a tray „LegalWork“ | `43c643ce` |

## Mimo lawoss#109

- **Lokálne modely sú pomalé.** Prvá požiadavka má okolo 40 tisíc tokenov, hlavne popisy nástrojov pribalených pluginov upstreamu (Word, Excel, PowerPoint, úlohy, projekty, recenzie). `gemma4:12b-mlx` na MacBooku potrebuje na prvú odpoveď asi 7 minút, ďalšie kolá sekundy. `qwen2.5:7b` nástroje nezvláda. Obmedziť nástroje pre lokálne modely je samostatné rozhodnutie.
- **OpenAI cez ChatGPT účet:** rýchly výber modelov ponúka `gpt-5.4` a `gpt-5.3-codex-spark`, ktoré tento typ účtu odmietne (400 „not supported when using Codex with a ChatGPT account“). Funguje napríklad `gpt-5.6-luna` z „All models“. Zoznam pochádza z katalógu OpenCode.
- **Jednotnosť UI:** onboarding, nastavenia a Home používajú iné prvky a písmo ako pohľady z OKF. Rieši sa samostatne.

## Ako pripojiť model (pre testerov)

Nastavenia → AI Providers → Add provider. Model sa potom vyberá dole v okne chatu.

- **Cloud** (OpenAI, Anthropic, OpenRouter, …): vybrať providera a prihlásiť sa alebo vložiť vlastný API kľúč. V alfe len vymyslené alebo verejné údaje.
- **Lokálny model:** Local model → Ollama alebo LM Studio → Fetch from endpoint → vybrať model. Bez kľúča. Odporúčame aspoň `gemma4:12b`; prvá odpoveď trvá minúty.
