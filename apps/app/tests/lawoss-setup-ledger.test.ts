import { describe, expect, test } from "bun:test";

import { DEFAULT_ONBOARDING_PROGRESS } from "../src/lawoss/domains/onboarding/onboarding-state";
import {
  SETUP_LEDGER_STAV_TEXT,
  buildSetupLedger,
  type SetupLedgerInput,
} from "../src/lawoss/domains/onboarding/setup-ledger";

/** Všetko nastavené: workspace na disku, model vybraný, úpravy sa potvrdzujú. */
function hotovyVstup(): SetupLedgerInput {
  return {
    workspace: { nazov: "Spisy", cesta: "/Users/test/Spisy" },
    model: { poskytovatel: "Anthropic", model: "Claude Opus" },
    ochranaUprav: "ask",
    prvaUlohaHotova: true,
    postup: DEFAULT_ONBOARDING_PROGRESS,
  };
}

const riadok = (input: SetupLedgerInput, id: string) => {
  const found = buildSetupLedger(input).find((item) => item.id === id);
  if (!found) throw new Error(`Register nemá riadok ${id}`);
  return found;
};

describe("LAWOSS stavový register prvého nastavenia", () => {
  test("vráti štyri riadky v poradí 01 – 04 a každý má dôvod", () => {
    const riadky = buildSetupLedger(hotovyVstup());

    expect(riadky.map((item) => item.poradie)).toEqual(["01", "02", "03", "04"]);
    expect(riadky.map((item) => item.id)).toEqual(["priecinok", "model", "ochrana", "prva-uloha"]);
    expect(riadky.map((item) => item.nazov)).toEqual([
      "Pracovný priečinok",
      "AI model",
      "Ochrana pri úpravách",
      "Prvá úloha",
    ]);
    for (const item of riadky) expect(item.detail.length).toBeGreaterThan(0);
  });

  test("všetko pripravené: cesta k súborom aj model sú v registri, netreba nič robiť", () => {
    const riadky = buildSetupLedger(hotovyVstup());

    expect(riadky.every((item) => item.stav === "pripravene")).toBe(true);
    expect(riadky.every((item) => item.akcia === undefined)).toBe(true);
    expect(riadok(hotovyVstup(), "priecinok").detail).toContain("/Users/test/Spisy");
    expect(riadok(hotovyVstup(), "model").detail).toContain("Anthropic");
    expect(riadok(hotovyVstup(), "model").detail).toContain("Claude Opus");
  });

  test("chýbajúci model čaká na výber a ponúkne lokálnu opravu", () => {
    const item = riadok({ ...hotovyVstup(), model: null }, "model");

    expect(item.stav).toBe("caka");
    expect(SETUP_LEDGER_STAV_TEXT[item.stav]).toBe("čaká na výber");
    expect(item.akcia).toContain("Nastavenia");
    // Ostatné riadky sa tým nerozhodia.
    expect(riadok({ ...hotovyVstup(), model: null }, "priecinok").stav).toBe("pripravene");
  });

  test("chýbajúci workspace čaká, chyba čítania ukáže dôvod a nie všeobecnú hlášku", () => {
    const caka = riadok({ ...hotovyVstup(), workspace: null }, "priecinok");
    expect(caka.stav).toBe("caka");
    expect(caka.akcia).toBe("Vybrať pracovný priečinok");

    const chyba = riadok({ ...hotovyVstup(), workspace: null, workspaceChyba: "server neodpovedá" }, "priecinok");
    expect(chyba.stav).toBe("chyba");
    expect(chyba.detail).toContain("server neodpovedá");
    expect(chyba.akcia).toBeDefined();
  });

  test("prerušené nastavenie povie, že sa pokračuje od posledného kroku", () => {
    const prerusene = riadok(
      { ...hotovyVstup(), workspace: null, model: null, ochranaUprav: null, prvaUlohaHotova: false, postup: { lane: "detailed", step: "folder" } },
      "priecinok",
    );

    expect(prerusene.stav).toBe("caka");
    expect(prerusene.detail).toContain("prerušili");
    expect(prerusene.detail).toContain("nič sa nestratilo");

    const riadky = buildSetupLedger({
      ...hotovyVstup(),
      workspace: null,
      model: null,
      ochranaUprav: null,
      prvaUlohaHotova: false,
      postup: { lane: "detailed", step: "folder" },
    });
    expect(riadky.map((item) => item.stav)).toEqual(["caka", "caka", "caka", "volitelne"]);
  });

  test("úpravy bez potvrdenia nie sú „pripravené“ a ochrana bez konfigurácie tiež čaká", () => {
    expect(riadok({ ...hotovyVstup(), ochranaUprav: "allow" }, "ochrana").stav).toBe("caka");
    expect(riadok({ ...hotovyVstup(), ochranaUprav: "deny" }, "ochrana").stav).toBe("pripravene");
    expect(riadok({ ...hotovyVstup(), ochranaUprav: null }, "ochrana").stav).toBe("caka");

    const chyba = riadok({ ...hotovyVstup(), ochranaUprav: null, ochranaChyba: "config 403" }, "ochrana");
    expect(chyba.stav).toBe("chyba");
    expect(chyba.detail).toContain("config 403");
  });

  test("prvá úloha je voliteľná, kým neprebehne", () => {
    const volitelna = riadok({ ...hotovyVstup(), prvaUlohaHotova: false }, "prva-uloha");

    expect(volitelna.stav).toBe("volitelne");
    expect(SETUP_LEDGER_STAV_TEXT[volitelna.stav]).toBe("voliteľné");
    expect(volitelna.detail).toContain("neklientskom");
  });

  test("vzdialené pracovné miesto nepredstiera lokálnu cestu", () => {
    const item = riadok({ ...hotovyVstup(), workspace: { nazov: "Kancelária", cesta: "" } }, "priecinok");

    expect(item.stav).toBe("pripravene");
    expect(item.detail).toContain("mimo tohto počítača");
  });
});
