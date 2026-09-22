import { t, type Language } from "@/i18n";
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

function priecinok(input: SetupLedgerInput, locale: Language): SetupLedgerRiadok {
  const zaklad = { id: "priecinok", poradie: "01", nazov: t("lawoss.initial.folder", locale) } as const;
  if (input.workspaceChyba) {
    return {
      ...zaklad,
      stav: "chyba",
      detail: t("lawoss.initial.workspace_error", { error: input.workspaceChyba, lng: locale }),
      akcia: t("lawoss.initial.retry_folder", locale),
    };
  }
  if (!input.workspace) {
    return {
      ...zaklad,
      stav: "caka",
      detail:
        input.postup.step === "folder"
          ? t("lawoss.initial.folder_paused", locale)
          : t("lawoss.initial.folder_missing", locale),
      akcia: t("lawoss.initial.select_folder", locale),
    };
  }
  return {
    ...zaklad,
    stav: "pripravene",
    detail: input.workspace.cesta
      ? t("lawoss.initial.folder_local", { path: input.workspace.cesta, name: input.workspace.nazov, lng: locale })
      : t("lawoss.initial.folder_remote", { name: input.workspace.nazov, lng: locale }),
  };
}

function model(input: SetupLedgerInput, locale: Language): SetupLedgerRiadok {
  const zaklad = { id: "model", poradie: "02", nazov: t("lawoss.initial.model", locale) } as const;
  if (!input.model) {
    return {
      ...zaklad,
      stav: "caka",
      detail: t("lawoss.initial.model_missing", locale),
      akcia: t("lawoss.initial.select_model", locale),
    };
  }
  return {
    ...zaklad,
    stav: "pripravene",
    detail: t("lawoss.initial.model_selected", { provider: input.model.poskytovatel, model: input.model.model, lng: locale }),
  };
}

function ochrana(input: SetupLedgerInput, locale: Language): SetupLedgerRiadok {
  const zaklad = { id: "ochrana", poradie: "03", nazov: t("lawoss.initial.safeguards", locale) } as const;
  if (input.ochranaChyba) {
    return {
      ...zaklad,
      stav: "chyba",
      detail: t("lawoss.initial.safeguards_error", { error: input.ochranaChyba, lng: locale }),
      akcia: t("lawoss.initial.check_permissions", locale),
    };
  }
  switch (input.ochranaUprav) {
    case "ask":
      return { ...zaklad, stav: "pripravene", detail: t("lawoss.initial.ask", locale) };
    case "deny":
      return { ...zaklad, stav: "pripravene", detail: t("lawoss.initial.deny", locale) };
    case "allow":
      return {
        ...zaklad,
        stav: "caka",
        detail: t("lawoss.initial.allow", locale),
        akcia: t("lawoss.initial.enable_confirmation", locale),
      };
    default:
      return {
        ...zaklad,
        stav: "caka",
        detail: t("lawoss.initial.unset", locale),
        akcia: t("lawoss.initial.set_confirmation", locale),
      };
  }
}

function prvaUloha(input: SetupLedgerInput, locale: Language): SetupLedgerRiadok {
  const zaklad = { id: "prva-uloha", poradie: "04", nazov: t("lawoss.initial.first_task", locale) } as const;
  if (input.prvaUlohaHotova) {
    return { ...zaklad, stav: "pripravene", detail: t("lawoss.initial.task_done", locale) };
  }
  return {
    ...zaklad,
    stav: "volitelne",
    detail: t("lawoss.initial.task_optional", locale),
    akcia: t("lawoss.initial.start_task", locale),
  };
}

/** Štyri riadky registra v poradí 01 – 04. */
export function buildSetupLedger(input: SetupLedgerInput, locale: Language = "sk"): SetupLedgerRiadok[] {
  return [priecinok(input, locale), model(input, locale), ochrana(input, locale), prvaUloha(input, locale)];
}

export function setupStatusLabel(status: SetupLedgerStav, locale: Language): string {
  const keys = { pripravene: "ready", caka: "waiting", volitelne: "optional", chyba: "error" };
  return t(`lawoss.initial.${keys[status]}`, locale);
}
