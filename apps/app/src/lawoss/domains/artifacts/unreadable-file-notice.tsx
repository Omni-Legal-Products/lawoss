/** @jsxImportSource react */
import { FileWarning } from "lucide-react";
import { Button } from "@/components/ui/button";
import { PanelEmptyState } from "@/react-app/design-system/panel-chrome";
import { t } from "@/i18n";

type Props = { onOpenExternal?: () => void; onReveal?: () => void };

/** LAWOSS #492: hláška namiesto náhľadu prázdneho alebo poškodeného súboru, s akciami panela. */
export function UnreadableFileNotice({ onOpenExternal, onReveal }: Props) {
  return (
    <div role="alert" className="h-full overflow-auto">
      <PanelEmptyState icon={<FileWarning />} title={t("lawoss.file_preview.unreadable_title")} description={t("lawoss.file_preview.unreadable_description")}>
        {onOpenExternal || onReveal ? (
          <div className="flex flex-wrap justify-center gap-2">
            {onOpenExternal && <Button variant="outline" size="sm" onClick={onOpenExternal}>{t("lawoss.file_preview.open_external")}</Button>}
            {onReveal && <Button variant="ghost" size="sm" onClick={onReveal}>{t("artifact.show_in_folder")}</Button>}
          </div>
        ) : null}
      </PanelEmptyState>
    </div>
  );
}
