export type MatterMemoryWritePlan = {
  kind: "create" | "update" | "delete";
  id: string;
  layer: string;
  requiresApproval: boolean;
  /** The folder the record goes to: the case, or the office for L1/L3. */
  targetDir: string;
  /** Absolute path of the record file in `targetDir/memory/`. */
  file: string;
  title: string;
  /** The record type (matter, decision, subject…). */
  type: string;
  truth: string;
  previousTruth?: string;
  history: string[];
  /** New record: every non-empty field; change: the changed fields. */
  fields: string[];
  /** SHA-256 of the serialized record that is written. */
  recordHash: string;
};
export function writeMatterMemory(directory: string, text: string, options: { reason: string; expectedRevision?: string | undefined; apply?: boolean }): { code: number; out: string; plan?: MatterMemoryWritePlan };
