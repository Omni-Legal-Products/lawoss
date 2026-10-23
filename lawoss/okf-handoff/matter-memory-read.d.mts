export function matterMemoryScope(directory: string): { clientDir?: string; subjectDir?: string };
export function readMatterMemory(action: "preamble" | "read", directory: string, options?: { allowedRoots?: string[] }): { code: number; out: string };
