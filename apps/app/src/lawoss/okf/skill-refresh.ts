/**
 * Keeps the OKF skills of a workspace in step with the bundled versions without
 * overwriting customizations: CLI resources are refreshed whenever they differ,
 * SKILL.md only when it is byte-for-byte a version LAWOSS bundled earlier.
 */
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { BUNDLED_OKF_SKILL_DESCRIPTIONS, BUNDLED_OKF_SKILL_HASHES } from "./bundled-skill-hashes";

export type OkfSkillClient = Pick<
  LegalworkServerClient,
  "listSkills" | "getSkill" | "upsertSkill" | "listSkillResources" | "getSkillResource" | "upsertSkillResource"
>;
export type BundledOkfSkill = {
  name: string;
  body: { description: string; content: string };
  resource: string;
  source: string;
};
/**
 * `modified`: skills whose customized SKILL.md was kept although the bundle differs.
 * `written`: skills whose SKILL.md was installed or replaced; the engine sees them only after it reloads.
 */
export type OkfSkillRefresh = { modified: string[]; written: string[] };

/**
 * The server appends an auto-managed "Attached resources" block to SKILL.md whenever a
 * resource is stored (`apps/server/src/skill-resources.ts`). It is not a customization:
 * without removing it every installed OKF skill looked modified, was never refreshed and
 * triggered a false notice (D1 2026-10-05).
 */
const MANAGED_RESOURCES_BLOCK = /(?:\n)*<!-- legalwork:resources:start -->[\s\S]*?<!-- legalwork:resources:end -->(?:\n)*/g;

/** Body of a stored SKILL.md as the server writes it: frontmatter and the managed resources block removed, LF, trimmed. */
export function installedSkillBody(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "").replace(MANAGED_RESOURCES_BLOCK, "\n").trim() + "\n";
}

export async function okfSkillBodyHash(content: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(installedSkillBody(content)));
  return [...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

async function refreshSkillMarkdown(
  client: OkfSkillClient,
  workspaceId: string,
  skill: BundledOkfSkill,
  known: ReadonlySet<string>,
): Promise<"current" | "updated" | "customized"> {
  const installed = (await client.getSkill(workspaceId, skill.name)).content;
  if (installedSkillBody(installed) === installedSkillBody(skill.body.content)) return "current";
  if (!known.has(await okfSkillBodyHash(installed))) return "customized";
  await client.upsertSkill(workspaceId, { name: skill.name, ...skill.body });
  return "updated";
}

function utf8Base64(text: string): string {
  let binary = "";
  for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
  return btoa(binary);
}

async function refreshResource(client: OkfSkillClient, workspaceId: string, skill: BundledOkfSkill): Promise<void> {
  const resources = await client.listSkillResources(workspaceId, skill.name);
  if (resources.items.some((item) => item.name === skill.resource)) {
    // CLI `okf.js` nie je textový zdroj editora (415 pri utf8), preto sa číta ako base64 (#255 E4).
    // Zdroj je náš pribalený CLI, nie úprava advokáta: nečitateľný sa prepíše aktuálnou verziou
    // namiesto toho, aby zhodil celé dokončenie onboardingu (D1 2026-10-05).
    const installed = await client.getSkillResource(workspaceId, skill.name, skill.resource, "base64").catch(() => undefined);
    if (installed?.content === utf8Base64(skill.source)) return;
  }
  await client.upsertSkillResource(workspaceId, skill.name, { name: skill.resource, content: skill.source });
}

/** Install missing OKF skills and refresh installed ones; global skills are never touched. */
export async function refreshOkfSkills(
  client: OkfSkillClient,
  workspaceId: string,
  skills: readonly BundledOkfSkill[],
  known: ReadonlySet<string> = BUNDLED_OKF_SKILL_HASHES,
  knownDescriptions: ReadonlySet<string> = BUNDLED_OKF_SKILL_DESCRIPTIONS,
): Promise<OkfSkillRefresh> {
  const existing = await client.listSkills(workspaceId, { includeGlobal: true });
  const modified: string[] = [];
  const written: string[] = [];
  for (const skill of skills) {
    const installed = existing.items.find((item) => item.name === skill.name);
    if (installed?.scope === "global") continue;
    if (!installed) { await client.upsertSkill(workspaceId, { name: skill.name, ...skill.body }); written.push(skill.name); }
    else {
      const state = await refreshSkillMarkdown(client, workspaceId, skill, known);
      if (state === "customized") modified.push(skill.name);
      if (state === "updated") written.push(skill.name);
      // Telo je aktuálne, ale popis je starší pribalený (napr. anglický popis /okf-pamat): obnoví sa len popis.
      const description = installed.description?.trim() ?? "";
      if (state === "current" && description !== skill.body.description && knownDescriptions.has(description)) {
        await client.upsertSkill(workspaceId, { name: skill.name, ...skill.body });
        written.push(skill.name);
      }
    }
    await refreshResource(client, workspaceId, skill);
  }
  return { modified, written };
}
