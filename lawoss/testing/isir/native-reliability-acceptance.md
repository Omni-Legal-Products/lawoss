# Acceptance: náprava pěti zjištění z používání LAWOSS

Autorizace: uživatel dne 13. 10. 2026 požádal o plán, produkční implementaci, zelené testy, commit a přímý push na dev, otevření nového buildu a opakovaný testovací cyklus do odstranění zjištění. Toto je implementační akceptace oprav existujícího používání aplikace, nikoli nový neodsouhlasený produktový směr.

1. Chybějící/přesunutý adresář jde z nativního projektu znovu připojit; jeho ID, soubory, návaznosti a výběr přežijí restart. Vadné/cizí cíle a neautorizované volání nezmění stav.
2. PDF se čte přes existující přípravu/OCR. Portfolio má evidované vložené dokumenty. Každá nepřečtená část zůstane označená; bajty originálů se nezmění, není implicitní remote fallback.
3. Vytvoření výstupu znamená skutečný uložený soubor. CSV a identifikace se validují proti schématu a zdrojům. Běžný agent zápis bez úspěšné kontroly není ověřený výstup; editace zneplatní předchozí kontrolu.
4. Native UI rozlišuje nahrání, čtení/částečné čtení a generování/formátovou kontrolu. Po reloadu jsou stavy reálné a zdroje nejsou zaměněny mezi spisy.
5. Automatizovaný test skutečného rendereru a Electron bridge pokrývá picker, drag/drop, chat, generování, validaci a restart. Vedle deterministického CI testu se po pushi zopakuje živý běh s místními vzorky deseti řízení. Chyba snímání externího nástroje není zaměněna za úspěšný GUI test.

Dokončení: všechny pokrývající testy, typecheck a build zelené; čerstvý nezávislý review bez otevřených odchylek od 1–5; ověřený remote dev commit a CI; spuštěný nový build a opakovaná skutečná akceptace. Neprokázané body zůstávají otevřené. Právní správnost libovolného tvrzení modelu není nahrazena technickým testem.
