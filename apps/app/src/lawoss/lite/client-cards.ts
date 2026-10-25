/**
 * Domov klienta ako portfólio prípadov (spec 0020, variant C): karty prípadov, najbližší termín a vstupy klienta.
 * Čisté funkcie nad už načítaným prehľadom; fáza a ďalší krok sú ručné riadky `_STATUS.md` (`buildMatterViews().strip`).
 * Stav práce prípadu ani stav kontroly súboru OKF neeviduje, preto tu nie sú.
 */
import { isOfficeFile, type MatterInput, type MatterOverview } from "../../../../../lawoss/okf/read";
import { pendingInputs } from "../../../../../lawoss/okf/inputs";
import type { MatterViews } from "../../../../../lawoss/okf/views";
import { deadlineText, isCalendarDay } from "../okf/view-rules";
import { isFiled } from "./inputs-model";

/** Najviac toľko kariet pred „Zobraziť všetky prípady“. */
export const CARDS_SHOWN = 6;

export type CardTerm = { kind: "deadline" | "work"; date: string; title: string; overdue: boolean };
/** Fáza a ďalší krok z `_STATUS.md`; `stale` = ručný stav je starší než pamäť. */
export type CardStatus = { phase?: string; nextStep?: string; stale?: true };
export type CaseCard = { matter: MatterOverview; term?: CardTerm; status: CardStatus };

/** Ručné riadky stavovej lišty prípadu (iba to, čo súbor skutočne obsahuje). */
export function cardStatus(views: Pick<MatterViews, "strip">): CardStatus {
  const item = (id: string) => {
    const section = views.strip.find((s) => s.id === id);
    return section?.status === "recorded" ? section.items[0] : undefined;
  };
  const phase = item("phase");
  const next = item("next_step");
  return { ...(phase ? { phase: phase.label } : {}), ...(next ? { nextStep: next.label } : {}), ...(phase?.flags?.includes("stale") || next?.flags?.includes("stale") ? { stale: true as const } : {}) };
}

/**
 * Termín karty: najskoršia lehota po termíne, inak najbližšia lehota alebo pracovný termín odo dneška.
 * Lehota kancelárie a neplatný dátum nie sú termínom prípadu.
 */
export function matterTerm(matter: Pick<MatterOverview, "deadlines" | "openTasks">, todayIso: string): CardTerm | undefined {
  const deadlines = matter.deadlines.filter((d) => !d.invalid && !isOfficeFile(d.file) && isCalendarDay(d.date))
    .map((d): CardTerm => ({ kind: "deadline", date: d.date, title: deadlineText(d), overdue: d.date < todayIso }));
  const work = matter.openTasks.flatMap((t): CardTerm[] => {
    const due = t.due?.trim().slice(0, 10);
    return due && isCalendarDay(due) && due >= todayIso ? [{ kind: "work", date: due, title: t.title, overdue: false }] : [];
  });
  const byDate = (a: CardTerm, b: CardTerm) => a.date.localeCompare(b.date) || (a.kind === "deadline" ? -1 : 1);
  return deadlines.filter((d) => d.overdue).sort(byDate)[0] ?? [...deadlines.filter((d) => !d.overdue), ...work].sort(byDate)[0];
}

/** Poradie: lehota po termíne → najbližší termín → bez termínu podľa poslednej zmeny (novšie skôr), potom názov. */
export function caseCards(matters: readonly MatterOverview[], statuses: Readonly<Record<string, CardStatus>>, todayIso: string): CaseCard[] {
  const rank = (card: CaseCard) => (card.term?.overdue ? 0 : card.term ? 1 : 2);
  return matters.map((matter): CaseCard => {
    const term = matterTerm(matter, todayIso);
    return { matter, status: statuses[matter.path] ?? {}, ...(term ? { term } : {}) };
  })
    .sort((a, b) => rank(a) - rank(b)
      || (a.term && b.term ? a.term.date.localeCompare(b.term.date) : (b.matter.lastEvent?.date ?? "").localeCompare(a.matter.lastEvent?.date ?? ""))
      || a.matter.title.localeCompare(b.matter.title, "cs"));
}

/** Najbližší termín klienta (karta súhrnu): to isté pravidlo ako pri karte, naprieč prípadmi. */
export function clientTerm(matters: readonly MatterOverview[], todayIso: string): (CardTerm & { matter: MatterOverview }) | undefined {
  return matters.flatMap((matter) => {
    const term = matterTerm(matter, todayIso);
    return term ? [{ ...term, matter }] : [];
  }).sort((a, b) => Number(b.overdue) - Number(a.overdue) || a.date.localeCompare(b.date))[0];
}

/** Vstupy klienta z `VSTUPY.md`; `null` = register vôbec nie je (neevidované, nie nula). */
export type InputCounts = { processed: number; waiting: number; unfiled: number };

/**
 * Počty zo `VSTUPY.md` prípadov a klienta. Klientsky register (`clientIntakes`) sa ráta aj vtedy, keď klient
 * ešte nemá prípad (review #246); s registrom zdedeným v prípadoch sa zlúči podľa cesty.
 */
export function inputCounts(matterInputs: readonly MatterInput[], matterPaths: readonly string[], clientIntakes: readonly { path: string; content: string }[] = []): InputCounts | null {
  const inputs: readonly MatterInput[] = clientIntakes.length
    ? [...matterInputs, { path: "", records: [], inheritedIntakes: clientIntakes.map((intake) => ({ ...intake, scope: "client" as const })) }]
    : matterInputs;
  const sources = new Map<string, string>();
  for (const input of inputs) {
    if (input.intake !== undefined) sources.set(`${input.path}/VSTUPY.md`, input.intake);
    for (const inherited of input.inheritedIntakes ?? []) sources.set(inherited.path, inherited.content);
  }
  if (sources.size === 0) return null;
  let processed = 0;
  for (const content of sources.values()) {
    for (const line of content.split("\n")) {
      if (line.trim().split("|").slice(1, -1).map((cell) => cell.trim())[4] === "processed") processed++;
    }
  }
  const pending = new Map(inputs.flatMap(pendingInputs).map((entry) => [`${entry.file}\u0000${entry.id}`, entry]));
  const unfiled = [...pending.values()].filter((entry) => !isFiled(entry, matterPaths)).length;
  return { processed, waiting: pending.size - unfiled, unfiled };
}
