# AGENTS.md: advokátní praxe (OKF)

Tato složka je advokátní praxe uspořádaná podle OKF (otevřený klientský folder framework). Pravidla platí pro každý AI nástroj, který zde pracuje.

## Struktura

- `Office/okf.config`: nastavení kanceláře (jurisdikce, jazyk, pracovní složky, kde jsou klienti).
- `Office/memory/`: paměť kanceláře, pravidla a prameny společné pro všechny klienty.
- Klienti: složky podle vzoru `{{CLIENT_PATH}}` (relativně k této složce). Každý klient má vlastní `AGENTS.md`, kartu `client.md` a složku `memory/`.

## Pravidla

- {{SCOPE_RULE}}
- Před prací na klientovi si přečti jeho `AGENTS.md` a kartu klienta.
- Soubory klientů neměň, nepřesouvej ani nemaž bez výslovného pokynu advokáta.
