// LAWOSS: výpočet nastavení klienta outside (lawoss/outside-engine-config.ts). Údaje sú syntetické.
import { afterEach, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { outsideDelivery, parseOutsideClientsMap, scanOutsideSkills, shareableConfiguration, withOutsideAgentSkeletons } from "./outside-engine-config.js";

const cleanups: (() => Promise<unknown>)[] = [];
afterEach(async () => { for (const cleanup of cleanups.splice(0)) await cleanup(); });

test("externý priečinok klienta outside sa nikdy nestane spoločným, ostatné skilly áno", () => {
  const configuration = { skills: ["/app/klient-a/.opencode/skills", "/kniznica/zmluvy"] };
  expect(shareableConfiguration(configuration, "/app/klient-a/.opencode")).toEqual({ skills: ["/kniznica/zmluvy"] });
  expect(shareableConfiguration(configuration, null)).toBe(configuration);
  // Súrodenec s rovnakým prefixom nie je vnútri externého priečinka.
  expect(shareableConfiguration({ skills: ["/app/klient-a/.opencode-iny"] }, "/app/klient-a/.opencode")).toEqual({ skills: ["/app/klient-a/.opencode-iny"] });
});

test("doručí len to, čo spoločný súbor nemá: MCP, skilly, inštrukcie, agentov a odmietnutých poskytovateľov", () => {
  const shared = { skills: ["/kniznica"], agents: { legalwork: { system: "Spoločný" } }, default_agent: "legalwork" };
  const delivery = outsideDelivery({
    skills: ["/kniznica", "/app/a/.opencode/skills"],
    instructions: ["/app/a/POKYNY.md", "relatívne.md"],
    mcp: { servers: { "a-konektor": { type: "remote", url: "http://127.0.0.1:7/mcp", disabled: true } } },
    agents: { legalwork: { system: "Spoločný" }, review: { system: "Iný" } },
    policies: [{ action: "provider.use", resource: "*", effect: "allow" }, { action: "provider.use", resource: "opencode", effect: "deny" }],
    default_agent: "review",
  }, shared);
  expect(delivery.skills).toEqual(["/app/a/.opencode/skills"]);
  expect(delivery.instructions).toEqual(["/app/a/POKYNY.md"]);
  expect(delivery.mcp.map(([name]) => name)).toEqual(["a-konektor"]);
  expect(delivery.agents.map(([id]) => id)).toEqual(["review"]);
  expect(delivery.defaultAgent).toBe("review");
  expect([delivery.deniedProviders("opencode"), delivery.deniedProviders("openai")]).toEqual([true, false]);
  // Rovnaké pravidlá ako spoločné: nič navyše.
  expect(outsideDelivery({ policies: [{ action: "provider.use", resource: "opencode", effect: "deny" }] },
    { policies: [{ action: "provider.use", resource: "opencode", effect: "deny" }] }).providerPolicies).toEqual([]);
});

test("skilly sa hľadajú ako v engine 2.1.4: priečinok so SKILL.md, Markdown v koreni, bez skrytých priečinkov", async () => {
  const root = await realpath(await mkdtemp(join(tmpdir(), "lawoss-outside-skills-")));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, "zmluvy", "nested"), { recursive: true });
  await mkdir(join(root, ".skryty"), { recursive: true });
  await mkdir(join(root, "skupina", "podanie"), { recursive: true });
  await writeFile(join(root, "zmluvy", "SKILL.md"), "---\nname: zmluvy\ndescription: Syntetické zmluvy\n---\nTelo");
  await writeFile(join(root, "zmluvy", "nested", "SKILL.md"), "---\nname: vnoreny\n---\nNenačíta sa");
  await writeFile(join(root, ".skryty", "SKILL.md"), "---\nname: skryty\n---\nNenačíta sa");
  await writeFile(join(root, "skupina", "podanie", "SKILL.md"), "---\nname: Podanie\nmetadata:\n  opencode/autoinvoke: false\n---\nPodanie");
  await writeFile(join(root, "rychly.md"), "---\ndescription: Rýchly\ndisable-model-invocation: true\n---\nRýchly");
  const skills = await scanOutsideSkills(root);
  expect(skills.map(({ id, name, description, autoinvoke }) => ({ id, name, description, autoinvoke }))).toEqual([
    { id: "rychly", name: "rychly", description: "Rýchly", autoinvoke: false },
    { id: "podanie", name: "Podanie", description: undefined, autoinvoke: false },
    { id: "zmluvy", name: "zmluvy", description: "Syntetické zmluvy", autoinvoke: undefined },
  ]);
  expect(skills.find(skill => skill.id === "zmluvy")?.content.trim()).toBe("Telo");
  expect(await scanOutsideSkills(join(root, "chyba"))).toEqual([]);
});

test("mapa klientov outside odmietne neznámy tvar", () => {
  expect(parseOutsideClientsMap({ version: 1, clients: [{ id: "a", directory: "/a", configDirectory: "/x" }] })?.clients).toHaveLength(1);
  expect(parseOutsideClientsMap({ version: 2, clients: [] })).toBeNull();
  expect(parseOutsideClientsMap({ version: 1, clients: [{ id: "a", directory: "/a" }] })).toBeNull();
});

test("kostra agenta, ktorého má každý klient inak: len spoločné polia, nikdy povolenia ani vypnutie", () => {
  const rules = (effect: "allow" | "deny") => [{ action: "shell", resource: "rm *", effect }];
  const a = { agents: { legalwork: { system: "Prompt", mode: "primary" as const, permissions: rules("deny") }, plan: { system: "A" }, iba: { system: "len A" }, vypnuty: { system: "X" } } };
  const b = { agents: { legalwork: { system: "Prompt", mode: "primary" as const, permissions: rules("allow") }, plan: { system: "B" }, vypnuty: { system: "X", disabled: true } } };
  const shared = { default_agent: "legalwork" };
  expect(withOutsideAgentSkeletons(shared, [a, b])).toEqual({ default_agent: "legalwork", agents: { legalwork: { system: "Prompt", mode: "primary" }, plan: {} } });
  // Spoločný agent ostane, ako je; bez rozdielov nič nepribudne.
  expect(withOutsideAgentSkeletons({ agents: { legalwork: { system: "S" } } }, [a, b]).agents?.legalwork).toEqual({ system: "S" });
  expect(withOutsideAgentSkeletons(shared, [{ agents: { iba: { system: "x" } } }, {}])).toBe(shared);
  // Doručenie klientovi outside: plný agent sa líši od kostry, preto ho plugin dostane celý.
  expect(outsideDelivery(a, withOutsideAgentSkeletons(shared, [a, b])).agents.map(([id]) => id)).toEqual(["legalwork", "plan", "iba", "vypnuty"]);
});
