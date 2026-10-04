/**
 * Keeps the OKF skills of a workspace in step with the bundled versions without
 * overwriting customizations: CLI resources are refreshed whenever they differ,
 * SKILL.md only when it is byte-for-byte a version LAWOSS bundled earlier.
 */
import type { LegalworkServerClient } from "@/app/lib/legalwork-server";
import { BUNDLED_OKF_SKILL_HASHES } from "./bundled-skill-hashes";

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
/** `modified`: skills whose customized SKILL.md was kept although the bundle differs. */
export type OkfSkillRefresh = { modified: string[] };

/** Body of a stored SKILL.md as the server writes it: frontmatter removed, LF, trimmed. */
export function installedSkillBody(content: string): string {
  return content.replace(/\r\n/g, "\n").replace(/^---\n[\s\S]*?\n---\n/, "").trim() + "\n";
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
): Promise<boolean> {
  const installed = (await client.getSkill(workspaceId, skill.name)).content;
  if (installedSkillBody(installed) === installedSkillBody(skill.body.content)) return true;
  if (!known.has(await okfSkillBodyHash(installed))) return false;
  await client.upsertSkill(workspaceId, { name: skill.name, ...skill.body });
  return true;
}

async function refreshResource(client: OkfSkillClient, workspaceId: string, skill: BundledOkfSkill): Promise<void> {
  const resources = await client.listSkillResources(workspaceId, skill.name);
  if (resources.items.some((item) => item.name === skill.resource)) {
    // Server číta cez editor len textové zdroje (.md, .txt, .csv) a CLI `okf.js` odmietne (415).
    // Zdroj je náš pribalený CLI, nie úprava advokáta: nečitateľný sa prepíše aktuálnou verziou
    // namiesto toho, aby zhodil celé dokončenie onboardingu (D1 2026-10-05).
    const installed = await client.getSkillResource(workspaceId, skill.name, skill.resource).catch(() => undefined);
    if (installed?.content === skill.source) return;
  }
  await client.upsertSkillResource(workspaceId, skill.name, { name: skill.resource, content: skill.source });
}

/** Install missing OKF skills and refresh installed ones; global skills are never touched. */
export async function refreshOkfSkills(
  client: OkfSkillClient,
  workspaceId: string,
  skills: readonly BundledOkfSkill[],
  known: ReadonlySet<string> = BUNDLED_OKF_SKILL_HASHES,
): Promise<OkfSkillRefresh> {
  const existing = await client.listSkills(workspaceId, { includeGlobal: true });
  const modified: string[] = [];
  for (const skill of skills) {
    const installed = existing.items.find((item) => item.name === skill.name);
    if (installed?.scope === "global") continue;
    if (!installed) await client.upsertSkill(workspaceId, { name: skill.name, ...skill.body });
    else if (!(await refreshSkillMarkdown(client, workspaceId, skill, known))) modified.push(skill.name);
    await refreshResource(client, workspaceId, skill);
  }
  return { modified };
}
