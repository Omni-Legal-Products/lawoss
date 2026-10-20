/**
 * LAWOSS: náhrada editorov xlsx/pptx v paneli doplnku pre Word, Excel a PowerPoint.
 *
 * `vite.wordaddin.config.ts` sem presmeruje importy `artifact-xlsx-editor` a
 * `artifact-pptx-editor`, takže build panelu nenačíta Univer ani pptx-react-viewer.
 * Bez nich sa watch build zmestí do predvolenej pamäte Node (rozhodnutie MČ 20. 10. 2026).
 * Desktopová aplikácia používa pôvodné editory.
 */
import { useEffect } from "react";
import { MonitorUp } from "lucide-react";
import { t } from "@/i18n";
import { PanelEmptyState } from "@/react-app/design-system/panel-chrome";
import type { OfficeEditorApi, OfficeEditorProps } from "@/react-app/domains/session/artifacts/office-editor-state";

const unavailable = "This spreadsheet or presentation cannot be opened in the Office add-in pane. Ask the user to open it in the LAWOSS app.";

// Ready on purpose: the document runtime waits for ready() before it runs an
// agent action, so false would stall the agent for a minute. Every call fails
// at once with the message above instead.
const inertApi: OfficeEditorApi = {
  navigate: () => Promise.reject(new Error(unavailable)),
  isReady: () => true,
  save: () => Promise.resolve(false),
  drain: () => Promise.resolve(),
  getBuffer: () => Promise.resolve(null),
  revision: () => 0,
  executeAgentTool: () => Promise.resolve({ success: false, error: unavailable }),
};

function OfficeEditorUnavailable({ name, apiRef }: OfficeEditorProps) {
  useEffect(() => {
    apiRef.current = inertApi;
    return () => { if (apiRef.current === inertApi) apiRef.current = null; };
  }, [apiRef]);
  return (
    <div role="status" className="h-full overflow-auto">
      <PanelEmptyState icon={<MonitorUp />} title={t("lawoss.word_addin.editor_unavailable_title")} description={t("lawoss.word_addin.editor_unavailable_description", { name })} />
    </div>
  );
}

export function ArtifactXlsxEditor(props: OfficeEditorProps) {
  return <OfficeEditorUnavailable {...props} />;
}

export function ArtifactPptxEditor(props: OfficeEditorProps) {
  return <OfficeEditorUnavailable {...props} />;
}
