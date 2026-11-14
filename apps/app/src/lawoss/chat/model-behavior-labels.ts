/**
 * LAWOSS: miera uvažovania po slovensky a česky, nie surové kľúče katalógu („none / low / … / xhigh / max“,
 * overenie alfy 12, 14. 11. 2026). Hodnota (kľúč katalógu) sa nemení, prekladá sa len zobrazený text;
 * neznámy kľúč vlastného poskytovateľa ostáva doslovne ako v upstreame. Volá `use-model-behavior.ts`, PATCHES.md.
 */
import { t } from "@/i18n";
import type { ModelBehaviorOption } from "@/app/types";

/** Statická mapa kľúčov (i18n audit odmieta skladané kľúče). */
const VARIANT_LABELS: Record<string, string> = {
  none: "lawoss.model_behavior.none",
  minimal: "lawoss.model_behavior.minimal",
  low: "lawoss.model_behavior.low",
  medium: "lawoss.model_behavior.medium",
  high: "lawoss.model_behavior.high",
  xhigh: "lawoss.model_behavior.xhigh",
  max: "lawoss.model_behavior.max",
};

/** Zobrazený text kľúča katalógu; neznámy kľúč vráti nezmenený. */
export function lawossVariantLabel(key: string): string {
  const label = VARIANT_LABELS[key];
  return label ? t(label) : key;
}

type BehaviorSummary = { label: string; value: string | null; options: ModelBehaviorOption[] };

/**
 * Prepíše texty volieb a vybranej voľby. Vybraná je uložená hodnota, inak predvolená voľba modelu; bez nej
 * ostáva pôvodný text súhrnu (nadpis), presne ako v `getModelBehaviorSummary`.
 */
export function localizeBehaviorSummary<T extends BehaviorSummary>(summary: T): T {
  const options = summary.options.map((option) => option.value && option.label === option.value
    ? { ...option, label: lawossVariantLabel(option.value) }
    : option);
  const selected = options.find((option) => summary.value ? option.value === summary.value : option.isDefault);
  return { ...summary, options, label: selected?.label ?? summary.label };
}
