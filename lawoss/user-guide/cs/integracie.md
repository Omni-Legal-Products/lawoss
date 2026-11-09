# Integrace: Marketplace, konektory, skilly a pluginy

Otevřít v LAWOSS: [Integrace](legalwork://app/settings/extensions/plugins), [Skills](legalwork://app/settings/extensions/skills), [Úložiště souborů](legalwork://app/settings/extensions/storage).

Vše, co agentovi přidává nástroje, je v nastavení na kartě **Integrace**. Nastavení se týká klienta vybraného v záhlaví nastavení. Karta má záložky **Plugins**, **Skills** a **Úložiště souborů**, nad nimi tlačítka **Importovat**, **Přidat** a **Další akce**.

Bez doplňků agent odpovídá z toho, co se naučil. S nimi ověří aktuální zdroj: firmu v obchodním rejstříku, platné znění zákona, soudní rozhodnutí.

## Zdroje integrací

Karta **Zdroje integrací** ukazuje, odkud integrace pocházejí:

- **LAWOSS** (**Výchozí**): katalog LAWOSS Marketplace a přibalené nástroje DOCX Redline, PDF Tools a skilly OKF. Vždy zapnuto.
- **Vlastní**: MCP konektory, pluginy a skilly, které přidáte sami.

## LAWOSS Marketplace

Na záložce **Plugins** je katalog LAWOSS Marketplace od Omni Legal Products.

- **Doporučené balíčky LAWOSS**: balíček jurisdikce vaší kanceláře (**Vaše jurisdikce**) je předvyplněný. Položky můžete odškrtnout nebo přidat balíček jiné jurisdikce. Tlačítko **Instalovat pro všechny klienty** nainstaluje zaškrtnuté balíčky jednou pro všechny klienty. Stáhnou se až po kliknutí, z veřejného repozitáře Omni-Legal-Products/lawoss-marketplace na GitHubu.
- **Všechny balíčky**: celý katalog bez ohledu na jurisdikci, s vyhledáváním **Hledat doplňky a skilly…**. U balíčku zvolíte **Instalovat pro**: **Všechny klienty (doporučeno)** nebo jen aktuální složku.
- **Přibalené v LAWOSS**: DOCX Redline, PDF Tools a skilly OKF jsou součástí aplikace a jsou zapnuté vždy.
- **Aktualizace**: **Zkontrolovat aktualizace**, potom **Aktualizovat** nebo **Aktualizovat vše**. Volba **Kontrolovat aktualizace automaticky jednou týdně** je jediné automatické spojení aplikace: jde jen na repozitář LAWOSS Marketplace na GitHubu, nikdy hned při startu, a samo nic neinstaluje.

Pokud jste v pluginu upravili soubor, aktualizace ani odinstalace ho bez zeptání nepřepíšou. U každého souboru vyberete, zda **Ponechat mou úpravu**, **Převzít novou verzi a mou úpravu uložit stranou** nebo **Převzít novou verzi (má úprava se zahodí)**. Plugin odstraníte ze všech klientů přes **Odinstalovat pro všechny klienty**.

Balíčky nainstalované ve starších verzích jen pro jednu složku jsou v části **Nainstalováno jen ve složce**; tlačítkem **Přesunout pro všechny klienty** je zpřístupníte všem klientům.

Doplňky nemění dokumenty klientů; každá změna dál potřebuje vaše schválení.

## MCP konektory

Konektory (MCP) jsou na záložce **Plugins** v části **Konektory**. Každý konektor ukazuje stav (například **Připojeno**) a po otevření **Nastavení připojení**, **Přístup k účtu** a přepínač **Používat v chatech**. Konektor, který potřebuje přihlášení, má tlačítko **Přihlásit se**; údaje, které potřebuje, zadáte přes **Nastavit**. Konektor vypnete tlačítkem **Zakázat**, znovu zapnete **Povolit** a odstraníte **Odebrat**.

Konektory z balíčků LAWOSS Marketplace jsou označené jako **Plugin: LAWOSS Marketplace**. **Procházet katalog** otevře **Katalog konektorů**; skryté položky ukáže **Zobrazit skryté**.

## Skilly

Záložka **Skills** ukazuje přibalené, nainstalované a importované skilly. Skill je návod pro agenta na opakovanou práci; v chatu ho spustíte napsáním `/` a výběrem ze seznamu. Nový skill přidáte přes **Přidat** a **Skills**, nebo ho importujete přes **Importovat**. Složku se skilly otevřete přes **Další akce** a **Otevřít složku skills**.

## Pluginy

Plugin je balíček skillů a konektorů.

- **Importovat** přidá plugin ze složky (**Vybrat složku**), ze ZIP souboru (**Vybrat ZIP**) nebo z **URL repozitáře pluginu**. Před importem ukáže, co plugin obsahuje a co potřebuje (**Zkontrolovat před importem**).
- **Vlastní** v katalogu konektorů otevře **Nový plugin**: spojíte skilly a konektory ze své knihovny do jednoho balíčku a zvolíte **Vytvořit plugin**. Vytvoří se nezávislé kopie; přihlášení ke konektorům se nekopírují.

Nainstalované pluginy jsou v seznamu pod konektory; filtrem **Zdroj knihovny** je zúžíte. Hledat můžete přes **Hledat pluginy…**.

## Úložiště souborů

Záložka **Úložiště souborů** spravuje připojená úložiště. V této verzi LAWOSS připojujete místní složky, i ty, které synchronizuje OneDrive, Dropbox nebo Google Drive. Cloudová a síťová úložiště jsou v nabídce vidět, ale zatím je nelze zvolit.

Související: [Chaty](chaty.md), [Nastavení](nastavenia.md), [Řešení problémů](riesenie-problemov.md).
