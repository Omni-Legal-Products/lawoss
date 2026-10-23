import test from 'node:test';
import assert from 'node:assert/strict';
import { runInNewContext } from 'node:vm';
import { readFile, mkdtemp, access, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { openNativeProjectFiles } from './project-files-navigation.mjs';

import { fixture, workspace } from './project-files-navigation-fixture.mjs';

// Removing the active-state branch must close the already-open retained pane.
test('already-open Files stays visible without any toggle or workspace expansion click',async()=>{
  const f=fixture();await f.run();assert.equal(f.state.open,true);assert.equal(f.state.toggles,0);assert.equal(f.state.titles,0);
  assert.equal(f.documents.getBoundingClientRect().width>0,true);assert.equal(f.waits.length,4);
  assert.equal(f.context.window.__isirChooserBoundary.sample('test').selectedOwnerEqual,true);
});
test('closed Files opens exactly once and repeated calls remain open',async()=>{
  const f=fixture({open:false});await f.run();await f.run();assert.equal(f.state.open,true);assert.equal(f.state.toggles,1);assert.equal(f.state.titles,0);
});
test('ordinary foreign-workspace Files activation acknowledges the new owner and root',async()=>{
  const f=fixture({foreign:true,expanded:false,folder:'Dokumenty'});await f.run();assert.equal(f.state.selected,workspace.id);assert.equal(f.state.toggles,1);assert.equal(f.state.titles,0);assert.equal(f.state.expansions,1);assert.equal(f.state.roots,1);
  assert.equal(f.panel.dataset.filesFolderPath,'');assert.equal(f.root.getAttribute('aria-current'),'location');
});
test('workspace expansion ignores session chevrons and nested workspace controls',async()=>{
  const f=fixture({expanded:false,open:false}),Element=f.expand.constructor;
  const session=new Element('button',{'aria-label':'Expand sessions','aria-expanded':'false'});
  const nested=new Element('div',{'data-slot':'collapsible'});
  const nestedExpand=new Element('button',{'aria-label':'Expand','aria-expanded':'false'});
  const nestedFiles=new Element('button',{'data-slot':'sidebar-menu-sub-button'},'Files');
  let unrelatedClicks=0;
  for(const control of [session,nestedExpand,nestedFiles])control.onClick=()=>unrelatedClicks++;
  f.group.append(session,nested.append(nestedExpand,nestedFiles));
  await f.run();await f.run();
  assert.equal(unrelatedClicks,0);assert.equal(f.state.expansions,1);
  assert.equal(f.state.titles,0);assert.equal(f.state.toggles,1);
});
test('root navigation is scoped to the visible owned pane rather than a retained foreign breadcrumb',async()=>{
  const f=fixture({folder:'Dokumenty'}),foreign=f.root.constructor;
  const retained=new foreign('div',{hidden:'','data-files-workspace-id':'foreign'}),decoy=new foreign('nav',{'aria-label':'Current folder'}),button=new foreign('button',{},'Foreign project');
  let clicks=0;button.onClick=()=>clicks++;retained.append(decoy.append(button));f.body.children.unshift(retained);retained.parentElement=f.body;
  await f.run();assert.equal(clicks,0);assert.equal(f.state.roots,1);assert.equal(f.documents.getBoundingClientRect().width>0,true);
});
for(const [name,mutate] of [
  ['active but hidden',f=>{f.retained.attrs.hidden='';}],
  ['hidden ancestor despite nonzero geometry',f=>{f.retained.attrs.hidden='';for(const node of [f.panel,f.processing,f.nav,f.root,f.documents])node.getBoundingClientRect=()=>({width:200,height:24});}],
  ['zero-height pane',f=>{f.panel.zeroHeight=true;}],
  ['duplicate Files controls',f=>{f.group.append(new f.files.constructor('button',{'data-slot':'sidebar-menu-sub-button','data-active':''},'Files'));}],
  ['wrong runtime owner',f=>{f.panel.attrs['data-files-workspace-id']='foreign';}],
  ['wrong root',f=>{f.panel.attrs['data-files-workspace-root']='/foreign';}],
  ['wrong selected owner',f=>{f.state.selected='foreign';f.files.attrs['data-active']='';}],
  ['missing pane',f=>{f.retained.children=[];}],
  ['duplicate visible pane',f=>{const duplicate=new f.panel.constructor('div',{...f.panel.attrs});f.body.append(duplicate);}],
  ['missing processing panel',f=>{f.panel.children=f.panel.children.filter(node=>node!==f.processing);}],
  ['disabled Files control',f=>{f.files.disabled=true;}],
  ['missing Files control',f=>{f.group.children=f.group.children.filter(node=>node!==f.files);}],
  ['hidden Files control',f=>{f.files.zeroWidth=true;}],
  ['unknown Files component',f=>{delete f.files.attrs['data-slot'];}],
  ['malformed Files active state',f=>{f.files.attrs['data-active']='false';}],
  ['missing expansion control',f=>{f.group.children=f.group.children.filter(node=>node!==f.expand);}],
  ['unknown expansion state',f=>{delete f.expand.attrs['aria-expanded'];}],
  ['disabled expansion control',f=>{f.expand.disabled=true;}],
  ['duplicate expansion control',f=>{f.group.append(new f.expand.constructor('button',{...f.expand.attrs}));}],
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
  const reconnect=new f.files.constructor('button',{},'Reconnect client folder');
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
  ['duplicate',f=>{f.panel.append(new f.files.constructor('button',{},'Reconnect client folder'));}],
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
    click:async text=>{assert.equal(text,'Reconnect client folder');assert.equal(first.path,oldRoot);assert.equal(await access(oldRoot).then(()=>true,()=>false),false);clicks++;},
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


test('chooser binds the input following the intended trigger, not sibling entry inputs',async()=>{
  const f=fixture(),row=f.input.parentElement,Element=f.input.constructor;
  const before=new Element('div',{'data-slot':'context-menu-trigger'}),beforeInput=new Element('input',{type:'file'});
  const after=new Element('div',{'data-slot':'context-menu-trigger'}),afterInput=new Element('input',{type:'file'});
  row.children.unshift(before,beforeInput);before.parentElement=row;beforeInput.parentElement=row;row.append(after,afterInput);
  await f.run();
  const observer=f.context.window.__isirChooserBoundary;
  assert.equal(observer.capture().inputCount,1);
  assert.equal(observer.event(f.input).eventInputEqual,true);
  assert.equal(observer.event(beforeInput).eventInputEqual,false);
  assert.equal(observer.event(afterInput).eventInputEqual,false);
});
for(const [name,mutate] of [
  ['duplicate adjacent input',f=>f.input.parentElement.append(new f.input.constructor('input',{type:'file'}))],
  ['missing adjacent input',f=>{f.input.parentElement.children.pop();}],
  ['unrelated node between trigger and input',f=>{const row=f.input.parentElement,node=new f.input.constructor('div');node.parentElement=row;row.children.splice(1,0,node);}],
])test(`chooser cannot capture ${name}`,async()=>{
  const f=fixture();mutate(f);await f.run();
  const receipt=f.context.window.__isirChooserBoundary.capture();
  assert.equal(receipt.physicalScopeEqual,false);assert.equal(receipt.capturedConnected,null);
  assert.equal(f.context.window.__isirChooserBoundary.event(f.input).eventInputEqual,false);
});


test('actual picker menu action refuses ambiguous or foreign ownership before opening an input',async()=>{
  const source=await readFile(new URL('../../../../scripts/test-isir-native.mjs',import.meta.url),'utf8');
  const caller=source.split('\n').find(line=>line.includes('const upload=')&&line.includes('current project native upload menu action'));
  const expression=caller.split('cdp.evaluate(`')[1].split("`),'current project")[0].replace('${JSON.stringify(workspace.name)}',JSON.stringify(workspace.name));
  for(const mutation of ['none','duplicate','runtime','selected','root']) {
    const f=fixture();await f.run();let clicks=0;
    const upload=new f.files.constructor('button',{role:'menuitem'},'Add files');upload.onClick=()=>clicks++;f.body.append(upload);
    if(mutation==='duplicate')f.input.parentElement.append(new f.input.constructor('input',{type:'file'}));
    if(mutation==='runtime')f.panel.attrs['data-files-workspace-id']='foreign';
    if(mutation==='selected')f.state.selected='foreign';
    if(mutation==='root')f.panel.attrs['data-files-workspace-root']='/foreign';
    assert.equal(await f.cdp.evaluate(expression),mutation==='none');assert.equal(clicks,mutation==='none'?1:0);
  }
});
