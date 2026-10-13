import { createHash, randomUUID } from "node:crypto";
import { lstat, readFile, realpath, rename, rm, writeFile, link } from "node:fs/promises";
import { isDeepStrictEqual } from "node:util";
import { dirname, join, relative, resolve } from "node:path";
import { z } from "zod";
import { ApiError } from "../../errors.js";
import { within } from "../../reviews/storage.js";
import type { WorkspaceInfo } from "../../types.js";
import type { DocumentEvidence } from "./types.js";
import type { LawossDocuments } from "./service.js";
import { CSV_HEADER, parseCsv, serializeCsv, type ValidationIssue, type ValidationResult } from "./validation.js";
const sha = (bytes: string | Uint8Array) => createHash("sha256").update(bytes).digest("hex");
const hashSchema=z.string().regex(/^[a-f0-9]{64}$/);
export const outputLanguageSchema=z.enum(["cs","sk","en"]);
const ids=z.array(z.string().uuid()).min(1).max(20);
const pathSchema=z.string().min(1).max(4096);
export const exportInputSchema=z.strictObject({ path:pathSchema, kind:z.enum(["registry","summary"]), outputLanguage:outputLanguageSchema, documentIds:ids, expectedHash:hashSchema.optional(), entries:z.array(z.strictObject({documentId:z.string().uuid(),summary:z.string().max(12000),date:z.string().max(100).optional(),type:z.string().max(200).optional()})).max(20) });
export const validateInputSchema=z.strictObject({paths:z.array(pathSchema).min(1).max(10),documentIds:ids,outputLanguage:outputLanguageSchema});
export type ExportInput=z.infer<typeof exportInputSchema>;
export type ValidateInput=z.infer<typeof validateInputSchema>;
export type OutputStatus={sourceKind:"isir"|"workspace";path:string;kind:"registry"|"summary";outputLanguage:z.infer<typeof outputLanguageSchema>;documentIds:string[];identity:{caseNumber:string|null;company:string|null;sourceUrl:string|null;project:string};hash:string;currentHash:string|null;sourceHash:string;currentSourceHash:string|null;owned:boolean;verified:boolean;legalApproval:false};
export type OutputList={outputs:OutputStatus[];nextOffset:number|null;legalApproval:false};
export type ExportResult={sourceKind:"isir"|"workspace";path:string;hash:string;verified:false;kind:"registry"|"summary";outputLanguage:z.infer<typeof outputLanguageSchema>;legalApproval:false};
const manifestSchema=z.object({source:z.string().min(1).max(200),company:z.string().min(1).max(500),caseNumber:z.string().min(1).max(200),sourceUrl:z.string().url().max(2048),sampleOnly:z.boolean(),documents:z.array(z.object({file:pathSchema,documentId:z.string().min(1).max(200),url:z.string().url().max(2048),sha256:hashSchema})).min(1).max(500)});
const labels={cs:{summary:"Souhrn",unknown:"Nezjištěno",coverage:"Úplnost zpracování",complete:"Úplné",partial:"Neúplné"},sk:{summary:"Súhrn",unknown:"Nezistené",coverage:"Úplnosť spracovania",complete:"Úplné",partial:"Neúplné"},en:{summary:"Summary",unknown:"Unknown",coverage:"Extraction coverage",complete:"Complete",partial:"Incomplete"}};
/** Output ownership is persisted by the document service, not inferred from filenames. */
export class DocumentExports {
 private pending:Promise<unknown>=Promise.resolve();
 constructor(private readonly documents:LawossDocuments) {}
 private lock<T>(action:()=>Promise<T>):Promise<T> { const result=this.pending.then(action); this.pending=result.catch(()=>{}); return result; }
 private async file(workspace:WorkspaceInfo,path:string,maxBytes=4*1024*1024) {
  const root=await realpath(workspace.path), requested=resolve(root,path);
  if(!within(root,requested) || requested===root) throw new ApiError(403,"output_path","Output must be inside the selected project.");
  const parent=await realpath(dirname(requested)); if(!within(root,parent)) throw new ApiError(403,"output_path","Output parent escapes the project.");
  try { const info=await lstat(requested); if(info.isSymbolicLink() || !info.isFile() || info.size>maxBytes) throw new ApiError(400,"output_file","Output must be a regular file under 4 MiB."); } catch(error) { if(!isMissing(error)) throw error; }
  return {absolute:requested,path:relative(root,requested).replaceAll("\\","/")};
 }
 private async context(workspace:WorkspaceInfo,documentIds:string[]) {
  await realpath(workspace.path);
  let sourceKind:"isir"|"workspace"="workspace", manifestHash:string|null=null;
  let manifest:{source:string;company:string|null;caseNumber:string|null;sourceUrl:string|null;sampleOnly:boolean;documents:z.infer<typeof manifestSchema>["documents"]}={source:"workspace",company:null,caseNumber:null,sourceUrl:null,sampleOnly:false,documents:[]};
  try {
   const file=await this.file(workspace,"TEST_ZDROJE_ISIR.json"), raw=await readFile(file.absolute);
   const known=manifestSchema.parse(JSON.parse(raw.toString("utf8")));
   const official=(url:string)=>{ const parsed=new URL(url); return parsed.protocol==="https:" && parsed.hostname==="isir.justice.cz"; };
   if(!official(known.sourceUrl) || known.documents.some(d=>!official(d.url))) throw new Error("Manifest requires official ISIR URLs.");
   manifest=known; manifestHash=sha(raw); sourceKind="isir";
  } catch(error) { if(!isMissing(error)) throw error; }
  const all=await this.documents.list(workspace), selected:Array<{record:DocumentEvidence;reference:z.infer<typeof manifestSchema>["documents"][number];children:DocumentEvidence[]}>=[];
  for(const id of new Set(documentIds)) {
   const record=await this.documents.evidence(workspace,id);
   if(record.provenance.parentId) throw new Error("Select original sources; attachment citations remain separate.");
   const reference=sourceKind==="isir"?manifest.documents.find(d=>resolve(workspace.path,d.file)===resolve(workspace.path,record.path) && d.sha256===record.hash):{file:record.path,documentId:record.id,url:"",sha256:record.hash};
   if(!reference) throw new Error("Source is missing or mismatched in selected manifest.");
   const sourceFile=await this.file(workspace,reference.file,64*1024*1024); if(sha(await readFile(sourceFile.absolute))!==reference.sha256) throw new Error("Manifest source hash differs.");
   const children:DocumentEvidence[]=[]; const descendants=new Set([id]); for(const item of all) if(item.provenance.parentId && descendants.has(item.provenance.parentId)) { children.push(await this.documents.evidence(workspace,item.id)); descendants.add(item.id); }
   if(!selected.some(item=>item.reference.documentId===reference.documentId || item.record.hash===record.hash)) selected.push({record,reference,children});
  }
  const fingerprint=sha(JSON.stringify({manifest:manifestHash,sourceKind,workspace:{id:workspace.id,name:workspace.name},sources:selected.map(x=>({id:x.reference.documentId,hash:x.record.hash,complete:x.record.complete,issue:x.record.issue,pages:x.record.pages,children:x.children.map(c=>({hash:c.hash,provenance:c.provenance,complete:c.complete,issue:c.issue,pages:c.pages}))}))}));
  return {manifest,selected,fingerprint,sourceKind};
 }
 async export(workspace:WorkspaceInfo,input:ExportInput):Promise<ExportResult> { return this.lock(async()=>{
  input=exportInputSchema.parse(input); if(!input.path.endsWith(input.kind==="registry"?".csv":".md")) throw new ApiError(400,"output_extension","Use .csv for registry or .md for summary."); const context=await this.context(workspace,input.documentIds), file=await this.file(workspace,input.path), label=labels[input.outputLanguage];
  const stored=await this.documents.outputRecord(workspace,file.path);
  let current:string|undefined; try { current=sha(await readFile(file.absolute)); } catch(error) { if(!isMissing(error)) throw error; }
  if(current!==undefined && (!stored?.owned || stored.hash!==current || input.expectedHash!==current)) throw new ApiError(409,"output_conflict","Existing output is user-owned or changed; choose a new path or supply its current registered hash.");
  if(current===undefined && input.expectedHash!==undefined) throw new ApiError(409,"output_conflict","Expected output no longer exists.");
  if(input.entries.some(e=>!input.documentIds.includes(e.documentId)) || new Set(input.entries.map(e=>e.documentId)).size!==input.entries.length) throw new Error("Entries must uniquely reference selected prepared sources.");
  const identity={caseNumber:context.manifest.caseNumber,company:context.manifest.company,sourceUrl:context.manifest.sourceUrl,project:workspace.name};
  const rows=context.selected.map(({record,reference,children})=>{const entry=input.entries.find(e=>e.documentId===record.id); return [reference.file,reference.documentId,reference.url,entry?.date??label.unknown,entry?.type??label.unknown,entry?.summary??label.unknown,JSON.stringify(coverage(record,children))];});
  const serialized=input.kind==="registry"?serializeCsv([CSV_HEADER,...rows]):JSON.stringify({identity,sourceKind:context.sourceKind,outputLanguage:input.outputLanguage,heading:label.summary,coverageLabel:label.coverage,legalApproval:false,sources:rows.map(row=>({file:row[0],documentId:row[1],url:row[2],date:row[3],type:row[4],summary:row[5],coverage:JSON.parse(row[6])}))},null,2)+"\n";
  const sections=rows.map((row,index)=>`## ${row[0]}\n\n${row[5]}\n\n${row[2]?`[${row[1]}](${row[2]})`:`${label.unknown} (${row[1]})`}\n\n${label.coverage}: ${context.selected[index].record.complete?label.complete:label.partial}`).join("\n\n");
  const content=input.kind==="summary"?`# ${label.summary}\n\n${identity.company??label.unknown} — ${identity.caseNumber??label.unknown}\n\n${sections}\n\n\`\`\`json\n${serialized}\`\`\`\n`:serialized;
  if(Buffer.byteLength(content)>4*1024*1024) throw new Error("Output exceeds 4 MiB.");
  const temp=join(dirname(file.absolute),`.lawoss-${randomUUID()}.tmp`);
  try { await writeFile(temp,content,{flag:"wx",mode:0o600}); if((await this.context(workspace,input.documentIds)).fingerprint!==context.fingerprint) throw new Error("Sources changed during export.");
   const latest=await this.file(workspace,file.path); if(current!==undefined) { if(sha(await readFile(latest.absolute))!==current) throw new Error("Output changed during export."); await rename(temp,latest.absolute); } else { await link(temp,latest.absolute); await rm(temp); }
   const savedHash=sha(await readFile(file.absolute)); if(savedHash!==sha(content)) throw new Error("Published output changed before registration.");
   const result:ExportResult={sourceKind:context.sourceKind,path:file.path,hash:savedHash,verified:false,kind:input.kind,outputLanguage:input.outputLanguage,legalApproval:false};
   await this.documents.saveOutputRecord(workspace,{...result,owned:true,identityPath:null,identityHash:null,documentIds:[...new Set(input.documentIds)],identity,sourceHash:context.fingerprint,verifiedHash:null}); return result;
  } finally { await rm(temp,{force:true}); }
 }); }
 async list(workspace:WorkspaceInfo,offset=0,limit=20):Promise<OutputList> {
  z.number().int().min(0).max(500).parse(offset); z.number().int().min(1).max(20).parse(limit);
  const records=await this.documents.outputRecords(workspace), outputs:OutputStatus[]=[];
  for(const record of records.slice(offset,offset+limit)) {
   let currentHash:string|null=null, currentSourceHash:string|null=null,identityCurrent=true;
   try { const file=await this.file(workspace,record.path); currentHash=sha(await readFile(file.absolute)); } catch { /* Missing/unsafe output is unverified. */ }
   try { currentSourceHash=(await this.context(workspace,record.documentIds)).fingerprint; } catch { /* Stale sources are unverified. */ }
   if(record.identityPath) try { const identityFile=await this.file(workspace,record.identityPath); identityCurrent=sha(await readFile(identityFile.absolute))===record.identityHash; } catch { identityCurrent=false; }
   outputs.push({sourceKind:record.sourceKind,path:record.path,kind:record.kind,outputLanguage:record.outputLanguage,documentIds:record.documentIds,identity:record.identity,hash:record.hash,currentHash,sourceHash:record.sourceHash,currentSourceHash,owned:record.owned,verified:identityCurrent && currentHash!==null && currentHash===record.verifiedHash && currentSourceHash===record.sourceHash,legalApproval:false});
  }
  const end=Math.min(records.length,offset+limit); return {outputs,nextOffset:end<records.length?end:null,legalApproval:false};
 }
 async validate(workspace:WorkspaceInfo,input:ValidateInput):Promise<ValidationResult> { return this.lock(async()=>{
  input=validateInputSchema.parse(input); const issues:ValidationIssue[]=[],outputs:ValidationResult["outputs"]=[];
  let context:Awaited<ReturnType<DocumentExports["context"]>>|undefined;
  try { context=await this.context(workspace,input.documentIds); } catch { issues.push({code:"source_reference",message:"Selected source preparation/current hashes, or a present reference manifest identity/official URLs, are missing or mismatched."}); }
  for(const path of input.paths) {
   let digest:string|null=null, owned=false; const start=issues.length;
   try {
    const file=await this.file(workspace,path), bytes=await readFile(file.absolute); digest=sha(bytes); const stored=await this.documents.outputRecord(workspace,file.path); owned=stored?.owned??false;
    const problem=(code:string,message:string,row?:number)=>issues.push({code,path: file.path,message,...(row===undefined?{}:{row})});
    let rows:string[][]; let identity: {caseNumber:string|null;company:string|null;sourceUrl:string|null;project:string} | undefined=stored?.owned?stored.identity:undefined; let identityPath:string|null=null,identityHash:string|null=null; let language=stored?.owned?stored.outputLanguage:undefined;
    if(file.path.endsWith(".json") || file.path.endsWith(".md")) {
     const text=bytes.toString("utf8"), json=file.path.endsWith(".md")?text.slice(text.lastIndexOf("```json\n")+8,text.lastIndexOf("```")):text;
     const data=z.object({identity:z.object({caseNumber:z.string().nullable(),company:z.string().nullable(),sourceUrl:z.string().nullable(),project:z.string()}),outputLanguage:outputLanguageSchema,sourceKind:z.enum(["isir","workspace"]).optional(),sources:z.array(z.object({file:z.string(),documentId:z.string(),url:z.string(),date:z.string(),type:z.string(),summary:z.string(),coverage:z.unknown()})).max(20),legalApproval:z.literal(false).optional()}).parse(JSON.parse(json));
     if(data.sourceKind && data.sourceKind!==context?.sourceKind) problem("case_identity","Source reference kind differs from selected project/manifest mode.");
     if(file.path.endsWith(".md") && !text.startsWith(`# ${labels[data.outputLanguage].summary}\n\n${data.identity.company??labels[data.outputLanguage].unknown} — ${data.identity.caseNumber??labels[data.outputLanguage].unknown}\n\n`)) problem("case_identity","Visible Markdown identity header differs from the machine identity block.");
     identity=data.identity; language=data.outputLanguage; rows=[CSV_HEADER,...data.sources.map(s=>[s.file,s.documentId,s.url,s.date,s.type,s.summary,JSON.stringify(s.coverage)])];
    } else {
     rows=parseCsv(bytes.toString("utf8"));
     if(!identity) {
      try { const sidecar=await this.file(workspace,`${file.path}.lawoss.json`); const sidecarBytes=await readFile(sidecar.absolute); const data=z.strictObject({caseNumber:z.string().max(200).nullable(),company:z.string().max(500).nullable(),sourceUrl:z.string().url().max(2048).nullable(),project:z.string().max(500),outputLanguage:outputLanguageSchema}).parse(JSON.parse(sidecarBytes.toString("utf8"))); identity=data; language=data.outputLanguage; identityPath=sidecar.path; identityHash=sha(sidecarBytes); } catch {
       // A supplied summary/registry pair can share the summary's saved identity.
       for(const candidate of input.paths.filter(p=>p.endsWith(".md") || p.endsWith(".json"))) {
        try { const paired=await this.file(workspace,candidate), text=await readFile(paired.absolute,"utf8"), json=candidate.endsWith(".md")?text.slice(text.lastIndexOf("```json\n")+8,text.lastIndexOf("```")):text;
         const data=z.object({identity:z.object({caseNumber:z.string().nullable(),company:z.string().nullable(),sourceUrl:z.string().nullable(),project:z.string()}),outputLanguage:outputLanguageSchema}).parse(JSON.parse(json)); identity=data.identity; language=data.outputLanguage; identityPath=paired.path; identityHash=sha(text); break;
        } catch { /* The summary receives its own concrete validation issues. */ }
       }
      }
     }
    }
    if(!identity || !context || identity.caseNumber!==context.manifest.caseNumber || identity.company!==context.manifest.company || identity.sourceUrl!==context.manifest.sourceUrl || language!==input.outputLanguage || identity.project!==workspace.name) problem("case_identity","Missing or mismatched selected case, project or output language identity.");
    const header=rows.shift(); if(!header || header.length!==7 || header.some((value,i)=>value!==CSV_HEADER[i] && !(i===6 && value==="ctitelnost"))) problem("csv_header","Expected canonical seven-field registry header (legacy ctitelnost accepted).");
    const seen=new Set<string>();
    rows.forEach((row,index)=>{ if(row.length!==7) problem("csv_width","Registry row must contain exactly seven fields.",index+1);
     const source=context?.selected.find(x=>x.reference.documentId===row[1]); if(!source) problem("extra_source","Registry includes an unselected source ID.",index+1);
     else if(row[0]!==source.reference.file || row[2]!==source.reference.url) problem("source_url","Filename or official document URL differs from selected manifest.",index+1);
     if(source && row[6]?.trimStart().startsWith("{")) {
      try { if(!isDeepStrictEqual(JSON.parse(row[6]),coverage(source.record,source.children))) problem("coverage","Structured extraction coverage, hashes, pages or attachment provenance differ from current preparation.",index+1); }
      catch { problem("coverage","Structured extraction coverage is malformed.",index+1); }
     }
     if(seen.has(row[1])) problem("duplicate_source","Registry source ID is duplicated.",index+1); seen.add(row[1]);
    });
    for(const source of context?.selected??[]) if(!seen.has(source.reference.documentId)) problem("missing_source","Registry lacks a selected source.");
    if(stored?.owned && stored.hash!==digest) problem("output_changed","Registered output changed; regenerate with ownership/CAS checks or inspect as an ordinary file.");
    if(context) try { if((await this.context(workspace,input.documentIds)).fingerprint!==context.fingerprint) problem("source_changed","Sources changed during validation."); } catch { problem("source_changed","Sources changed during validation."); }
    if(sha(await readFile(file.absolute))!==digest) problem("output_changed","Output changed during validation.");
    if(identityPath) { const identityFile=await this.file(workspace,identityPath); if(sha(await readFile(identityFile.absolute))!==identityHash) problem("case_identity","Saved identity changed during validation."); }
    const valid=!!context && issues.length===start;
    if(stored?.owned && stored.sourceHash!==context?.fingerprint) problem("source_changed","Registered source set or manifest changed; regenerate output.");
    const verified=valid && (!stored?.owned || stored.sourceHash===context?.fingerprint);
    if(context && identity) await this.documents.saveOutputRecord(workspace,{sourceKind:context.sourceKind,path:file.path,hash:stored?.owned?stored.hash:digest,owned,identityPath,identityHash,documentIds:[...new Set(input.documentIds)],identity,sourceHash:stored?.owned?stored.sourceHash:context.fingerprint,verifiedHash:verified?digest:null,kind:stored?.kind??(file.path.endsWith(".json") || file.path.endsWith(".md")?"summary":"registry"),outputLanguage:input.outputLanguage,verified:false,legalApproval:false});
    outputs.push({path:file.path,hash:digest,owned,verified});
   } catch { issues.push({code:"output_unreadable",path,message:"Output is missing, unsafe, oversized or structurally unreadable."}); outputs.push({path,hash:digest,owned,verified:false}); }
  }
  return {valid:issues.length===0,issues,outputs,legalApproval:false,instruction:issues.length?"Repair the listed concrete issues; reread sources and revalidate saved files. Stop after three unsuccessful repairs and report remaining issues.":"Saved output and current source references passed formatting/provenance checks; legal review remains required."};
 }); }
}
function coverage(record:DocumentEvidence,children:DocumentEvidence[]) {
 return {hash:record.hash,complete:record.complete,issue:record.issue??null,pages:record.pages,children:children.map(child=>({hash:child.hash,provenance:child.provenance,complete:child.complete,issue:child.issue??null,pages:child.pages}))};
}
function isMissing(error:unknown):boolean { return error instanceof Error && "code" in error && error.code==="ENOENT"; }
