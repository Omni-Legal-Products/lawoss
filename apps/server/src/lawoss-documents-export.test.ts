import { test, expect } from "bun:test";
import { mkdtemp, writeFile, readFile, rm, symlink, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { LawossDocuments } from "./lawoss/documents/service.js";
import { DocumentPreparation } from "./document-preparation/service.js";
import { OcrManager } from "./ocr/manager.js";
import { DocumentExports, exportInputSchema, type ValidateInput } from "./lawoss/documents/export.js";
import { parseCsv } from "./lawoss/documents/validation.js";
import type { WorkspaceInfo } from "./types.js";
const sha = (text: string) => createHash("sha256").update(text).digest("hex");
async function fixture(run: (exports: DocumentExports, workspace: WorkspaceInfo, root: string, id: string, documents: LawossDocuments) => Promise<void>) {
 const root = await mkdtemp(join(tmpdir(), "exports-"));
 const workspace: WorkspaceInfo = { id: "synthetic", name: "Synthetic", path: root, preset: "", workspaceType: "local" };
 const manager = new OcrManager(join(root,"ocr")), preparation = new DocumentPreparation(manager);
 const documents = new LawossDocuments({ configPath: join(root,"config.json") }, preparation);
 try {
  await writeFile(join(root,"source.txt"),"Synthetic Czech evidence");
  await writeFile(join(root,"TEST_ZDROJE_ISIR.json"),JSON.stringify({ source:"ISIR",company:"Synthetic s.r.o.",caseNumber:"SYN 1/2026",sourceUrl:"https://isir.justice.cz/isir/synthetic",sampleOnly:true,documents:[{file:"source.txt",documentId:"D1",url:"https://isir.justice.cz/isir/document/D1",sha256:sha("Synthetic Czech evidence")}] }));
  const [started] = await documents.prepare(workspace,["source.txt"]);
  for (let i=0;i<200;i++) { if ((await documents.list(workspace))[0].status === "readable") break; await new Promise(resolve=>setTimeout(resolve,10)); }
  await run(new DocumentExports(documents),workspace,root,started.id,documents);
 } finally { await documents.stop(); preparation.stop(); manager.stop(); await rm(root,{recursive:true,force:true}); }
}
test("actual prepared source exports UTF8 quoted registry, rereads and invalidates edits",()=>fixture(async (exports,w,root,id)=>{
 const input=exportInputSchema.parse({path:"registry.csv",kind:"registry",outputLanguage:"cs",documentIds:[id,id],entries:[{documentId:id,summary:'Český; "text"\nřádek'}]});
 const output=await exports.export(w,input);
 expect(output.verified).toBe(false);
 const rows=parseCsv(await readFile(join(root,"registry.csv"),"utf8")); expect(rows[1]).toHaveLength(7); expect(rows[1][5]).toBe('Český; "text"\nřádek'); expect(rows).toHaveLength(2);
 expect((await exports.validate(w,{paths:["registry.csv"],documentIds:[id],outputLanguage:"cs"})).valid).toBe(true); expect((await exports.list(w)).outputs[0].verified).toBe(true);
 await writeFile(join(root,"registry.csv"),(await readFile(join(root,"registry.csv"),"utf8")).replace("D1","D2"));
 const invalid=await exports.validate(w,{paths:["registry.csv"],documentIds:[id],outputLanguage:"cs"}); expect(invalid.valid).toBe(false); expect(invalid.outputs[0].verified).toBe(false); expect((await exports.list(w)).outputs[0].verified).toBe(false);
 await expect(exports.export(w,{...input,expectedHash:output.hash})).rejects.toThrow();
}));
test("ordinary malformed six-field CSV is inspectable, rejects identity and never overwritten",()=>fixture(async(exports,w,root,id)=>{
 await writeFile(join(root,"agent.csv"),'soubor;id_dokumentu;zdroj_url;datum_z_dokumentu;typ_dokumentu;kratky_obsah;ctitelnost\nsource.txt;D1;bad;;;text\n');
 const result=await exports.validate(w,{paths:["agent.csv"],documentIds:[id],outputLanguage:"cs"}); expect(result.valid).toBe(false); expect(result.issues.map(x=>x.code)).toContain("csv_width"); expect(result.issues.map(x=>x.code)).toContain("case_identity");
 await expect(exports.export(w,exportInputSchema.parse({path:"agent.csv",kind:"registry",outputLanguage:"cs",documentIds:[id],entries:[]}))).rejects.toThrow();
}));
test("summary Markdown uses explicit locale and unknown facts, current sources remain required",()=>fixture(async(exports,w,root,id)=>{
 const output=await exports.export(w,exportInputSchema.parse({path:"summary.md",kind:"summary",outputLanguage:"sk",documentIds:[id],entries:[]}));
 const text=await readFile(join(root,output.path),"utf8"); expect(text).toContain("# Súhrn"); expect(text).toContain("Nezistené");
 expect((await exports.validate(w,{paths:[output.path],documentIds:[id],outputLanguage:"sk"})).valid).toBe(true);
 await writeFile(join(root,"source.txt"),"Changed source");
 const result=await exports.validate(w,{paths:[output.path],documentIds:[id],outputLanguage:"sk"}); expect(result.valid).toBe(false); expect(result.outputs[0].verified).toBe(false);
}));
test("moved root fails export without recreating old directory",()=>fixture(async(exports,w,root,id)=>{
 const {rename,stat}=await import("node:fs/promises"); const moved=`${root}-moved`; await rename(root,moved);
 try { await expect(exports.export(w,exportInputSchema.parse({path:"registry.csv",kind:"registry",outputLanguage:"en",documentIds:[id],entries:[]}))).rejects.toThrow(); await expect(stat(root)).rejects.toThrow(); }
 finally { await rename(moved,root); }
}));
test("ordinary legacy register identity sidecar validates with exact rows and concrete issue codes",()=>fixture(async(exports,w,root,id)=>{
 const exported=await exports.export(w,exportInputSchema.parse({path:"generated.csv",kind:"registry",outputLanguage:"cs",documentIds:[id],entries:[]}));
 const rows=parseCsv(await readFile(join(root,exported.path),"utf8")); rows[0][6]="ctitelnost";
 const {serializeCsv}=await import("./lawoss/documents/validation.js");
 await writeFile(join(root,"ordinary.csv.lawoss.json"),JSON.stringify({caseNumber:"SYN 1/2026",company:"Synthetic s.r.o.",sourceUrl:"https://isir.justice.cz/isir/synthetic",project:w.name,outputLanguage:"cs"}));
 await writeFile(join(root,"ordinary.csv"),serializeCsv(rows));
 const valid=await exports.validate(w,{paths:["ordinary.csv"],documentIds:[id],outputLanguage:"cs"}); expect(valid.valid).toBe(true); expect(valid.outputs[0].owned).toBe(false);
 await expect(exports.export(w,exportInputSchema.parse({path:"ordinary.csv",kind:"registry",outputLanguage:"cs",documentIds:[id],entries:[],expectedHash:valid.outputs[0].hash}))).rejects.toThrow();
 const variants: Array<{data:string[][];code:string}>=[{data:[],code:"missing_source"},{data:[[...rows[1],"extra"]],code:"csv_width"},{data:[rows[1],rows[1]],code:"duplicate_source"},{data:[[...rows[1].slice(0,2),"https://isir.justice.cz/wrong",...rows[1].slice(3)]],code:"source_url"},{data:[[rows[1][0],"UNKNOWN",...rows[1].slice(2)]],code:"extra_source"}];
 for(const {data,code} of variants) {
  await writeFile(join(root,"ordinary.csv"),serializeCsv([rows[0],...data]));
  const result=await exports.validate(w,{paths:["ordinary.csv"],documentIds:[id],outputLanguage:"cs"}); expect(result.valid).toBe(false); expect(result.issues.map(issue=>issue.code)).toContain(code);
 }
}));
test("CAS repair is serialized, reload reads persisted checks, source and identity edits invalidate",()=>fixture(async(exports,w,root,id)=>{
 const input=exportInputSchema.parse({path:"registry.csv",kind:"registry",outputLanguage:"en",documentIds:[id],entries:[]});
 const first=await exports.export(w,input);
 const results=await Promise.allSettled([exports.export(w,{...input,expectedHash:first.hash,entries:[{documentId:id,summary:"First repair"}]}),exports.export(w,{...input,expectedHash:first.hash,entries:[{documentId:id,summary:"Second repair"}]})]);
 expect(results.filter(x=>x.status==="fulfilled")).toHaveLength(1); expect(results.filter(x=>x.status==="rejected")).toHaveLength(1);
 expect((await exports.list(w)).outputs[0].verified).toBe(false);
 expect((await exports.validate(w,{paths:["registry.csv"],documentIds:[id],outputLanguage:"en"})).valid).toBe(true);
 expect((await exports.list(w)).outputs[0].verified).toBe(true);
 await writeFile(join(root,"source.txt"),"Changed"); expect((await exports.list(w)).outputs[0].verified).toBe(false);
}));
test("ordinary Markdown plus CSV pair shares current saved identity without sidecar",()=>fixture(async(exports,w,root,id)=>{
 await exports.export(w,exportInputSchema.parse({path:"summary.md",kind:"summary",outputLanguage:"cs",documentIds:[id],entries:[]}));
 await exports.export(w,exportInputSchema.parse({path:"registered.csv",kind:"registry",outputLanguage:"cs",documentIds:[id],entries:[]}));
 await writeFile(join(root,"agent.md"),await readFile(join(root,"summary.md"))); await writeFile(join(root,"agent.csv"),await readFile(join(root,"registered.csv")));
 const input:ValidateInput={paths:["agent.md","agent.csv"],documentIds:[id],outputLanguage:"cs"};
 const result=await exports.validate(w,input); expect(result.valid).toBe(true); expect(result.outputs.every(o=>!o.owned && o.verified)).toBe(true);
 const before=await exports.list(w); expect(before.outputs.filter(o=>o.path.startsWith("agent")).every(o=>o.verified)).toBe(true);
 await writeFile(join(root,"agent.md"),(await readFile(join(root,"agent.md"),"utf8")).replaceAll("SYN 1/2026","OTHER CASE"));
 expect((await exports.list(w)).outputs.filter(o=>o.path.startsWith("agent")).every(o=>!o.verified)).toBe(true);
 const invalid=await exports.validate(w,input); expect(invalid.valid).toBe(false); expect(invalid.issues.map(i=>i.code)).toContain("case_identity");
}));
test("distinct prepared duplicate copies produce one registry row by source hash",()=>fixture(async(exports,w,root,id,documents)=>{
 await writeFile(join(root,"copy.txt"),await readFile(join(root,"source.txt")));
 const manifest=JSON.parse(await readFile(join(root,"TEST_ZDROJE_ISIR.json"),"utf8")); manifest.documents.push({...manifest.documents[0],file:"copy.txt"}); await writeFile(join(root,"TEST_ZDROJE_ISIR.json"),JSON.stringify(manifest));
 const [copy]=await documents.prepare(w,["copy.txt"]); for(let i=0;i<200;i++) { if((await documents.list(w)).find(r=>r.id===copy.id)?.status==="readable") break; await new Promise(resolve=>setTimeout(resolve,10)); }
 await exports.export(w,exportInputSchema.parse({path:"registry.csv",kind:"registry",outputLanguage:"cs",documentIds:[id,copy.id],entries:[]}));
 expect(parseCsv(await readFile(join(root,"registry.csv"),"utf8"))).toHaveLength(2);
 expect((await exports.validate(w,{paths:["registry.csv"],documentIds:[id,copy.id],outputLanguage:"cs"})).valid).toBe(true);
}));
test("missing case identity, mismatched source hash and nonofficial manifest URL remain invalid",()=>fixture(async(exports,w,root,id)=>{
 const file=join(root,"TEST_ZDROJE_ISIR.json"), original=JSON.parse(await readFile(file,"utf8"));
 const variants=[{...original,caseNumber:""},{...original,documents:[{...original.documents[0],sha256:"0".repeat(64)}]},{...original,documents:[{...original.documents[0],url:"https://example.invalid/D1"}]}];
 for(const manifest of variants) { await writeFile(file,JSON.stringify(manifest)); await expect(exports.export(w,exportInputSchema.parse({path:"registry.csv",kind:"registry",outputLanguage:"cs",documentIds:[id],entries:[]}))).rejects.toThrow(); const result=await exports.validate(w,{paths:["registry.csv"],documentIds:[id],outputLanguage:"cs"}); expect(result.valid).toBe(false); expect(result.issues.map(i=>i.code)).toContain("source_reference"); }
}));
test("ordinary non-ISIR project exports actual prepared references while legal case identity remains unknown",()=>fixture(async(exports,w,root,id)=>{
 await rm(join(root,"TEST_ZDROJE_ISIR.json"));
 await exports.export(w,exportInputSchema.parse({path:"ordinary-summary.md",kind:"summary",outputLanguage:"cs",documentIds:[id],entries:[{documentId:id,summary:"Source-backed synthetic summary"}]}));
 await exports.export(w,exportInputSchema.parse({path:"ordinary-registry.csv",kind:"registry",outputLanguage:"cs",documentIds:[id],entries:[]}));
 const result=await exports.validate(w,{paths:["ordinary-summary.md","ordinary-registry.csv"],documentIds:[id],outputLanguage:"cs"}); expect(result.valid).toBe(true);
 const list=await exports.list(w); expect(list.outputs.every(o=>o.identity.caseNumber===null && o.identity.company===null && o.identity.sourceUrl===null)).toBe(true); expect(list.outputs[0].identity.project).toBe(w.name);
 const rows=parseCsv(await readFile(join(root,"ordinary-registry.csv"),"utf8")); expect(rows[1][1]).toBe(id); expect(rows[1][2]).toBe(""); expect(rows[1]).toHaveLength(7);
 expect(await readFile(join(root,"ordinary-summary.md"),"utf8")).toContain("Nezjištěno");
}));
test("visible source attribution and coverage must match the saved summary block",()=>fixture(async(exports,w,root,id)=>{
 await exports.export(w,exportInputSchema.parse({path:"summary.md",kind:"summary",outputLanguage:"cs",documentIds:[id],entries:[]}));
 const original=await readFile(join(root,"summary.md"),"utf8");
 for(const changed of [original.replace("[D1](https://isir.justice.cz/isir/document/D1)","[D1](https://example.invalid/wrong-source)"),original.replace("[D1](https://isir.justice.cz/isir/document/D1)","[OTHER](https://isir.justice.cz/isir/document/D1)"),original.replace("## source.txt","## wrong.txt"),original.replace("Úplnost zpracování: Úplné","Úplnost zpracování: Neúplné")]) {
  await writeFile(join(root,"agent.md"),changed);
  const result=await exports.validate(w,{paths:["agent.md"],documentIds:[id],outputLanguage:"cs"});
  expect(result.valid).toBe(false); expect(result.outputs[0].verified).toBe(false); expect(result.issues.map(issue=>issue.code)).toContain("summary_provenance");
  expect((await exports.list(w)).outputs.find(o=>o.path==="agent.md")?.verified).toBe(false);
 }
}));
test("rejected visible identity companion cannot verify its CSV in either path order or persisted reload",()=>fixture(async(exports,w,root,id,documents)=>{
 await exports.export(w,exportInputSchema.parse({path:"summary.md",kind:"summary",outputLanguage:"cs",documentIds:[id],entries:[]}));
 await exports.export(w,exportInputSchema.parse({path:"registered.csv",kind:"registry",outputLanguage:"cs",documentIds:[id],entries:[]}));
 await writeFile(join(root,"agent.csv"),await readFile(join(root,"registered.csv")));
 await writeFile(join(root,"agent.md"),(await readFile(join(root,"summary.md"),"utf8")).replace("Synthetic s.r.o. — SYN 1/2026","OTHER COMPANY — OTHER CASE"));
 for(const paths of [["agent.md","agent.csv","registered.csv"],["agent.csv","agent.md","registered.csv"]]) {
  const result=await exports.validate(w,{paths,documentIds:[id],outputLanguage:"cs"}); expect(result.valid).toBe(false);
  expect(result.outputs.find(o=>o.path==="agent.csv")?.verified).toBe(false);
  expect(result.outputs.find(o=>o.path==="registered.csv")?.verified).toBe(true);
  expect(result.issues.some(issue=>issue.path==="agent.csv" && issue.code==="identity_dependency")).toBe(true);
  const reloaded=await new DocumentExports(documents).list(w);
  expect(reloaded.outputs.find(o=>o.path==="agent.csv")?.verified).toBe(false);
 }
}));


test("unlisted same-hash native copies validate in either selection order without another reference row",()=>fixture(async(exports,w,root,id,documents)=>{
 const bytes=await readFile(join(root,"source.txt"));
 await writeFile(join(root,"source (1).txt"),bytes);
 const [copy]=await documents.prepare(w,["source (1).txt"]);
 for(let i=0;i<200;i++){if((await documents.list(w)).find(d=>d.id===copy.id)?.status==="readable")break;await new Promise(r=>setTimeout(r,10));}
 for(const [index,ids] of [[copy.id,id],[id,copy.id]].entries()){
  const output=await exports.export(w,exportInputSchema.parse({path:`native-copy-${index}.csv`,kind:"registry",outputLanguage:"cs",documentIds:ids,entries:[]}));
  const rows=parseCsv(await readFile(join(root,output.path),"utf8"));expect(rows).toHaveLength(2);expect(rows[1][1]).toBe("D1");expect(rows[1][0]).toBe("source.txt");
  expect((await exports.validate(w,{paths:[output.path],documentIds:ids,outputLanguage:"cs"})).valid).toBe(true);
 }
 expect(await readFile(join(root,"source.txt"))).toEqual(bytes);expect(await readFile(join(root,"source (1).txt"))).toEqual(bytes);
 await writeFile(join(root,"source.txt"),"Changed listed reference");
 expect((await exports.list(w)).outputs.every(o=>!o.verified)).toBe(true);
 await writeFile(join(root,"source.txt"),bytes);
 expect((await exports.validate(w,{paths:["native-copy-0.csv","native-copy-1.csv"],documentIds:[copy.id,id],outputLanguage:"cs"})).valid).toBe(true);
 await writeFile(join(root,"source (1).txt"),"Changed duplicate");
 expect((await exports.list(w)).outputs.every(o=>!o.verified)).toBe(true);
}));

test("canonical within-case file/folder aliases resolve the known reference while external aliases reject",()=>fixture(async(exports,w,root,id,documents)=>{
 await mkdir(join(root,"inside"));
 await symlink(join(root,"source.txt"),join(root,"inside","alias.txt"));
 await symlink(join(root,"inside"),join(root,"folder-alias"),process.platform==="win32"?"junction":"dir");
 const [alias]=await documents.prepare(w,["folder-alias/alias.txt"]);
 for(let i=0;i<200;i++){if((await documents.list(w)).find(d=>d.id===alias.id)?.status==="readable")break;await new Promise(r=>setTimeout(r,10));}
 const output=await exports.export(w,exportInputSchema.parse({path:"alias.csv",kind:"registry",outputLanguage:"cs",documentIds:[alias.id,id],entries:[]}));
 expect(parseCsv(await readFile(join(root,output.path),"utf8"))).toHaveLength(2);
 expect((await exports.validate(w,{paths:[output.path],documentIds:[alias.id,id],outputLanguage:"cs"})).valid).toBe(true);
 const outside=await mkdtemp(join(tmpdir(),"native-reference-outside-"));
 try{
  await writeFile(join(outside,"foreign.txt"),await readFile(join(root,"source.txt")));
  await symlink(join(outside,"foreign.txt"),join(root,"external.txt"));
  const manifest=JSON.parse(await readFile(join(root,"TEST_ZDROJE_ISIR.json"),"utf8"));manifest.documents[0].file="external.txt";
  await writeFile(join(root,"TEST_ZDROJE_ISIR.json"),JSON.stringify(manifest));
  await expect(exports.export(w,exportInputSchema.parse({path:"external.csv",kind:"registry",outputLanguage:"cs",documentIds:[id],entries:[]}))).rejects.toThrow();
 }finally{await rm(outside,{recursive:true,force:true});}
}));

test("listed-path hash mismatch cannot borrow another matching reference; ambiguous unlisted hashes reject",()=>fixture(async(exports,w,root,id,documents)=>{
 const bytes=await readFile(join(root,"source.txt"));await writeFile(join(root,"copy.txt"),bytes);
 const [copy]=await documents.prepare(w,["copy.txt"]);
 for(let i=0;i<200;i++){if((await documents.list(w)).find(d=>d.id===copy.id)?.status==="readable")break;await new Promise(r=>setTimeout(r,10));}
 const file=join(root,"TEST_ZDROJE_ISIR.json"),original=JSON.parse(await readFile(file,"utf8"));
 const other={...original.documents[0],file:"copy.txt",documentId:"D2",url:"https://isir.justice.cz/isir/document/D2"};
 await writeFile(file,JSON.stringify({...original,documents:[{...original.documents[0],sha256:"0".repeat(64)},other]}));
 await expect(exports.export(w,exportInputSchema.parse({path:"wrong-listed.csv",kind:"registry",outputLanguage:"cs",documentIds:[id],entries:[]}))).rejects.toThrow();
 await writeFile(join(root,"same-bytes.txt"),bytes);
 const [unlisted]=await documents.prepare(w,["same-bytes.txt"]);
 for(let i=0;i<200;i++){if((await documents.list(w)).find(d=>d.id===unlisted.id)?.status==="readable")break;await new Promise(r=>setTimeout(r,10));}
 await writeFile(file,JSON.stringify({...original,documents:[...original.documents,other]}));
 await expect(exports.export(w,exportInputSchema.parse({path:"ambiguous.csv",kind:"registry",outputLanguage:"cs",documentIds:[unlisted.id],entries:[]}))).rejects.toThrow();
}));

// Removing unsupported-coverage rejection would endorse legacy model text,
// scalar/array JSON or absent fields despite current failed/partial extraction.
test("ordinary saved CSV and summaries require provable coverage for actual failed, partial and readable sources",()=>fixture(async(exports,w,root,_id,documents)=>{
 await rm(join(root,"TEST_ZDROJE_ISIR.json"));
 await writeFile(join(root,"failed.txt"),"binary\0content");
 const {PDFDocument,StandardFonts}=await import("pdf-lib");
 const pdf=await PDFDocument.create(),font=await pdf.embedFont(StandardFonts.Helvetica);
 pdf.addPage().drawText("Synthetic partial cover",{font}); await pdf.attach(new Uint8Array([1,2,3]),"unsupported.exe");
 await writeFile(join(root,"partial.pdf"),await pdf.save());
 await documents.prepare(w,["failed.txt","partial.pdf"]);
 let records=await documents.list(w);
 for(let i=0;i<200&&records.some(r=>["uploaded","preparing"].includes(r.status));i++){await new Promise(resolve=>setTimeout(resolve,10));records=await documents.list(w);}
 const {serializeCsv,renderSummaryVisible,summarySchema}=await import("./lawoss/documents/validation.js");
 const variants=["Complete; all pages read","",'"Complete"',"true","null","[]","[{}]"];
 for(const path of ["failed.txt","partial.pdf","source.txt"]){
  const source=records.find(r=>r.path===path&&!r.provenance.parentId)!;
  expect(source.status).toBe(path==="failed.txt"?"failed":path==="partial.pdf"?"partial":"readable");
  const baseline=`baseline-${source.id}.csv`,summary=`baseline-${source.id}.md`;
  await exports.export(w,{path:baseline,kind:"registry",outputLanguage:"cs",documentIds:[source.id],entries:[]});
  await exports.export(w,{path:summary,kind:"summary",outputLanguage:"cs",documentIds:[source.id],entries:[]});
  const rows=parseCsv(await readFile(join(root,baseline),"utf8")); rows[0][6]="ctitelnost";
  const markdown=await readFile(join(root,summary),"utf8"),start=markdown.lastIndexOf("```json\n"),end=markdown.lastIndexOf("```");
  const data=JSON.parse(markdown.slice(start+8,end));
  const ordinary=`ordinary-${source.id}.csv`,ordinarySummary=`ordinary-${source.id}.md`;
  await writeFile(join(root,`${ordinary}.lawoss.json`),JSON.stringify({caseNumber:null,company:null,sourceUrl:null,project:w.name,outputLanguage:"cs"}));
  // Structured truthful incomplete coverage is valid; completeness is not required.
  await writeFile(join(root,ordinary),serializeCsv(rows));
  expect((await exports.validate(w,{paths:[ordinary,summary],documentIds:[source.id],outputLanguage:"cs"})).valid).toBe(true);
  for(const unsupported of variants){
   rows[1][6]=unsupported; await writeFile(join(root,ordinary),serializeCsv(rows));
   const result=await exports.validate(w,{paths:[ordinary],documentIds:[source.id],outputLanguage:"cs"});
   expect(result.valid).toBe(false); expect(result.issues.map(issue=>issue.code)).toContain("unsupported_coverage"); expect(result.outputs[0].verified).toBe(false); expect(result.outputs[0].owned).toBe(false);
   const altered=structuredClone(data); altered.sources[0].coverage=unsupported===""?undefined:unsupported==="Complete; all pages read"?unsupported:JSON.parse(unsupported);
   await writeFile(join(root,ordinarySummary),`${renderSummaryVisible(summarySchema.parse(altered))}\`\`\`json\n${JSON.stringify(altered)}\n\`\`\`\n`);
   const summaryResult=await exports.validate(w,{paths:[ordinarySummary],documentIds:[source.id],outputLanguage:"cs"});
   expect(summaryResult.valid).toBe(false); expect(summaryResult.issues.map(issue=>issue.code)).toContain("unsupported_coverage"); expect(summaryResult.outputs[0].verified).toBe(false);
   const reloaded=await new DocumentExports(documents).list(w);
   expect(reloaded.outputs.filter(output=>[ordinary,ordinarySummary].includes(output.path)).every(output=>!output.verified)).toBe(true);
  }
  const changed=structuredClone(data); changed.sources[0].coverage.complete=!source.complete;
  await writeFile(join(root,ordinary),serializeCsv([rows[0],[...rows[1].slice(0,6),JSON.stringify(changed.sources[0].coverage)]]));
  const mismatch=await exports.validate(w,{paths:[ordinary],documentIds:[source.id],outputLanguage:"cs"});
  expect(mismatch.issues.map(issue=>issue.code)).toContain("coverage"); expect(mismatch.outputs[0].verified).toBe(false);
 }
}));

test("reload retracts historical unsupported-coverage receipts and their dependent CSV without a new validation",()=>fixture(async(exports,w,root,id,documents)=>{
 await rm(join(root,"TEST_ZDROJE_ISIR.json"));
 await exports.export(w,{path:"current.csv",kind:"registry",outputLanguage:"cs",documentIds:[id],entries:[]});
 await exports.export(w,{path:"current.md",kind:"summary",outputLanguage:"cs",documentIds:[id],entries:[]});
 expect((await exports.validate(w,{paths:["current.csv","current.md"],documentIds:[id],outputLanguage:"cs"})).valid).toBe(true);
 const csvReceipt=(await documents.outputRecord(w,"current.csv"))!,summaryReceipt=(await documents.outputRecord(w,"current.md"))!;
 const {serializeCsv,renderSummaryVisible,summarySchema}=await import("./lawoss/documents/validation.js");
 const rows=parseCsv(await readFile(join(root,"current.csv"),"utf8")); rows[1][6]="Complete; all pages read";
 const csv=serializeCsv(rows),markdown=await readFile(join(root,"current.md"),"utf8");
 const data=JSON.parse(markdown.slice(markdown.lastIndexOf("```json\n")+8,markdown.lastIndexOf("```"))); data.sources[0].coverage="Complete; all pages read";
 const legacyMarkdown=`${renderSummaryVisible(summarySchema.parse(data))}\`\`\`json\n${JSON.stringify(data)}\n\`\`\`\n`;
 await writeFile(join(root,"legacy.csv"),csv);await writeFile(join(root,"legacy.md"),legacyMarkdown);
 // Explicit migration fixtures represent receipts the old validator admitted;
 // the baseline source, ownership schema and fingerprint come from real validation.
 await documents.saveOutputRecord(w,{...csvReceipt,path:"legacy.csv",owned:false,hash:sha(csv),verifiedHash:sha(csv)});
 await documents.saveOutputRecord(w,{...summaryReceipt,path:"legacy.md",owned:false,hash:sha(legacyMarkdown),verifiedHash:sha(legacyMarkdown)});
 const currentCsv=await readFile(join(root,"current.csv"),"utf8");await writeFile(join(root,"dependent.csv"),currentCsv);
 await documents.saveOutputRecord(w,{...csvReceipt,path:"dependent.csv",owned:false,hash:sha(currentCsv),verifiedHash:sha(currentCsv),identityPath:"legacy.md",identityHash:sha(legacyMarkdown)});
 const listed=(await new DocumentExports(documents).list(w)).outputs;
 expect(listed.filter(output=>output.path.startsWith("current")).every(output=>output.verified)).toBe(true);
 for(const path of ["legacy.csv","legacy.md","dependent.csv"]) expect(listed.find(output=>output.path===path)?.verified).toBe(false);
}));

test("saved summary identity and source kind still match their persisted verification receipt",()=>fixture(async(exports,w,root,id,documents)=>{
 await exports.export(w,{path:"summary.md",kind:"summary",outputLanguage:"cs",documentIds:[id],entries:[]});
 expect((await exports.validate(w,{paths:["summary.md"],documentIds:[id],outputLanguage:"cs"})).valid).toBe(true);
 const receipt=(await documents.outputRecord(w,"summary.md"))!;
 for(const change of [{identity:{...receipt.identity,caseNumber:"OTHER CASE"}},{sourceKind:"workspace" as const}]){
  await documents.saveOutputRecord(w,{...receipt,...change});
  expect((await new DocumentExports(documents).list(w)).outputs[0].verified).toBe(false);
 }
}));
