import { createHash } from "node:crypto";
export const sha256 = (value: string | Uint8Array): string => createHash("sha256").update(value).digest("hex");
export function stableJson(value: unknown): string { return JSON.stringify(value, (_key, item: unknown) => item !== null && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item); }
export const fingerprint = (value: unknown): string => sha256(stableJson(value));

/** Retrieval time is observation metadata, not a change to the selected legal evidence. */
export const legalFingerprint = (value: unknown): string => sha256(JSON.stringify(value, (key, item: unknown) => key === "retrievedAt" ? undefined : item !== null && typeof item === "object" && !Array.isArray(item) ? Object.fromEntries(Object.entries(item).sort(([a], [b]) => a.localeCompare(b))) : item));
