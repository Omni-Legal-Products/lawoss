/**
 * Tri skupiny plánu pred zápisom (spec MF 3.2 — „Nový spis — OKF plán pred
 * zápisom“). Čistá funkcia: dostane hotový plán z `previewPlan()` a kontext
 * obrazovky. Nevyrába vlastnú OKF logiku — čo vznikne a čo sa preskočí, o tom
 * rozhoduje `planEntity` v `lawoss/okf/src/core.ts`, rovnako pre CLI aj appku.
 */
import type { PlanEntry } from "../../../../../lawoss/okf/src/core";
import { targetDir, type NovySpisForm } from "./compose-prompt";

export type PlanGroupItem = {
  /** Cesta relatívna k priečinku spisu, alebo pomenovanie údaja pri upozornení. */
  label: string;
  /** Prečo je položka práve v tejto skupine. */
  note: string;
  /** UI-only keys; raw labels and notes stay independent of language. */
  labelKey?: string;
  noteKey?: string;
  noteParams?: Record<string, string>;
};

export type PlanGroups = {
  /** Súbory a priečinky, ktoré vzniknú. */
  prida: PlanGroupItem[];
  /** Čo v priečinku už je — plán sa toho nedotkne. */
  zostava: PlanGroupItem[];
  /** Konflikt názvu, cesta mimo workspace, neoverený subjekt, prázdne povinné pole. */
  pozornost: PlanGroupItem[];
};

export type PlanGroupContext = {
  form: NovySpisForm;
  /** Koreň workspace-u. Prázdny = cestu nevieme posúdiť, upozornenie nevzniká. */
  workspacePath: string;
};

/**
 * Cesta `dir` vyjadrená relatívne ku koreňu workspace-u; `null` = leží mimo neho.
 * Rovnaká odpoveď slúži na dve veci: čím sa pýtať servera na obsah priečinka a
 * či vôbec ide o cestu, na ktorú má agent povolenie.
 */
export function workspaceRelativePath(dir: string, workspacePath: string): string | null {
  const root = workspacePath.replace(/\/+$/, "");
  if (!root || !dir) return null;
  if (dir === root) return "";
  return dir.startsWith(`${root}/`) ? dir.slice(root.length + 1) : null;
}

export function groupPlan(rows: readonly PlanEntry[], context: PlanGroupContext): PlanGroups {
  const { form, workspacePath } = context;
  const groups: PlanGroups = { prida: [], zostava: [], pozornost: [] };

  for (const row of rows) {
    if (row.action === "skip") {
      groups.zostava.push({ label: row.path, note: "už existuje — plán ho neprepisuje", noteKey: "lawoss.setup.plan.exists" });
    } else {
      groups.prida.push({ label: row.path, note: "vznikne", noteKey: "lawoss.setup.plan.create" });
    }
  }

  const dir = targetDir(form);
  const folder = dir.split("/").pop() ?? dir;
  const title = form.title.trim();

  if (!title) {
    groups.pozornost.push({ label: "Názov", labelKey: "lawoss.setup.wizard.name", noteKey: "lawoss.setup.plan.missingTitle", note: "prázdne povinné pole — priečinok by vznikol ako „[názov]“" });
  } else if (folder !== title) {
    // Spisová značka má lomítko (`MSPH 79 INS 1/2026`); názov priečinka je jeden
    // segment, názov veci v karte ostáva pôvodný. Advokát musí vidieť oboje.
    groups.pozornost.push({ label: folder, noteKey: "lawoss.setup.plan.sanitized", noteParams: { title }, note: `názov priečinka sa líši od názvu veci „${title}“ — upravený na jeden segment` });
  }

  if (form.subject === "pravnicka-osoba" || form.subject === "fyzicka-osoba-podnikatel") {
    if (!form.ico.trim()) groups.pozornost.push({ label: form.identifierType || "Identifikátor", labelKey: form.identifierType ? undefined : "lawoss.setup.plan.identifier", noteKey: "lawoss.setup.plan.missingId", note: "chýba registračný identifikátor klienta" });
  }

  if (form.subject !== "spis" && form.subject !== "projekt") {
    if (!form.country?.trim()) groups.pozornost.push({ label: "Krajina klienta", labelKey: "lawoss.setup.plan.country", noteKey: "lawoss.setup.plan.missingCountry", note: "doplň krajinu; jurisdikcia veci ju nenahrádza" });
    groups.pozornost.push({ label: "Overenie subjektu", labelKey: "lawoss.setup.plan.verification", noteKey: "lawoss.setup.plan.unverified", note: "zatiaľ neoverené — preverenie sa vykoná pri inicializácii; samotná požiadavka nie je výsledkom" });
  }

  if (workspacePath && workspaceRelativePath(dir, workspacePath) === null) {
    groups.pozornost.push({ label: dir, noteKey: "lawoss.setup.plan.outsideWorkspace", note: "cesta mimo workspace — agent na ňu potrebuje povolenie (Tool Permissions)" });
  }

  return groups;
}
