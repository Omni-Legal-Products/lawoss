/**
 * Stavový register prvého nastavenia (spec MF, bod 3.1).
 *
 * Čistá funkcia: dostane to, čo v aplikácii už existuje — aktívny workspace,
 * uložený predvolený model, nastavenie ochrany pri úpravách a to, či už
 * prebehla prvá úloha — a poskladá z toho štyri riadky registra. Nič nečíta
 * zo storage, nič nevolá a nič nezapisuje; načítanie robí obrazovka.
 *
 * Stav je vždy aj text, nielen farba: `stav` má slovné znenie v
 * `SETUP_LEDGER_STAV_TEXT` a `detail` vždy povie dôvod.
 */
import type { OnboardingProgress } from "./onboarding-state";

export type SetupLedgerStav = "pripravene" | "caka" | "volitelne" | "chyba";

export type SetupLedgerRiadokId = "priecinok" | "model" | "ochrana" | "prva-uloha";

export type SetupLedgerRiadok = {
  id: SetupLedgerRiadokId;
  /** „01“ … „04“ — poradie je súčasť registra, nie číslo na počítanie. */
  poradie: string;
  nazov: string;
  stav: SetupLedgerStav;
  /** Čo už vzniklo, kam sa ukladá, prípadne dôvod chyby. Nikdy nie prázdne. */
  detail: string;
  /** Lokálna oprava alebo ďalší krok. Chýba, keď netreba nič robiť. */
  akcia?: string;
};

/** Slovné znenie stavu — register musí byť čitateľný aj bez farby. */
export const SETUP_LEDGER_STAV_TEXT: Record<SetupLedgerStav, string> = {
  pripravene: "pripravené",
  caka: "čaká na výber",
  volitelne: "voliteľné",
  chyba: "chyba",
};

/**
 * Akcia nástroja `edit` z opencode konfigurácie (rovnaká trojica, akú používa
 * panel Povolenia nástrojov). `null` = v konfigurácii nie je nastavená.
 */
export type OchranaUprav = "ask" | "allow" | "deny";

export type SetupLedgerInput = {
  /** Aktívny workspace; `cesta` je prázdna pri vzdialenom pracovnom mieste. */
  workspace: { nazov: string; cesta: string } | null;
  /** Dôvod, prečo sa pracovné miesto nepodarilo načítať. */
  workspaceChyba?: string | null;
  /** Uložený predvolený model, už s menami na zobrazenie. */
  model: { poskytovatel: string; model: string } | null;
  ochranaUprav: OchranaUprav | null;
  /** Dôvod, prečo sa konfigurácia nedala prečítať. */
  ochranaChyba?: string | null;
  /** Vo workspace už existuje aspoň jedna session. */
  prvaUlohaHotova: boolean;
  /** Kde nastavenie skončilo — aby register vedel povedať, odkiaľ pokračuje. */
  postup: OnboardingProgress;
};

function priecinok(input: SetupLedgerInput): SetupLedgerRiadok {
  const zaklad = { id: "priecinok", poradie: "01", nazov: "Pracovný priečinok" } as const;
  if (input.workspaceChyba) {
    return {
      ...zaklad,
      stav: "chyba",
      detail: `Pracovné miesto sa nepodarilo načítať: ${input.workspaceChyba}`,
      akcia: "Skúste priečinok vybrať znova — kým sa to nepodarí, LAWOSS nič nečíta ani nezapisuje.",
    };
  }
  if (!input.workspace) {
    return {
      ...zaklad,
      stav: "caka",
      detail:
        input.postup.step === "folder"
          ? "Nastavenie ste prerušili pri výbere priečinka. Uložený krok ostáva v tomto počítači, pokračuje sa odtiaľ a nič sa nestratilo."
          : "Priečinok ešte nie je vybraný. Až do výberu LAWOSS nepracuje so žiadnymi súbormi.",
      akcia: "Vybrať pracovný priečinok",
    };
  }
  return {
    ...zaklad,
    stav: "pripravene",
    detail: input.workspace.cesta
      ? `Súbory sa ukladajú do ${input.workspace.cesta} · ${input.workspace.nazov}.`
      : `Pracovné miesto ${input.workspace.nazov} beží mimo tohto počítača, lokálna cesta k súborom nie je známa.`,
  };
}

function model(input: SetupLedgerInput): SetupLedgerRiadok {
  const zaklad = { id: "model", poradie: "02", nazov: "AI model" } as const;
  if (!input.model) {
    return {
      ...zaklad,
      stav: "caka",
      detail: "Model ešte nie je vybraný. Kým si ho nevyberiete, dokumenty neodchádzajú nikam.",
      akcia: "Vybrať model v Nastavenia → AI",
    };
  }
  return {
    ...zaklad,
    stav: "pripravene",
    detail: `Použije sa ${input.model.poskytovatel} / ${input.model.model}. Dokumenty idú iba k tomuto modelu.`,
  };
}

function ochrana(input: SetupLedgerInput): SetupLedgerRiadok {
  const zaklad = { id: "ochrana", poradie: "03", nazov: "Ochrana pri úpravách" } as const;
  if (input.ochranaChyba) {
    return {
      ...zaklad,
      stav: "chyba",
      detail: `Nastavenie ochrany sa nepodarilo prečítať: ${input.ochranaChyba}`,
      akcia: "Otvorte Nastavenia → Povolenia nástrojov a skontrolujte potvrdzovanie úprav.",
    };
  }
  switch (input.ochranaUprav) {
    case "ask":
      return { ...zaklad, stav: "pripravene", detail: "Zmenu, uloženie aj odstránenie súboru vždy potvrdzuje človek." };
    case "deny":
      return { ...zaklad, stav: "pripravene", detail: "Agent nesmie meniť súbory. Úpravy robíte vy." };
    case "allow":
      return {
        ...zaklad,
        stav: "caka",
        detail: "Agent smie meniť súbory bez potvrdenia.",
        akcia: "Zapnúť potvrdzovanie v Nastavenia → Povolenia nástrojov",
      };
    default:
      return {
        ...zaklad,
        stav: "caka",
        detail: "Ochrana pri úpravách zatiaľ nie je nastavená, platí predvolené správanie pracovného prostredia.",
        akcia: "Nastaviť potvrdzovanie úprav v Nastavenia → Povolenia nástrojov",
      };
  }
}

function prvaUloha(input: SetupLedgerInput): SetupLedgerRiadok {
  const zaklad = { id: "prva-uloha", poradie: "04", nazov: "Prvá úloha" } as const;
  if (input.prvaUlohaHotova) {
    return { ...zaklad, stav: "pripravene", detail: "Prvá úloha už prebehla. Register ostáva dostupný aj neskôr." };
  }
  return {
    ...zaklad,
    stav: "volitelne",
    detail: "Prvú úlohu môžete preskočiť. Vyskúšajte ju na neklientskom testovacom súbore alebo na dokumente, ktorý sami vyberiete.",
    akcia: "Spustiť prvú úlohu",
  };
}

/** Štyri riadky registra v poradí 01 – 04. */
export function buildSetupLedger(input: SetupLedgerInput): SetupLedgerRiadok[] {
  return [priecinok(input), model(input), ochrana(input), prvaUloha(input)];
}
