# Trvalé poverenie — keď sa zo zápisu stane agentná práca

Jadro štandardne stojí na tom, že **agent smie navrhnúť, človek schvaľuje**.
Zápis do vrstvy kancelárie (L1) a do vrstvy práva (L3) sa bez `--approve-as`
neuskutoční. Pri jednom-dvoch záznamoch je to správne. Pri spise, kde agent
za večer založí tridsať poučení a prameňov, je to tridsať klikaní — a tridsiate
už nikto nečíta.

**Trvalé poverenie** je odpoveď: advokát schváli **vopred a písomne**, čo smie
agent zapisovať sám. Nie je to vypnutá brána. Je to schválenie udelené v inom
čase — a preto ide tou istou cestou a rovnako sa zapíše do histórie záznamu.

---

## Ako sa zapne

Advokát vytvorí v adresári kancelárie súbor `_kancelaria/okf.config`:

```
standing_authorization: JUDr. Vojtěch Říha, Ph.D.
granted_at: 2026-09-02
expires_at: 2026-12-31
scope: [L1, L3]
reason: agentné vedenie spisov v rozsahu odsúhlasenom na porade 2. 9. 2026
```

| Pole | Význam | Povinné |
|---|---|---|
| `standing_authorization` | meno advokáta, ktorý poverenie udelil — objaví sa v histórii každého záznamu | ✅ |
| `granted_at` | dátum udelenia | — |
| `expires_at` | **dátum, po ktorom poverenie neplatí** | ✅ |
| `scope` | vrstvy, ktorých sa týka: `L1`, `L3` | ✅ |
| `reason` | prečo bolo udelené — aby sa o rok dalo posúdiť, či ešte platí | ✅ |

**Chýbajúce pole znamená žiadne poverenie.** Bez mena sa nedá podpísať, bez
`expires_at` by platilo navždy a bez `reason` sa po roku nedá posúdiť, či ešte
zodpovedá tomu, na čom sa kancelária dohodla. Neúplný súbor sa preto ticho
ignoruje a brána zostáva zapnutá — bezpečný default je ten, ktorý blokuje.

Súbor sa nezakladá príkazom `init` zámerne. Poverenie je vedomý akt advokáta,
nie vedľajší produkt založenia spisu.

---

## Čo sa tým zmení

Bez poverenia:

```
$ okf-memory write <spis> --file poucenie.md --reason "z veci Novák" --apply
ODMIETNUTÉ: zápis do vrstvy L1 vyžaduje --approve-as "<meno advokáta>"
alebo trvalé poverenie v _kancelaria/okf.config.
```

S poverením ten istý príkaz prejde a v zázname pribudne riadok histórie:

```
## History
- 2026-09-02 — vzniklo z veci
- 2026-09-02 — schválil JUDr. Vojtěch Říha, Ph.D. (trvalé poverenie do 2026-12-31) — z veci Novák
```

Stopa teda nezmizne. Zmení sa len to, **kedy** advokát rozhodol — nie **či**.

---

## Čo poverenie nevypína

Toto je podstatná časť. Poverenie schvaľuje zápis; nerobí nič iné.

| Brána | Vypne ju poverenie? | Prečo |
|---|---|---|
| Schválenie zápisu do L1 / L3 | ✅ áno, v rozsahu `scope` | to je jeho účel |
| **Mazanie záznamu** | ❌ **nikdy** | mazanie je nezvratné; poverenie sa naň nevzťahuje ani keď je `scope` akokoľvek široký |
| **Únik klientskych údajov do L3** | ❌ nie | prameň s IČO klienta sa neodmieta preto, že chýba schválenie, ale preto, že je to únik |
| **Atomicita Pravdy a Histórie** | ❌ nie | zmena Pravdy bez riadku histórie zostáva odmietnutá |
| **Súbežný zápis nad starým stavom** | ❌ nie | `ConcurrentWriteError` platí ďalej |
| Platnosť odkazov, cykly úloh, AML úplnosť | ❌ nie | to nie sú brány zápisu, ale nálezy validácie |

Inak povedané: poverenie odpovedá na otázku *„smie to agent zapísať sám?"*.
Neodpovedá na *„je to vôbec v poriadku?"*.

---

## Kedy prestane platiť

- **Uplynutím `expires_at`.** Deň po ňom zápisy do L1 a L3 znova pýtajú
  `--approve-as`, bez ďalšieho zásahu.
- **Zmazaním alebo prepísaním súboru.** Poverenie nikde inde neexistuje.
- **Zúžením `scope`.** `scope: [L3]` nechá poučenia (L1) opäť pod schválením.

Aby sa uplynutie neprejavilo ako porucha, `validate` ho hlási:

```
$ okf-memory validate <spis>
WARNING STANDING_AUTH_EXPIRED _kancelaria/okf.config: trvalé poverenie
(JUDr. Vojtěch Říha, Ph.D.) uplynulo 2026-08-31 — zápisy do L1, L3 znova
vyžadujú --approve-as.
```

Je to varovanie, nie chyba: pamäť je v poriadku, len sa vrátila k prísnejšiemu
režimu. Bez tejto hlášky by advokát videl len to, že agentovi zrazu prestali
prechádzať zápisy, a hľadal by poruchu tam, kde je uplynutá lehota.

---

## Čo to znamená pre advokáta

Poverenie je **profesijný úkon, nie nastavenie**. Advokát ním preberá
zodpovednosť za to, čo agent do pamäte kancelárie zapíše, rovnako ako keby
každý záznam odklepol jednotlivo. Preto:

- **Krátke obdobie.** Mesiace, nie roky. Predĺžiť je jedna zmena riadku;
  zabudnuté poverenie na tri roky je niečo iné.
- **`reason` píš pre seba o pol roka**, nie pre stroj. „agentné vedenie spisov"
  nič nehovorí; „v rozsahu odsúhlasenom na porade 2. 9. 2026" áno.
- **Prejdi si, čo sa zapísalo.** `okf-memory read <spis>` a `validate` ukážu
  všetko, čo pod poverením vzniklo; riadky histórie sú označené menom
  a dátumom platnosti poverenia.
- **Mazanie zostáva tvoje.** Aj pod najširším poverením záznam zmaže len človek.

---

## Odkazy

- Implementácia: [`src/config.ts`](src/config.ts), brána v
  [`src/store.ts`](src/store.ts) (`standingApproval`)
- Testy: [`tests/standing-authorization.test.ts`](tests/standing-authorization.test.ts) —
  vrátane toho, čo poverenie **nesmie** vypnúť
- Desať vecí naprieč agendou:
  [`tests/desat-pripadov.test.ts`](tests/desat-pripadov.test.ts)
