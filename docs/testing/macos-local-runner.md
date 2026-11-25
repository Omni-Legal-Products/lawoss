# Lokálne overenie macOS ARM64

Pri zrušenom jobe otvor jeho detail a skontroluj pridelený runner, vykonané kroky a ich logy. Prázdny runner a žiadne kroky znamenajú, že GitHub produkt na tejto platforme netestoval. Ak sa niektorý krok spustil, najprv vyhodnoť jeho log.

## Príprava Macu

Použi Apple Silicon s Tart 2.42.0, Softnet 0.26.0 a prihláseným GitHub CLI s právom spravovať vyhradenú skupinu runnerov. Z overenej kópie tohto postupu vykonaj jednorazovú inštaláciu sieťového pomocníka. Inštalátor skontroluje SHA-256 pred nastavením oprávnení. Heslo správcu zostáva na počítači.

```sh
sudo /bin/sh scripts/ci/local-mac/install-softnet.sh
tart pull ghcr.io/cirruslabs/macos-sequoia-base@sha256:8386ef670c04b38e57bd0e97fe2cde6bc0598e1bcfba0212ecba1814e659a6b1
```

Skupina organizácie `lawoss-macos-isolated` povoľuje len repozitár LAWOSS a konkrétne skontrolované workflow súbory. V zozname povolených workflow použi úplný názov `Omni-Legal-Products/lawoss/.github/workflows/<súbor>@<presná revízia workflow>`. Pre opakovane volané workflow rozhoduje súbor, v ktorom je priamo definovaný job. Schválenie zdrojového kódu aj definície jobu skontroluj pred vytvorením runnera. Pri zmene definície treba preveriť novú revíziu. Predvolené oprávnenia ostatných runnerov spravuj samostatne.

Po každej zmene povolených workflow načítaj späť **obe** nastavenia skupiny. GitHub pri úprave skupiny môže vyprázdniť výber repozitárov. Prvý príkaz má ukázať schválené revízie, druhý jediný repozitár `Omni-Legal-Products/lawoss`.

```sh
gh api "orgs/Omni-Legal-Products/actions/runner-groups/$GROUP_ID" --jq '{visibility,restricted_to_workflows,selected_workflows}'
gh api "orgs/Omni-Legal-Products/actions/runner-groups/$GROUP_ID/repositories" --jq '{total_count,selected:[.repositories[].full_name]}'
```

## Prvá skúška

Po zaradení workflow do predvolenej vetvy spusti ručný workflow `macos-local-probe.yml` so vstupom `revision` nastaveným na celú skontrolovanú SHA. Pre prvú skúšku pred zlúčením môže existujúci ručný workflow na samostatnej vetve zavolať tú istú definíciu cez `uses` s jej presnou SHA. V oboch prípadoch porovnaj definíciu a referenciu na GitHube. V schválenej lokálnej kópii spusti:

```sh
gh api "repos/Omni-Legal-Products/lawoss/actions/runs/$RUN_ID/jobs" --jq '.jobs[] | {id,name,status,labels}'
python3 scripts/ci/local-mac/one-job.py "$JOB_ID" "$REVIEWED_SHA"
```

Skript pre jeden čakajúci job vytvorí čistý klon macOS 15, skontroluje architektúru a izoláciu, overí hash runnera a vyžiada jednorazovú registráciu. GitHub CLI zostáva na hostiteľovi. Skript po ukončení odstráni VM a uvoľní registráciu. Pri výpadku napájania skontroluj `tart list` a zoznam runnerov skupiny. Odstráň iba klon a registráciu identifikovanú číslom ukončeného jobu.

## Povinné kontroly PR

1. Over vlastný repozitár na oboch stranách PR, aktuálny head a testovací merge commit. Schváľ obsah testovaného stromu a samotné workflow. V repozitári zisti `merge_commit_sha` cez `gh api repos/Omni-Legal-Products/lawoss/pulls/$PR --jq .merge_commit_sha`.
2. Ak verzia workflow v PR podporuje lokálny výber, nastav premennú repozitára `LAWOSS_LOCAL_MAC_SHA` na túto presnú merge SHA. Koordinuj hodnotu s inými operátormi. Výber sa týka jobov `legalwork-tests`, zostavenia sandbox runtime a `package-smoke` pre macOS ARM64 v tomto PR.
3. Spusti nový pokus. Už pridelený štítok čakajúceho jobu ostáva v platnosti. Pokračuj len ak GitHub zobrazí štítok s testovanou SHA, číslom behu, pokusom a druhom jobu. Staršia definícia workflow potrebuje najprv aktualizáciu cez PR. Produkčné podpisovanie má vlastný postup.
4. Spusti vyššie uvedený skript pre konkrétne ID jobu a merge SHA. Pri ďalšom jobe použi nový klon. Zmena headu alebo testovacej merge SHA vyžaduje nové overenie. Po skončení odstráň premennú, ak stále obsahuje tvoju SHA. Bez zhodnej hodnoty workflow používa bežný GitHub runner.
5. Do výsledku uveď URL jobu, head a testovanú SHA, pokus, priradený runner, vykonané kroky a výsledok. Úvodná skúška overí iba runner a vybrané desktopové testy. Zlúčenie vyžaduje úspech pôvodných povinných kontrol na GitHube. Pri zlyhaní produktu uchovaj prvý zlyhaný krok a oprav potvrdenú príčinu.

Pri správe vykonávaj hostiteľský skript zo skontrolovanej kópie infraštruktúry. Kód kandidáta sa spúšťa v hosťovi. Klientske priečinky, hostiteľské prihlasovacie údaje a podpisové identity do VM nepatria.
