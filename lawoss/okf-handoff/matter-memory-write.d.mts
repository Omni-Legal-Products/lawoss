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
  truth: string;
  previousTruth?: string;
  history: string[];
  fields: string[];
};
export function writeMatterMemory(directory: string, text: string, options: { reason: string; expectedRevision?: string | undefined; apply?: boolean }): { code: number; out: string; plan?: MatterMemoryWritePlan };
