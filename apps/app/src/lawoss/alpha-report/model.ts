/**
 * LAWOSS: stav a pravidlá okna „Nahlásiť chybu alebo nápad“ (špecifikácia „Systém verejnej alfy“, časť 2).
 * Odosiela hlavný proces (`apps/desktop/electron/lawoss-alpha-report.mjs`); tu sú len polia formulára a texty chýb.
 */
import type { LawossAlphaReport } from "@legalwork/types/desktop-ipc";
import type { Language } from "@/i18n";

export type ReportKind = NonNullable<LawossAlphaReport["kind"]>;
export type ReportSeverity = NonNullable<LawossAlphaReport["severity"]>;
export type ReportRepeat = NonNullable<LawossAlphaReport["repeat"]>;

export const REPORT_KINDS: readonly ReportKind[] = ["chyba", "vylepsenie", "otazka"];
export const REPORT_SEVERITIES: readonly ReportSeverity[] = ["blokuje", "vazne", "drobnost"];
export const REPORT_REPEATS: readonly Exclude<ReportRepeat, "">[] = ["vzdy", "niekedy", "raz", "neskusane"];
/** Rovnaké minimum ako server (`what` aspoň 5 znakov). */
export const MIN_DESCRIPTION = 5;

export type ReportForm = {
  kind: ReportKind;
  severity: ReportSeverity;
  what: string;
  outcome: string;
  repeat: ReportRepeat;
  contact: string;
  includeDiagnostics: boolean;
  includeScreenshot: boolean;
};

/** Diagnostika je predvolene zaškrtnutá, snímka nie: na snímke môžu byť mená klientov. */
export const initialReportForm = (): ReportForm => ({
  kind: "chyba",
  severity: "vazne",
  what: "",
  outcome: "",
  repeat: "",
  contact: "",
  includeDiagnostics: true,
  includeScreenshot: false,
});

export const canSubmitReport = (form: ReportForm): boolean => form.what.trim().length >= MIN_DESCRIPTION;

/** Polia pre hlavný proces; závažnosť a opakovanie len pri chybe. */
export function toReport(form: ReportForm): LawossAlphaReport {
  const bug = form.kind === "chyba";
  return {
    kind: form.kind,
    ...(bug ? { severity: form.severity, repeat: form.repeat } : {}),
    what: form.what.trim(),
    outcome: form.outcome.trim(),
    contact: form.contact.trim(),
    includeDiagnostics: form.includeDiagnostics,
    includeScreenshot: form.includeScreenshot,
  };
}

const ERROR_CODES = [
  "rate_limited", "too_large", "consent", "invalid", "file_type", "too_many_files", "storage_failed", "bad_request",
  "server", "timeout", "network", "diagnostics",
] as const;
export type ReportErrorKey = `lawoss.report.error_${(typeof ERROR_CODES)[number] | "unknown"}`;

/** Zrozumiteľná veta ku kódu z hlavného procesu (kódy servera podľa `api/alfa/hlasenie`). */
export function reportErrorKey(code: string): ReportErrorKey {
  const known = ERROR_CODES.find((item) => item === code);
  return known ? `lawoss.report.error_${known}` : "lawoss.report.error_unknown";
}

/** Veľkosť diagnostiky v náhľade. */
export function formatReportBytes(bytes: number, locale: Language): string {
  const tag = locale === "cs" ? "cs-CZ" : locale === "sk" ? "sk-SK" : locale === "de" ? "de-DE" : "en-GB";
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${new Intl.NumberFormat(tag, { maximumFractionDigits: 0 }).format(kb)} kB`;
  return `${new Intl.NumberFormat(tag, { maximumFractionDigits: 1 }).format(kb / 1024)} MB`;
}
