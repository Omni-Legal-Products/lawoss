# AI a modely

Otevřít v LAWOSS: [Poskytovatelé AI](legalwork://app/settings/ai).

## Připojit poskytovatele

Agent odpovídá přes poskytovatele AI, kterého připojíte. Otevřete nastavení, kartu **Poskytovatelé AI**, a v části **Poskytovatelé** zvolte **Přidat poskytovatele**. Přihlašovací údaje nebo klíč zadejte do formuláře, nikdy ne do chatu. Připojit se lze i předplatným ChatGPT.

Připojený poskytovatel má v seznamu nabídku, přes kterou ho upravíte nebo odpojíte. Bez poskytovatele agent neodpovídá; zbytek aplikace (klienti, soubory, přehledy) funguje dál.

Model vyberete při prvním spuštění v kroku **AI asistent** (**Model asistenta**) nebo přímo v chatu. Pokud poskytovatel nabízí jen bezplatné modely, LAWOSS upozorní: s podklady klientů je nepoužíváme, připojte placený nebo vlastní model.

Vzdálený poskytovatel dostane obsah dokumentů, se kterými agent pracuje. Před použitím s údaji klientů posuďte konkrétní službu, účel a údaje; přihlášení ani placený tarif takové posouzení nenahrazují.

## Hranice AI

Na stejné kartě je přepínač **Hranice AI**. Když jsou zapnuté, aplikace neposílá obsah případů žádnému modelu kromě chráněného generování dokumentů a běžný chat je vypnutý. Když jsou vypnuté, běžný chat posílá to, co do něj napíšete nebo přiložíte, zvolenému poskytovateli bez dalšího potvrzení. Pokud je přepínač uzamčený nastavením počítače, v aplikaci ho vypnout nelze.

## Naskenované dokumenty (OCR)

V části **Naskenované dokumenty** je volba **Rozpoznávání textu ze skenů (OCR)**. Dokud je vypnutá, LAWOSS čte z dokumentů jen jejich vlastní textovou vrstvu a naskenované strany nepřečte; model nestahuje ani nespouští.

Po zapnutí LAWOSS jednorázově stáhne místní model PaddleOCR z huggingface.co (tlačítkem **Stáhnout model** nebo u prvního naskenovaného dokumentu). Naskenované strany se pak čtou na tomto počítači a dokumenty se nikam neodesílají. Pokud stahování selže, zkontrolujte připojení a volné místo na disku a zvolte **Opakovat stahování**. Stažený model smažete tlačítkem **Odstranit model**.

Související: [První spuštění](zaciatok.md), [Chaty](chaty.md), [Řešení problémů](riesenie-problemov.md).
