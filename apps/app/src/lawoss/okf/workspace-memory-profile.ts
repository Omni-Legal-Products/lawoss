import { t, type Language } from "@/i18n";
import type { LegalworkServerClient, LegalworkWorkspaceMemoryStatus } from "@/app/lib/legalwork-server";
import { parseWorkspaceMemoryProfile, parseWorkspaceMemoryProfileText, type WorkspaceMemoryProfile } from "../../../../../lawoss/okf-pamat/src/workspace-memory-profile";
export { parseWorkspaceMemoryProfile, parseWorkspaceMemoryProfileText, type WorkspaceMemoryProfile };
export const MEMORY_PROFILE_PATH = ".lawoss/memory-profile.json";
export type MemoryProfileClient = Pick<LegalworkServerClient, "statWorkspaceFile" | "readWorkspaceFile" | "writeWorkspaceFile" | "getWorkspaceMemoryStatus" | "capabilities">;
export type MemoryProfileSnapshot = { content: string | null; profile: WorkspaceMemoryProfile };
export const emptyMemoryProfile = (): WorkspaceMemoryProfile => ({ version: 1, matterId: "", roots: [{ id: "matter", path: "." }], sources: [{ id: "memory", root: "matter", path: "_memory.md", role: "case_memory", required: true, writable: true, anchors: [] }] });
export async function loadMemoryProfile(client: MemoryProfileClient, workspaceId: string): Promise<MemoryProfileSnapshot> {
  const stat = await client.statWorkspaceFile(workspaceId, MEMORY_PROFILE_PATH);
  if (!stat.exists) return { content: null, profile: emptyMemoryProfile() };
  if (stat.kind !== "file") throw new Error(t("lawoss.integrations.error.memory_not_file"));
  const { content } = await client.readWorkspaceFile(workspaceId, MEMORY_PROFILE_PATH);
  try { return { content, profile: parseWorkspaceMemoryProfileText(content) }; }
  catch (error) { throw new Error(t("lawoss.integrations.error.memory_invalid", { detail: memoryProfileProblem(null, error) })); }
}

/**
 * Parser v `okf-pamat` (prenosná vrstva) hlási chyby po anglicky; advokát dostane vetu v jazyku appky
 * (test inštalácie 3. 11. 2026: „Neplatné mapovanie: Invalid version 1 memory profile.“ pri novom formulári).
 */
const PROBLEMS: readonly [RegExp, string][] = [
  [/^Invalid profile source\/root count/, "lawoss.integrations.memory.problem.count"],
  [/^Invalid or duplicate root/, "lawoss.integrations.memory.problem.root"],
  [/^Invalid or duplicate source/, "lawoss.integrations.memory.problem.source"],
  [/^Role \S+ cannot be writable/, "lawoss.integrations.memory.problem.writable"],
  [/^Invalid identity anchors/, "lawoss.integrations.memory.problem.anchors_invalid"],
  [/^At least one case_memory source must be required/, "lawoss.integrations.memory.problem.case_memory"],
  [/^At least one required source must have identity anchors/, "lawoss.integrations.memory.problem.anchors_required"],
  [/byte limit exceeded/, "lawoss.integrations.memory.problem.size"],
];
const MATTER_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,95}$/;

export function memoryProfileProblem(profile: WorkspaceMemoryProfile | null, failure: unknown, locale?: Language): string {
  const message = failure instanceof Error ? failure.message : String(failure);
  const key = profile && /^Invalid version 1 memory profile/.test(message) && !MATTER_ID.test(profile.matterId)
    ? "lawoss.integrations.memory.problem.identity"
    : PROBLEMS.find(([pattern]) => pattern.test(message))?.[1] ?? "lawoss.integrations.memory.problem.other";
  return locale ? t(key, locale) : t(key);
}
export function previewMemoryProfile(profile: WorkspaceMemoryProfile): string {
  const content = `${JSON.stringify(parseWorkspaceMemoryProfile(profile), null, 2)}\n`;
  // Enforce the shared UTF-8 byte limit before any write, including JSON formatting.
  parseWorkspaceMemoryProfileText(content);
  return content;
}
export async function saveMemoryProfile(client: MemoryProfileClient, workspaceId: string, snapshot: MemoryProfileSnapshot, profile: WorkspaceMemoryProfile): Promise<MemoryProfileSnapshot> {
  if (!(await client.capabilities()).config.write) throw new Error(t("lawoss.integrations.error.read_only"));
  const content = previewMemoryProfile(profile);
  await client.writeWorkspaceFile(workspaceId, { path: MEMORY_PROFILE_PATH, content, expectedContent: snapshot.content });
  return { content, profile: parseWorkspaceMemoryProfileText(content) };
}
/** A server preflight is about the saved bytes only, never about an edited draft. */
export async function checkMemoryProfile(client: MemoryProfileClient, workspaceId: string, snapshot: MemoryProfileSnapshot): Promise<LegalworkWorkspaceMemoryStatus> {
  const status = await client.getWorkspaceMemoryStatus(workspaceId);
  const hash = snapshot.content === null ? null : Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(snapshot.content))), byte => byte.toString(16).padStart(2, "0")).join("");
  if (status.profileHash !== hash) throw new Error(t("lawoss.integrations.error.memory_changed"));
  return status;
}
