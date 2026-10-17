import { useState } from "react";
import { BrowserRouter, useNavigate, useLocation } from "react-router-dom";
import { PanelTab } from "../src/components/panel-tabs";
import { usePanelTabStore } from "../src/react-app/domains/session/panel/panel-tab-store";
import { createRoot } from "react-dom/client";
import { flushSync } from "react-dom";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { createLegalworkServerClient } from "../src/app/lib/legalwork-server";
import { WorkspaceEntryMenu } from "../src/react-app/domains/session/panel/workspace-entry-menu";
import { ProjectFileImportContext } from "../src/react-app/domains/workspace/use-project-file-import";
import { PanelTabDestinationProvider } from "../src/react-app/domains/session/panel/panel-tab-destination";

// Isolated browser fixture: real production menu/input/import handler; the
// supported visual-fixture importer writes bytes through an owned loopback sink.
export function mountChooserBoundaryFixture(copyUrl: string, options: { holdCompletion?: boolean; sibling?: boolean } = {}) {
  const previousSessions=usePanelTabStore.getState().sessions, previousUrl=location.href;
  const host=document.createElement('div');document.body.appendChild(host);
  const root=createRoot(host), client=new QueryClient();
  const endpoint=createLegalworkServerClient({baseUrl:location.origin,token:'synthetic'});
  let release = () => {};
  const completion = options.holdCompletion ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
  const copy=async (_projectId:string,files:File[],folder:string) => {
    if(files.length!==1||folder!=='Dokumenty')throw new Error('Unexpected synthetic copy scope');
    const response=await fetch(copyUrl,{method:'POST',body:await files[0].arrayBuffer()});
    if(!response.ok)throw new Error('Synthetic copy failed');
    await completion;
    return {files:[{name:files[0].name,status:'copied' as const,path:`Dokumenty/${files[0].name}`}]};
  };
  function CopyTabs() {
    const session=usePanelTabStore(state=>state.sessions['workspace:synthetic']);
    const tabs=session?.tabs ?? [];
    return <div>{tabs.map(tab=><div key={tab.id} data-panel-tab-id={tab.id}><PanelTab aria-label={`Select tab: ${tab.label}`} title={tab.type==='artifact' && tab.value ? `${tab.label} · Synthetic / ${tab.value}` : tab.label}>{tab.label}</PanelTab></div>)}</div>;
  }
  function Routing({label}:{label:string}) {
    const navigate=useNavigate(), location=useLocation();
    const [view,setView]=useState('files');
    return <><output data-copy-route>{location.pathname}</output><button aria-label="Refresh folder" />
    <PanelTabDestinationProvider destination={{kind:'workspace',workspaceId:'synthetic'}} onOpen={tab=>{usePanelTabStore.getState().openTab('workspace:synthetic',tab);navigate('/workspace/synthetic/session?view=workspace');setView('workspace')}}>
    <div data-copy-view={view}>

    <div data-files-workspace-id="synthetic" data-files-workspace-root="/synthetic" data-files-folder-path="" data-files-client-identity="1" style={{width:400}}>
      <nav aria-label="Current folder"><button>Synthetic</button></nav>
      {options.sibling && <WorkspaceEntryMenu client={endpoint} workspaceId="synthetic" workspaceRoot="/synthetic" isRemoteWorkspace={false} folderPath="" entry={{name:'Other',path:'Other',kind:'dir'}} onRefresh={()=>{}}><div data-project-folder="Other">Other</div></WorkspaceEntryMenu>}
      <WorkspaceEntryMenu client={endpoint} workspaceId="synthetic" workspaceRoot="/synthetic" isRemoteWorkspace={false} folderPath="" entry={{name:'Dokumenty',path:'Dokumenty',kind:'dir'}} onRefresh={()=>{}}>
        <div data-project-folder="Dokumenty">{label}</div>
      </WorkspaceEntryMenu>
    </div>
    </div><CopyTabs /></PanelTabDestinationProvider></>;
  }
  const render=(label:string)=>flushSync(()=>root.render(<BrowserRouter><QueryClientProvider client={client}><ProjectFileImportContext value={copy}><Routing label={label}/></ProjectFileImportContext></QueryClientProvider></BrowserRouter>));
  // A prior same-path tab must not acknowledge a fresh import.
  usePanelTabStore.getState().openTab('workspace:synthetic',{id:'stale',type:'artifact',label:'selected.txt',preview:'text',value:'Dokumenty/selected.txt'});
  history.replaceState(null,'','/workspace/synthetic/files');
  render('Dokumenty');
  return {release,refresh:()=>render('Dokumenty refreshed'),dispose:()=>{flushSync(()=>root.unmount());host.remove();client.clear();usePanelTabStore.setState({sessions:previousSessions});history.replaceState(null,'',previousUrl);}};
}
