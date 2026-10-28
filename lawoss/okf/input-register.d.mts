// Portable declarations keep server tsc inside rootDir; Bun bundles the implementation (`inputs.ts`).
export const INBOX_FOLDERS: ReadonlySet<string>;
export const MATTER_CARD_FILES: readonly string[];
export const INPUT_REGISTER_FILE: string;
export const PROFILE_FILE: string;
export function nextInputId(intake: string | null): string;
export function receivedStamp(now: Date): string;
export function inputRow(id: string, received: string, original: string, source?: string): string;
export function originalCell(relativePath: string): string;
export function appendInputRow(intake: string | null, row: string, title: string): string;
export function moveInputOriginal(intake: string, from: string, to: string, handedOver?: string): { content: string; id: string } | null;
export function codeSpan(text: string): string;
export function parseWorkingProfile(content: string): { folders: string[]; roles: Record<string, string>; naming: string };
