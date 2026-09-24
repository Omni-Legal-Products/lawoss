---
name: vystup-dokumentu
description: Vyhotovení finálního dokumentu z návrhu v Markdownu — .docx podle šablony kanceláře a PDF ze stejného .docx. Spouštěče — „vyhotov dokument“, „do Wordu“, „do PDF“, „finální verze“; (SK) „vyhotov dokument“, „do Wordu“; (EN) „final document“, „export to Word“.
---

# vystup-dokumentu — návrh → Word a PDF podle šablony kanceláře

Dokument vzniká jedinou cestou: Markdown → `pandoc` se šablonou kanceláře → úprava `.docx` → PDF z **téhož** `.docx` přes LibreOffice. PDF tak vypadá přesně jako Word. Nic se neodesílá, nepodepisuje ani nepodává.

## Postup

1. **Zdroj.** Vezmi soubor `.md`, který advokát určil. Jinak poslední návrh v pracovní složce návrhů věci (`03_Navrhy/` nebo podle `PRACOVNY-PROFIL.md`). Když není jasné, který, zeptej se — nehádej.
2. **Šablona.** Kořen kanceláře je nejbližší nadřazená složka, která obsahuje `Office/` nebo `AK/`. Hledej v tomto pořadí: `Office/sablony/reference.docx`, pak `Template/pandoc/*reference*.docx`. Nenajdeš-li ji, zeptej se; bez šablony jen s výslovným souhlasem a řekni, že vzhled nebude podle kanceláře.
3. **Kontrola Markdownu před převodem** (jinak se PDF v LibreOffice rozbije, i když Word vypadá dobře):
   - žádná tabulka s prázdným záhlavím (`| | |`) — místo ní řádky `**Popisek:** hodnota\`;
   - víceřádkové bloky (adresy, identifikace stran, podpisy) s tvrdým zalomením `\` na konci řádku;
   - nadpisy nejvýš `###`; žádné `---` mezi oddíly; žádný ruční konec stránky.
   Úpravy navrhni a proveď jen v pracovní kopii, ne v originálu přijatého dokumentu.
4. **Údaje, které nejsou ověřené** v podkladech věci (názvy a IČO firem, jména, adresy, spisové značky, data), nedoplňuj — nech `[DOPLNIT]`. Na konci je všechny vyjmenuj.
5. **Převod:** `pandoc "<zdroj>.md" -o "<výstup>.docx" --reference-doc "<šablona>"`. Výstup do složky výstupů věci (`04_Vystupy/` nebo podle profilu) jako `<název>_vNN.docx`. Existující soubor nikdy nepřepisuj — další verze dostane vyšší `NN`.
6. **Úprava a PDF:** `python3 "<cesta k tomuto skillu>/resources/postprocess_docx.py" "<výstup>.docx"` — písmo a okraje kanceláře, oprava zalomení a číslování, pak PDF z téhož `.docx`. Jiné písmo: `LAWOSS_DOCX_FONT`, `LAWOSS_DOCX_SIZE`.
7. **Chybí-li** `pandoc`, `python-docx` nebo LibreOffice (`soffice`), zastav se a řekni, co chybí. PDF nevyráběj jinou cestou (přes LaTeX má jiné písmo i okraje).
8. **Výsledek:** cesty k `.docx` a `.pdf`, seznam `[DOPLNIT]` a upozornění, že PDF je třeba před odesláním zkontrolovat očima (textová kontrola rozbitý vzhled neodhalí).
