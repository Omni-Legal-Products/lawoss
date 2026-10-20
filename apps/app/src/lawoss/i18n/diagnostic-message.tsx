import { t, type Language } from "@/i18n";
import { useLocale } from "@/i18n/use-locale";
import { diagnosticsEn } from "./diagnostics";

export function diagnosticText(value: unknown, locale: Language, fallback?: string): string {
  const code = value && typeof value === "object" && "code" in value ? value.code : undefined;
  const key = typeof code === "string" && code.startsWith("okf.")
    ? `lawoss.diagnostics.${code.slice(4)}` : "";
  const params = value && typeof value === "object" && "params" in value ? value.params : undefined;
  const safeParams: Record<string, string | number> = {};
  if (params && typeof params === "object") for (const [name, parameter] of Object.entries(params)) {
    if (typeof parameter === "string" || typeof parameter === "number") safeParams[name] = parameter;
  }
  return Object.hasOwn(diagnosticsEn, key) ? t(key, locale, safeParams) : fallback ?? t("lawoss.diagnostics.unknown", locale);
}
export function DiagnosticMessage({ value, fallback }: { value: unknown; fallback?: string }) {
  const locale = useLocale();
  const text = diagnosticText(value, locale, fallback);
  const raw = value instanceof Error ? value.message : value && typeof value === "object" && "message" in value ? String(value.message) : String(value ?? "");
  return <><span>{text}</span>{raw && raw !== text ? <details><summary>{t("lawoss.diagnostics.details", locale)}</summary><pre className="whitespace-pre-wrap break-words">{raw}</pre></details> : null}</>;
}
