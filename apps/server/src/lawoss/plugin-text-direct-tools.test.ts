import { expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin";
import { readdir, readFile } from "node:fs/promises";
import { join, relative, resolve } from "node:path";
import ts from "typescript";
import { nativePluginTestRuntime } from "../opencode-plugins/native-plugin-test-support.js";
import { LINKED_FOLDERS_REMINDER_RULES } from "../opencode-plugins/lawoss-linked-folders.js";
import { LAWOSS_PLUGIN_NAMES } from "./engine-plugin-names.js";

/**
 * #573: engine 2.1.4 offers a plugin tool to the model by name only with `codemode: false`; any other tool exists only
 * inside Code Mode `execute`, and a direct call ends with "No tool named … is currently available". Every tool that a
 * LAWOSS system text, the sandbox guidance (the shell route of the OKF skills) or a bundled OKF skill names must
 * therefore be direct. Plugins run with their own registration here, never with the scripted-engine test plugin
 * that offers every tool directly (#484).
 */
const server = resolve(import.meta.dir, "..", "..");
const repository = resolve(server, "..", "..");
/** Named only to say what the tool does not cover or not to use; the texts never ask for a call. */
const MENTIONED_NOT_CALLED: Record<string, string> = {
  legalwork_extension_list_actions: "lawoss-integrations: its actions are not connected integrations",
  legalwork_review_files: "linked-folders reminder: it does not cover linked folders, glob with a path does",
  inapp_markdown_create: "lawoss-file-operations: create_file is used instead of it",
};
const TEXT_PLUGINS = [...LAWOSS_PLUGIN_NAMES, "legalwork-sandbox"];

async function upstreamPluginNames() {
  const script = await readFile(join(server, "scripts", "build-opencode-plugins.ts"), "utf8");
  const list = script.slice(script.indexOf("pluginNames = ["), script.indexOf("...LAWOSS_PLUGIN_NAMES"));
  return [...list.matchAll(/"([a-z0-9-]+)"/g)].flatMap((match) => match[1] ? [match[1]] : []);
}

async function bundledSkillTexts() {
  const bundle = await readFile(join(repository, "apps", "app", "src", "lawoss", "okf", "skill-bundle.ts"), "utf8");
  const paths = [...bundle.matchAll(/from "\.\.\/\.\.\/\.\.\/\.\.\/\.\.\/(lawoss\/[^"?]+\.md)\?raw"/g)].flatMap((match) => match[1] ? [match[1]] : []);
  return Promise.all(paths.map(async (path) => ({ source: path, text: await readFile(join(repository, path), "utf8") })));
}

type Loaded = { tools: Map<string, boolean>; descriptions: Map<string, string>; system: string; failed: boolean };
async function load(name: string): Promise<Loaded> {
  const runtime = nativePluginTestRuntime();
  try {
    const plugin: Plugin.Plugin = (await import(join(server, "src", "opencode-plugins", `${name}.ts`))).default;
    await runtime.start(plugin);
    const event = { sessionID: "ses_guard", agent: "legalwork", system: [] as Array<{ text: string }>, tools: {} };
    await runtime.hook("session", "context", event);
    const tools = new Map([...runtime.tools.values()].map((tool) => [tool.name, tool.options?.codemode === false]));
    const descriptions = new Map([...runtime.tools.values()].map((tool) => [tool.name, tool.description]));
    return { tools, descriptions, system: event.system.map((part) => part.text).join("\n"), failed: false };
  } catch {
    // The fixture lacks some engine domains (options, rpc, integration); such a plugin is checked from its source below.
    return { tools: new Map(), descriptions: new Map(), system: "", failed: true };
  } finally {
    await runtime.close().catch(() => {});
  }
}

const identifiers = (text: string) => new Set(text.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []);

test("every tool a LAWOSS system text, the sandbox guidance or a bundled OKF skill names is directly callable", async () => {
  const names = [...await upstreamPluginNames(), ...LAWOSS_PLUGIN_NAMES];
  expect(names).toContain("legalwork-project-tools");
  const loaded = new Map(await Promise.all(names.map(async (name) => [name, await load(name)] as const)));
  const direct = new Map([...loaded.values()].flatMap((plugin) => [...plugin.tools]));
  for (const name of TEXT_PLUGINS) {
    if (!loaded.get(name)?.failed) continue;
    const source = await readFile(join(server, "src", "opencode-plugins", `${name}.ts`), "utf8");
    expect({ plugin: name, named: [...identifiers(source)].filter((id) => direct.has(id)) }).toEqual({ plugin: name, named: [] });
  }
  const skills = await bundledSkillTexts();
  expect(skills.map((skill) => skill.source)).toEqual(expect.arrayContaining(["lawoss/skills/novy-spis/SKILL.md", "lawoss/skills/roztried-spis/SKILL.md", "lawoss/okf-pamat/SKILL.md"]));
  const texts = [
    ...TEXT_PLUGINS.map((name) => ({ source: `${name} system text`, text: loaded.get(name)?.system ?? "" })),
    { source: "lawoss-linked-folders reminder", text: LINKED_FOLDERS_REMINDER_RULES.join("\n") },
    ...skills,
  ];
  const codeModeOnly = texts.flatMap(({ source, text }) => [...identifiers(text)].flatMap((id) => {
    if (Object.hasOwn(MENTIONED_NOT_CALLED, id)) return [];
    if (direct.get(id) === false) return [`${source}: ${id} is Code Mode only`];
    if (!direct.has(id) && /^(?:lawoss|legalwork)_/.test(id)) return [`${source}: ${id} is not registered by any plugin`];
    return [];
  }));
  expect(codeModeOnly).toEqual([]);
  // The texts this guard is about.
  for (const tool of ["legalwork_shell", "lawoss_documents_prepare", "lawoss_documents_read", "lawoss_memory", "lawoss_files"]) expect(direct.get(tool)).toBe(true);
}, 60000);

/**
 * #578: the document editor tools `inapp_*` (upstream `legalwork-extensions-preview`) are named by upstream texts
 * too: the runtime guidance, plugin system texts and reminders, the docx-edit skill and the edit-docx command. Only
 * the core of the editor is direct, so a text naming any other `inapp_*` tool must write it as `tools.inapp_…`,
 * the expression the model calls inside `execute`. Every server source that names `inapp_` is scanned, so a new
 * text is covered without a list. In TypeScript only prose literals count (a literal with a space), never code
 * such as a tool's key. The description of a Code Mode tool is shown only inside `execute` and is skipped.
 */
const INAPP = /(tools\.)?\binapp((?:_[a-z0-9]+)*)(_\*)?/g;
/** Named in a LAWOSS text only to say what is used instead of it. */
const INAPP_NOT_CALLED: Record<string, string> = {
  "src/opencode-plugins/lawoss-file-operations-text.ts": "inapp_markdown_create",
};

async function inappSources() {
  const pluginDirectory = join(server, "src", "opencode-plugins");
  const plugins = (await readdir(pluginDirectory)).filter((name) => name.endsWith(".ts") && !/\.test(-support)?\.ts$/.test(name)).map((name) => join(pluginDirectory, name));
  const resources = (await readdir(join(server, "resources", "core-opencode"), { recursive: true })).filter((name) => name.endsWith(".md")).map((name) => join(server, "resources", "core-opencode", name));
  const files = [join(server, "src", "legalwork-runtime-config.ts"), ...plugins, ...resources];
  const read = await Promise.all(files.map(async (file) => ({ source: relative(server, file), text: await readFile(file, "utf8") })));
  return read.filter(({ text }) => text.includes("inapp_"));
}

function proseLiterals(source: string, text: string) {
  if (!source.endsWith(".ts")) return [text];
  const prose: string[] = [];
  // A literal interpolated into a template literal is part of that prose even without a space.
  const visit = (node: ts.Node, interpolated = false) => {
    if ((ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node) || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) && (interpolated || /\s/.test(node.text))) prose.push(node.text);
    if (ts.isTemplateExpression(node)) { visit(node.head); for (const span of node.templateSpans) { visit(span.expression, true); visit(span.literal); } return; }
    ts.forEachChild(node, (child) => visit(child, interpolated));
  };
  visit(ts.createSourceFile(source, text, ts.ScriptTarget.Latest, true));
  return prose;
}

test("every inapp_* tool a model text names is direct, or the text calls it as tools.inapp_… inside execute", async () => {
  const loaded = await load("legalwork-extensions-preview");
  expect(loaded.failed).toBe(false);
  const inapp = new Map([...loaded.tools].filter(([name]) => name.startsWith("inapp_")));
  expect(inapp.size).toBeGreaterThan(20);
  const executeOnly = [...loaded.descriptions].filter(([name]) => inapp.get(name) === false).map(([, description]) => description);
  const sources = await inappSources();
  expect(sources.map((file) => file.source)).toEqual(expect.arrayContaining([
    "src/legalwork-runtime-config.ts", "src/opencode-plugins/legalwork-extensions-preview.ts", "src/opencode-plugins/legalwork-word-tools.ts",
    "src/opencode-plugins/legalwork-powerpoint-tools.ts", "resources/core-opencode/skills/docx-edit/SKILL.md",
  ]));
  const findings = sources.flatMap(({ source, text }) => proseLiterals(source, text)
    .filter((prose) => !executeOnly.some((description) => description.includes(prose)))
    .flatMap((prose) => [...prose.matchAll(INAPP)].flatMap(([, qualified, rest = "", glob]) => {
      const name = `inapp${rest}`;
      if (!rest && !glob) return [];
      if (INAPP_NOT_CALLED[source] === name) return [];
      if (glob) {
        const family = [...inapp].filter(([tool]) => tool.startsWith(`${name}_`));
        if (!family.length) return [`${source}: ${name}_* matches no tool`];
        if (family.some(([, direct]) => direct)) return qualified ? [`${source}: tools.${name}_* has direct tools`] : [];
        return qualified ? [] : [`${source}: ${name}_* is Code Mode only, write tools.${name}_*`];
      }
      const direct = inapp.get(name);
      if (direct === undefined) return [`${source}: ${name} is not registered`];
      if (direct && qualified) return [`${source}: tools.${name} is direct, call it by name`];
      if (!direct && !qualified) return [`${source}: ${name} is Code Mode only, write tools.${name}`];
      return [];
    })));
  expect([...new Set(findings)]).toEqual([]);
  // The editor core that the runtime guidance, the Word guidance and the docx-edit skill start with.
  for (const tool of ["inapp_documents_open", "inapp_documents_list", "inapp_documents_select", "inapp_docx_read_document", "inapp_docx_find_text", "inapp_docx_suggest_change"]) expect({ tool, direct: inapp.get(tool) }).toEqual({ tool, direct: true });
}, 60000);
