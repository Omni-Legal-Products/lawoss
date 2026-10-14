import { projectFilePath } from "@legalwork/types/project-files";
import type { ViewOwner } from "@legalwork/types/views";
import { projectFileTab } from "../workspace/project-file-tab";
import { wikiPanelTab } from "../wiki/wiki-tabs";

export function viewSourceTab(serverUrl: string, owner: ViewOwner, path: string) {
  if (!projectFilePath.safeParse(path).success || /^[a-z][a-z\d+.-]*:/i.test(path)) return null;
  const label = path.split("/").at(-1) ?? path;
  return owner.kind === "wiki" ? wikiPanelTab(serverUrl, owner.id, { kind: /\.md$/i.test(path) ? "page" : "asset", path }, label)
    : projectFileTab({ projectId: owner.id, workspaceId: owner.id, path, name: label });
}
