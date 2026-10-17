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

/** Actual desktop history, SessionPage import event, SidePanel and control publication. */
export async function mountProductionImportFixture(copyUrl: string, options: { holdCompletion?: boolean; sibling?: boolean } = {}) {
  const globals = ['__legalwork', '__legalworkControl', '__LEGALWORK_ELECTRON__'] as const;
  const descriptors = globals.map(name => [name, Object.getOwnPropertyDescriptor(window, name)] as const);
  const previousUrl = location.href;
  const previousSessions = usePanelTabStore.getState().sessions;
  const host = document.createElement('div');
  host.style.cssText = 'position:fixed;inset:0;background:white';
  document.body.appendChild(host);
  const root = createRoot(host), client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  let disposeOwner = () => {};
  let release = () => {};
  const dispose = () => {
    flushSync(() => root.unmount()); host.remove(); client.clear(); disposeOwner();
    usePanelTabStore.setState({ sessions: previousSessions });
    history.replaceState(null, '', previousUrl);
    for (const [name, descriptor] of descriptors) {
      if (descriptor) Object.defineProperty(window, name, descriptor);
      else Reflect.deleteProperty(window, name);
    }
  };
  try {
    // This is the real runtime-env router switch used by index.react.tsx.
    // Only a capability marker is supplied; no Electron or user profile is used.
    Object.defineProperty(window, '__LEGALWORK_ELECTRON__', { value: {}, configurable: true });
    const [{ HashRouter }, { isDesktopRuntime }, { SessionPage }, { LegalworkControlProvider }, { LocalProvider }, { ShellConfigProvider }, { WorkspaceProvider }, { TooltipProvider }, { publishInspectorSlice }, { ReloadCoordinatorProvider }] = await Promise.all([
      import('react-router-dom'), import('../src/app/lib/runtime-env'),
      import('../src/react-app/domains/session/chat/session-page'),
      import('../src/react-app/shell/control/control-provider'), import('../src/react-app/kernel/local-provider'),
      import('../src/react-app/shell/shell-config'), import('../src/react-app/shell/workspace-provider'),
      import('../src/components/ui/tooltip'), import('../src/app/lib/app-inspector'), import('../src/react-app/shell/reload-coordinator'),
    ]);
    const Router = isDesktopRuntime() ? HashRouter : BrowserRouter;
    let owner = 'synthetic';
    // The selected workspace is an input, published using the real inspector
    // descriptor/getter contract. Route navigation is owned by SessionPage below.
    disposeOwner = publishInspectorSlice('route', () => ({ selectedWorkspaceId: owner }));
    const endpoint = createLegalworkServerClient({ baseUrl: new URL(copyUrl).origin, token: 'synthetic' });
    const workspace = { id: 'synthetic', name: 'Synthetic', path: '/synthetic', preset: 'starter', workspaceType: 'local' as const };
    const noop = () => {};
    const completion = options.holdCompletion ? new Promise<void>(resolve => { release = resolve; }) : Promise.resolve();
    const copy = async (id: string, files: File[], folder: string) => {
      if (id !== workspace.id || files.length !== 1 || folder !== 'Dokumenty') throw new Error('Unexpected synthetic copy scope');
      const response = await fetch(copyUrl, { method: 'POST', body: await files[0].arrayBuffer() });
      if (!response.ok) throw new Error('Synthetic copy failed');
      await completion;
      return { files: [{ name: files[0].name, status: 'copied' as const, path: `Dokumenty/${files[0].name}` }] };
    };
    function Files() {
      return <PanelTabDestinationProvider destination={{ kind: 'workspace', workspaceId: workspace.id }}>
        <button aria-label="Refresh folder" />
        <div data-files-workspace-id={workspace.id} data-files-workspace-root={workspace.path} data-files-folder-path="" data-files-client-identity="1" style={{ width: 400 }}>
          <nav aria-label="Current folder"><button>Synthetic</button></nav>
          {(options.sibling ? ['Other', 'Dokumenty'] : ['Dokumenty']).map(name => <WorkspaceEntryMenu key={name} client={endpoint} workspaceId={workspace.id} workspaceRoot={workspace.path} isRemoteWorkspace={false} folderPath="" entry={{ name, path: name, kind: 'dir' }} onRefresh={noop}><div data-project-folder={name}>{name}</div></WorkspaceEntryMenu>)}
        </div>
      </PanelTabDestinationProvider>;
    }
    function Page() {
      const route = useLocation();
      return <><output data-copy-route>{route.pathname}</output><SessionPage
        mainView={route.pathname.endsWith('/files') ? <Files /> : undefined}
        selectedSessionId={null} selectedWorkspaceId={workspace.id} selectedWorkspaceDisplay={workspace}
        selectedWorkspaceRoot={workspace.path} runtimeWorkspaceId={workspace.id} workspaces={[workspace]}
        clientConnected legalworkServerStatus="connected" legalworkServerClient={endpoint} environmentClient={endpoint}
        developerMode={false} headerStatus="Ready" busyHint={null} startupPhase="ready" providerConnectedIds={[]}
        mcpConnectedCount={0} onOpenSettings={noop} onStartProjectRecording={noop} todos={[]} sessionLoadingById={() => false}
        sidebar={{ workspaceSessionGroups: [{ workspace, status: 'ready', sessions: [] }], selectedWorkspaceId: workspace.id, selectedSessionId: null, developerMode: false,
          sessionStatusById: {}, connectingWorkspaceId: null, workspaceConnectionStateById: {}, newChatDisabled: true,
          sidebarHydratedFromCache: true, startupPhase: 'ready', onSelectWorkspace: noop, onOpenSession: noop,
          onCreateChatInWorkspace: noop, onOpenRenameWorkspace: noop, onRevealWorkspace: noop, onForgetWorkspace: noop,
          onOpenCreateWorkspace: noop, onCreateChatInNewWorkspace: noop }}
      /></>;
    }
    usePanelTabStore.getState().openTab('workspace:synthetic', { id: 'stale', type: 'artifact', label: 'selected.txt', preview: 'text', value: 'Dokumenty/selected.txt' });
    history.replaceState(null, '', '/__isir-fixtures/probe.html#/workspace/synthetic/files');
    flushSync(() => root.render(<Router><QueryClientProvider client={client}><TooltipProvider><LocalProvider><ShellConfigProvider><ReloadCoordinatorProvider><WorkspaceProvider client={null} selectedWorkspaceRoot={workspace.path} workspaces={[]} baseUrl={endpoint.baseUrl} token="synthetic" opencodeBaseUrl="" onOpenSession={noop}><LegalworkControlProvider><ProjectFileImportContext value={copy}><Page /></ProjectFileImportContext></LegalworkControlProvider></WorkspaceProvider></ReloadCoordinatorProvider></ShellConfigProvider></LocalProvider></TooltipProvider></QueryClientProvider></Router>));
    return { release, dispose, setOwner: (id: string) => { owner = id; } };
  } catch (error) { dispose(); throw error; }
}
