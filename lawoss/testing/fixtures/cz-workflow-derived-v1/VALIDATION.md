# Provedené kontroly

Kontrolováno 18. 10. 2026 proti OKF z větve dev LAWOSS na commitu `310cb34e850f3cd5ac8eb35ff2221ecede2b365a`. Běh používal Node 24.21.0, Python 3.14 a pypdf 6.9.2.

- Oficiální OKF CLI: všech deset spisů i všech pět klientů prošlo strukturální validací. Záměrně neplatný Markdown byl odmítnut pro chybějící typ dokumentu.
- Lokální validátor: ověřil SHA256 a inventář, skutečné rozporné varianty a chybějící přílohy, součty CSV, shodnost dekódovaných příloh EML s PDF, označení fiktivních dat, metadata autorů DOCX a kontrolované testovací adresy.
- Všech deset DOCX bylo nativně vykresleno pomocí LibreOffice. Každý dokument má jednu stránku. Vizuální kontrola všech deseti stran potvrdila čitelné české znaky, konzistentní sazbu, žádné překryvy nebo ořezání a zřetelné fiktivní označení. Dokumenty nepoužívají skutečný hlavičkový papír.
- Jedenácté PDF je obrazová kopie vytvořená z nového dokumentu TEST-CZ-09. Kontrola potvrdila chybějící textovou vrstvu; výsledek případného OCR musí být ověřen samostatně.

Automatická kontrola osobních údajů je podpůrná a nenahrazuje obsahovou kontrolu. Třicet scénářových závěrů představuje očekávání pro další test, nikoli třicet již provedených modelových testů.

Nebyly prováděny požadavky na model, cloudové zpracování, právní podání, platby, odesílání e-mailů, potvrzování lhůt ani zápisy do kalendáře. Tato sada proto nedokládá funkčnost celé kladné procesní cesty v běžící aplikaci.
