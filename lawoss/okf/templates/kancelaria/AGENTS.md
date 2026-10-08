# AGENTS.md: advokátska prax (OKF)

Tento priečinok je advokátska prax usporiadaná podľa OKF (otvorený klientsky folder framework). Pravidlá platia pre každý AI nástroj, ktorý tu pracuje.

## Štruktúra

- `Office/okf.config`: nastavenie kancelárie (jurisdikcia, jazyk, pracovné priečinky, kde sú klienti).
- `Office/memory/`: pamäť kancelárie, pravidlá a pramene spoločné pre všetkých klientov.
- Klienti: priečinky podľa vzoru `{{CLIENT_PATH}}` (relatívne k tomuto priečinku). Každý klient má vlastný `AGENTS.md`, kartu `client.md` a priečinok `memory/`.

## Pravidlá

- {{SCOPE_RULE}}
- Pred prácou na klientovi si prečítaj jeho `AGENTS.md` a kartu klienta.
- Súbory klientov nemeň, nepresúvaj ani nemaž bez výslovného pokynu advokáta.
