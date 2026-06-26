/** @jsxImportSource react */
import type { Language } from "@/i18n";
import { LanguageSection } from "../appearance/language-section";
import { LayoutStack } from "../settings-layout";

export type AppearanceViewProps = {
  busy: boolean;
  themeMode: "light" | "dark" | "system";
  setThemeMode: (value: "light" | "dark" | "system") => void;
  language: Language;
  setLanguage: (value: Language) => void;
  hideTitlebar: boolean;
  toggleHideTitlebar: () => void;
};

// The theme is fixed to Light (see app/theme.ts) and the window/frame controls
// are hidden, so this tab now surfaces only the language picker.
export function AppearanceView(props: AppearanceViewProps) {
  return (
    <LayoutStack>
      <LanguageSection {...props} />
    </LayoutStack>
  );
}
