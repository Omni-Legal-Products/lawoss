<div align="center">

<img src="https://raw.githubusercontent.com/originalmagneto/lawOSS-like-SK-CZ/main/assets/brand/logo.png" alt="LAWOSS | Czechia and Slovakia" width="200" />

# LAWOSS

### Czechia · Slovakia

**Open-source AI pracovné prostredie pre českých a slovenských advokátov**

*Poriadok v spise. Overené právo. AI pod kontrolou.*

[![Status](https://img.shields.io/badge/f%C3%A1za-fork%20%26%20MVP-blue)](https://github.com/originalmagneto/lawOSS-like-SK-CZ/blob/main/planning/roadmap.md)
[![Upstream](https://img.shields.io/badge/upstream-LegalWork-brightgreen)](https://github.com/eigenweltlabs/legalwork)
[![License](https://img.shields.io/badge/licencia-MIT-green)](LICENSE)
[![Jurisdikcia](https://img.shields.io/badge/jurisdikcia-CZ%20%2B%20SK-red)](https://github.com/originalmagneto/lawOSS-like-SK-CZ/blob/main/docs/vision.md)

<img src="https://raw.githubusercontent.com/originalmagneto/lawOSS-like-SK-CZ/main/assets/brand/keyvisual-hero.png" alt="LAWOSS | AI nástroje pre moderného advokáta" width="100%" />

</div>

> [!IMPORTANT]
> LAWOSS je v aktívnom vývoji a zatiaľ nemá vlastné produkčné binárky. Nepoužívajte testovacie buildy s klientskymi, privilegovanými ani spisovými dátami bez vlastného bezpečnostného posúdenia.

## Čo je LAWOSS

LAWOSS je česká a slovenská open-source vrstva nad projektom [LegalWork](https://github.com/eigenweltlabs/legalwork). Spája lokálne agentické pracovné prostredie s právnymi workflowmi, otvorenými promptmi, skills a MCP konektormi pre naše jurisdikcie.

Základom zostáva upstream LegalWork. Všeobecne použiteľné opravy a lokalizácie chceme ponúkať späť upstreamu. Naše právne workflowy držíme v samostatných adresároch, aby zostali prenositeľné a aby bol fork dlhodobo udržateľný.

| | |
|---|---|
| **Koordinácia a rozhodnutia** | [lawOSS-like-SK-CZ](https://github.com/originalmagneto/lawOSS-like-SK-CZ) |
| **Produktový kód** | tento repozitár |
| **Upstream** | [eigenweltlabs/legalwork](https://github.com/eigenweltlabs/legalwork) |
| **Licencia** | MIT, so zachovanou atribúciou Eigenwelt Labs |

## Päť pilierov

| | |
|---|---|
| 📂 **Inteligentné spisy a úlohy** | OKF štruktúra, validácia a lehoty pod kontrolou |
| 🎙️ **Transkripcia a zápisy** | Lokálne spracovanie a prepojenie so spisom |
| ⚖️ **Overené právne zdroje CZ a SK** | Slov-Lex, judikatúra a registre cez MCP |
| 🔓 **Otvorený prompt layer** | Žiadny black box, verzované prompty a skills |
| 🔒 **Lokálne dáta a bezpečnostné brány** | Advokát zostáva rozhodujúcim človekom v procese |

## Čo staviame ako prvé

LegalWork už poskytuje chat, lokálneho agenta, Office add-iny, transkripciu a správu MCP serverov. LAWOSS sa preto sústreďuje na to, čo z neho robí nástroj pre českého a slovenského advokáta.

| Oblasť | Cieľ |
|---|---|
| 🇸🇰🇨🇿 **SK a CZ lokalizácia** | Kompletné rozhranie a právne názvoslovie pre obe jurisdikcie |
| 📁 **OKF** | Zakladanie a udržiavanie štruktúrovaných spisov |
| 🔌 **Právne MCP konektory** | Judikatúra, Slov-Lex a ďalšie overené zdroje |
| ⏰ **Lehoty a timeline** | Kontrolovaný výpočet a evidencia lehôt s potvrdením advokáta |
| 📄 **OCR ingest** | Prevod dokumentov do čistého, agenticky použiteľného Markdownu |

Podrobný scope, ADR a špecifikácie sú v [koordinačnom repozitári](https://github.com/originalmagneto/lawOSS-like-SK-CZ).

## Vizuálny smer

> [!NOTE]
> Nasledujúce obrázky sú koncepty, nie snímky hotového produktu. Dáta v nich sú vymyslené.

<div align="center">

<img src="https://raw.githubusercontent.com/originalmagneto/lawOSS-like-SK-CZ/main/assets/brand/keyvisual-dashboard.png" alt="LAWOSS dashboard concept" width="100%" />

<br><br>

<img src="https://raw.githubusercontent.com/originalmagneto/lawOSS-like-SK-CZ/main/assets/brand/keyvisual-features.png" alt="LAWOSS feature concepts" width="100%" />

</div>

## Architektúra rozšírení

```mermaid
flowchart TD
    L["LAWOSS doména<br/>OKF · prompty · skills · MCP · CZ/SK"]
    W["LegalWork<br/>desktop · server · Office add-iny"]
    O["OpenCode<br/>agentický harness"]
    M["Model používateľa<br/>API · cloud · lokálny model"]
    L --> W
    W --> O
    O --> M
```

Pracujeme v troch zónach:

| Zóna | Obsah | Pravidlo |
|---|---|---|
| 🟢 **Naše adresáre** | `lawoss/**`, CZ/SK locale a dokumentácia | Prednostné miesto pre našu prácu |
| 🟡 **Evidované zásahy** | Branding, registrácia locale a nevyhnutné upstream úpravy | Každá zmena patrí do [`PATCHES.md`](PATCHES.md) |
| 🔴 **Zakázaná zóna** | LegalMemory AGPL plugin, extension registry, svojvoľný bump OpenCode | Zmena iba po novom ADR |

## Tím

| Člen | Zameranie |
|---|---|
| [Marián Čuprík](https://github.com/originalmagneto) | SK jurisdikcia, integrácie a upstream sync |
| [Martin Friedrich](https://github.com/LexaurinTheDog) | Lehoty, právne workflowy a bezpečnostné brány |
| [Igor Ribár](https://github.com/igorribar) | Advokátska prax a produktové overovanie |
| [Vojta Říha](https://github.com/BiggusDicckkus) | CZ jurisdikcia, lokalizácia a technické návrhy |

## Vývoj

Základné požiadavky upstreamu: Node.js, `pnpm@11.4.0`, Bun 1.3.9+ a OpenCode CLI. Platformové požiadavky a aktuálny onboarding sledujte podľa upstream dokumentácie a build workflowov.

```bash
pnpm install
pnpm dev
```

Pred otvorením PR spustite minimálne:

```bash
pnpm typecheck
pnpm test:e2e
```

Prečítajte si [`AGENTS.md`](AGENTS.md). Každá zmena ide cez krátku vetvu, pull request, jedno schválenie a zelené CI. Pri zásahu do upstream súboru aktualizujte v tom istom PR aj [`PATCHES.md`](PATCHES.md).

## Bezpečnosť a modely

- Free modely poskytované upstreamom logujú používanie. Sú určené iba na testovanie bez klientskych a spisových dát.
- Produkčné používanie musí mať vlastný schválený model alebo vlastný API kľúč.
- Telemetria upstream buildov je opísaná v [`TERMS.md`](TERMS.md) a dá sa vypnúť.
- LAWOSS neposkytuje právne poradenstvo a nenahrádza odborné rozhodnutie advokáta.

## Pôvod a licencia

LAWOSS je fork projektu [LegalWork](https://github.com/eigenweltlabs/legalwork), pôvodne vytvoreného spoločnosťou Eigenwelt Labs. Pôvodná MIT licencia zostáva zachovaná v [`LICENSE`](LICENSE) a atribúcia je uvedená v [`NOTICE`](NOTICE).

Ďakujeme tímom Eigenwelt Labs, OpenCode a Different AI za prácu, na ktorej tento projekt stavia.
