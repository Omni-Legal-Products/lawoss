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

**Odkazy vedú na skutočné súbory.** Projekcia do `_STATUS.md` odkazuje na
záznamy ako `[S-001](./memory/S-001-eva-novakova.md)` — v Obsidiane sú to
klikateľné odkazy a **graf vaultu ukáže pamäť spisu**.

> [!NOTE]
> **Oprava oproti prvej verzii tohto dokumentu.** Pôvodne tu stálo, že
> `[[wiki-odkazy]]` fungujú natívne. Nefungovali. Projekcia písala `[[S-001]]`,
> ale súbor sa volá `S-001-eva-novakova.md` — Obsidian hľadá wiki-odkaz podľa
> názvu súboru, takže **každý odkaz visel v grafe ako osirelý.** Odhalilo sa to
> až skúšaním na napodobenine skutočného vaultu, nie čítaním kódu.
>
> Relatívny markdown odkaz mieri na skutočný súbor. Zhodou okolností je to
> zároveň tvar, ktorý žiada podmienka MČ v úlohe 12 **aj** Open Knowledge
> Format — takže spor, ktorý som k úlohe 12 otvoril, žiadny spor nebol.

**Denné poznámky, tagy a šablóny sa nerozbijú.** Jadro sa dotýka výhradne
`memory/`, `BRAIN.md`, `index.md` a blokov medzi markermi v `_STATUS.md`.
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
kartu osoby. Wiki-odkaz tu funguje preto, že nesie **cestu** — `[[S-001]]` na
holé identifikátor nesadol, `[[Subjekty/Rihova-Veronika]]` na existujúci súbor
sadne.

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
| **Kontrolu nad celým vaultom** | 88 908 súborov; `validate` beží nad jedným spisom a tak to má zostať |
| **Presúvanie existujúcich poznámok** | OKF pridáva `memory/`, neupratuje cudzí vault |
| **Automatické zakladanie `klient.md`** | 52 súborov do živého vaultu je zásah, nie inštalácia |

### ✅ Úloha 12 (O1c) — námietka stiahnutá, podmienka splnená

Pôvodne som proti podmienke MČ „markdown odkazy namiesto `[[…]]`" namietal
s tým, že pre vault je to opačne. **Bol to omyl** a skúška ho vyvrátila:
wiki-odkaz na holé ID v Obsidiane vôbec nesadol, lebo súbor nesie v názve aj
slug titulku. Markdown odkaz mieri na skutočný súbor a funguje v Obsidiane
rovnako dobre ako mimo neho.

Podmienka je tým **splnená**, nie obídená — a nie je potrebný žiadny prepínač
dialektu.

---

## Čo sa deje pri prechode medzi systémami

Tri veci sa našli až skúšaním v oboch smeroch. Každá vyzerala v kóde v poriadku
a každá ticho nefungovala.

### Advokát si pridá tagy → záznam sa nestratí

`tags:` je základný idióm Obsidianu. Kým bol neznámy kľúč vo frontmatteri
chybou, **celý záznam vypadol zo store** — a s ním z jehiel detektora únikov.
Pridanie tagu k subjektu teda ticho oslepilo bránu pre toho klienta.

Neznáme kľúče sa odteraz **zachovajú a prežijú round-trip**. Zhoduje sa to
s Open Knowledge Format v0.1: *„Consumers MUST preserve unknown keys on
round-trip and MUST NOT reject documents with unrecognized fields."*

### Advokát prepíše Pravdu v Obsidiane → nástroj si to všimne

Brána atomicity beží **v ceste zápisu**. Úprava v Obsidiane cez ňu nejde, takže
zmena Pravdy bez riadku Histórie prechádzala bez stopy — presne to, čo má
systém znemožniť.

Každý zápis preto ukladá `truth_digest`. Pri nezhode ohlási `validate`
**varovanie** `TRUTH_EDITED_OUTSIDE`. Úprava rukou je legitímna, chýba jej len
stopa.

> [!WARNING]
> **Nie je to kryptografia a nemá ňou byť.** Kto prepíše Pravdu, prepíše aj
> odtlačok. Chráni pred zabudnutím, nie pred úmyslom. Záznam bez odtlačku sa
> nekontroluje, aby staršie spisy ďalej fungovali.

### Dropbox vyrobí konfliktnú kópiu → ohlási sa ako duplicita

Vault v Dropboxe pri súbežnej úprave založí `… (conflicted copy …).md`.
V `memory/` z toho vzniknú dva záznamy s tým istým identifikátorom —
`validate` to hlási ako **chybu** `DUPLICATE_ID`. Dve pravdy o tom istom
zázname nie sú varovanie.

## Overenie

```bash
cd lawoss/okf-pamat && node --test 'tests/**/*.test.ts'
```

Testy napojenia sú v [`tests/obsidian-vault.test.ts`](tests/obsidian-vault.test.ts),
vrátane regresného dôkazu, že bez `client_path` je brána úniku slepá.
Prechody medzi systémami drží [`tests/prechod-obsidian.test.ts`](tests/prechod-obsidian.test.ts).

Ručne, nad kópiou vaultu (nikdy nad ostrým): založ `_kancelaria/`, zapíš
`client_path`, spusti `init` a `read` nad jedným spisom a over, že výpis hlási
`u klienta N` — to je znak, že klientská úroveň naozaj vznikla.
