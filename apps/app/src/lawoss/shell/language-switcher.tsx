/** @jsxImportSource react */
import { Languages } from "lucide-react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { LANGUAGE_OPTIONS, SYSTEM_LANGUAGE, isLanguagePreference, setLanguagePreference, t } from "@/i18n";
import { useLanguagePreference, useLocale } from "@/i18n/use-locale";

/** The header and native Settings share one persisted language preference. */
export function LanguageSwitcher() {
  const preference = useLanguagePreference();
  const locale = useLocale();
  const items = [
    ...LANGUAGE_OPTIONS.map((option) => ({ value: option.value, label: option.nativeName })),
    { value: SYSTEM_LANGUAGE, label: t("settings.language_system", locale) },
  ];
  return (
    <div className="w-40 max-w-[42vw] shrink-0 mac:titlebar-no-drag" data-lawoss-language-switcher>
      <Select value={preference} items={items} onValueChange={(value) => {
        if (isLanguagePreference(value)) setLanguagePreference(value);
      }}>
        <SelectTrigger className="h-8 w-full gap-2 text-xs" aria-label={t("settings.language", locale)}>
          <Languages className="size-4 shrink-0" aria-hidden="true" />
          <SelectValue placeholder={t("settings.language", locale)} />
        </SelectTrigger>
        <SelectContent align="end">
          <SelectGroup>
            {items.map((item) => <SelectItem key={item.value} value={item.value}>{item.label}</SelectItem>)}
          </SelectGroup>
        </SelectContent>
      </Select>
    </div>
  );
}
