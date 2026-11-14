/**
 * Domov klienta ako portfólio prípadov (spec 0020, variant C): karty prípadov, najbližší termín a vstupy klienta.
 * Čisté funkcie nad už načítaným prehľadom; fáza a ďalší krok sú ručné riadky `_STATUS.md` (`buildMatterViews().strip`).
 * Stav práce prípadu ani stav kontroly súboru OKF neeviduje, preto tu nie sú.
 */
import { daysBetween, isOfficeFile, type MatterInput, type MatterOverview, type UpcomingDeadline } from "../../../../../lawoss/okf/read";
import { pendingInputs } from "../../../../../lawoss/okf/inputs";
import type { MatterViews } from "../../../../../lawoss/okf/views";
import { deadlineText, isCalendarDay } from "../okf/view-rules";
import type { OkfClient } from "../okf/read-model";
import { folderInputs, isFiled } from "./inputs-model";
import { dayTone, type DayTone } from "./today-model";

/** Najviac toľko kariet pred „Zobraziť všetky prípady“. */
export const CARDS_SHOWN = 6;

export type CardTerm = { kind: "deadline" | "work"; date: string; title: string; overdue: boolean };
/** Fáza a ďalší krok z `_STATUS.md`; `stale` = ručný stav je starší než pamäť. */
export type CardStatus = { phase?: string; nextStep?: string; stale?: true };
/** `invalid`: pôvodný text neplatného dátumu úlohy alebo lehoty prípadu (N-A7-4), na overenie. */
export type CaseCard = { matter: MatterOverview; term?: CardTerm; invalid?: string; status: CardStatus };

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

/**
 * N-A7-4: neplatný dátum úlohy alebo lehoty prípadu (nie kancelárie). Karta ho ukáže namiesto termínu
 * („? 31. 2. 2026 · overiť dátum“), inak by mala „bez termínu“ a advokát by sa o chybe nedozvedel.
 */
export function matterInvalidDate(matter: Pick<MatterOverview, "deadlines" | "openTasks">): string | undefined {
  const task = matter.openTasks.find((t) => t.invalid);
  if (task) return task.due?.trim() ?? "";
  return matter.deadlines.find((d) => d.invalid && !isOfficeFile(d.file))?.date.trim();
}

/** Poradie: neplatný dátum alebo lehota po termíne → najbližší termín → bez termínu podľa poslednej zmeny (novšie skôr), potom názov. */
export function caseCards(matters: readonly MatterOverview[], statuses: Readonly<Record<string, CardStatus>>, todayIso: string): CaseCard[] {
  const rank = (card: CaseCard) => (card.invalid !== undefined || card.term?.overdue ? 0 : card.term ? 1 : 2);
  return matters.map((matter): CaseCard => {
    const term = matterTerm(matter, todayIso);
    const invalid = matterInvalidDate(matter);
    return { matter, status: statuses[matter.path] ?? {}, ...(term ? { term } : {}), ...(invalid !== undefined ? { invalid } : {}) };
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
 * Počty zo `VSTUPY.md` prípadov a klienta. Klientsky register (`clients`) sa ráta aj vtedy, keď klient ešte nemá
 * prípad (review #246); s registrom zdedeným v prípadoch sa zlúči podľa cesty. Súbory v priečinkoch na nezaradené
 * bez riadku sú nezaradené vstupy ako na Dnes (N-A5-3).
 */
export function inputCounts(matterInputs: readonly MatterInput[], matterPaths: readonly string[], clients: readonly Pick<OkfClient, "path" | "intake" | "inboxFiles">[] = []): InputCounts | null {
  const clientIntakes = clients.flatMap((client) => client.intake ? [client.intake] : []);
  const inputs: readonly MatterInput[] = clientIntakes.length
    ? [...matterInputs, { path: "", records: [], inheritedIntakes: clientIntakes.map((intake) => ({ ...intake, scope: "client" as const })) }]
    : matterInputs;
  const sources = new Map<string, string>();
  for (const input of inputs) {
    if (input.intake !== undefined) sources.set(`${input.path}/VSTUPY.md`, input.intake);
    for (const inherited of input.inheritedIntakes ?? []) sources.set(inherited.path, inherited.content);
  }
  const folder = folderInputs({ inputs: matterInputs, clients });
  if (sources.size === 0 && folder.length === 0) return null;
  let processed = 0;
  for (const content of sources.values()) {
    for (const line of content.split("\n")) {
      if (line.trim().split("|").slice(1, -1).map((cell) => cell.trim())[4] === "processed") processed++;
    }
  }
  const pending = new Map(inputs.flatMap(pendingInputs).map((entry) => [`${entry.file}\u0000${entry.id}`, entry]));
  // Vlastný priečinok prípadu na nezaradené (#241) platí aj tu, nie len na Dnes.
  const inboxes = new Map(matterInputs.flatMap((input) => input.inbox ? [[input.path, input.inbox] as const] : []));
  const unfiled = [...pending.values(), ...folder].filter((entry) => !isFiled(entry, matterPaths, inboxes)).length;
  return { processed, waiting: pending.size + folder.length - unfiled, unfiled };
}

// ── Domov klienta v bežnom režime ako pasívny prehľad (alfa 14, spec-klient.md) ─────────────────────
// Čisté odvodenia nad tým, čo prehľad klienta už dostáva; obrazovka (`client-dashboard.tsx`) ich len zobrazí.

/** Dlaždica „Najbližšia lehota“: ten istý termín ako doterajšia karta (`clientTerm`), s počtom dní a farbou. */
export type TermTile =
  | { kind: "none" }
  | { kind: CardTerm["kind"]; title: string; date: string; matter: MatterOverview; daysLeft: number; late: boolean; tone: DayTone };

export function termTile(matters: readonly MatterOverview[], todayIso: string): TermTile {
  const term = clientTerm(matters, todayIso);
  if (!term) return { kind: "none" };
  const daysLeft = daysBetween(todayIso, term.date);
  // Pracovný termín nie je lehota: farbu naliehavosti dostane len po termíne (ako štítok na Dnes).
  const tone: DayTone = term.overdue ? "red" : term.kind === "deadline" ? dayTone(daysLeft) : "neutral";
  return { kind: term.kind, title: term.title, date: term.date, matter: term.matter, daysLeft, late: term.overdue, tone };
}

/**
 * Rozpis prípadov podľa druhu pre dlaždicu „Prípady“ len z druhov, ktoré dáta majú (`kinds` z `familyNames`, druhy
 * spojené „ · “). Prípad s dvoma druhmi sa ráta pri oboch; prípad bez rozpoznaného druhu sa nevymýšľa.
 */
export function kindBreakdown(kinds: Readonly<Record<string, string>>, paths: readonly string[]): { label: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const path of paths) {
    for (const label of new Set((kinds[path] ?? "").split(" · ").map((part) => part.trim()).filter(Boolean))) counts.set(label, (counts.get(label) ?? 0) + 1);
  }
  return [...counts].map(([label, count]) => ({ label, count })).sort((a, b) => b.count - a.count);
}

/** Koľko kariet nemá zapísanú fázu: jeden tichý riadok pod kartami namiesto „Fáza neevidovaná“ na každej karte. */
export const phaseMissing = (cards: readonly Pick<CaseCard, "status">[]): number => cards.filter((card) => !card.status.phase).length;

/** Štítok termínu na karte prípadu: neplatný dátum má prednosť (N-A7-4), potom po termíne, termín, bez termínu. */
export type CardPill =
  | { kind: "invalid"; raw: string }
  | { kind: "late"; term: CardTerm }
  | { kind: "due"; term: CardTerm; daysLeft: number; tone: DayTone | "work" }
  | { kind: "none" };

export function cardPill(card: Pick<CaseCard, "term" | "invalid">, todayIso: string): CardPill {
  if (card.invalid !== undefined) return { kind: "invalid", raw: card.invalid };
  const term = card.term;
  if (!term) return { kind: "none" };
  if (term.overdue) return { kind: "late", term };
  const daysLeft = daysBetween(todayIso, term.date);
  return { kind: "due", term, daysLeft, tone: term.kind === "work" ? "work" : dayTone(daysLeft) };
}

/** Riadok zoznamu lehôt klienta v štýle „Čo horí“: štvorček dní a štítok pôvodu. */
export type ClientDeadlineRow = { key: string; deadline: UpcomingDeadline; daysLeft: number | null; tone: DayTone; origin: "instruction" | "recorded" };

/** Prvých `limit` lehôt v poradí registra (po termíne, potom najbližšie); neplatný dátum nemá počet dní. */
export function clientDeadlineRows(deadlines: readonly UpcomingDeadline[], todayIso: string, limit: number): { rows: ClientDeadlineRow[]; more: number } {
  const rows = deadlines.slice(0, Math.max(0, limit)).map((deadline, index): ClientDeadlineRow => {
    const daysLeft = deadline.invalid ? null : daysBetween(todayIso, deadline.date);
    return { key: `${deadline.matter.path}\u0000${deadline.recordId}\u0000${deadline.date}\u0000${index}`, deadline, daysLeft, tone: dayTone(daysLeft), origin: deadline.basis === "instruction" ? "instruction" : "recorded" };
  });
  return { rows, more: Math.max(0, deadlines.length - rows.length) };
}

/** Otvorené úlohy zo záznamov prípadov klienta; úloha zo zdieľaného súboru sa ráta raz (ako na Dnes). */
export function openTaskTotal(matters: readonly Pick<MatterOverview, "path" | "openTasks">[]): number {
  return new Set(matters.flatMap((m) => m.openTasks.map((task) => task.file ?? `${m.path}\u0000${task.id}`))).size;
}

/** Dve písmená z názvu klienta: prvé písmená prvých dvoch slov (spec: právnu formu ani „SYN“ nerieši). */
export function clientInitials(name: string): string {
  const words = name.trim().split(/\s+/).map((word) => word.replace(/^[^\p{L}\p{N}]+/u, "")).filter(Boolean);
  return words.slice(0, 2).map((word) => ([...word][0] ?? "").toLocaleUpperCase("sk")).join("");
}

/** Chat klienta, ktorý už načítal bočný panel: názov a čas poslednej zmeny. */
export type RecentChat = { id: string; title: string; updated?: number };
type SessionLike = { id: string; title: string; parentID?: string | null; time?: { updated?: number | null; created?: number | null; archived?: number | null } };

/**
 * „Pokračovať“ na Domove klienta: najnovšie chaty z živého zoznamu bočného panela (nič sa nečíta navyše). Len
 * projekty so zoznamom načítaným (`ready`); bez archivovaných a podriadených chatov; najnovšie prvé.
 */
export function recentChats(groups: readonly { workspace: { id: string }; status: string; sessions: readonly SessionLike[] }[], limit: number): Record<string, RecentChat[]> {
  const when = (session: SessionLike) => session.time?.updated ?? session.time?.created ?? 0;
  return Object.fromEntries(groups.filter((group) => group.status === "ready").map((group) => [group.workspace.id, group.sessions
    .filter((session) => !session.parentID && !session.time?.archived && session.title.trim())
    .sort((a, b) => when(b) - when(a))
    .slice(0, Math.max(0, limit))
    .map((session): RecentChat => ({ id: session.id, title: session.title.trim(), ...(when(session) ? { updated: when(session) } : {}) }))]));
}
