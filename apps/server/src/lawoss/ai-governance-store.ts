import { dirname } from "node:path";
import { GovernanceProfileSchema, type GovernanceProfile } from "../ai-governance-schema.js";
import { ApiError } from "../errors.js";
import { initializeSqlite, type Row, type SqliteHandle } from "../runtime-db.js";
import { runtimeDbResource, withRuntimeDb } from "../runtime-db-lifecycle.js";
import type { Actor, ServerConfig } from "../types.js";
import { ensureDir } from "../utils.js";

export type GovernanceProfilePatch = Omit<GovernanceProfile, "id" | "revision" | "decidedBy" | "decidedAt">;
const resource = Symbol("ai-governance-profiles");
async function profileDb(config: ServerConfig): Promise<SqliteHandle> {
  return runtimeDbResource(config, resource, async path => {
    await ensureDir(dirname(path));
    return initializeSqlite(path, db => {
      db.exec("CREATE TABLE IF NOT EXISTS ai_governance_profiles (id TEXT PRIMARY KEY NOT NULL, revision INTEGER NOT NULL, state TEXT NOT NULL, scope_json TEXT NOT NULL, target_fingerprint TEXT NOT NULL, legal_profile_id TEXT NOT NULL, legal_profile_version TEXT NOT NULL, evidence_refs_json TEXT NOT NULL, expires_at TEXT, decided_by TEXT NOT NULL, decided_at TEXT NOT NULL)");
      return db;
    });
  });
}
function profileFromRow(row: Row): GovernanceProfile {
  try {
    return GovernanceProfileSchema.parse({id: row.id, revision: row.revision, state: row.state,
      scope: JSON.parse(String(row.scope_json)), targetFingerprint: row.target_fingerprint,
      legalProfileId: row.legal_profile_id, legalProfileVersion: row.legal_profile_version,
      evidenceRefs: JSON.parse(String(row.evidence_refs_json)), expiresAt: row.expires_at,
      decidedBy: row.decided_by, decidedAt: row.decided_at});
  } catch { throw new ApiError(409, "governance_profile_invalid", "Stored AI profile requires reassessment."); }
}

/** Host-owned metadata only. Copying preferences or an OKF file never imports these records. */
export async function readGovernanceProfiles(config: ServerConfig): Promise<GovernanceProfile[]> {
  return withRuntimeDb(config, async () => (await profileDb(config)).all("SELECT * FROM ai_governance_profiles ORDER BY id").map(profileFromRow));
}

/** Internal native-domain writer; no HTTP endpoint accepts this patch as an approval. */
export async function compareAndSetGovernanceProfile(config: ServerConfig, input: {id: string; expectedRevision: number; patch: GovernanceProfilePatch}, actor: Actor): Promise<GovernanceProfile> {
  if (actor.type !== "host") throw new ApiError(403, "native_host_required", "This change requires the native host.");
  if (!Number.isSafeInteger(input.expectedRevision) || input.expectedRevision < 0) throw new ApiError(400, "invalid_revision", "Expected revision is invalid.");
  const profile = GovernanceProfileSchema.parse({...input.patch, id: input.id, revision: input.expectedRevision + 1,
    decidedBy: "native-host", decidedAt: new Date().toISOString()});
  return withRuntimeDb(config, async () => {
    const db = await profileDb(config);
    const values = [profile.revision, profile.state, JSON.stringify(profile.scope), profile.targetFingerprint,
      profile.legalProfileId, profile.legalProfileVersion, JSON.stringify(profile.evidenceRefs), profile.expiresAt, profile.decidedBy, profile.decidedAt];
    const statement = input.expectedRevision === 0
      ? db.prepare("INSERT OR IGNORE INTO ai_governance_profiles (revision,state,scope_json,target_fingerprint,legal_profile_id,legal_profile_version,evidence_refs_json,expires_at,decided_by,decided_at,id) VALUES (?,?,?,?,?,?,?,?,?,?,?)")
      : db.prepare("UPDATE ai_governance_profiles SET revision=?,state=?,scope_json=?,target_fingerprint=?,legal_profile_id=?,legal_profile_version=?,evidence_refs_json=?,expires_at=?,decided_by=?,decided_at=? WHERE id=? AND revision=?");
    const result = statement.run(...values, profile.id, ...(input.expectedRevision === 0 ? [] : [input.expectedRevision]));
    if (Number(result.changes) !== 1) throw new ApiError(409, "governance_revision_conflict", "The AI profile changed. Review its current revision.");
    return profile;
  });
}
