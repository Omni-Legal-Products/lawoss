import { useEffect, useRef, useState } from "react";
import { t } from "@/i18n";
import { createDocumentAutosave } from "./document-autosave";

/** Share DOCX's debounce, deadline and failure pause with text-based editors. */
export function useTextAutosave(options: {
  enabled: boolean;
  suspended: boolean;
  content: string;
  isDirty: () => boolean;
  save: () => Promise<boolean>;
}) {
  const latest = useRef(options);
  latest.current = options;
  const [error, setError] = useState<string | null>(null);
  const [controller] = useState(() => createDocumentAutosave({
    save: () => latest.current.save(),
    isDirty: () => latest.current.isDirty(),
    onError: error => setError(error instanceof Error ? error.message : t("artifact.save_failed")),
  }));
  useEffect(() => {
    controller.setEnabled(options.enabled);
    setError(null);
  }, [controller, options.enabled]);
  useEffect(() => {
    controller.setSuspended(options.suspended);
    return () => controller.setSuspended(true);
  }, [controller, options.suspended]);
  useEffect(() => { controller.changed(); }, [controller, options.content]);
  return {
    error,
    saved() { setError(null); controller.saved(); },
  };
}
