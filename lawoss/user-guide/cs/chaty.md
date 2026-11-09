# Chaty

Otevřít v LAWOSS: [Oprávnění nástrojů](legalwork://app/settings/safety), [Poskytovatelé AI](legalwork://app/settings/ai).

## Nový chat

Chat začnete tlačítkem **Nový chat** v postranním panelu nebo pod konkrétním případem. Chat klienta pracuje se složkou klienta a s jeho [připojenými složkami](klienti-a-pripady.md); chat případu navíc ví, o který případ jde. Rozpracované chaty najdete pod klientem v **Chaty** a pod případem.

Do pole **Popište svůj úkol...** napište, co potřebujete, například: „Přečti smlouvu a vypiš ustanovení o odstoupení s odkazem na články.“ Soubory přidáte přes **Přiložit soubory**. Model vyberete přímo v chatu; pokud není připojený žádný, viz [AI a modely](ai-a-modely.md).

Když napíšete `/`, zobrazí se seznam skillů a příkazů. Přibalené skilly OKF jsou například `/novy-spis`, `/okf-pamat`, `/usporiadaj-spis`, `/roztried-spis` a `/vystup-dokumentu`. Další skilly přidáte v [Integracích](integracie.md).

Odpověď chatu není důkaz, že se soubor uložil. Zkontrolujte odkaz na výstup a případné chyby nástrojů.

## Schvalování změn

Agent smí číst dokumenty klienta a paměť případu bez ptaní. Před změnou se vás zeptá kartou, která ukazuje přesně, co se stane:

- změny souborů, například **Přejmenovat?**, **Přesunout?**, **Kopírovat?**, **Vytvořit složku?** nebo **Přesunout do Koše?** (smazané položky jdou do Koše, odkud je obnovíte);
- zápis do paměti případu: **Zapsat do paměti případu?** se seznamem toho, co a kam se zapíše;
- příkazy a jiné nástroje se zkontrolovaným rozsahem.

Na kartě zvolte **Povolit jednou**, **Povolit do konce konverzace** nebo **Zamítnout**. Zamítnutí nic nezmění. Pokud cesta patří jinému klientovi, karta to napíše (**Pozor: složka patří jinému klientovi**) a nabídne také **Povolit pro tohoto klienta**; takovou žádost povolte jen tehdy, pokud to opravdu chcete.

## YOLO Mode

**YOLO Mode** je v nastavení na kartě **Oprávnění nástrojů** (v pokročilém režimu) a lze ho zvolit i při prvním spuštění. Ve výchozím stavu je vypnutý. Zapnutý YOLO Mode nechá agenta bez ptaní přesouvat, přejmenovávat, upravovat a mazat soubory a spouštět příkazy s plnými právy vašeho uživatelského účtu. Před zapnutím se LAWOSS zeptá (**Zapnout YOLO Mode?**). Dokud je zapnutý, je v chatu značka **YOLO**.

I v YOLO Mode se souborové nástroje LAWOSS před otevřením složky jiného klienta ptají kartou s varováním. Příkazy, které agent spustí přímo, tuto ochranu nemají a mazání jimi je trvalé. Mějte zálohy. Pokud oprávnění nástrojů spravuje vaše organizace, YOLO Mode zůstává vypnutý.

## Co agent nedělá

Agent připravuje a navrhuje. Odeslání, podání nebo podpis se schvalují samostatně pro konkrétní úkon. Výstup agenta není ověřená právní rada; posouzení je na advokátovi.

Související: [Klienti a případy](klienti-a-pripady.md), [Nastavení](nastavenia.md), [Řešení problémů](riesenie-problemov.md).
