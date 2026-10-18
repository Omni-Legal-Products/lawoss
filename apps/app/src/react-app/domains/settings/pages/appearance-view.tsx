/** @jsxImportSource react */
import { LanguageSection } from "../appearance/language-section";
import { LayoutStack } from "../settings-layout";

export type AppearanceViewProps = {
  busy: boolean;
};

// Keep older Appearance routes working; these controls also live in Customization.
export function AppearanceView(props: AppearanceViewProps) {
  return (
    <LayoutStack>
      {/* 🟡 LAWOSS: alfa je len tmavá (enforceTheme), výber témy upstreamu sa nevykresľuje. */}
      <LanguageSection busy={props.busy} />
    </LayoutStack>
  );
}
