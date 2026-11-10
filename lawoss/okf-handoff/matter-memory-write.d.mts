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
/** Record types that may live at client level: subject, screening and the client-wide working note `client_note`. */
export const CLIENT_RECORD_TYPES: readonly string[];
/** The client's folder `directory` belongs to: itself (client card) or the client above a case. */
export function clientMemoryDir(directory: string): string | undefined;
/** One client-level L2 record in `<client>/memory/`, read with every case of that client; the same gates as `writeMatterMemory`. */
export function writeClientMemory(directory: string, text: string, options: { reason: string; expectedRevision?: string | undefined; apply?: boolean }): { code: number; out: string; plan?: MatterMemoryWritePlan };
/** The `deadline_basis` value of a deadline recorded from the lawyer's instruction, not verified from a document. */
export const INSTRUCTION_DEADLINE_BASIS: string;
/**
 * The record (a new L2 task with `deadlines`, marked `deadline_basis: lawyer_instruction`, never `verified`) for a deadline
 * the lawyer stated in chat with an explicit date. `code` 0 carries `id`, `jurisdiction` and the record `text`.
 */
export function instructionDeadlineRecord(directory: string, input: { date: string; what: string; instruction: string; inputId: string; today: string }):
  { code: number; out: string; id?: string; jurisdiction?: "cz" | "sk"; text?: string };
