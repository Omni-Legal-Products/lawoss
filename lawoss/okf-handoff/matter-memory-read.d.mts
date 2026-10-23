export function matterMemoryScope(directory: string): { clientDir?: string; subjectDir?: string; officeDir?: string };
export function readMatterMemory(action: "preamble" | "read", directory: string, options?: { allowedRoots?: string[]; office?: boolean; excludedRoots?: string[] }): { code: number; out: string };
export const FILE_BYTE_LIMIT: number;
export const STORE_BYTE_LIMIT: number;
