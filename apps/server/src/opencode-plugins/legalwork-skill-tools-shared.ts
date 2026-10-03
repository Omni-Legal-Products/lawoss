/**
 * Naming and SKILL.md helpers for the legalwork-skill-tools plugin. They live
 * outside the plugin module on purpose: opencode calls every export of a plugin
 * module as a plugin entry point (`server(input)`), so a helper exported next to
 * the plugin ran with the engine's PluginInput and failed the whole load at
 * engine start ("undefined is not an object (evaluating 'input.description.trim')").
 * The plugin is bundled standalone by `bun build`, so this module is inlined.
 */

// A skill is exposed to the model as a tool, and providers reject tool names
// longer than 64 chars (Anthropic: `^[a-zA-Z0-9_-]{1,64}$`).
const MAX_SKILL_NAME_LENGTH = 64;

/**
 * Coerce a free-text name into a valid kebab-case slug of at most 64 chars,
 * dropping whole trailing words rather than cutting mid-word (same rule the
 * desktop import uses, so a name behaves identically whichever path created it).
 */
export function fitSkillName(raw: string): string {
  const cleaned = raw
    .toLowerCase()
    .normalize("NFKD")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .replace(/ß/g, "ss")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  if (!cleaned) return "";
  if (cleaned.length <= MAX_SKILL_NAME_LENGTH) return cleaned;
  const words = cleaned.split("-");
  let candidate = words[0]!.slice(0, MAX_SKILL_NAME_LENGTH);
  for (let index = 1; index < words.length; index += 1) {
    const next = `${candidate}-${words[index]}`;
    if (next.length > MAX_SKILL_NAME_LENGTH) break;
    candidate = next;
  }
  return candidate.replace(/-+$/g, "");
}

/**
 * Workflows are marked by a `workflow-<type>-` name prefix, not by frontmatter:
 * the app detects them by it, and the engine skips a SKILL.md that carries
 * non-standard frontmatter keys. Mirrors the Workflows view's naming.
 */
export function resolveSkillName(input: { name: string; kind: "skill" | "workflow"; workflowType: "assistant" | "tabular" }): string {
  const slug = fitSkillName(input.name);
  if (!slug) return "";
  if (input.kind !== "workflow") return slug;
  const bare = slug.replace(/^workflow-(?:assistant|tabular)-/, "").replace(/^workflow-/, "");
  return fitSkillName(`workflow-${input.workflowType}-${bare}`);
}

function titleFromName(name: string): string {
  return name
    .replace(/^workflow-(?:assistant|tabular)-/, "")
    .replace(/-/g, " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

/**
 * Build the SKILL.md. Frontmatter stays standard (name + description only) so
 * the engine loads it as an ordinary skill; a tabular workflow's body carries
 * the instruction to run through the bundled `tabular-review` skill.
 */
export function buildSkillMarkdown(input: {
  fullName: string;
  description: string;
  instructions: string;
  kind: "skill" | "workflow";
  workflowType: "assistant" | "tabular";
}): string {
  const frontmatter = `---\nname: ${input.fullName}\ndescription: ${JSON.stringify(input.description.trim())}\n---\n`;
  const body = input.instructions.trim();
  if (input.kind !== "workflow" || input.workflowType === "assistant") {
    return `${frontmatter}\n${body}\n`;
  }
  const title = titleFromName(input.fullName);
  return `${frontmatter}\n${[
    `# ${title}`,
    ``,
    "This is a **tabular review workflow**. To run it, load the **`tabular-review`** skill",
    "and build a review grid over the user's documents — one row per document, with a",
    "source citation in every cell — extracting the fields described below.",
    ``,
    `## What to extract`,
    ``,
    body,
    ``,
    `When the user asks to run "${title}", use the \`tabular-review\` skill.`,
  ].join("\n")}\n`;
}
