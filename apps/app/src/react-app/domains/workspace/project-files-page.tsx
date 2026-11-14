import type { ComponentProps } from "react";
import { t } from "@/i18n";
import { WorkspaceFilesPanel } from "../session/panel/workspace-files-panel";
import { LegalMemoryFilesPanel } from "../session/panel/legalmemory-files-panel";
import { useProjectFiles } from "./project-file-context";
import { ProjectFileDropTarget } from "./project-file-transfer";
import { FileSelectionProvider } from "./file-selection";
import { CompareDocumentsAction } from "@/lawoss/lite/compare-documents"; // 🟡 LAWOSS

export function ProjectFilesPage({ local }: {
  local: ComponentProps<typeof WorkspaceFilesPanel>;
  connected: ComponentProps<typeof LegalMemoryFilesPanel>;
}) {
  const access = useProjectFiles();
  const project = access?.projects.find(project => project.workspaceId === local.workspaceId && project.client.baseUrl === local.client?.baseUrl);
  return <FileSelectionProvider key={`${local.client?.baseUrl}:${local.workspaceId}`} scope={project?.projectId ?? ""}>{selectionToolbar => <ProjectFileDropTarget projectId={project?.projectId ?? ""} className="min-h-0 flex-1"><section data-file-explorer className="@container/files flex h-full min-h-0 flex-col overflow-auto">
    <div className="lw-project-page-content lw-project-page-top flex min-h-full flex-col pb-6">
      <header className="flex shrink-0 items-start gap-4 pb-5">{/* 🟡 LAWOSS: v bežnom režime „Porovnať dokumenty“ (Tabuľková kontrola) */}
        <div className="min-w-0 flex-1">
          <h1 className="text-2xl font-semibold tracking-tight">{t("projects.files")}</h1>
          <p className="mt-1.5 text-sm text-muted-foreground">{t("project_browser.files_description")}</p>
        </div>
        <CompareDocumentsAction projectId={local.projectId} />
      </header>
      {selectionToolbar}
      {/* 🟡 LAWOSS: „Pripojené súbory“ (Memory Drive / LegalMemory) sa neponúkajú, panel bol slepá ulička (PATCHES.md). */}
      <div className="grid min-h-[32rem] flex-1 gap-4">
        <section className="min-h-64 min-w-0 overflow-hidden rounded-xl border border-border/70" aria-label={t("session.workspace_files")}><WorkspaceFilesPanel {...local} searchable uploadPlacement="header" /></section>
      </div>
    </div>
  </section></ProjectFileDropTarget>}</FileSelectionProvider>;
}
