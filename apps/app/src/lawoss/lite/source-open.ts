/**
 * Otvorí zdrojový súbor položky prehľadu (cesta voči koreňu prehľadu) v natívnom pracovnom
 * priestore klienta: rovnaká karta súboru ako z prehliadača súborov, potom pohľad Pracovný priestor.
 * Cesta mimo rozsahu alebo priečinok sa neotvorí (`false`).
 */
import { requestPanelTab } from "@/react-app/domains/session/panel/panel-tab-request";
import { classifyOpenTarget } from "@/react-app/domains/session/artifacts/open-target";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";
import { locateInScope, type OkfScope } from "../okf/read-model";

export function openScopeFile(scope: OkfScope | null, file: string, navigate: (to: string) => void): boolean {
  if (!scope || !file || file.endsWith("/")) return false;
  const located = locateInScope(scope, file);
  if (!located?.path) return false;
  const name = located.path.split("/").pop() ?? located.path;
  requestPanelTab(
    { id: `file:${located.path.toLowerCase()}`, type: "artifact", label: name, preview: classifyOpenTarget(name, "file"), value: located.path },
    { kind: "workspace", workspaceId: located.workspace.id },
  );
  navigate(`${workspaceSessionRoute(located.workspace.id)}?view=workspace`);
  return true;
}
