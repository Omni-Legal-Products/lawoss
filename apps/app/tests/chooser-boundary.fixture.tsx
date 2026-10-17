import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { WorkspaceEntryMenu } from "../src/react-app/domains/session/panel/workspace-entry-menu";
import { ProjectFileImportContext } from "../src/react-app/domains/workspace/use-project-file-import";
import { PanelTabDestinationProvider } from "../src/react-app/domains/session/panel/panel-tab-destination";

// Isolated browser fixture: real production menu/input/import handler; the
// supported visual-fixture importer writes bytes through an owned loopback sink.
export function mountChooserBoundaryFixture(copyUrl: string) {
  const host=document.createElement('div');document.body.appendChild(host);
  const root=createRoot(host), client=new QueryClient();
  const endpoint=createLegalworkServerClient({baseUrl:location.origin,token:'synthetic'});
  const copy=async (_projectId:string,files:File[],folder:string) => {
    if(files.length!==1||folder!=='Dokumenty')throw new Error('Unexpected synthetic copy scope');
    const response=await fetch(copyUrl,{method:'POST',body:await files[0].arrayBuffer()});
    if(!response.ok)throw new Error('Synthetic copy failed');
    return {files:[{name:files[0].name,status:'copied' as const,path:`Dokumenty/${files[0].name}`}]};
  };
  const render=(label:string)=>flushSync(()=>root.render(<QueryClientProvider client={client}><ProjectFileImportContext value={copy}><PanelTabDestinationProvider destination={{kind:'workspace',workspaceId:'synthetic'}} onOpen={()=>{}}>
    <div data-files-workspace-id="synthetic" data-files-workspace-root="/synthetic" data-files-folder-path="" data-files-client-identity="1" style={{width:400}}>
      <nav aria-label="Current folder"><button>Synthetic</button></nav>
      <WorkspaceEntryMenu client={endpoint} workspaceId="synthetic" workspaceRoot="/synthetic" isRemoteWorkspace={false} folderPath="" entry={{name:'Dokumenty',path:'Dokumenty',kind:'dir'}} onRefresh={()=>{}}>
        <div data-project-folder="Dokumenty">{label}</div>
      </WorkspaceEntryMenu>
    </div>
  </PanelTabDestinationProvider></ProjectFileImportContext></QueryClientProvider>));
  render('Dokumenty');
  return {refresh:()=>render('Dokumenty refreshed'),dispose:()=>{flushSync(()=>root.unmount());host.remove();client.clear();}};
}
