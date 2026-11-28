/** @jsxImportSource react */
/**
 * Spoločné diely Prehľadu praxe a detailu prípadu (variant A): kalendár s víkendmi, odpočet dní, štítok overenia,
 * upozornenie a preklad kanonických hodnôt (druh udalosti, riziko, záver) cez statické mapy kľúčov.
 */
import type { ReactNode } from "react";
import { AlertTriangle, Check, Clock, PenLine, Search, ShieldCheck } from "lucide-react";
import type { Language } from "@/i18n";
import type { MatterTextKey } from "../i18n/matters";
import { formatDay } from "../okf/read-model";
import type { CalendarDay, DeadlineTone } from "./overview-model";
import type { useMatterText } from "./okf-page";

export type MatterText = ReturnType<typeof useMatterText>["text"];

const EVENT_KIND: Readonly<Record<string, MatterTextKey>> = {
  delivery: "eventKind.delivery", filing: "eventKind.filing", hearing: "eventKind.hearing", decision: "eventKind.decision",
  request: "eventKind.request", call: "eventKind.call", email: "eventKind.email",
};
/** Kanonický druh udalosti v jazyku rozhrania; neznámy (vlastný) druh ostáva tak, ako je v zázname. */
export const eventKindText = (kind: string, text: MatterText): string => {
  const key = EVENT_KIND[kind];
  return key ? text(key) : kind;
};

const RISK: Readonly<Record<string, MatterTextKey>> = { low: "risk.low", medium: "risk.medium", high: "risk.high" };
const CONCLUSION: Readonly<Record<string, MatterTextKey>> = {
  proceed: "conclusion.proceed", enhanced_diligence: "conclusion.enhanced_diligence", decline: "conclusion.decline",
};
export const riskText = (value: string, text: MatterText): string => {
  const key = RISK[value];
  return key ? text(key) : value;
};
export const conclusionText = (value: string, text: MatterText): string => {
  const key = CONCLUSION[value];
  return key ? text(key) : value;
};

const daysBetweenIso = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);

/** Odpočet dní ako na Dnes: číslo a slovo, po termíne „!“. */
export function DayCount({ date, todayIso, tone, text, overdueLabel, todayLabel }: { date: string; todayIso: string; tone: DeadlineTone; text: MatterText; overdueLabel: string; todayLabel: string }) {
  const left = daysBetweenIso(todayIso, date);
  const [value, unit] = left < 0 ? ["!", overdueLabel] : left === 0 ? ["0", todayLabel] : [String(left), text("daysLeft", { count: left }).replace(/^\d+\s*/, "")];
  return <span className="lw-x-dni" data-tone={tone} aria-hidden><b>{value}</b><span>{unit}</span></span>;
}

/** Overenie lehoty slovom: overené človekom (prípadne kto a kedy), inak zapísané a neoverené. */
export function Trust({ confirmed, by, at, locale, text }: { confirmed: boolean; by?: string; at?: string; locale: Language; text: MatterText }) {
  if (!confirmed) return <span className="lw-x-trust" data-trust="recorded"><PenLine aria-hidden size={12} />{text("trust.recorded")}</span>;
  return <span className="lw-x-trust" data-trust="confirmed"><ShieldCheck aria-hidden size={13} />
    {by ? text("trust.verifiedBy", { by, date: at ? formatDay(at, locale) : "" }).replace(/ · $/, "") : text("provenance.verified")}
  </span>;
}

export type AlertTone = "red" | "amber" | "ok";
const ALERT_ICON = { clock: Clock, task: AlertTriangle, search: Search, ok: Check } as const;

/** Upozornenie: ikona, nadpis, detail a voliteľné štítky; s `href`-om ho volajúci obalí odkazom. */
export function AlertBox({ tone, icon, title, detail, tags, as = "div", ...rest }: { tone: AlertTone; icon: keyof typeof ALERT_ICON; title: string; detail?: ReactNode; tags?: ReactNode; as?: "div" | "li" } & Record<`data-${string}`, string | number | undefined>) {
  const Icon = ALERT_ICON[icon];
  const Tag = as;
  return <Tag className="lw-x-alert" data-tone={tone} {...rest}>
    <span className="lw-x-alert-icon"><Icon aria-hidden size={16} /></span>
    <span className="lw-x-alert-body"><b>{title}</b>{detail ? <span>{detail}</span> : null}{tags ? <span className="lw-x-alert-tags">{tags}</span> : null}</span>
  </Tag>;
}

const weekdayNames = (locale: Language): string[] => {
  const format = new Intl.DateTimeFormat(locale, { weekday: "short", timeZone: "UTC" });
  // 30. 11. 2026 je pondelok: názvy dní od pondelka po nedeľu.
  return Array.from({ length: 7 }, (_, i) => format.format(new Date(Date.UTC(2026, 10, 30 + i))).replace(".", ""));
};

/** Mriežka dní po týždňoch; obsah dňa dodá volajúci. Víkend má prerušovaný rámik, dnešok zlatý. */
export function CalendarGrid({ days, locale, todayLabel, holidayLabel, size = "large", label, renderDay }: { days: readonly CalendarDay[]; locale: Language; todayLabel: string;
  /** Slovo pri dni pracovného pokoja; pri viacerých jurisdikciách sa doplní SK alebo CZ. */
  holidayLabel: string; size?: "large" | "small"; label: string;
  renderDay: (day: CalendarDay) => ReactNode }) {
  const mixed = new Set(days.flatMap((day) => day.holidays.map((h) => h.jurisdiction))).size > 1;
  const names = weekdayNames(locale);
  const monthName = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  return <div className="lw-x-cal" data-size={size} role="grid" aria-label={label}>
    {names.map((name, i) => <span key={name} className="lw-x-cal-dow" role="columnheader" data-weekend={i > 4 || undefined}>{name}</span>)}
    {days.map((day, i) => {
      const dom = Number(day.iso.slice(8, 10));
      const showMonth = size === "large" && (i === 0 || dom === 1);
      const holiday = day.holidays.length > 0 ? `${holidayLabel}${mixed ? ` ${day.holidays.map((h) => h.jurisdiction.toUpperCase()).join("+")}` : ""}` : "";
      return <div key={day.iso} className="lw-x-cell" role="gridcell" data-weekend={day.weekend || undefined} data-past={day.past && !day.today ? "" : undefined}
        data-today={day.today || undefined} data-outside={day.outside} data-holiday={holiday ? day.holidays.map((h) => h.jurisdiction).join(" ") : undefined} data-day={day.iso}
        title={day.holidays.length ? day.holidays.map((h) => `${h.jurisdiction.toUpperCase()}: ${h.name}`).join(" · ") : undefined}>
        <span className="lw-x-cell-day">{dom}.{showMonth ? ` ${monthName.format(new Date(`${day.iso}T00:00:00Z`))}` : ""}{day.today ? <em>{todayLabel}</em> : holiday ? <em data-holiday-label="">{holiday}</em> : null}</span>
        {renderDay(day)}
      </div>;
    })}
  </div>;
}

/** Vypíše najviac `max` položiek dňa a zvyšok ako „+N ďalšie“. */
export function DayItems({ items, max, more }: { items: readonly ReactNode[]; max: number; more: (count: number) => string }) {
  return <>{items.slice(0, max)}{items.length > max ? <span className="lw-x-cal-more">{more(items.length - max)}</span> : null}</>;
}
