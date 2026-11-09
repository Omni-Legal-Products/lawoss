/**
 * LAWOSS: nastavenia klienta outside po lokáciách (rozhodnutie MČ 9. 11. 2026, `lawoss/outside-engine-config.ts`).
 *
 * Klient outside nemá v priečinku vygenerovaný `.opencode/opencode.json`. Tento plugin doplní jeho lokáciám (koreň
 * klienta aj prípady v ňom, nie vnorenému klientovi) to, čo by inak niesol projektový súbor: MCP servery, priečinky
 * skillov vrátane externého `.opencode/skills`, nastavené inštrukcie, pravidlá povolení klienta v každom agentovi,
 * agentov (aj tých, ktoré spoločný súbor nesie len ako kostru), predvoleného agenta a odmietnutých poskytovateľov. Hranicu priečinkov a schválenia rieši `legalwork-managed-config` (`managed-folder-permissions.ts`), príkazy
 * `legalwork-commands` cez server. Iné lokácie (ostatní klienti, klienti inside) nedostanú nič. Transformácie sú
 * synchrónne nad stavom načítaným pri štarte lokácie a pri `refresh` (server ho volá po zápise konfigurácie).
 */
import { Plugin } from "@opencode/plugin";
import { Mcp } from "@opencode/schema/mcp";
import { Model } from "@opencode/schema/model";
import { Skill } from "@opencode/schema/skill";
import { Schema } from "effect";
import { readFile, realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, resolve, sep } from "node:path";
import { ManagedSettingsWorkspaceMissingError, readManagedEngineSettings } from "../managed-engine-settings.js";
import { nativeEngineLocationApprovedSync } from "../native-engine-project-registry.js";
import { outsideConfigRpc, outsideDelivery, outsideSkillsDirectory, parseOutsideClientsMap, scanOutsideSkills, type OutsideClient, type OutsideDelivery } from "../lawoss/outside-engine-config.js";
import { registerPrimaryContext } from "./native-review-worker.js";

type Rule = { action: string; resource: string; effect: "allow" | "deny" | "ask" };
type State = { client: OutsideClient; delivery: OutsideDelivery; skills: Skill.Info[]; instructions: string[]; permissions: Rule[]; agents: string[] };

/** Like the native agent fold: `~`/`$HOME` in folder rules is the engine home. */
const engineHome = () => process.env.OPENCODE_TEST_HOME || homedir();
const HOME_ACTIONS = new Set(["external_directory", "read", "edit"]);
const expandRules = (rules: readonly Rule[]): Rule[] => rules.map((rule) => {
  if (!HOME_ACTIONS.has(rule.action)) return { ...rule };
  const home = engineHome(), resource = rule.resource;
  if (resource === "~" || resource === "$HOME") return { ...rule, resource: home };
  const rest = resource.startsWith("~/") ? resource.slice(2) : resource.startsWith("$HOME/") || resource.startsWith("$HOME\\") ? resource.slice(6) : undefined;
  return rest === undefined ? { ...rule } : { ...rule, resource: join(home, rest) };
});

const canonical = (path: string) => realpath(path).catch(() => resolve(path));
const within = (root: string, path: string) => {
  const suffix = relative(root, path);
  return suffix === "" || (!isAbsolute(suffix) && suffix !== ".." && !suffix.startsWith(`..${sep}`));
};
const decodeSkill = Schema.decodeUnknownSync(Skill.Info);
const decodeServer = Schema.decodeUnknownSync(Mcp.ServerConfig);
const decodeModel = Schema.decodeUnknownSync(Model.Ref);

export const LawossOutsideConfig = Plugin.define({
  id: "lawoss.outside-config",
  async setup(ctx) {
    const { settingsPath, outsidePath, registryPath } = ctx.options;
    if (typeof settingsPath !== "string" || typeof outsidePath !== "string" || typeof registryPath !== "string") throw new Error("LAWOSS outside client settings paths are required.");
    const read = async (): Promise<State | null> => {
      const map = parseOutsideClientsMap(await readFile(outsidePath, "utf8").then(JSON.parse, () => null));
      if (!map?.clients.length) return null;
      let settings;
      try { settings = await readManagedEngineSettings(settingsPath, ctx.location.directory); }
      catch (error) { if (error instanceof ManagedSettingsWorkspaceMissingError) return null; throw error; }
      // The location's own registered client (longest root, so a nested client keeps its own settings).
      const root = await canonical(settings.directory);
      const location = await canonical(ctx.location.directory);
      if (!within(root, location)) return null;
      let client: OutsideClient | undefined;
      for (const candidate of map.clients) if (await canonical(candidate.directory) === root) client = candidate;
      if (!client) return null;
      const delivery = outsideDelivery(settings.configuration, settings.sharedConfiguration);
      const skills = new Map<string, Skill.Info>();
      // Like the native skill source: `~/` is the engine home, a relative path the location directory.
      const folders = [...delivery.skills, outsideSkillsDirectory(client.configDirectory)].map(directory => directory.startsWith("~/")
        ? join(engineHome(), directory.slice(2)) : isAbsolute(directory) ? directory : resolve(ctx.location.directory, directory));
      for (const folder of new Set(folders)) for (const skill of await scanOutsideSkills(folder)) skills.set(skill.id, decodeSkill(skill));
      const instructions: string[] = [];
      for (const path of delivery.instructions) {
        const content = await readFile(path, "utf8").catch(() => undefined);
        if (content?.trim()) instructions.push(`Instructions from: ${path}\n${content}`);
      }
      return { client, delivery, skills: [...skills.values()], instructions, permissions: expandRules(settings.configuration.permissions ?? []),
        agents: Object.keys(settings.configuration.agents ?? {}) };
    };
    let state = await read();
    // The admission plugin removes every server of an unapproved location; do not add them back.
    const approved = () => nativeEngineLocationApprovedSync(registryPath, ctx.location.directory);
    const registrations = [
      await ctx.mcp.transform(editor => {
        if (!state || !approved()) return;
        for (const [name, server] of state.delivery.mcp) editor.set(name, decodeServer(server));
      }),
      await ctx.skill.transform(editor => {
        for (const skill of state?.skills ?? []) { if (editor.get(skill.id)) editor.remove(skill.id); editor.add(skill); }
      }),
      // The native fold of configured agents runs after plugin transforms (engine 2.1.4): here only the built-in agents
      // exist, and `update` of a missing id creates it. Like the project file of an inside client, this client's own
      // rules come first in every agent, then each agent's declaration; the shared file (identical values, skeletons
      // without permissions, `withOutsideAgentSkeletons`) is applied afterwards by the engine.
      await ctx.agent.transform(editor => {
        if (!state) return;
        const own = state.permissions;
        for (const agent of editor.list()) editor.update(agent.id, value => { value.permissions.push(...own.map(rule => ({ ...rule }))); });
        for (const id of state.agents) if (!editor.get(id)) editor.update(id, value => { value.permissions.push(...own.map(rule => ({ ...rule }))); });
        for (const [id, declared] of state.delivery.agents) {
          if (declared.disabled) { editor.remove(id); continue; }
          editor.update(id, agent => {
            if (declared.system !== undefined) agent.system = declared.system;
            if (declared.description !== undefined) agent.description = declared.description;
            if (declared.mode !== undefined) agent.mode = declared.mode;
            if (declared.hidden !== undefined) agent.hidden = declared.hidden;
            if (declared.steps !== undefined) agent.steps = declared.steps;
            if (declared.color !== undefined) agent.color = declared.color;
            if (declared.model) agent.model = decodeModel({ providerID: declared.model.providerID, id: declared.model.model,
              ...(declared.model.variant ? { variant: declared.model.variant } : {}) });
            if (declared.request) { Object.assign(agent.request.headers, declared.request.headers ?? {}); Object.assign(agent.request.body, declared.request.body ?? {}); }
            if (declared.permissions) agent.permissions.push(...expandRules(declared.permissions));
          });
        }
        if (state.delivery.defaultAgent && editor.get(state.delivery.defaultAgent)) editor.default(state.delivery.defaultAgent);
      }),
      await ctx.provider.transform(editor => {
        if (!state) return;
        for (const record of editor.list()) if (state.delivery.deniedProviders(record.provider.id)) editor.remove(record.provider.id);
      }),
      await registerPrimaryContext(ctx, event => {
        for (const text of state?.instructions ?? []) event.system.push({ type: "text", text });
      }),
      await ctx.rpc.register(outsideConfigRpc, { async refresh() {
        const previous = state;
        state = await read();
        const changed = (pick: (value: State | null) => unknown) => JSON.stringify(pick(previous)) !== JSON.stringify(pick(state));
        if (changed(value => value?.delivery.mcp)) await ctx.mcp.reload();
        if (changed(value => value?.skills)) await ctx.skill.reload();
        // Configured instruction files are read here; a chat sees the new text from its next turn.
        if (changed(value => [value?.delivery.agents, value?.delivery.defaultAgent, value?.permissions, value?.agents])) await ctx.agent.reload();
        if (changed(value => value?.delivery.providerPolicies)) { await ctx.provider.reload(); await ctx.model.reload(); }
        return { refreshed: true };
      } }),
    ];
    return async () => { for (const registration of registrations.reverse()) await registration.dispose(); };
  },
});
export default LawossOutsideConfig;
