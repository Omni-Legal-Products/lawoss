# Návrat z v0.1.21: MCP konektory po downgrade

Build od upstream v0.1.21 pri každom štarte presunie MCP konektory z `opencode.json` (globálneho `~/.config/opencode/opencode.json` aj z `opencode.json` v pracovných priečinkoch) do zdieľaného riadku v `~/.config/legalwork/runtime.sqlite` a z pôvodných súborov ich zmaže. Presun je jednosmerný: starší LAWOSS build a samostatný `opencode` CLI čítajú len súbor, nie databázu. Revert merge commitu vráti kód, nie súbory na disku používateľa. Tento postup vracia konektory do súborov.

## Čo vznikne pri prvom štarte

Pred prvým presunom si server každý dotknutý súbor skopíruje vedľa seba ako `<súbor>.bak-<dátum>` (napr. `opencode.json.bak-2026-09-22T14-05-33`). Kópia je bajtovo zhodná s pôvodným súborom a vzniká len raz — po presune súbor žiadne `mcp` položky nemá, takže ďalší štart nič nekopíruje. Cesty k záložným kópiám sú v logu servera (`connector files backed up before the move`).

## Pred prvým spustením (odporúčané aj tak)

Automatická záloha nekryje súbory, ktoré by vznikli alebo sa zmenili až po prvom štarte. Preto:

```sh
cp ~/.config/opencode/opencode.json ~/.config/opencode/opencode.json.pred-v0.1.21
```

a to isté pre `opencode.json` v každom pracovnom priečinku, ktorý appka pozná.

## Návrat na starší build

1. Zavrite LAWOSS.
2. Nainštalujte starší build (napr. `v0.1.18-lawoss.x`).
3. Obnovte konektory jedným z dvoch spôsobov:
   - **Zo záložnej kópie:** skopírujte `opencode.json.bak-<dátum>` späť cez `opencode.json` (globálny aj v pracovných priečinkoch). Ak ste medzitým v appke pridali ďalšie konektory, v kópii nebudú.
   - **Z exportu appky (od PR #86):** ešte pred downgradom v LAWOSS **Settings → MCP → Export** vyberte konektory a uložte JSON. Výstup má tvar `{ "mcp": { "<názov>": { … } } }`, teda presne blok, ktorý patrí do `opencode.json`. Vložte ho do súboru (zlúčte s existujúcim obsahom, nie prepíšte celý súbor).
4. Spustite starší build a v nastaveniach skontrolujte, že konektory vidí. Samostatný `opencode` CLI ich uvidí z globálneho súboru.

Databáza `~/.config/legalwork/runtime.sqlite` môže ostať; starší build zdieľaný riadok ignoruje. Ak sa neskôr vrátite na v0.1.21, presun prebehne znova a vznikne nová záloha.

## Čo tento postup nerieši

Tokeny OAuth konektorov sa pri presune nemenia a ostávajú v pôvodnom úložisku enginu. Iné zmeny v0.1.21 (session routing, nastavenia, úložiská) revert kódu vráti; tento dokument sa týka len konektorov.
