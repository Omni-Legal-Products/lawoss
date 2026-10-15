import { test } from "node:test";
import assert from "node:assert/strict";
import { startProvider } from "./provider.mjs";

const source={id:"00000000-0000-4000-8000-000000000001",hash:"a".repeat(64),path:"Dokumenty/Synthetic source.pdf",parentId:null};
const prompt=`outputLanguage="cs".\nSelected sources (JSON): ${JSON.stringify([source])}`;
const tools=['lawoss_documents_list','lawoss_documents_read','lawoss_documents_export','lawoss_documents_validate','bash'].map(name=>({type:'function',function:{name,parameters:{type:'object'}}}));
async function complete(provider,messages,advertised=tools){
 const response=await fetch(`${provider.url}/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'synthetic',stream:true,messages,tools:advertised})});
 assert.equal(response.status,200);
 const chunks=(await response.text()).split('\n\n').filter(line=>line.startsWith('data: {')).map(line=>JSON.parse(line.slice(6)));
 return chunks.flatMap(c=>c.choices).find(c=>c.delta.tool_calls)?.delta.tool_calls[0];
}
test('title completion containing an old generation prompt never requests unavailable tools',async()=>{
 const provider=await startProvider();
 try{assert.equal(await complete(provider,[{role:'user',content:prompt}],[]),undefined);assert.equal(provider.errors.length,0);}finally{await provider.close();}
});
test('provider protocol follows real list/read cursors before requesting exports',async()=>{
 const provider=await startProvider();
 const messages=[{role:'user',content:[{type:'text',text:prompt}]}];
 try{
  const first=await complete(provider,messages);assert.equal(first.function.name,'lawoss_documents_list');
  messages.push({role:'assistant',tool_calls:[first]},{role:'tool',tool_call_id:first.id,content:JSON.stringify({documents:[],nextOffset:null})});
  const read=await complete(provider,messages);assert.equal(read.function.name,'lawoss_documents_read');
  messages.push({role:'assistant',tool_calls:[read]},{role:'tool',tool_call_id:read.id,content:JSON.stringify({pages:[],nextOffset:16000,complete:true})});
  const continuation=await complete(provider,messages);assert.equal(continuation.function.name,'lawoss_documents_read');assert.equal(JSON.parse(continuation.function.arguments).offset,16000);
  assert.equal(provider.errors.length,0);
 }finally{await provider.close();}
});

test('recovered native turn requests a fresh read instead of reusing an earlier tool result',async()=>{
 const provider=await startProvider();
 const old={id:'old_read',type:'function',function:{name:'lawoss_documents_read',arguments:JSON.stringify({id:source.id,limit:16000})}};
 const messages=[{role:'user',content:prompt},{role:'assistant',tool_calls:[old]},{role:'tool',tool_call_id:old.id,content:JSON.stringify({pages:[],nextOffset:null})},{role:'user',content:'NATIVE_RECOVERED_CWD_PROOF'}];
 try{
  const fresh=await complete(provider,messages);assert.equal(fresh.function.name,'lawoss_documents_read');assert.equal(JSON.parse(fresh.function.arguments).id,source.id);
  messages.push({role:'assistant',tool_calls:[fresh]},{role:'tool',tool_call_id:fresh.id,content:JSON.stringify({pages:[],nextOffset:null})});
  const cwd=await complete(provider,messages);assert.equal(cwd.function.name,"bash");assert.equal(JSON.parse(cwd.function.arguments).command,process.platform === "win32" ? 'node -p "process.cwd()"' : "pwd");
  messages.push({role:"assistant",tool_calls:[cwd]},{role:"tool",tool_call_id:cwd.id,content:"/synthetic/moved"});
  assert.equal(await complete(provider,messages),undefined);assert.equal(provider.errors.length,0);
 }finally{await provider.close();}
});

test('native export protocol validates advertised JSON schema then sends empty registry and missing summary hashes',async()=>{
 const {createRequire}=await import('node:module');
 const {z}=createRequire(new URL('../../../../apps/server/package.json',import.meta.url))('zod');
 const {LegalWorkProjectTools}=await import('../../../../apps/server/dist/opencode-plugins/legalwork-project-tools.js');
 const plugin=await LegalWorkProjectTools();
 const base={path:'synthetic.csv',kind:'registry',outputLanguage:'cs',documentIds:[source.id],entries:[]};
 for(const expectedHash of [null,' ','invalid','A'.repeat(64)])assert.throws(()=>plugin.tool.lawoss_documents_export.execute({...base,expectedHash},{directory:'/synthetic'}),'Built registered execute must reject invalid input before HTTP');
 const advertised=tools.map(tool=>tool.function.name==='lawoss_documents_export'?{...tool,function:{...tool.function,parameters:z.toJSONSchema(z.object(plugin.tool.lawoss_documents_export.args))}}:tool);
 const list={id:'list',type:'function',function:{name:'lawoss_documents_list',arguments:'{"limit":50}'}};
 const read={id:'read',type:'function',function:{name:'lawoss_documents_read',arguments:JSON.stringify({id:source.id,limit:16000})}};
 const messages=[{role:'user',content:prompt},{role:'assistant',tool_calls:[list]},{role:'tool',tool_call_id:'list',content:'{"documents":[],"nextOffset":null}'},{role:'assistant',tool_calls:[read]},{role:'tool',tool_call_id:'read',content:'{"text":"Synthetic evidence","nextOffset":null}'}];
 const provider=await startProvider();
 try{
  const registry=await complete(provider,messages,advertised);assert.equal(registry.function.name,'lawoss_documents_export');assert.equal(JSON.parse(registry.function.arguments).expectedHash,'');
  assert.equal(provider.receipts.at(-1).exportSchemaVerified,true);
  messages.push({role:'assistant',tool_calls:[registry]},{role:'tool',tool_call_id:registry.id,content:'{"path":"native-registry.csv"}'});
  const summary=await complete(provider,messages,advertised);assert.equal(JSON.parse(summary.function.arguments).kind,'summary');assert.equal(Object.hasOwn(JSON.parse(summary.function.arguments),'expectedHash'),false);
  assert.equal(provider.receipts.at(-1).exportSchemaVerified,true);
  const broad=structuredClone(advertised),broadExport=broad.find(t=>t.function.name==='lawoss_documents_export');
  broadExport.function.parameters=z.toJSONSchema(z.object({...plugin.tool.lawoss_documents_export.args,expectedHash:z.union([z.string(),z.literal('')]).optional()}));
  const broadCall=await complete(provider,messages,broad);assert.equal(JSON.parse(broadCall.function.arguments).kind,'summary');
  assert.deepEqual(provider.receipts.at(-1).exportWireAcceptance,{missing:true,empty:true,valid:true,null:false,whitespace:true,invalid:true,uppercase:true});
  const strict=structuredClone(advertised);const exported=strict.find(t=>t.function.name==='lawoss_documents_export');
  exported.function.parameters=z.toJSONSchema(z.object({...plugin.tool.lawoss_documents_export.args,expectedHash:z.string().regex(/^[a-f0-9]{64}$/).optional()}));
  const rejected=await fetch(`${provider.url}/chat/completions`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({model:'synthetic',stream:true,messages,tools:strict})});
  assert.equal(rejected.status,500,'Fixture must reject a real advertised schema that rejects literal empty');
  const diagnostic=(await rejected.json()).error.message;
  assert.match(diagnostic,/"variant":"empty"/);assert.match(diagnostic,/"expectedAccepted":true/);assert.match(diagnostic,/"actualAccepted":false/);assert.match(diagnostic,/"required":false/);
  assert.doesNotMatch(diagnostic,/Synthetic evidence|native-registry|synthetic-token/);
 }finally{await provider.close();}
});
