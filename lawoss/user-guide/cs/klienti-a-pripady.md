# Klienti a případy

Otevřít v LAWOSS: [Klienti](legalwork://app/projects), [Oprávnění](legalwork://app/settings/permissions).

## Postranní panel

Nahoře v postranním panelu jsou **Dnes**, **Nový chat** a **Přidat klienta**. Pod nimi je sekce **Klienti**; v jejím záhlaví tlačítko **Klienti a případy** otevře přehled všech klientů a **Přidat klienta** začne přidání dalšího. Sekce **Připnuté chaty** a **Nedávné chaty** jsou v pokročilém režimu; bez něj jsou ve výchozím stavu vypnuté a zapnete je v přizpůsobení postranního panelu.

Pod rozbaleným klientem jsou položky **Přehled**, **Případy**, **Chaty**, **Soubory** a **Připojené složky**. Ostatní zapnuté položky jsou pod **Více**. V [pokročilém režimu](pokrocily-rezim.md) jsou všechny v jednom seznamu, včetně **Lhůty**, **Tabelární přehled**, **Úkoly** a **Pracovní prostor**.

Pod **Případy** je každý případ klienta, pod případem jeho chaty a **Nový chat**. Pokud klient zatím nemá případ, zobrazí se **Zatím bez případů.**

## Přidat klienta nebo případ

- **Přidat klienta** otevře stejný postup jako při prvním spuštění: vyberete složku a LAWOSS ukáže **Toto jsme našli**. Viz [První spuštění](zaciatok.md).
- Na stránce **Klienti a případy** je také **Připojit existující složku klienta** a **Nový případ**.
- Klient nemůže být uvnitř jiného klienta. Pokud složka nese kód jiného klienta, LAWOSS ji jako klienta ani případ nepřipojí a nabídne klienta, kterému složka patří.

## Přehled klienta

V části **Složka klienta** vidíte počty souborů a podsložek na první úrovni a můžete přímo otevřít index či poznámky. **Obnovit z disku** načte aktuální údaje. Pokud jsou na disku dokumenty a v přehledu ještě chybí případy, vyberte **Zpracovat složku v chatu**. Zkontrolujte připravenou zprávu a model, potom ji odešlete. Asistent má uvést zdroje a počkat na schválení změn. **Náhled struktury složky** otevře průvodce evidencí. Pole v detailech klienta se spravují samostatně.

**Přehled** pod klientem ukazuje **Přehled klienta**: jeho **Případy** s fází a dalším krokem, **Nejbližší lhůty**, **Nejbližší termín**, **Otevřené úkoly z případů**, **Vstupy klienta** a **Chaty klienta**. Odkaz **Všechny lhůty klienta** otevře registr lhůt jen pro tohoto klienta. Údaje se čtou z pomocných souborů OKF ve složce klienta; pokud se něco nedalo přečíst, přehled to napíše (například **Podklady se nepodařilo přečíst, lhůty proto nejsou známé.**).

## Případ

Kliknutím na případ otevřete jeho stránku. Karta **Přehled** shrnuje případ v blocích (například **Základ**, **Řízení**, **Korporátní agenda**, **Duševní vlastnictví**) podle toho, co LAWOSS rozpozná ze souborů. Bloky změníte přes **Upravit** a **Uložit do karty případu**. Karta **Co víme** ukazuje záznamy z paměti případu.

Tužka vedle názvu otevře **Přejmenovat případ**. Zadejte nový název a zvolte **Uložit**. Změna se týká názvu na kartě případu. Soubory a složku najdete na původní cestě. Pokud se karta mezitím změnila, obnovte přehled a zkuste úpravu znovu.

Na stránce případu jsou také **Rozpracované chaty** s tlačítkem **Pokračovat**, **Časová osa**, **Lhůty v příštích 14 dnech** a **Otevřené úkoly**.

Rychlé akce otevřou chat k případu s připraveným úkolem: **Shrň případ**, **Zkontroluj lhůty**, **Připrav odpověď**, **Přidat dokument** a **Ověř klienta**. Pod **Další práce na případu** jsou **Příprava na jednání**, **Rešerše**, **Strategie**, **Revize dokumentu**, **Dopis klientovi** a **Vyhotovit dokument (Word/PDF)**. Rychlé akce potřebují připojený model; pokud chybí, stránka nabídne **Otevřít nastavení AI**.

Dokumenty můžete na stránku případu přetáhnout. Uloží se do případu a čekají na zařazení (viz [Dnes a lhůty](dnes-a-lehoty.md)).

## Připojené složky

Pokud má klient dokumenty i mimo svou hlavní složku, připojte je v **Připojené složky** tlačítkem **Připojit složku**. V chatech tohoto klienta (i v jeho případech) je agent čte bez ptaní; pokud to dovolí oprávnění v nastavení, může v nich i upravovat soubory. V chatech jiných klientů se nejdřív zeptá. Soubory v nich LAWOSS netřídí. Složku odpojíte tlačítkem **Odpojit**; změna platí hned, i pro otevřené chaty.

Připojujte jen složku, která opravdu patří tomuto klientovi. Pokud složka nese kód jiného klienta nebo obsahuje složky více klientů, LAWOSS upozorní a nabídne **Nepřipojovat** nebo **Přesto připojit**. Nikdy nepřipojujte složku nad složkou klienta ani složku s jinými klienty.

## Soubory

**Soubory** pod klientem ukazují soubory ve složce klienta. Dokumenty z odpovědí agenta otevřete z odkazu v chatu.

### Elektronické podpisy v PDF

Při čtení vedle chatu můžete dokument rozšířit ikonou v pravém horním rohu. V desktopové čtečce zapněte **Nástroje PDF** pro výběr stránky, zvětšení nebo tisk. Nabídka se třemi tečkami vedle ikony rozšíření obsahuje akce souboru. Na Macu má tlačítko **Podepsat v Chevron7** u názvu souboru ikonu pera.

Otevřete PDF v **Souborech**. Nad stránkou rozbalte **Elektronické podpisy** s uvedeným počtem. U každého nalezeného podpisu nebo časového razítka si můžete zobrazit dostupné údaje, například formát, uvedenou podepisující osobu, vydavatele jejího certifikátu a uvedený čas. U nepodepsaného pole se v detailu zobrazí **Prázdná podpisová pole** s počtem. U nalezeného podpisu se zobrazí **Důvěryhodnost neověřena**. Pokud potřebujete potvrdit platnost či kvalifikovanost podpisu, důvěryhodnost certifikátu nebo platnost časového razítka, ověřte soubor v nástroji pro validaci podpisů.

Na Macu s Apple Silicon vyberte v náhledu nebo v nabídce místního PDF **Podepsat v Chevron7**. V potvrzovacím okně LAWOSS zkontrolujte soubor, v Chevron7 vyberte certifikát a zadejte PIN. Po návratu otevřete vytvořený soubor v LAWOSS. Pokud úkon v Chevron7 zrušíte, samotné zavření okna nepotvrzuje vytvoření podepsané kopie.

Související: [Chaty](chaty.md), [Dnes a lhůty](dnes-a-lehoty.md), [Nastavení](nastavenia.md).
