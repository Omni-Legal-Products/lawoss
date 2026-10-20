export function withRecordWriteLock<T>(dir: string, action: () => T): T;
export function readDeadlineEnvelope(text: string): { id: string; type: string; status: string; truth: string; deadlines: string[]; state?: string; body: string; fingerprint: string } | null;
export function patchDeadlineEnvelope(text: string | null, patch: { id: string; jurisdiction: "cz" | "sk"; status: string; truth: string; state: string; at: string; event: string; deadlines: string[]; body: string }): string;
