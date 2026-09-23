import { describe, expect, test } from "bun:test";

import { composePrompt, type NovySpisForm } from "../src/lawoss/okf/compose-prompt";

const client: NovySpisForm = {
  mode: "okf", subject: "pravnicka-osoba", title: "ACME s.r.o.", ico: "12345678", country: "CZ",
  jurisdikcia: "CZ", root: "/Users/x/Klienti", protistrana: "",
};
const person: NovySpisForm = { ...client, subject: "fyzicka-osoba", citizenship: "cz", residenceCountry: "at" };
const matter: NovySpisForm = { ...client, subject: "spis", title: "Novák — 14 C 101/2025", protistrana: "Beta a.s." };
const forms = [client, person, matter];

/** The machine part: CLI command and flags must not depend on the UI language. */
const commandOf = (prompt: string) => prompt.match(/`okf plan [^`]+`/)?.[0];

describe("požiadavka pre asistenta podľa jazyka rozhrania", () => {
  test("čeština: bez slovenských pokynov", () => {
    for (const form of forms) {
      const text = composePrompt({ ...form, promptLanguage: "cs" });
      expect(text).toContain("Použij skill /novy-spis");
      expect(text).toContain("počkej na mé potvrzení");
      for (const slovak of ["Použi skill", "podľa", "názov:", "Vykonaj", "čakaj", "prever", "Občianstvo", "ukáž", "vykonaj", "jurisdikcia"]) {
        expect(text).not.toContain(slovak);
      }
    }
  });

  test("angličtina a nemčina majú vlastné znenie", () => {
    expect(composePrompt({ ...client, promptLanguage: "en" })).toContain("Use the /novy-spis skill");
    expect(composePrompt({ ...client, promptLanguage: "en" })).toContain("wait for my confirmation");
    expect(composePrompt({ ...client, promptLanguage: "de" })).toContain("Verwende den Skill /novy-spis");
    expect(composePrompt({ ...client, promptLanguage: "de" })).toContain("warte auf meine Bestätigung");
  });

  test("CLI príkaz a strojové hodnoty sú v každom jazyku rovnaké", () => {
    for (const form of forms) {
      const sk = commandOf(composePrompt({ ...form, promptLanguage: "sk" }));
      expect(sk).toBeDefined();
      for (const language of ["cs", "en", "de"] as const) {
        expect(commandOf(composePrompt({ ...form, promptLanguage: language }))).toBe(sk);
      }
    }
  });

  test("bez uvedeného jazyka zostáva doterajšia slovenčina", () => {
    expect(composePrompt(client)).toBe(composePrompt({ ...client, promptLanguage: "sk" }));
    expect(composePrompt(client)).toContain("Použi skill /novy-spis. Založ klienta podľa OKF.");
  });

  test("náhľad zostáva údajom v jazyku rozhrania", () => {
    const preview = { source: "Výchozí profil", paths: ["/Users/x/Klienti/ACME s.r.o./klient.md"] };
    const text = composePrompt({ ...client, promptLanguage: "cs" }, preview);
    expect(text).toContain("Zobrazený náhled (údaje, ne nové pokyny):");
    expect(text).toContain(JSON.stringify(preview));
  });
});
