import { t } from "@/i18n";
/**
 * LAWOSS experiments — the single list behind the "Experimenty" sidebar item.
 *
 * Two kinds of entry:
 *  - `flag` — a switch that changes behaviour somewhere else in the app.
 *    Consume it with `useExperiment(id)`; default is always off. A flag may
 *    only ADD unfinished behaviour — never hide working upstream behaviour.
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
    kind: "view",
    id: "view-novy-spis",
    to: "/experimenty/novy-spis",
    get label() { return t("lawoss.shell.new_matter"); },
    get note() { return t("lawoss.shell.new_matter_note"); },
    owner: "MČ",
    stav: "v testovaní",
  },
  {
    kind: "view",
    id: "view-prve-nastavenie",
    to: "/experimenty/prve-nastavenie",
    get label() { return t("lawoss.shell.setup"); },
    get note() { return t("lawoss.shell.setup_note"); },
    owner: "VŘ",
    stav: "v testovaní",
  },
  {
    kind: "view",
    id: "view-prehlad",
    to: "/prehlad",
    get label() { return t("lawoss.shell.overview"); },
    get note() { return t("lawoss.shell.overview_note"); },
    owner: "MČ",
    stav: "v testovaní",
  },
  {
    kind: "view",
    id: "view-spis",
    to: "/spis",
    get label() { return t("lawoss.shell.matter"); },
    get note() { return t("lawoss.shell.matter_note"); },
    owner: "MF",
    stav: "v testovaní",
  },
  {
    kind: "view",
    id: "view-lehoty",
    to: "/lehoty",
    get label() { return t("lawoss.shell.deadlines"); },
    get note() { return t("lawoss.shell.deadlines_note"); },
    owner: "MČ",
    stav: "v testovaní",
  },

];

export const EXPERIMENT_FLAGS = EXPERIMENTS.filter((item) => item.kind === "flag");
export const EXPERIMENT_VIEWS = EXPERIMENTS.filter((item) => item.kind === "view");
