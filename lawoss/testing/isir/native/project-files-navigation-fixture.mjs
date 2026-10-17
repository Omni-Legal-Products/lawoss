import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { openNativeProjectFiles } from './project-files-navigation.mjs';

export const workspace = {id:'case-10',name:'Native case 10',path:'/synthetic/case-10'};
// Renderer-shaped DOM only: real helper expressions and the actual chooser
// observer execute in the VM. Files toggles; visited panels stay in the DOM.
// This does not mount React or claim native layout/handler coverage.
export function fixture({open=true,expanded=true,foreign=false,folder='',renderControls}={}) {
  const state={selected:foreign?'case-9':workspace.id,open,expanded,toggles:0,titles:0,expansions:0,roots:0};
  class Element {
    constructor(tag,attrs={},text='') {this.tagName=tag;this.attrs={...attrs};this.text=text;this.children=[];this.isConnected=true;this.disabled=false;this.zeroWidth=false;this.zeroHeight=false;}
    append(...children){for(const child of children){child.parentElement=this;this.children.push(child);}return this;}
    get nextElementSibling(){const siblings=this.parentElement?.children??[];return siblings[siblings.indexOf(this)+1]??null;}
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
  const group=el('div',{'data-slot':'collapsible'}),title=el('button',{},workspace.name),files=el('button',{},'Files');
  const expand=el('button',{'aria-label':'Expand'});
  const retained=el('div'),panel=el('div',{'data-files-workspace-id':workspace.id,'data-files-workspace-root':workspace.path,'data-files-folder-path':folder,'data-files-client-identity':'7'});
  const processing=el('div',{'aria-label':'Document processing'}),nav=el('nav',{'aria-label':'Current folder'}),root=el('button',{},workspace.name);
  const row=el('div'),trigger=el('div',{'data-slot':'context-menu-trigger'}),documents=el('button',{'data-project-folder':'Dokumenty'},'Dokumenty'),input=el('input',{type:'file'});
  body.append(group.append(title,expand,files),retained.append(panel.append(processing,nav.append(root),row.append(trigger.append(documents),input))));
  function sync(){
    const active=state.open&&state.selected===workspace.id;
    const rendered=renderControls?.({expanded:state.expanded,active,selected:state.selected===workspace.id}) ?? {
      title:{'data-slot':'sidebar-menu-button'},
      expand:{'data-slot':'button','aria-label':state.expanded?'Collapse':'Expand','aria-expanded':String(state.expanded)},
      files:{'data-slot':'sidebar-menu-sub-button',...(active?{'data-active':''}:{})},
    };
    title.attrs={...rendered.title};expand.attrs={...rendered.expand};files.attrs={...rendered.files};
    files.zeroWidth=!state.expanded;
    if(state.open)delete retained.attrs.hidden;else retained.attrs.hidden='';
    root.disabled=panel.dataset.filesFolderPath==='';
    if(root.disabled)root.attrs['aria-current']='location';else delete root.attrs['aria-current'];
    documents.zeroWidth=panel.dataset.filesFolderPath!=='';
  }
  title.onClick=()=>{state.titles++;state.selected=workspace.id;state.open=false;sync();};
  expand.onClick=()=>{state.expansions++;state.expanded=!state.expanded;sync();};
  files.onClick=()=>{state.toggles++;state.open=state.selected!==workspace.id||!state.open;state.selected=workspace.id;sync();};
  root.onClick=()=>{state.roots++;panel.attrs['data-files-folder-path']='';sync();};sync();
  const document={body,querySelectorAll:selector=>body.querySelectorAll(selector),querySelector:selector=>body.querySelector(selector)};
  const window={__legalwork:{slice:name=>{assert.equal(name,'route');return {selectedWorkspaceId:state.selected};}}};
  const context={window,document,MutationObserver:class{observe(){}disconnect(){}},__owReactQueryClient:{getQueryCache:()=>({findAll:()=>[{queryKey:['workspace-files',workspace.id,null,7,workspace.path,panel.dataset.filesFolderPath],getObserversCount:()=>1,state:{status:'success',fetchStatus:'idle'}}]})}};
  const expressions=[],waits=[];
  const cdp={evaluate:async expression=>{expressions.push(expression);return runInNewContext(expression,context);}};
  const waitError=Object.assign(new Error('fixture native wait expired'),{code:'ISIR_NATIVE_WAIT_EXPIRED'});
  const until=async(read,description,...budgets)=>{assert.deepEqual(budgets,[],'retain the default native operation budget');waits.push(description);for(let i=0;i<3;i++){const result=await read();if(result)return result;}throw waitError;};
  return {state,body,group,title,expand,files,retained,panel,processing,nav,root,documents,input,context,expressions,waits,waitError,cdp,until,sync,
    run:(readiness)=>openNativeProjectFiles({cdp,until,workspace,caseIndex:10,readiness})};
}
