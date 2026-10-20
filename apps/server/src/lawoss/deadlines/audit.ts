import { lstat, readFile } from "node:fs/promises";
import { ApiError } from "../../errors.js";
import { auditLogPath, recordAudit } from "../../audit.js";
import type { DeadlinePayload, MatterBinding } from "./types.js";
const queues = new Map<string,Promise<unknown>>();
/** Retryable mirror of immutable OKF event IDs; never the domain commit point. */
export async function mirrorDeadlineAudit(binding: MatterBinding,payload: DeadlinePayload): Promise<void> {
  const key=auditLogPath(binding.workspaceId), previous=queues.get(key) ?? Promise.resolve();
  const run=previous.catch(()=>{}).then(async()=>{
    let text="";
    try { const info=await lstat(key);if(info.isSymbolicLink()||!info.isFile()||info.size>16*1024*1024)throw new ApiError(409,"deadline_audit_limit","Audit mirror requires bounded archive review.");text=await readFile(key,"utf8"); }
    catch(error){if(!(error instanceof Error&&"code" in error&&error.code==="ENOENT"))throw error;}
    const ids=new Set<string>();for(const line of text.split("\n")){if(!line)continue;try{const value:unknown=JSON.parse(line);if(value&&typeof value==="object"&&"id" in value&&typeof value.id==="string")ids.add(value.id);}catch{throw new ApiError(409,"deadline_audit_invalid","Audit mirror is unreadable; canonical OKF events are preserved.");}}
    for(const event of payload.events){if(ids.has(event.id))continue;await recordAudit(binding.workspaceRoot,{id:event.id,workspaceId:binding.workspaceId,actor:{type:"host"},action:`deadline.${event.kind}`,target:payload.revisions.at(-1)!.candidateId,summary:JSON.stringify({revisionHash:event.revisionHash,operationId:event.operationId}),timestamp:Date.parse(event.at)});ids.add(event.id);}
  });queues.set(key,run);try{await run;}finally{if(queues.get(key)===run)queues.delete(key);}
}
