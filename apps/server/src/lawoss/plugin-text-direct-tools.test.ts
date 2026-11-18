import { expect, test } from "bun:test";
import type { Plugin } from "@opencode/plugin";
import { readFile } from "node:fs/promises";
import { join, resolve } from "node:path";
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

type Loaded = { tools: Map<string, boolean>; system: string; failed: boolean };
async function load(name: string): Promise<Loaded> {
  const runtime = nativePluginTestRuntime();
  try {
    const plugin: Plugin.Plugin = (await import(join(server, "src", "opencode-plugins", `${name}.ts`))).default;
    await runtime.start(plugin);
    const event = { sessionID: "ses_guard", agent: "legalwork", system: [] as Array<{ text: string }>, tools: {} };
    await runtime.hook("session", "context", event);
    const tools = new Map([...runtime.tools.values()].map((tool) => [tool.name, tool.options?.codemode === false]));
    return { tools, system: event.system.map((part) => part.text).join("\n"), failed: false };
  } catch {
    // The fixture lacks some engine domains (options, rpc, integration); such a plugin is checked from its source below.
    return { tools: new Map(), system: "", failed: true };
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
