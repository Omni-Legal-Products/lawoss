import { readdir, readFile, writeFile, rm, mkdir } from "node:fs/promises";
import { join } from "node:path";
import type { CommandItem } from "./types.js";
import { parseFrontmatter, buildFrontmatter } from "./frontmatter.js";
import { exists } from "./utils.js";
import { globalOpencodeConfigDir, projectCommandsDir } from "./workspace-files.js";
import { validateCommandName, sanitizeCommandName } from "./validators.js";
import { resolveWorkspaceFilePath } from "./lawoss/filesystem-boundary.js";
import { ApiError } from "./errors.js";

function normalizeCommandFrontmatter(data: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(data).filter(([, value]) => value !== null && value !== undefined),
  );
}

async function repairLegacyCommandFile(filePath: string, content: string): Promise<{ data: Record<string, unknown>; body: string; changed: boolean }> {
  const parsed = parseFrontmatter(content);
  if (parsed.data.model !== null) {
    return { ...parsed, changed: false };
  }

  const nextContent = buildFrontmatter(normalizeCommandFrontmatter(parsed.data)) + parsed.body.replace(/^\n?/, "\n");
  await writeFile(filePath, nextContent, "utf8");
  return {
    data: normalizeCommandFrontmatter(parsed.data),
    body: parsed.body,
    changed: true,
  };
}

async function listCommandsInDir(
  dir: string,
  scope: "workspace" | "global",
  repairLegacy: boolean,
  workspaceRoot?: string,
): Promise<CommandItem[]> {
  if (workspaceRoot) dir = await resolveWorkspaceFilePath(workspaceRoot, dir);
  if (!(await exists(dir))) return [];
  const entries = await readdir(dir, { withFileTypes: true });
  const items: CommandItem[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith(".md")) continue;
    const filePath = workspaceRoot ? await resolveWorkspaceFilePath(workspaceRoot, join(dir, entry.name)) : join(dir, entry.name);
    const content = await readFile(filePath, "utf8");
    const { data, body } = repairLegacy
      ? await repairLegacyCommandFile(filePath, content)
      : parseFrontmatter(content);
    const name = typeof data.name === "string" ? data.name : entry.name.replace(/\.md$/, "");
    try {
      validateCommandName(name);
    } catch {
      continue;
    }
    items.push({
      name,
      description: typeof data.description === "string" ? data.description : undefined,
      template: body.trim(),
      agent: typeof data.agent === "string" ? data.agent : undefined,
      model: typeof data.model === "string" ? data.model : null,
      subtask: typeof data.subtask === "boolean" ? data.subtask : undefined,
      scope,
    });
  }
  return items;
}

export async function listCommands(
  workspaceRoot: string,
  scope: "workspace" | "global",
  options: { repairLegacy?: boolean } = {},
): Promise<CommandItem[]> {
  const repairLegacy = options.repairLegacy ?? true;
  if (scope === "global") {
    const dir = join(globalOpencodeConfigDir(), "commands");
    return listCommandsInDir(dir, "global", repairLegacy);
  }
  return listCommandsInDir(projectCommandsDir(workspaceRoot), "workspace", repairLegacy, workspaceRoot);
}

export type UpsertCommandPayload = {
  name: string;
  description?: string;
  template: string;
  agent?: string;
  model?: string | null;
  subtask?: boolean;
};

export function buildCommandContent(payload: UpsertCommandPayload): { name: string; content: string } {
  if (!payload.template || payload.template.trim().length === 0) {
    throw new ApiError(400, "invalid_command_template", "Command template is required");
  }
  const sanitized = sanitizeCommandName(payload.name);
  validateCommandName(sanitized);
  const frontmatter = buildFrontmatter(normalizeCommandFrontmatter({
    name: sanitized,
    description: payload.description,
    agent: payload.agent,
    model: payload.model,
    subtask: payload.subtask ?? false,
  }));
  const content = frontmatter + "\n" + payload.template.trim() + "\n";
  return { name: sanitized, content };
}

export async function upsertCommand(
  workspaceRoot: string,
  payload: UpsertCommandPayload,
): Promise<string> {
  const command = buildCommandContent(payload);
  const dir = await resolveWorkspaceFilePath(workspaceRoot, projectCommandsDir(workspaceRoot));
  await mkdir(dir, { recursive: true });
  const path = await resolveWorkspaceFilePath(workspaceRoot, join(dir, `${command.name}.md`));
  await writeFile(path, command.content, "utf8");
  return join(projectCommandsDir(workspaceRoot), `${command.name}.md`);
}

export async function repairCommands(workspaceRoot: string): Promise<boolean> {
  const dir = await resolveWorkspaceFilePath(workspaceRoot, projectCommandsDir(workspaceRoot));
  if (!(await exists(dir))) return false;
  const entries = await readdir(dir, { withFileTypes: true });
  let changed = false;
  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    const filePath = await resolveWorkspaceFilePath(workspaceRoot, join(dir, entry.name));
    const content = await readFile(filePath, "utf8");
    const result = await repairLegacyCommandFile(filePath, content);
    changed ||= result.changed;
  }
  return changed;
}

export async function deleteCommand(workspaceRoot: string, name: string): Promise<void> {
  const sanitized = sanitizeCommandName(name);
  validateCommandName(sanitized);
  const path = await resolveWorkspaceFilePath(workspaceRoot, join(projectCommandsDir(workspaceRoot), `${sanitized}.md`), { preserveLeaf: true });
  await rm(path, { force: true });
}
