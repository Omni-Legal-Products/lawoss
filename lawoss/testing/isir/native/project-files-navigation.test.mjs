import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFile, mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openNativeProjectFiles } from './project-files-navigation.mjs';

const workspace = {id:'case-10',name:'Native case 10',path:'/synthetic/case-10'};
// Renderer-shaped DOM only: real helper expressions and the actual chooser
// observer execute in the VM. Files toggles; visited panels stay in the DOM.
// This does not mount React or claim native layout/handler coverage.
function fixture({open=true,expanded=true,foreign=false,folder=''}={}) {
  const state={selected:foreign?'case-9':workspace.id,open,expanded,toggles:0,titles:0,roots:0};
  class Element {
    constructor(tag,attrs={},text='') {this.tagName=tag;this.attrs={...attrs};this.text=text;this.children=[];this.isConnected=true;this.disabled=false;this.zeroWidth=false;this.zeroHeight=false;}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}return this;}
    get dataset(){return Object.fromEntries(Object.entries(this.attrs).filter(([key])=>key.startsWith('data-')).map(([key,value])=>[key.slice(5).replace(/-([a-z])/g,(_,c)=>c.toUpperCase()),value]));}
    get textContent(){return this.text+this.children.map(child=>child.textContent).join('');}
    get innerText(){return this.textContent;}
    getAttribute(key){return this.attrs[key]??null;}
    matches(selector){return selector.split(',').some(part=>{const tag=part.trim().match(/^[a-z]+/);return (!tag||tag[0]===this.tagName)&&[...part.matchAll(/\[([^=\]]+)(?:="([^"]*)")?\]/g)].every(([,key,value])=>key in this.attrs&&(value===undefined||this.attrs[key]===value));});}
    querySelectorAll(selector){return this.children.flatMap(child=>[...(child.matches(selector)?[child]:[]),...child.querySelectorAll(selector)]);}
    querySelector(selector){return this.querySelectorAll(selector)[0]??null;}
    closest(selector){return this.matches(selector)?this:this.parentElement?.closest(selector)??null;}
    contains(node){return node===this||this.children.some(child=>child.contains(node));}
    getBoundingClientRect(){const hidden=this.closest('[hidden]');return {width:hidden||this.zeroWidth?0:200,height:hidden||this.zeroHeight?0:24};}
    click(){if(!this.disabled)this.onClick?.();}
  }
  const el=(...args)=>new Element(...args),body=el('body');
  const group=el('div',{'data-slot':'collapsible'}),title=el('button',{'aria-expanded':String(expanded)},workspace.name),files=el('button',{'aria-pressed':String(open&&!foreign)},'Files');
  const expand=el('button',{'aria-label':'Expand'});
  const retained=el('div'),panel=el('div',{'data-files-workspace-id':workspace.id,'data-files-workspace-root':workspace.path,'data-files-folder-path':folder,'data-files-client-identity':'7'});
  const processing=el('div',{'aria-label':'Document processing'}),nav=el('nav',{'aria-label':'Current folder'}),root=el('button',{},workspace.name);
  const row=el('div'),trigger=el('div',{'data-slot':'context-menu-trigger'}),documents=el('button',{'data-project-folder':'Dokumenty'},'Dokumenty'),input=el('input',{type:'file'});
  body.append(group.append(title,expand,files),retained.append(panel.append(processing,nav.append(root),row.append(trigger.append(documents),input))));
  function sync(){
    title.attrs['aria-expanded']=String(state.expanded);files.zeroWidth=!state.expanded;
    files.attrs['aria-pressed']=String(state.open&&state.selected===workspace.id);
    if(state.open)delete retained.attrs.hidden;else retained.attrs.hidden='';
    root.disabled=panel.dataset.filesFolderPath==='';
    if(root.disabled)root.attrs['aria-current']='location';else delete root.attrs['aria-current'];
    documents.zeroWidth=panel.dataset.filesFolderPath!=='';
  }
  title.onClick=()=>{state.titles++;state.expanded=!state.expanded;sync();};
  expand.onClick=()=>{state.expanded=true;sync();};
  files.onClick=()=>{state.toggles++;state.open=state.selected!==workspace.id||!state.open;state.selected=workspace.id;sync();};
  root.onClick=()=>{state.roots++;panel.attrs['data-files-folder-path']='';sync();};sync();
  const document={body,querySelectorAll:selector=>body.querySelectorAll(selector),querySelector:selector=>body.querySelector(selector)};
  const window={__legalwork:{slice:name=>{assert.equal(name,'route');return {selectedWorkspaceId:state.selected};}}};
  const context={window,document,MutationObserver:class{observe(){}disconnect(){}},__owReactQueryClient:{getQueryCache:()=>({findAll:()=>[{queryKey:['workspace-files',workspace.id,null,7,workspace.path,panel.dataset.filesFolderPath],getObserversCount:()=>1,state:{status:'success',fetchStatus:'idle'}}]})}};
  const expressions=[],waits=[];
  const cdp={evaluate:async expression=>{expressions.push(expression);return runInNewContext(expression,context);}};
  const waitError=Object.assign(new Error('fixture native wait expired'),{code:'ISIR_NATIVE_WAIT_EXPIRED'});
  const until=async(read,description,...budgets)=>{assert.deepEqual(budgets,[],'retain the default native operation budget');waits.push(description);for(let i=0;i<3;i++){const result=await read();if(result)return result;}throw waitError;};
  return {state,body,group,title,files,retained,panel,processing,nav,root,documents,input,context,expressions,waits,waitError,cdp,until,sync,
    run:(readiness)=>openNativeProjectFiles({cdp,until,workspace,caseIndex:10,readiness})};
}

// Removing the pressed-state branch must close the already-open retained pane.
test('already-open Files stays visible without any toggle or workspace expansion click',async()=>{
  const f=fixture();await f.run();assert.equal(f.state.open,true);assert.equal(f.state.toggles,0);assert.equal(f.state.titles,0);
  assert.equal(f.documents.getBoundingClientRect().width>0,true);assert.equal(f.waits.length,4);
  assert.equal(f.context.window.__isirChooserBoundary.sample('test').selectedOwnerEqual,true);
});
test('closed Files opens exactly once and repeated calls remain open',async()=>{
  const f=fixture({open:false});await f.run();await f.run();assert.equal(f.state.open,true);assert.equal(f.state.toggles,1);assert.equal(f.state.titles,0);
});
test('ordinary foreign-workspace Files activation acknowledges the new owner and root',async()=>{
  const f=fixture({foreign:true,expanded:false,folder:'Dokumenty'});await f.run();assert.equal(f.state.selected,workspace.id);assert.equal(f.state.toggles,1);assert.equal(f.state.titles,1);assert.equal(f.state.roots,1);
  assert.equal(f.panel.dataset.filesFolderPath,'');assert.equal(f.root.getAttribute('aria-current'),'location');
});
test('root navigation is scoped to the visible owned pane rather than a retained foreign breadcrumb',async()=>{
  const f=fixture({folder:'Dokumenty'}),foreign=f.root.constructor;
  const retained=new foreign('div',{hidden:'','data-files-workspace-id':'foreign'}),decoy=new foreign('nav',{'aria-label':'Current folder'}),button=new foreign('button',{},'Foreign project');
  let clicks=0;button.onClick=()=>clicks++;retained.append(decoy.append(button));f.body.children.unshift(retained);retained.parentElement=f.body;
  await f.run();assert.equal(clicks,0);assert.equal(f.state.roots,1);assert.equal(f.documents.getBoundingClientRect().width>0,true);
});
for(const [name,mutate] of [
  ['pressed but hidden',f=>{f.retained.attrs.hidden='';}],
  ['hidden ancestor despite nonzero geometry',f=>{f.retained.attrs.hidden='';for(const node of [f.panel,f.processing,f.nav,f.root,f.documents])node.getBoundingClientRect=()=>({width:200,height:24});}],
  ['zero-height pane',f=>{f.panel.zeroHeight=true;}],
  ['duplicate Files controls',f=>{f.group.append(new f.files.constructor('button',{'aria-pressed':'true'},'Files'));}],
  ['wrong runtime owner',f=>{f.panel.attrs['data-files-workspace-id']='foreign';}],
  ['wrong root',f=>{f.panel.attrs['data-files-workspace-root']='/foreign';}],
  ['wrong selected owner',f=>{f.state.selected='foreign';f.files.attrs['aria-pressed']='true';}],
  ['missing pane',f=>{f.retained.children=[];}],
  ['duplicate visible pane',f=>{const duplicate=new f.panel.constructor('div',{...f.panel.attrs});f.body.append(duplicate);}],
  ['missing processing panel',f=>{f.panel.children=f.panel.children.filter(node=>node!==f.processing);}],
  ['disabled Files control',f=>{f.files.disabled=true;}],
  ['missing Files control',f=>{f.group.children=f.group.children.filter(node=>node!==f.files);}],
  ['hidden Files control',f=>{f.files.zeroWidth=true;}],
  ['unknown Files pressed state',f=>{delete f.files.attrs['aria-pressed'];}],
  ['disabled project title',f=>{f.title.disabled=true;}],
  ['hidden root breadcrumb',f=>{f.nav.attrs.hidden='';}],
  ['wrong root breadcrumb',f=>{f.root.text='Foreign project';}],
  ['hidden Dokumenty',f=>{f.documents.zeroWidth=true;}],
  ['disabled Dokumenty',f=>{f.documents.disabled=true;}],
])test(`refuses ${name} instead of acknowledging stale DOM`,async()=>{
  const f=fixture();mutate(f);await assert.rejects(f.run(),error=>error===f.waitError);assert.equal(f.state.toggles,0);
});
test('a disabled noncurrent root cannot acknowledge root navigation',async()=>{
  const f=fixture({folder:'Dokumenty'});f.root.disabled=true;await assert.rejects(f.run(),error=>error===f.waitError);assert.equal(f.state.roots,0);
});
test('visibility lost while returning to root remains a refusal',async()=>{
  const f=fixture({folder:'Dokumenty'}),click=f.root.onClick;f.root.onClick=()=>{click();f.retained.attrs.hidden='';};
  await assert.rejects(f.run(),error=>error===f.waitError);assert.equal(f.state.roots,1);
});
test('chooser and CDP/wait failures retain the original error object',async()=>{
  for(const boundary of ['cdp','until']){const f=fixture(),primary=new Error(boundary);
    const args={cdp:f.cdp,until:f.until,workspace,caseIndex:10};if(boundary==='cdp')args.cdp={evaluate:async()=>{throw primary;}};else args.until=async()=>{throw primary;};
    await assert.rejects(openNativeProjectFiles(args),error=>error===primary);
  }
});
test('driver uses the imported helper and retains its selected-index side effect',async()=>{
  const source=await readFile(new URL('../../../../scripts/test-isir-native.mjs',import.meta.url),'utf8');
  assert.equal(source.split('import { openNativeProjectFiles } from "../lawoss/testing/isir/native/project-files-navigation.mjs";').length,2);
  const wrapper=source.match(/  const openFiles = (async[\s\S]*?\n  };)/)[1].slice(0,-1);
  const f=fixture({open:false});const call=runInNewContext(`(()=>{let selectedIndex=1;const workspaces=[{},${JSON.stringify(workspace)}];const openFiles=${wrapper};return async()=>{await openFiles(workspaces[1]);return selectedIndex;};})()`,{cdp:f.cdp,until:f.until,openNativeProjectFiles});
  assert.equal(await call(),2);assert.equal(f.state.toggles,1);assert.equal(f.state.open,true);
});

function missingRootFixture() {
  const f=fixture();
  // Production error branch: processing/breadcrumb stay; directory rows do not.
  f.panel.children=f.panel.children.filter(node=>!node.contains(f.documents));
  const reconnect=new f.files.constructor('button',{},'Reconnect project folder');
  f.panel.append(reconnect);
  return {...f,reconnect};
}
test('explicit missing-root recovery accepts the actual visible action without any directory row',async()=>{
  const f=missingRootFixture();await f.run('reconnect');
  assert.equal(f.panel.querySelector('[data-project-folder="Dokumenty"]'),null);
  assert.equal(f.state.toggles,0);assert.equal(f.waits.length,4);
});
for(const [name,mutate] of [
  ['missing',f=>{f.panel.children=f.panel.children.filter(node=>node!==f.reconnect);}],
  ['hidden',f=>{f.reconnect.attrs.hidden='';}],
  ['disabled',f=>{f.reconnect.disabled=true;}],
  ['aria-disabled',f=>{f.reconnect.attrs['aria-disabled']='true';}],
  ['wrong owner',f=>{f.panel.attrs['data-files-workspace-id']='foreign';}],
  ['wrong selected owner',f=>{f.state.selected='foreign';}],
  ['wrong registered root',f=>{f.panel.attrs['data-files-workspace-root']='/foreign';}],
  ['hidden pane',f=>{f.retained.attrs.hidden='';}],
  ['duplicate',f=>{f.panel.append(new f.files.constructor('button',{},'Reconnect project folder'));}],
  ['foreign pane action',f=>{f.panel.children=f.panel.children.filter(node=>node!==f.reconnect);f.body.append(f.reconnect);}],
])test(`explicit recovery refuses ${name} reconnect action`,async()=>{
  const f=missingRootFixture();mutate(f);await assert.rejects(f.run('reconnect'),error=>error===f.waitError);
});
test('ordinary Files still refuses the missing-root error branch',async()=>{
  const f=missingRootFixture();await assert.rejects(f.run(),error=>error===f.waitError);
});
for(const [name,mutate] of [
  ['missing',f=>{f.documents.parentElement.children=[];}],
  ['duplicate',f=>{f.panel.append(new f.files.constructor('button',{'data-project-folder':'Dokumenty'},'Dokumenty'));}],
  ['foreign',f=>{f.documents.parentElement.children=[];f.body.append(f.documents);}],
])test(`ordinary Files refuses ${name} Dokumenty row`,async()=>{
  const f=fixture();mutate(f);await assert.rejects(f.run(),error=>error===f.waitError);
});
test('actual driver recovery call reaches reconnect with old root absent, then requires ordinary listing after relink',async t=>{
  const owned=await mkdtemp(path.join(tmpdir(),'native-reconnect-'));t.after(()=>rm(owned,{recursive:true,force:true}));
  const oldRoot=path.join(owned,'absent'),moved=path.join(owned,'replacement');
  const source=await readFile(new URL('../../../../scripts/test-isir-native.mjs',import.meta.url),'utf8');
  const wrapper=source.match(/  const openFiles = (async[\s\S]*?\n  };)/)[1].slice(0,-1);
  const segment=source.slice(source.indexOf("  await until(()=>cdp.evaluate('!!window.__legalworkControl'),'relaunched native renderer',90000);"),source.indexOf("  await until(async()=>{const saved=",source.indexOf("'relaunched native renderer'")));
  const f=missingRootFixture();let clicks=0;
  // VM uses real navigation expressions. The registered root must still be old
  // when the existing driver click is reached; no filesystem recovery is faked.
  const first={...workspace,path:oldRoot};f.panel.attrs['data-files-workspace-root']=oldRoot;
  const call=runInNewContext(`(async()=>{let selectedIndex=1;const workspaces=[first];const openFiles=${wrapper};${segment}})()`,{
    first,cdp:{...f.cdp,events:[],evaluate:expression=>expression==='!!window.__legalworkControl'?true:f.cdp.evaluate(expression)},
    until:async(read,description,...budgets)=>description==='relaunched native renderer'?read():f.until(read,description,...budgets),openNativeProjectFiles,
    click:async text=>{assert.equal(text,'Reconnect project folder');assert.equal(first.path,oldRoot);assert.equal(await access(oldRoot).then(()=>true,()=>false),false);clicks++;},
  });
  await call;assert.equal(clicks,1);assert.equal(first.path,oldRoot);
  await assert.rejects(openNativeProjectFiles({cdp:f.cdp,until:f.until,workspace:first,caseIndex:1}),error=>error===f.waitError);
  // Model only the production relink's new DOM root/listing, then execute the
  // real driver's post-transaction assignment and ordinary navigation seam.
  f.panel.attrs['data-files-workspace-root']=moved;f.panel.append(f.documents);
  const relink=source.match(/  first.path=moved;\n  await openFiles\(first\);/)[0];
  await runInNewContext(`(async()=>{let selectedIndex=1;const workspaces=[first];const openFiles=${wrapper};${relink}})()`,{first,moved,cdp:f.cdp,until:f.until,openNativeProjectFiles});
  assert.equal(first.path,moved);assert.equal(f.state.toggles,0);assert.equal(await access(oldRoot).then(()=>true,()=>false),false);
});
