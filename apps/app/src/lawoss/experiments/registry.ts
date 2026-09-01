/**
 * LAWOSS experiments — the single list behind the "Experimenty" tab.
 *
 * Two kinds of entry:
 *  - `flag` — a switch that changes behaviour somewhere else in the app.
 *    Consume it with `useExperiment(id)`; default is always off.
 *  - `view` — a standalone screen that is still a design draft. Listed so we
 *    can see at a glance which screens are mockups and who owns them.
 *
 * Adding an experiment is one row here plus one `useExperiment` call. Removing
 * one is deleting the row: `useExperiment` returns false for unknown ids, so a
 * stale stored value can never resurrect dead behaviour.
 */

export type ExperimentStav = "návrh" | "v testovaní" | "na zlúčenie";

type ExperimentBase = {
  /** Stable storage key. Never reuse an id for a different experiment. */
  id: string;
  label: string;
  note: string;
  owner: string;
  stav: ExperimentStav;
};

export type Experiment =
  | (ExperimentBase & { kind: "flag" })
  | (ExperimentBase & { kind: "view"; to: string });

export const EXPERIMENTS: readonly Experiment[] = [
  {
    kind: "flag",
    id: "sidebar-registrove-zalozky",
    label: "Registrové záložky v sidebare asistenta",
    note: "Vloží Prehľad · Lehoty · Konektory · Marketplace priamo do sidebaru upstream asistenta, aby sa nemuselo prepínať medzi dvoma shellmi.",
    owner: "MČ",
    stav: "v testovaní",
  },
  {
    kind: "view",
    id: "view-prehlad",
    to: "/prehlad",
    label: "Prehľad",
    note: "Denný prehľad praxe — fiktívne dáta, čaká na lawoss/okf/read.ts (fáza C1).",
    owner: "MČ",
    stav: "návrh",
  },
  {
    kind: "view",
    id: "view-lehoty",
    to: "/lehoty",
    label: "Lehoty",
    note: "Počítanie a sledovanie lehôt — fiktívne dáta, SK a CZ sa musia modelovať zvlášť.",
    owner: "MČ",
    stav: "návrh",
  },
  {
    kind: "view",
    id: "view-konektory",
    to: "/konektory",
    label: "Konektory",
    note: "Stav pripojených MCP a skills — fiktívne dáta.",
    owner: "MČ",
    stav: "návrh",
  },
  {
    kind: "view",
    id: "view-marketplace",
    to: "/marketplace",
    label: "Marketplace",
    note: "Katalóg z lawoss-registry s pinnutými verziami — fiktívne dáta, fáza C7.",
    owner: "MČ",
    stav: "návrh",
  },
];

export const EXPERIMENT_FLAGS = EXPERIMENTS.filter((item) => item.kind === "flag");
export const EXPERIMENT_VIEWS = EXPERIMENTS.filter((item) => item.kind === "view");
