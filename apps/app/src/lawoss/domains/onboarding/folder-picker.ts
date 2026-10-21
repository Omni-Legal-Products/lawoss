import { t } from "@/i18n";

export async function pickOnboardingDirectory(
  pick: (options: { title: string; canonical: true }) => Promise<unknown>,
): Promise<string | null> {
  const result = await pick({ title: t("welcome.folder_select"), canonical: true });
  return typeof result === "string" ? result : null;
}
