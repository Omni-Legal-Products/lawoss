import { t } from "@/i18n";
import { aiBoundariesRefusal } from "./boundaries-refusal";

type ToastOptions = { description: string; duration?: number; action?: { label: string; onClick: () => void } };

/**
 * #551: toast pri neúspešnom odoslaní alebo zmene frontu v chate. Odmietnutie „AI hranicami“ ukáže lokalizovanú vetu
 * namiesto anglického textu servera, ostane na obrazovke a ponúkne nastavenie AI hraníc (ak ho okno vie otvoriť).
 */
export function composerFailureToast(error: unknown, title: string, openAiSettings?: () => void): { title: string; options: ToastOptions } {
  const boundaries = aiBoundariesRefusal(error);
  if (!boundaries) return { title, options: { description: error instanceof Error ? error.message : String(error) } };
  return {
    title,
    options: {
      description: boundaries,
      duration: Infinity,
      ...(openAiSettings ? { action: { label: t("lawoss.ai_boundaries.open_settings"), onClick: openAiSettings } } : {}),
    },
  };
}
