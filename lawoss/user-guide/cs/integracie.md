# Integrace: Marketplace, konektory, skilly a pluginy

Otevřít v LAWOSS: [Integrace](legalwork://app/settings/extensions), [Skills](legalwork://app/settings/workflows/skills), [Úložiště souborů](legalwork://app/settings/extensions/storage).

V **Integracích** najdete dostupná připojení, nainstalované položky, LAWOSS Marketplace, Google Workspace přes gog a nástroje kanceláře. Tlačítko **Přidat vlastní MCP** otevře formulář připojení. Skilly mají samostatnou položku v nastavení.

Bez doplňků agent odpovídá z toho, co se naučil. S nimi ověří aktuální zdroj: firmu v obchodním rejstříku, platné znění zákona, soudní rozhodnutí.

## Zdroje integrací

Karta **Zdroje integrací** ukazuje, odkud integrace pocházejí:

- **LAWOSS** (**Výchozí**): katalog LAWOSS Marketplace a přibalené nástroje DOCX Redline, PDF Tools a skilly OKF. Vždy zapnuto.
- **Vlastní**: MCP konektory, pluginy a skilly, které přidáte sami.

## LAWOSS Marketplace

Na kartě **LAWOSS Marketplace** je katalog LAWOSS Marketplace od Omni Legal Products.

- **Doporučené balíčky LAWOSS**: balíček jurisdikce vaší kanceláře (**Vaše jurisdikce**) je předvyplněný. Položky můžete odškrtnout nebo přidat balíček jiné jurisdikce. Tlačítko **Instalovat pro všechny klienty** nainstaluje zaškrtnuté balíčky jednou pro všechny klienty. Stáhnou se až po kliknutí, z veřejného repozitáře Omni-Legal-Products/lawoss-marketplace na GitHubu.
- **Všechny balíčky**: celý katalog bez ohledu na jurisdikci, s vyhledáváním **Hledat doplňky a skilly…**. U balíčku zvolíte **Instalovat pro**: **Všechny klienty (doporučeno)** nebo jen aktuální složku.
- **Přibalené v LAWOSS**: U OKF vidíte, kolik z pěti přibalených skillů je dostupných ve vybraném pracovním prostoru. Zápis balíčku uloží všech pět i s jejich soubory do vybrané složky a nahradí stejnojmenné místní kopie.
- **Aktualizace**: **Zkontrolovat aktualizace**, potom **Aktualizovat** nebo **Aktualizovat vše**. Volba **Kontrolovat aktualizace automaticky jednou týdně** je jediné automatické spojení aplikace: jde jen na repozitář LAWOSS Marketplace na GitHubu, nikdy hned při startu, a samo nic neinstaluje.

Pokud jste v pluginu upravili soubor, aktualizace ani odinstalace ho bez zeptání nepřepíšou. U každého souboru vyberete, zda **Ponechat mou úpravu**, **Převzít novou verzi a mou úpravu uložit stranou** nebo **Převzít novou verzi (má úprava se zahodí)**. Plugin odstraníte ze všech klientů přes **Odinstalovat pro všechny klienty**.

Balíčky nainstalované ve starších verzích jen pro jednu složku jsou v části **Nainstalováno jen ve složce**; tlačítkem **Přesunout pro všechny klienty** je zpřístupníte všem klientům.

Doplňky nemění dokumenty klientů; každá změna dál potřebuje vaše schválení.

## MCP konektory

Přidané konektory (MCP) jsou na kartě **Nainstalované**. Každý konektor ukazuje stav (například **Připojeno**) a po otevření **Nastavení připojení**, **Přístup k účtu** a přepínač **Používat v chatech**. Konektor, který potřebuje přihlášení, má tlačítko **Přihlásit se**; údaje, které potřebuje, zadáte přes **Nastavit**. Konektor vypnete tlačítkem **Zakázat**, znovu zapnete **Povolit** a odstraníte **Odebrat**.

Konektory z balíčků LAWOSS Marketplace jsou označené jako **Plugin: LAWOSS Marketplace**. **Procházet katalog** otevře **Katalog konektorů**; skryté položky ukáže **Zobrazit skryté**.

## Skilly

V Nastavení otevřete **Skills**. Skill je návod pro agenta na opakovanou práci. V chatu ho vyberete napsáním `/`. Osobní skill otevřete kliknutím na jeho název a změníte přes **Upravit**. Tlačítko **Přidat** vytvoří nový skill.

Přes **Importovat skills** vyberete kompatibilní balíček z místní instalace ChatGPT nebo Claude, složku, ZIP nebo repozitář na GitHubu. Před uložením zkontrolujte jeho obsah. Import nepřihlašuje cloudový účet a nepřenáší historii chatů.

## Pluginy

Plugin může obsahovat skilly i konektory. Na kartě **LAWOSS Marketplace** můžete zobrazit všechny balíčky nebo filtrovat nainstalované balíčky a balíčky dostupné k instalaci. U Google Workspace přes gog jsou instalace skillu a přihlášení k účtu samostatné kroky. Účet ověříte v terminálu příkazem `gog auth list --check`.

## Úložiště souborů

Záložka **Úložiště souborů** spravuje připojená úložiště. V této verzi LAWOSS připojujete místní složky, i ty, které synchronizuje OneDrive, Dropbox nebo Google Drive. Cloudová a síťová úložiště jsou v nabídce vidět, ale zatím je nelze zvolit.

Související: [Chaty](chaty.md), [Nastavení](nastavenia.md), [Řešení problémů](riesenie-problemov.md).
