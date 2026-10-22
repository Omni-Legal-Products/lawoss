/**
 * Otvorí zdrojový súbor položky prehľadu (cesta voči koreňu prehľadu) v natívnom pracovnom
 * priestore klienta prípadu: rovnaká karta súboru ako z prehliadača súborov, potom pohľad
 * Pracovný priestor. Súbor mimo priečinka klienta prípadu (iný klient, kancelária, priečinok)
 * sa neotvorí (`false`); UI ho vtedy ukáže len ako text (`locateCaseFile`).
 */
import { requestPanelTab } from "@/react-app/domains/session/panel/panel-tab-request";
import { classifyOpenTarget } from "@/react-app/domains/session/artifacts/open-target";
import { workspaceSessionRoute } from "@/react-app/shell/workspace-routes";
import type { OkfScope } from "../okf/read-model";
import { locateCaseFile } from "./case-files";

export function openScopeFile(scope: OkfScope | null, file: string, workspaceId: string, navigate: (to: string) => void): boolean {
  const located = locateCaseFile(scope, file, workspaceId);
  if (!located) return false;
  const name = located.path.split("/").pop() ?? located.path;
  requestPanelTab(
    { id: `file:${located.path.toLowerCase()}`, type: "artifact", label: name, preview: classifyOpenTarget(name, "file"), value: located.path },
    { kind: "workspace", workspaceId: located.workspace.id },
  );
  navigate(`${workspaceSessionRoute(located.workspace.id)}?view=workspace`);
  return true;
}
