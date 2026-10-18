# Syntetické české scenáre

`cz-workflow-derived-v1/` je presná zmrazená verejná sada: 10 fiktívnych spisov, 5 klientov, 299 payload súborov a manifest. SHA256 manifestu: `e7cd7b73470269a1e02b0267b5a627db2dd02f05909f80f68a013a2cec7c965b`.

Sada je vytvorená nanovo; neobsahuje redigované originály, súkromnú provenienciu ani klientské dokumenty. Jej metadata a obsah prešli nezávislou kontrolou pred zmrazením. Každý commitovaný byte payloadu je overený proti manifestu. Zachované sú aj licenčné oznámenia šablón OKF.

Do modelového pracovného adresára kopírujte iba vybraný spis z `office/Clients/.../Spisy/test-xx`. `ground-truth/` ani koreň celého balíčka modelu nepripájajte. Benchmark adaptér musí staging obmedziť na konkrétny spis; očakávané odpovede slúžia iba hodnotiteľovi.

Dátumy 2035 sú fiktívne. Táto verzia overuje najmä chýbajúce dôkazy, varianty, saldo a odmietnutie nepodloženého termínu; nedokladá budúce právo ani kladnú kalendárovú cestu. Schválenie českých pravidiel a Google workflow je samostatný návrh [koordinačné PR #100](https://github.com/Omni-Legal-Products/lawOSS-like-SK-CZ/pull/100).

Kontrola podľa vnútorného README: `uv run --with pypdf==6.9.2 python tools/validate_dataset.py` z koreňa sady. Nepotrebuje model ani klientské dáta. Pracujte na disposable kópiách; zmrazené podklady neopravujte. Nové kladné právne prípady patria do novej verzie po právnej kontrole.
