import { useState, type RefObject } from "react";
import type { DocxEditorRef } from "@eigenpal/docx-editor-react";
import { Button } from "@/components/ui/button";
import { toast } from "@/components/ui/sonner";
import { t } from "@/i18n";
import { updateWordFields } from "./docx-fields";
import type { WordMetadata } from "./docx-word-package";

type Props = {
  editorRef: RefObject<DocxEditorRef | null>;
  metadata: WordMetadata;
  readOnly: boolean;
  onChanged: () => void;
};

export function DocxWordTools({ editorRef, metadata, readOnly, onChanged }: Props) {
  const [busy, setBusy] = useState(false);
  const updateFields = async () => {
    if (!editorRef.current) return;
    setBusy(true);
    try {
      await updateWordFields(editorRef.current, metadata);
      onChanged();
      toast.success(t("docx.word.fields_updated"));
    } catch (error) {
      toast.error(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  };
  return <Button size="sm" variant="ghost" disabled={readOnly || busy} onClick={() => void updateFields()}>{t("docx.word.update_fields")}</Button>;
}
