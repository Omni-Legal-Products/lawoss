/** Výber priečinka v sprievodcovi (#456): nadpis natívneho dialógu v jazyku rozhrania, nie napevno anglicky. */
import { t } from "@/i18n";

type PickDirectory = (options: { title: string; canonical: boolean }) => Promise<string | string[] | null>;

export function onboardingFolderPicker(pickDirectory: PickDirectory): () => Promise<string | null> {
  return async () => {
    const result = await pickDirectory({ title: t("lawoss.onboarding.pick_folder_title"), canonical: true });
    return typeof result === "string" ? result : null;
  };
}
