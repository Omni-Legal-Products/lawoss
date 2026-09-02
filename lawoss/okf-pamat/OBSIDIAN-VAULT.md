# Napojenie na existujúci Obsidian vault

OKF pamäť je markdown v priečinku spisu. Obsidian vault je priečinok markdownu.
Napojenie preto nie je most medzi dvomi svetmi — je to **zapnutie pamäte
v priečinku, ktorý už existuje**.

Overené na vaulte s **88 908 súbormi, 52 klientmi a 1 859 subjektmi**: jadro
v ňom beží tak, ako je. Chýbali presne dve veci a obe sú konfiguráciou.

---

## Čo treba nastaviť

### 1. Koreň kancelárie

V koreni vaultu vytvor `_kancelaria/memory/`. Tam žijú pravidlá praxe (L1)
a právne pramene (L3) — teda to, čo neprináleží jednému spisu.

### 2. Kde leží klient

Vault, ktorý vznikol pred OKF, karty `klient.md` nemá. Nasypať ich doň 52 je
zásah do cudzieho poriadku — objavili by sa vo vyhľadávaní, v grafe aj
v quick-switcheri. Vzor sa preto zapíše **raz** do `_kancelaria/okf.config`:

```
client_path: AK/*/*
```

Hviezdička je **práve jeden segment cesty**, nie ľubovoľná hĺbka — inak by za
klienta prešiel aj priečinok veci. Cesta je relatívna ku koreňu vaultu (rodič
`_kancelaria/`). Karta v priečinku má prednosť: keď niekde `klient.md` je,
vyhrá nad vzorom.

> [!WARNING]
> **Toto nie je pohodlie, je to bezpečnosť.** AML subjekty žijú u klienta
> a brána zákazu úniku L2→L3 číta `readScope`. Keby sa klientská úroveň
> nerozpoznala, brána by klientské identifikátory **nevidela** — prameň s IČO
> klienta by prešiel na disk a nikto by si toho nevšimol. Regresný test
> `bez client_path by tá istá brána bola slepá` to drží.

### 3. Hotovo

```bash
okf-memory init "AK/R/Novák Ján/Prodej vozidla" --apply
okf-memory read "AK/R/Novák Ján/Prodej vozidla"
```

---

## Čo funguje samo

**`[[wiki-odkazy]]` sú natívne.** Projekcia do `_STATUS.md` odkazuje na záznamy
ako `[[D-001]]` — v Obsidiane sú to hneď klikateľné odkazy a **graf vaultu
ukáže pamäť spisu** bez toho, aby sme čokoľvek pridávali.

**Denné poznámky, tagy a šablóny sa nerozbijú.** Jadro sa dotýka výhradne
`memory/`, `BRAIN.md`, `INDEX.md` a blokov medzi markermi v `_STATUS.md`.
Čokoľvek iné vo vaulte je preň neviditeľné.

**Jurisdikcia je hodnota poľa**, nie priečinok — český a slovenský spis môžu
ležať vedľa seba pod tým istým klientom.

---

## Subjekty: 1 859 poznámok, ktoré sa nemajú zdvojiť

Vault už má `Subjekty/{Priezvisko}-{Meno}.md` s frontmatterom
`typ · jmeno · prijmeni · rodne_cislo · datum_narozeni`. To je **existujúci
zdroj pravdy o totožnosti** a OKF ho nemá prepisovať.

**Konvencia (žiadna zmena schémy):** záznam `subject` odkáže na poznámku cez
pole `related`, ktoré v schéme už je:

```yaml
related: ["[[Subjekty/Rihova-Veronika]]"]
```

V Obsidiane tým vznikne obojsmerná väzba a subjekt v spise sa preklikne na
kartu osoby.

> [!IMPORTANT]
> **AML údaje sa tým nepresúvajú.** `AML_INCOMPLETE` naďalej vyžaduje údaje
> priamo v zázname a je to zámer: AML doklad musí byť úplný a uchovaný 10 rokov
> (§ 16 zák. č. 253/2008 Sb.). Poznámka vo vaulte je pracovný materiál, ktorý
> advokát kedykoľvek prepíše — doklad o identifikácii nie.
>
> Či sa má `AML_INCOMPLETE` naučiť čítať prepojenú poznámku, je **rozhodnutie
> s právnym dosahom, nie technická voľba**. Zámerne nie je implementované.

### Past, ktorá sa pri tom čaká

macOS ukladá názvy súborov v **NFD** (`ě` = `e` + U+030C), text v `.md` je
typicky **NFC**. Akýkoľvek budúci kód, ktorý bude porovnávať meno zo záznamu
s názvom súboru v `Subjekty/`, **musí obe strany normalizovať na NFC** — inak
ohlási ako osirelý každý odkaz s českou diakritikou. Overené: 19 falošných
nálezov → po normalizácii 0.

Dnešné jadro touto pascou netrpí (identifikátory záznamov sú ASCII a detektor
únikov normalizuje sám), ale prepojenie na `Subjekty/` je presne to miesto,
kde by udrela.

---

## Čo sa vedome nerobí

| Nerobiť | Prečo |
|---|---|
| **Synchronizáciu vault ↔ samostatné úložisko** | dve pravdy, ktoré sa rozídu. Vault **je** úložisko. |
| **Prepis `[[…]]` na markdown odkazy** | viď konflikt nižšie |
| **Kontrolu nad celým vaultom** | 88 908 súborov; `validate` beží nad jedným spisom a tak to má zostať |
| **Presúvanie existujúcich poznámok** | OKF pridáva `memory/`, neupratuje cudzí vault |
| **Automatické zakladanie `klient.md`** | 52 súborov do živého vaultu je zásah, nie inštalácia |

### ⚠️ Konflikt s úlohou 12 (O1c)

Pamäťový plán má úlohu **„markdown odkazy namiesto `[[…]]`"** ako podmienku MČ
k O1. **Pre vault je to presne opačne** — `[[…]]` je to, čo z projekcie robí
navigovateľný graf; markdown odkazy by túto vlastnosť zabili.

Návrh: dialekt odkazov nech je **voľba v `okf.config`**, nie globálny prepínač.
Vault dostane `[[…]]`, kto Obsidian nepoužíva, dostane markdown. Patrí to na
call 7. 9. spolu s ostatnými podmienkami O1.

---

## Overenie

```bash
cd lawoss/okf-pamat && node --test 'tests/**/*.test.ts'
```

Testy napojenia sú v [`tests/obsidian-vault.test.ts`](tests/obsidian-vault.test.ts),
vrátane regresného dôkazu, že bez `client_path` je brána úniku slepá.

Ručne, nad kópiou vaultu (nikdy nad ostrým): založ `_kancelaria/`, zapíš
`client_path`, spusti `init` a `read` nad jedným spisom a over, že výpis hlási
`u klienta N` — to je znak, že klientská úroveň naozaj vznikla.
