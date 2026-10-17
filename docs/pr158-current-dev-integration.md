# PR158: integrácia aktuálneho dev

Integrácia zachováva pôvodný PR158 `41047ec30f81aba6b3de541ec6ff38a50c683acf` aj produktový dev `a51afb31885538e851c11e8933ba38af8b61e3bf` (tree `def44b2a8cd9cd429f7ce4583d52cb0f486a58cf`). Git má dve merge bases; rozdiel proti jednej odhadnutej báze nie je úplná proveniencia.

Z 22 konfliktov vznikol aktuálny serverový lifetime, scoped autentizácia a UI/bootstrap kontrakty dev spolu s privátnymi desktop credentials, scoped idle evidence, Files navigation a guarded POSIX quit PR158. Všetkých 44 skutočne inventarizovaných súborov `lawoss/build/plugin-payload` a `lawoss/engine-dependencies` ostáva byte-for-byte rovnakých ako v pôvodnom PR158. Helper nie je zapojený do produkčnej prípravy user dependencies. Packaging zachováva actaport, sandbox, ARM64 a úplný genuine dependency closure.

## Doložené chyby a opravy

- Pôvodný Windows job `117065519238` / run `38928313577` zlyhal pri selected-directory readiness: global health bol dokončený, selected `/path` nemal pozorované headers/body/verified pred timeoutom. SDK alebo compile príčina nie je dokázaná.
- Existujúci test macOS fixture na pôvodnom zdroji zachytil chýbajúci mock keychain pred production importom. Integrovaný entry zachováva zároveň skutočný origin/main-frame guard pri quit.
- Pôvodný modul nemal aktuálne `awaitNativeStartup`; ide o RED adopcie API. Integrovaný behaviorálny test s držanými HTTP telami overuje cold MCP pred začiatkom samostatného selected90s rozpočtu. Cold300/selected90 pochádzajú z dev, nie zo špekulatívneho predĺženia starého Windows limitu.
- Nové fake-engine fixtures dev nevracali health version a skutočne zlyhali na zachovanom 15s produkčnom limite. Dopĺňa sa len syntetická odpoveď `/global/health`; bezpečnostné asercie a negatívne health prípady ostávajú.
- Nezávislá review I1 odhalila starý Files DOM kontrakt: title už neovláda expansion a Files nemá aria-pressed. Helper teraz používa scoped Expand/Collapse chevron a boolean-presence data-active skutočného SidebarMenuSubButton. SSR produkčných primitives zachytil RED 0/2 a po oprave GREEN 2/2; existujúce renderer-expression prípady zachovávajú owner/root/reconnect ochrany (49/49). Syntetické click/layout fixtures nie sú dôkaz mounted/native journey.
- Merge vytvoril duplicitný calendar import/owner. Deduplikácia ponecháva jeden generačný lifetime aj zachovanie primárnej a cleanup chyby.

## Overenie a hranice

Aplikácia používa Node24.21.0/Bun1.4.2/pnpm11.4.0 s nezávislým frozen-lock installom a privátnym HOME. Samostatný runtime dependency gate používa vlastný kontrakt Node22.23.2. Skutočný SDK replay overuje dve zhodné zostavenia, natívne importy, fyzický closure, premiestnenie a corruption negatives pod network guardom. Portable closure sa skúša po ukrytí pôvodného stage.

Private-auth, lifetime/producer, helper, celé app/server suites, types/build a import/i18n/network guards sú zaznamenané s presnými príkazmi, výsledkami a hashmi v privátnom task reporte. Neúspešné prvé integračné a setup behy zostávajú zachované. Runtime-pinned generátory nemenia schválené generované zdroje dev.

Žiadny lokálny live engine, Electron, provider ani používateľský profil nebol spustený. Opt-in real-engine/model/service testy ostávajú SKIP. Natívny Windows výsledok a štyri packaging platformy musí potvrdiť bežné CI nového headu; helper PASS ani historický diagnostický job nie je natívna acceptance. Historické experimenty majú naďalej job admission `if: false`.
