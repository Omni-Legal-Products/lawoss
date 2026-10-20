import { expect,test } from "bun:test";
import { mkdtemp,mkdir,readFile,rm,writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { mirrorDeadlineAudit } from "./audit.js";
import { auditLogPath } from "../../audit.js";
import { proposeDeadline } from "./extract.js";
import { fixtureInput } from "./fixtures.js";
import { resolveMatterBinding } from "./repository.js";

test("operational audit mirrors canonical immutable IDs once and contains only identifiers/hash/state",async()=>{
  const root=await mkdtemp(join(tmpdir(),"deadline-audit-")),old=process.env.LEGALWORK_DATA_DIR;process.env.LEGALWORK_DATA_DIR=join(root,"data");
  try {
    await mkdir(join(root,"case"));await writeFile(join(root,"case","matter.md"),"---\ntype: matter\nid: matter\njurisdiction: cz\n---\n");
    const binding=await resolveMatterBinding({id:"audit-workspace",path:root,name:"Synthetic",preset:"starter",workspaceType:"local"},"case"),candidate=proposeDeadline({workspaceId:binding.workspaceId,matterId:binding.matterId,input:fixtureInput()}),payload={version:1 as const,revisions:[candidate],confirmation:null,export:null,events:[{id:"audit-event",operationId:"audit-op",at:new Date().toISOString(),kind:"candidate" as const,revisionHash:candidate.revisionHash,reason:"private client text must not leave canonical record"}]};
    await Promise.all([mirrorDeadlineAudit(binding,payload),mirrorDeadlineAudit(binding,payload)]);
    const text=await readFile(auditLogPath(binding.workspaceId),"utf8"),rows=text.trim().split("\n");expect(rows).toHaveLength(1);expect(JSON.parse(rows[0]!).id).toBe("audit-event");expect(text).not.toContain("private client text");expect(text).not.toContain("Service proof");
    await writeFile(auditLogPath(binding.workspaceId),"BROKEN AUDIT\n");await expect(mirrorDeadlineAudit(binding,payload)).rejects.toThrow("unreadable");expect(await readFile(auditLogPath(binding.workspaceId),"utf8")).toBe("BROKEN AUDIT\n");
  }finally{if(old===undefined)delete process.env.LEGALWORK_DATA_DIR;else process.env.LEGALWORK_DATA_DIR=old;await rm(root,{recursive:true,force:true});}
});
