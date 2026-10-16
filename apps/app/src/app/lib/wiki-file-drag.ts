import { writeWorkspaceFileDrag, type WorkspaceFileDragItem } from "./workspace-file-drag";

export const WIKI_FILE_DRAG_TYPE = "application/x-legalwork-wiki-file";
export type WikiFileDragItem = WorkspaceFileDragItem & { serverUrl: string; wikiId: string };
export function writeWikiFileDrag(data: DataTransfer, item: WikiFileDragItem) {
  writeWorkspaceFileDrag(data, item);
  data.setData(WIKI_FILE_DRAG_TYPE, JSON.stringify(item));
}
export function readWikiFileDrag(data: Pick<DataTransfer, "getData">): WikiFileDragItem | null {
  try {
    const item: unknown = JSON.parse(data.getData(WIKI_FILE_DRAG_TYPE));
    if (!item || typeof item !== "object") return null;
    if (!("serverUrl" in item) || typeof item.serverUrl !== "string" || !/^https?:\/\//.test(item.serverUrl)) return null;
    if (!("wikiId" in item) || typeof item.wikiId !== "string" || !item.wikiId) return null;
    if (!("workspaceId" in item) || typeof item.workspaceId !== "string" || !item.workspaceId) return null;
    if (!("name" in item) || typeof item.name !== "string" || !item.name) return null;
    if (!("path" in item) || typeof item.path !== "string" || !item.path || /[\\:\x00-\x1f]/.test(item.path) || item.path.split("/").some(part => !part || part === ".." || part === ".")) return null;
    return { serverUrl: item.serverUrl, wikiId: item.wikiId, workspaceId: item.workspaceId, path: item.path, name: item.name };
  } catch { return null; }
}
