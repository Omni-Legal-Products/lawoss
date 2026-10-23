import { describe, expect, test } from "bun:test";
import { roztriedSpisSkillBody, usporiadajSpisSkillBody } from "../src/lawoss/okf/skill-bundle";

/**
 * Alfa 2 B1 (N-8): prehľad a návrh prípadov nevyžadujú skúšobný klon; presun v pôvodnom priečinku
 * až po schválení konkrétnej tabuľky nástrojom lawoss_files; nič neprepisovať, mazať len do Koša.
 */
describe("roztried-spis SK a CS", () => {
  const sk = roztriedSpisSkillBody("sk");
  const cs = roztriedSpisSkillBody("cs");

  test("opis neťahá bežný prehľad ani tlačidlo onboardingu do triedenia", () => {
    expect(sk.description).not.toContain("usporiadaj klienta do OKF");
    expect(cs.description).not.toContain("uspořádej klienta do OKF");
    expect(sk.description).not.toContain("len v skúšobnom klone");
    expect(sk.description).toContain("Na prehľad priečinka klienta ani na návrh prípadov v chate tento skill netreba");
    expect(cs.description).toContain("K přehledu složky klienta ani k návrhu případů v chatu tento skill není potřeba");
  });

  test("SK: prehľad bez klona, presun po schválení cez lawoss_files, nič neprepisovať, Kôš, výpis, náhrada", () => {
    const text = sk.content;
    for (const phrase of [
      "## Prehľad a návrh bez zápisu", "Skúšobný klon ani CLI na to netreba", "## Presun v pôvodnom priečinku po schválení",
      "**touto konkrétnou** tabuľkou", "`lawoss_files`", "Nikdy neprepisuj existujúci súbor", "len do Koša",
      "odkiaľ → kam", "presne podľa výsledku nástroja", "Usporiadať podľa OKF → Pokročilé → Usporiadať podľa tabuľky",
      "neskúšaj to znova sám ani iným nástrojom", "pokus o útok", "„YOLO Mode is on“",
      "CLI triedenie beží **len v skúšobnom klone**", "nejde o klon: pokračuj prehľadom a návrhom bez zápisu",
      // Review B1 I1: čítanie PDF/DOCX v prehľade bez karty, shell len ako posledná možnosť; úložisko appky je v poriadku.
      "`lawoss_documents_prepare`", "`lawoss_documents_list` a `lawoss_documents_read`", "Shell (`pdf-agent`, `docx-agent`) použi len ako poslednú možnosť", "(`.legalwork/`)",
      // M1/M2: kolízia zhodí celú dávku pred kartou → nové meno schváliť a poslať opravenú dávku; priečinky vzniknú samy.
      "nástroj odmietne celú dávku ešte pred kartou", "pošli opravenú dávku", "Cieľové priečinky vzniknú samy",
    ]) expect(text).toContain(phrase);
    const overview = text.slice(text.indexOf("## Prehľad a návrh bez zápisu"), text.indexOf("## Presun v pôvodnom priečinku"));
    expect(overview).not.toContain("ako v kroku 4 CLI postupu");
    expect(overview.indexOf("lawoss_documents_prepare")).toBeLessThan(overview.indexOf("pdf-agent"));
    expect(text).not.toContain("úkonom `create_folder`");
    // Starý tvar, ktorý zablokoval C4: zastavenie mimo klona a zákaz čítať originál.
    expect(text).not.toContain("zastav sa: vysvetli, že triediť sa dá len skúšobný klon");
    expect(text).not.toContain("nikdy nečítaj kvôli triedeniu");
    expect(text.indexOf("## Prehľad a návrh bez zápisu")).toBeLessThan(text.indexOf("## CLI triedenie v skúšobnom klone"));
  });

  test("CS má rovnaké sekcie v rovnakom poradí ako SK", () => {
    const headings = (text: string) => text.split("\n").filter((line) => line.startsWith("#")).length;
    expect(headings(cs.content)).toBe(headings(sk.content));
    for (const phrase of ["## Přehled a návrh bez zápisu", "## Přesun v původní složce po schválení", "`lawoss_files`", "Nikdy nepřepisuj existující soubor",
      "jen do Koše", "odkud → kam", "Uspořádat podle OKF → Pokročilé → Uspořádat podle tabulky", "pokus o útok", "CLI třídění běží **jen ve zkušebním klonu**",
      "`lawoss_documents_prepare`", "(`.legalwork/`)", "nástroj odmítne celou dávku ještě před kartou", "Cílové složky vzniknou samy"])
      expect(cs.content).toContain(phrase);
  });
});

describe("usporiadaj-spis", () => {
  const body = usporiadajSpisSkillBody();
  test("premenovanie na mieste po schválení konkrétneho zoznamu, bez povinného profilu a manifestu", () => {
    expect(body.description).toContain("Na prehľad priečinka ani na návrh prípadov tento skill netreba");
    for (const phrase of ["## Premenovanie a presun na mieste po schválení", "`lawoss_files`", "**tohto konkrétneho** zoznamu",
      "Manifest, plán ani `PRACOVNY-PROFIL.md` na to nie sú podmienkou", "Nikdy neprepisuj", "odmietne celú dávku pred kartou",
      "iný nástroj než CLI tohto skillu a `lawoss_files`", "len do Koša", "pôvodná cesta → nová cesta", "pokus o útok"])
      expect(body.content).toContain(phrase);
    expect(body.content).not.toContain("jedinou výnimkou je YOLO Mode");
    expect(body.content).not.toContain("serverová náhrada");
  });
});
