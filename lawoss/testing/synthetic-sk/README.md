# Posun dátumov v syntetických dátach

Syntetická slovenská kancelária ([SYNTHETIC_DATA.md](../../../SYNTHETIC_DATA.md)) je zamrazená k 17. 10. 2026. Lehoty v nej sa preto s časom dostávajú do minulosti a pohľad Dnes ich ukazuje ako uplynuté. Skript `shift_dates.py` skopíruje kancelárie do nového priečinka a všetky dátumy v súboroch `.md` posunie tak, aby sedeli k dnešku.

## Použitie

Z koreňa repozitára, s Pythonom 3.11 alebo novším. Dataset musí byť už stiahnutý a rozbalený podľa [SYNTHETIC_DATA.md](../../../SYNTHETIC_DATA.md). Skript pri starom Pythone skončí s kódom 2 a vypíše, čo treba.

```sh
python3 lawoss/testing/synthetic-sk/shift_dates.py \
  --source .work/synthetic-sk/LAWOSS-SK-synthetic-v1/02_OKF_kancelaria \
  --dest .work/synthetic-sk/dnes/02_OKF_kancelaria
```

Vždy zadajte jeden priečinok kancelárie (`01_Neusporiadana_kancelaria` alebo `02_OKF_kancelaria`), nikdy koreň balíka. Cieľový priečinok nesmie existovať. Ak existuje, skript skončí s kódom 2 a nič nezmení. Pôvodný dataset ostane nedotknutý.

| Voľba | Význam |
| --- | --- |
| `--source` | priečinok kancelárie, ktorý sa kopíruje |
| `--dest` | nový priečinok pre kópiu |
| `--as-of` | dátum, ku ktorému je dataset zamrazený; predvolene `2026-10-17` |
| `--today` | dátum, na ktorý sa posúva; predvolene dnešok |

Posun sa rovná počtu dní medzi `--today` a `--as-of`. Pri `--as-of 2026-10-17` a `--today 2026-10-24` sa `due: 2026-10-20` zmení na `due: 2026-10-27`.

## Čo sa mení a čo nie

- V súboroch `.md` sa posunie každý dátum tvaru `RRRR-MM-DD`: hlavička, riadky histórie aj text. Pri dátume s časom (`2026-10-17T09:00:00Z`, `2026-10-17T09:00:00.123+02:00`) sa posunie len dátum, čas a pásmo ostanú. Kódovanie UTF-8, BOM a konce riadkov (LF alebo CRLF) ostanú.
- Čísla spisov ako `SYN-M001/2026`, názvy súborov a neplatné dátumy (napríklad `2026-02-30`) sa nemenia.
- Všetky ostatné súbory (PDF, DOCX, XLSX, EML, CSV, JSON a ďalšie) sa skopírujú bajtovo rovnaké. Dátumy vo vnútri nich ostanú pôvodné, takže otázka nad dokumentom môže spomenúť starší dátum než karta veci.
- Súbor `.md`, ktorý nie je UTF-8, sa skopíruje bez posunu a skript na to upozorní.
- Záznam pamäte s odtlačkom pravdy (`truth_digest`) sa posúva opatrne. Dátumy sa menia len v hlavičke a v časti `## History`, telo `## Truth` ostane. Inak by odtlačok prestal sedieť. Dataset v1 odtlačok nemá, preto sa v ňom posunie celý text.

Priečinok `ground-truth/` sa tým neposúva. Ostáva mimo kópie a nikdy ho nedávajte modelu.

## Overenie

```sh
python3 -m unittest lawoss/testing/synthetic-sk/test_shift_dates.py
```

Skutočná kópia `02_OKF_kancelaria` sa dá skontrolovať aj nástrojom pamäte. Pred posunom aj po ňom dáva rovnaký výsledok: koniec 0 a len zámerné varovania (napríklad `AML_MISSING`, `SUBJECT_SOURCE_MISSING`, `CASE_NUMBER_FORMAT`).

```sh
node lawoss/okf-pamat/bundle/okf-memory.js validate <priečinok veci>
```
