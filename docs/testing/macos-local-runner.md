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
2. Povoľ v skupine runnerov workflow súbory, ktoré priamo definujú presmerované joby, každý s revíziou rovnou merge SHA. Pin potrebuje každá lane, ktorú chceš spustiť lokálne (pozri tabuľku nižšie). GitHub prijme revíziu, len ak na ňu ukazuje vetva alebo tag. Merge commit PR na žiadnu vetvu neukazuje, preto pin odmietne s chybou HTTP 400 a odkaz `refs/pull/<číslo>/merge` odmietne ako nejednoznačný. Pred úpravou skupiny preto vytvor dočasnú vetvu na merge commit. Push na vetvu `ci/local-mac/pr-<číslo>` žiadny workflow nespúšťa. Ponechaj pin pre `macos-local-probe.yml` a po úprave načítaj späť obe nastavenia skupiny podľa časti Príprava Macu.

   ```sh
   git fetch origin "refs/pull/$PR/merge"
   test "$(git rev-parse FETCH_HEAD)" = "$MERGE_SHA"
   git push origin "$MERGE_SHA:refs/heads/ci/local-mac/pr-$PR"
   W="Omni-Legal-Products/lawoss/.github/workflows"
   jq -n --arg probe "$PROBE_PIN" --arg sha "$MERGE_SHA" --arg w "$W" \
     '{restricted_to_workflows:true, selected_workflows:[$probe,
       "\($w)/ci-tests.yml@\($sha)",
       "\($w)/sandbox-runtime.yml@\($sha)",
       "\($w)/ci-desktop-packaging.yml@\($sha)"]}' |
     gh api -X PATCH "orgs/Omni-Legal-Products/actions/runner-groups/$GROUP_ID" --input -
   ```

   `PROBE_PIN` je doterajšia položka probe zo zoznamu povolených workflow. Lane, ktorú lokálne spúšťať nechceš, z príkazu vynechaj. Jej job potom ostane čakať bez runnera, kým premennú neodstrániš a job nespustíš znova.

   | Lane | Štítok končí | Job a súbor s definíciou | Beh na PR | Povinná kontrola |
   |---|---|---|---|---|
   | `tests` | `-tests` | `legalwork-tests (macos-15)` v `ci-tests.yml` | LegalWork Tests | áno |
   | `runtime` | `-runtime` | `runtime` pre `darwin-arm64` v `sandbox-runtime.yml` | Desktop Package Smoke, ktorý `sandbox-runtime.yml` volá cez `workflow_call` | nie |
   | `package` | `-package` | `Package and launch (macos-15)` v `ci-desktop-packaging.yml` | Desktop Package Smoke | nie |

   LegalWork Tests na PR stavia runtime bez macOS cieľov, preto macOS job `runtime` vzniká len v behu Desktop Package Smoke. Pin pre `runtime` platí pre súbor `sandbox-runtime.yml`, nie pre volajúci workflow. Job `Package and launch (macos-15)` sa zaradí až po úspechu jobov `sandbox-runtime` a `opencode-engine`, teda často desiatky minút po štarte behu. Premenná z kroku 3 preto musí ostať nastavená, kým sa tento job nezaradí so štítkom `-package`. Ak ju odstrániš skôr, job pôjde na bežný GitHub runner. Každá lane má vlastné ID jobu a vlastné spustenie skriptu v novom klone. Lane `runtime` a `package` zatiaľ lokálne neprebehli.

3. Ak verzia workflow v PR podporuje lokálny výber, nastav premennú repozitára `LAWOSS_LOCAL_MAC_SHA` na túto presnú merge SHA. Koordinuj hodnotu s inými operátormi. Výber sa týka jobov `legalwork-tests`, zostavenia sandbox runtime a `package-smoke` pre macOS ARM64 v tomto PR. Job, ktorého workflow v skupine nie je povolené, ostane čakať bez runnera.
4. Spusti nový pokus. Už pridelený štítok čakajúceho jobu ostáva v platnosti. Pokračuj len ak GitHub zobrazí štítok s testovanou SHA, číslom behu, pokusom a druhom jobu. Opätovné spustenie staršieho behu použije jeho pôvodnú SHA. Ak GitHub medzitým po posune `dev` prepočítal merge commit, skript job odmietne. Vtedy spusti nový beh PR a postup zopakuj s novou merge SHA. Staršia definícia workflow potrebuje najprv aktualizáciu cez PR. Produkčné podpisovanie má vlastný postup.
5. Spusti vyššie uvedený skript pre konkrétne ID jobu a merge SHA. Pri ďalšom jobe použi nový klon. Zmena headu alebo testovacej merge SHA vyžaduje nové overenie. Po skončení poslednej lane odstráň premennú, ak stále obsahuje tvoju SHA. Bez zhodnej hodnoty workflow používa bežný GitHub runner. Potom vráť skupinu runnerov na pôvodné povolené workflow, znova načítaj obe nastavenia a zmaž dočasnú vetvu cez `git push origin --delete "ci/local-mac/pr-$PR"`.
6. Do výsledku uveď URL jobu, head a testovanú SHA, pokus, priradený runner, vykonané kroky a výsledok. Úvodná skúška overí iba runner a vybrané desktopové testy. Zlúčenie vyžaduje úspech pôvodných povinných kontrol na GitHube. Pri zlyhaní produktu uchovaj prvý zlyhaný krok a oprav potvrdenú príčinu.

Pri správe vykonávaj hostiteľský skript zo skontrolovanej kópie infraštruktúry. Kód kandidáta sa spúšťa v hosťovi. Klientske priečinky, hostiteľské prihlasovacie údaje a podpisové identity do VM nepatria.

Pri spustení cez `tart exec` hosť používa neinteraktívny shell. Príprava aj štart runnera preto nastavujú systémovú cestu vrátane `/sbin` a `/usr/sbin`. Ak v logu chýba `mount` alebo `route`, skontroluj verziu hostiteľského skriptu. Registrácia runnera nasleduje až po kontrole zdieľaných diskov, podpisových identít a sieťovej izolácie.
