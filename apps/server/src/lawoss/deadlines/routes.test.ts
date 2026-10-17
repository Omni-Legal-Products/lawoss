import { expect, test } from "bun:test";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import type { ServerConfig } from "../../types.js";
import { sha256 } from "./hash.js";

test("real HTTP manually selects prepared evidence; owner bearer cannot answer native-only route", async () => {
  const { startServer } = await import("../../server.js");
  const root=await mkdtemp(join(tmpdir(),"deadline-http-")), path=join(root,"workspace"); await mkdir(join(path,"case"),{recursive:true});
  const previous={db:process.env.LEGALWORK_RUNTIME_DB,flag:process.env.LAWOSS_DEADLINE_WORKFLOW}; process.env.LEGALWORK_RUNTIME_DB=join(root,"runtime.sqlite"); process.env.LAWOSS_DEADLINE_WORKFLOW="1";
  const config: ServerConfig={host:"127.0.0.1",port:0,token:"synthetic-owner",hostToken:"synthetic-native-host",configPath:join(root,"server.json"),approval:{mode:"auto",timeoutMs:100},corsOrigins:[],workspaces:[{id:"workspace",name:"Synthetic",path,preset:"starter",workspaceType:"local",appFiles:"outside",appFilesStorageKey:"deadline-http"}],authorizedRoots:[path],readOnly:false,startedAt:Date.now(),tokenSource:"cli",hostTokenSource:"cli",logFormat:"pretty",logRequests:false};
  let server: Awaited<ReturnType<typeof startServer>> | undefined;
  try {
    await writeFile(join(path,"case","matter.md"),"---\ntype: matter\nid: case\njurisdiction: cz\n---\n"); await writeFile(join(path,"case","decision.txt"),"Synthetic appeal advice: 15 days. This is a document date, not service.");
    server=await startServer(config); const base=`http://127.0.0.1:${server.port}`, endpoint=`${base}/workspace/workspace/lawoss/deadlines`, headers={Authorization:"Bearer synthetic-owner","content-type":"application/json"}, host={"x-legalwork-host-token":"synthetic-native-host","content-type":"application/json"};
    const prepare=await fetch(`${base}/workspace/workspace/lawoss/documents/prepare`,{method:"POST",headers,body:JSON.stringify({paths:["case/decision.txt"]})}); expect(prepare.status).toBe(200); const prepared=await prepare.json(); const id=prepared.documents[0].id;
    let text="";
    for(let tries=0;tries<200;tries++){ const response=await fetch(`${base}/workspace/workspace/lawoss/documents/${id}/read`,{headers}); if(response.ok){text=(await response.json()).text;break;} await new Promise(resolve=>setTimeout(resolve,10)); }
    expect(text).toContain("Synthetic appeal advice"); const quote="15 days", start=text.indexOf(quote), locator={locatorId:"advice",page:null,start,end:start+quote.length,quote,quoteHash:sha256(quote),preparationHash:sha256(text)};
    const request={matterPath:"case",selection:{documentIds:[id],locators:[{documentId:id,locator}]},decisionDocumentId:id,ruleId:"cz-civil-appeal",ruleVersion:"2026-proposed",delivery:null,scenario:"other",expectedRecordHash:null};
    const create=await fetch(`${endpoint}/candidates`,{method:"POST",headers,body:JSON.stringify(request)}); expect(create.status).toBe(200); const candidate=await create.json(); expect(candidate.state).toBe("needs_review");
    const repeat=await fetch(`${endpoint}/candidates`,{method:"POST",headers,body:JSON.stringify(request)}); expect(repeat.status).toBe(200); expect((await repeat.json()).candidateId).toBe(candidate.candidateId);
    const review=await fetch(`${endpoint}/${candidate.candidateId}/review`,{method:"POST",headers,body:JSON.stringify({matterPath:"case",expectedRevisionHash:candidate.revisionHash})}); expect(review.status).toBe(200); const preview=await review.json(); expect(preview.canConfirm).toBe(false); expect(preview.candidate.input.evidence[0].locator.quote).toBe("15 days");
    const decision={matterPath:"case",expectedRevisionHash:candidate.revisionHash,expectedReviewHash:preview.reviewHash,operationId:"host-check",decision:"confirm",reason:"Synthetic HTTP review"};
    expect((await fetch(`${endpoint}/${candidate.candidateId}/decision`,{method:"POST",headers,body:JSON.stringify(decision)})).status).toBe(401);
    expect((await fetch(`${endpoint}/${candidate.candidateId}/decision`,{method:"POST",headers:host,body:JSON.stringify(decision)})).status).toBe(409);
    const forged=await fetch(`${endpoint}/candidates`,{method:"POST",headers,body:JSON.stringify({...request,human:true,by:"lawyer",verified:true})}); expect(forged.status).toBe(400);
    expect((await fetch(`${endpoint}?matterPath=../`,{headers})).status).toBe(409);
    const tokenResponse=await fetch(`${base}/tokens`,{method:"POST",headers:host,body:JSON.stringify({scope:"viewer",label:"deadline-viewer"})}); const token=await tokenResponse.json();
    expect((await fetch(`${endpoint}/candidates`,{method:"POST",headers:{...headers,Authorization:`Bearer ${token.token}`},body:JSON.stringify(request)})).status).toBe(403);
    const viewerList=await fetch(`${endpoint}?matterPath=case`,{headers:{...headers,Authorization:`Bearer ${token.token}`}});expect(viewerList.status).toBe(200);
    const ownerList=await fetch(`${endpoint}?matterPath=case`,{headers});expect(await viewerList.json()).toEqual(await ownerList.json());
    for(const suffix of [`/${candidate.candidateId}/review`,`/${candidate.candidateId}/export/retry`,`/recover`])expect((await fetch(`${endpoint}${suffix}`,{method:"POST",headers:{...headers,Authorization:`Bearer ${token.token}`},body:JSON.stringify({matterPath:"case",expectedRevisionHash:candidate.revisionHash,operationId:"viewer-attempt"})})).status).toBe(403);
    expect(await readFile(join(path,"case","decision.txt"),"utf8")).toContain("not service");
  } finally {
    try { await server?.stop(); } finally { if(previous.db===undefined)delete process.env.LEGALWORK_RUNTIME_DB;else process.env.LEGALWORK_RUNTIME_DB=previous.db; if(previous.flag===undefined)delete process.env.LAWOSS_DEADLINE_WORKFLOW;else process.env.LAWOSS_DEADLINE_WORKFLOW=previous.flag; await rm(root,{recursive:true,force:true}); }
  }
},20000);
