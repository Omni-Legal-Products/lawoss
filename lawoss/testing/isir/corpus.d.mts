export type ISIRDocument = { name: string; bytes: Buffer; sourcePath?: string };
export type ISIRCase = { id: string; documents: ISIRDocument[] };
export function sha256(bytes: Uint8Array): string;
export function loadISIRCorpus(manifestPath?: string): Promise<{ mode: string; cases: ISIRCase[] }>;
